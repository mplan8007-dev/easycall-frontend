begin;
alter table public.easycall_voters add column if not exists call_started_at timestamptz;
-- Treat pre-migration live leases conservatively: an older client may be on a call.
update public.easycall_voters set call_started_at=now() where locked_by is not null and lock_expires_at>now() and call_started_at is null;
create index if not exists easycall_voter_normal_phone on public.easycall_voters(camp_id,(regexp_replace(phone,'[^0-9]','','g')));
create table if not exists easycall_private_v2.voter_import_runs(
 id uuid primary key,camp_id text not null,actor_id uuid not null,filename text not null,mode text not null,
 request_hash text not null,result jsonb not null,created_at timestamptz not null default now()
);
revoke all on easycall_private_v2.voter_import_runs from public,anon,authenticated;
create index if not exists easycall_import_camp_time on easycall_private_v2.voter_import_runs(camp_id,created_at desc);

create or replace function easycall_private_v2.clear_call_marker()
returns trigger language plpgsql set search_path='' as $$
begin
 if new.locked_by is null or new.locked_by is distinct from old.locked_by or (old.lock_expires_at<=now() and new.lock_expires_at>now()) then new.call_started_at:=null;end if;
 return new;
end $$;
drop trigger if exists easycall_clear_call_marker on public.easycall_voters;
create trigger easycall_clear_call_marker before update of locked_by,lock_expires_at on public.easycall_voters for each row execute function easycall_private_v2.clear_call_marker();

create or replace function public.easycall_authorize_call(p_camp_id text,p_voter_id text)
returns void language plpgsql security definer set search_path='' as $$
declare m jsonb:=public.easycall_require_camp(p_camp_id);cfg jsonb;n integer;
begin
 if m->>'easycall_role'<>'agent' then raise exception 'Agent required' using errcode='42501';end if;
 perform public.easycall_check_calling(p_camp_id);
 perform pg_advisory_xact_lock(hashtextextended('easycall:'||p_camp_id,0));
 if not exists(select 1 from public.easycall_sync_store s,lateral jsonb_array_elements(s.payload->'agentsList') e where s.store_key='MASTER_META' and e->>'campId'=p_camp_id and e->>'agentId'=m->>'agent_id') then raise exception 'Agent disabled';end if;
 select payload->'config' into cfg from public.easycall_sync_store where store_key='STATE_'||p_camp_id;
 update public.easycall_voters t set lock_expires_at=now()+interval '15 minutes',call_started_at=coalesce(call_started_at,now())
 where t.camp_id=p_camp_id and t.voter_id=p_voter_id and t.locked_by=m->>'agent_id' and t.lock_expires_at>now() and t.last_result<>'REJECT'
 and not coalesce(cfg->'dncPhones','[]') ? regexp_replace(t.phone,'[^0-9]','','g')
 and not exists(select 1 from easycall_private_v2.blocked_phone b where b.camp_id=p_camp_id and b.phone=regexp_replace(t.phone,'[^0-9]','','g'));
 get diagnostics n=row_count;if n<>1 then raise exception 'Assignment expired or blocked';end if;
end $$;

create or replace function public.easycall_release_unstarted_claim(p_camp_id text,p_voter_id text)
returns integer language plpgsql security definer set search_path='' as $$
declare m jsonb:=public.easycall_require_camp(p_camp_id);n integer;
begin
 if m->>'easycall_role'<>'agent' then raise exception 'Agent required' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended('easycall:'||p_camp_id,0));
 update public.easycall_voters set locked_by=null,lock_expires_at=null where camp_id=p_camp_id and voter_id=p_voter_id and locked_by=m->>'agent_id' and call_started_at is null;
 get diagnostics n=row_count;return n;
end $$;

create or replace function public.easycall_import_voters(p_camp_id text,p_rows jsonb,p_mode text,p_filename text,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare m jsonb:=public.easycall_require_camp(p_camp_id);prior easycall_private_v2.voter_import_runs;h text;cfg jsonb;outcome jsonb;
 added integer:=0;blocked integer:=0;duplicates integer:=0;total integer;input_count integer;reason text;verified integer;
begin
 if m->>'easycall_role' not in ('super','admin') then raise exception 'Administrator required' using errcode='42501';end if;
 if p_request_id is null or length(coalesce(p_filename,'')) not between 1 and 255 or p_mode not in ('append','replace') or p_mode is null then raise exception 'Invalid import request';end if;
 h:=md5(coalesce(p_rows::text,'null')||p_mode||p_filename);
 perform pg_advisory_xact_lock(hashtextextended('easycall:'||p_camp_id,0));
 select * into prior from easycall_private_v2.voter_import_runs where id=p_request_id;
 if found then
  if prior.actor_id<>auth.uid() or prior.camp_id<>p_camp_id or prior.request_hash<>h then raise exception 'Import request conflict' using errcode='42501';end if;
  return prior.result;
 end if;
 begin
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 10000 then raise exception '1~10,000건 파일을 선택하세요.';end if;
  input_count:=jsonb_array_length(p_rows);
  if exists(select 1 from jsonb_array_elements(p_rows) r where coalesce(r->>'id','') !~ '^[a-f0-9-]{36}$' or coalesce(r->>'phone','') !~ '^0[0-9]{8,10}$' or length(coalesce(r->>'name','')) not between 1 and 100 or length(coalesce(r->>'dong',''))>200)
   or exists(select 1 from jsonb_array_elements(p_rows) r group by r->>'phone' having count(*)>1)
   or exists(select 1 from jsonb_array_elements(p_rows) r group by r->>'id' having count(*)>1) then raise exception '파일에 잘못된 형식 또는 중복 행이 있습니다.';end if;
  if p_mode='replace' and exists(select 1 from public.easycall_voters where camp_id=p_camp_id and locked_by is not null and lock_expires_at>now()) then raise exception '배정 중인 대상이 있어 전체 교체를 중단했습니다. 새 번호만 추가하려면 추가 등록을 선택하세요.';end if;
  select payload->'config' into cfg from public.easycall_sync_store where store_key='STATE_'||p_camp_id;
  if p_mode='replace' then delete from public.easycall_voters where camp_id=p_camp_id;end if;
  select count(*) into blocked from jsonb_array_elements(p_rows) r where coalesce(cfg->'dncPhones','[]') ? (r->>'phone') or exists(select 1 from easycall_private_v2.blocked_phone b where b.camp_id=p_camp_id and b.phone=r->>'phone');
  with inserted as (insert into public.easycall_voters(camp_id,voter_id,name,phone,dong,last_result,last_memo)
   select p_camp_id,r->>'id',r->>'name',r->>'phone',coalesce(r->>'dong',''),'READY','' from jsonb_array_elements(p_rows) r
   where not coalesce(cfg->'dncPhones','[]') ? (r->>'phone')
   and not exists(select 1 from easycall_private_v2.blocked_phone b where b.camp_id=p_camp_id and b.phone=r->>'phone')
   and not exists(select 1 from public.easycall_voters v where v.camp_id=p_camp_id and regexp_replace(v.phone,'[^0-9]','','g')=r->>'phone') returning voter_id,name,phone,dong)
  select count(*),count(*) filter(where exists(select 1 from jsonb_array_elements(p_rows) r where i.voter_id=r->>'id' and i.name=r->>'name' and i.phone=r->>'phone' and i.dong=coalesce(r->>'dong',''))) into added,verified from inserted i;
  duplicates:=input_count-added-blocked;
  -- Verify the inserted IDs and values within the same transaction.
  if verified<>added then raise exception '저장 내용 확인 실패';end if;
  select count(*) into total from public.easycall_voters where camp_id=p_camp_id;
  outcome:=jsonb_build_object('success',true,'id',p_request_id,'mode',p_mode,'filename',p_filename,'input',input_count,'inserted',added,'duplicates',duplicates,'blocked',blocked,'total',total);
 exception when others then
  get stacked diagnostics reason=message_text;
  outcome:=jsonb_build_object('success',false,'id',p_request_id,'mode',p_mode,'filename',p_filename,'error',left(reason,500));
 end;
 outcome:=outcome||jsonb_build_object('createdAt',now());
 insert into easycall_private_v2.voter_import_runs values(p_request_id,p_camp_id,auth.uid(),p_filename,p_mode,h,outcome,now());
 return outcome;
end $$;

create or replace function public.easycall_import_history(p_camp_id text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare m jsonb:=public.easycall_require_camp(p_camp_id);items jsonb;
begin
 if m->>'easycall_role' not in ('super','admin') then raise exception 'Administrator required' using errcode='42501';end if;
 select coalesce(jsonb_agg(r.result order by r.created_at desc),'[]') into items from (select result,created_at from easycall_private_v2.voter_import_runs where camp_id=p_camp_id order by created_at desc limit 20) r;
 return items;
end $$;
revoke all on function public.easycall_import_voters(text,jsonb,text,text,uuid),public.easycall_import_history(text),public.easycall_release_unstarted_claim(text,text) from public,anon;
grant execute on function public.easycall_import_voters(text,jsonb,text,text,uuid),public.easycall_import_history(text),public.easycall_release_unstarted_claim(text,text) to authenticated;
notify pgrst,'reload schema';
commit;
