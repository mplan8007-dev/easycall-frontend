-- Operational scaling: indexed device lookups, parallel assignments, compact polling.
-- Apply after paging_mfa. This does not raise purchased server capacity.
begin;
create table if not exists easycall_private_v2.camp_registry(camp_id text primary key,payload jsonb not null,revision timestamptz not null default clock_timestamp());
create table if not exists easycall_private_v2.agent_registry(camp_id text not null,agent_id text not null,payload jsonb not null,revision timestamptz not null default clock_timestamp(),primary key(camp_id,agent_id));
create table if not exists easycall_private_v2.blocked_phone(camp_id text not null,phone text not null,created_at timestamptz not null default now(),primary key(camp_id,phone));
create table if not exists easycall_private_v2.runtime_cache(cache_key text primary key,payload jsonb not null,expires_at timestamptz not null,computed_at timestamptz not null default clock_timestamp());
create table if not exists easycall_private_v2.agent_counter(camp_id text not null,agent_id text not null,total bigint not null default 0,today bigint not null default 0,day date not null default (now() at time zone 'Asia/Seoul')::date,primary key(camp_id,agent_id));
revoke all on all tables in schema easycall_private_v2 from public,anon,authenticated;

create or replace function easycall_private_v2.sync_registry(p_meta jsonb)
returns void language plpgsql security definer set search_path='' as $$
begin
 insert into easycall_private_v2.camp_registry(camp_id,payload)
  select c->>'campId',c from jsonb_array_elements(coalesce(p_meta->'campsList','[]')) c
  on conflict(camp_id) do update set payload=excluded.payload,revision=clock_timestamp() where camp_registry.payload is distinct from excluded.payload;
 delete from easycall_private_v2.camp_registry r where not exists(select 1 from jsonb_array_elements(coalesce(p_meta->'campsList','[]')) c where c->>'campId'=r.camp_id);
 insert into easycall_private_v2.agent_registry(camp_id,agent_id,payload)
  select a->>'campId',a->>'agentId',a from jsonb_array_elements(coalesce(p_meta->'agentsList','[]')) a
  on conflict(camp_id,agent_id) do update set payload=excluded.payload,revision=clock_timestamp() where agent_registry.payload is distinct from excluded.payload;
 delete from easycall_private_v2.agent_registry r where not exists(select 1 from jsonb_array_elements(coalesce(p_meta->'agentsList','[]')) a where a->>'campId'=r.camp_id and a->>'agentId'=r.agent_id);
 delete from public.easycall_agent_presence p where not exists(select 1 from easycall_private_v2.agent_registry a where a.camp_id=p.camp_id and a.agent_id=p.agent_id);
 delete from easycall_private_v2.runtime_cache where cache_key='overview';
end $$;
create or replace function easycall_private_v2.sync_runtime_trigger()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.store_key='MASTER_META' then perform easycall_private_v2.sync_registry(new.payload);
 elsif left(new.store_key,6)='STATE_' then
  insert into easycall_private_v2.blocked_phone(camp_id,phone)
   select substring(new.store_key from 7),regexp_replace(p#>>'{}','[^0-9]','','g') from jsonb_array_elements(coalesce(new.payload->'config'->'dncPhones','[]')) p where p#>>'{}'<>'' on conflict do nothing;
 end if;return new;
end $$;
drop trigger if exists easycall_runtime_registry on public.easycall_sync_store;
create trigger easycall_runtime_registry after insert or update on public.easycall_sync_store for each row execute function easycall_private_v2.sync_runtime_trigger();
select easycall_private_v2.sync_registry(payload) from public.easycall_sync_store where store_key='MASTER_META';
insert into easycall_private_v2.blocked_phone(camp_id,phone)
 select substring(s.store_key from 7),regexp_replace(p#>>'{}','[^0-9]','','g') from public.easycall_sync_store s,lateral jsonb_array_elements(coalesce(s.payload->'config'->'dncPhones','[]')) p where left(s.store_key,6)='STATE_' and p#>>'{}'<>'' on conflict do nothing;
create index if not exists easycall_agent_lease_idx on public.easycall_voters(camp_id,locked_by,lock_expires_at);
create index if not exists easycall_ready_order_idx on public.easycall_voters(camp_id,voter_id) where coalesce(last_result,'READY')='READY';
create index if not exists easycall_agent_log_date_idx on public.easycall_call_logs(camp_id,agent_id,created_at desc);
create or replace function easycall_private_v2.block_imported_phone_trigger()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if coalesce(new.last_result,'READY')='READY' and exists(select 1 from easycall_private_v2.blocked_phone where camp_id=new.camp_id and phone=regexp_replace(new.phone,'[^0-9]','','g')) then new.last_result:='REJECT';end if;
 return new;
end $$;
drop trigger if exists easycall_block_imported_phone on public.easycall_voters;
create trigger easycall_block_imported_phone before insert or update of phone,last_result on public.easycall_voters for each row execute function easycall_private_v2.block_imported_phone_trigger();
update public.easycall_voters v set last_result='REJECT' where coalesce(v.last_result,'READY')='READY' and exists(select 1 from easycall_private_v2.blocked_phone b where b.camp_id=v.camp_id and b.phone=regexp_replace(v.phone,'[^0-9]','','g'));
create or replace function easycall_private_v2.count_log_trigger()
returns trigger language plpgsql security definer set search_path='' as $$
declare d date:=(now() at time zone 'Asia/Seoul')::date;
begin
 if tg_op in ('DELETE','UPDATE') then
  insert into easycall_private_v2.agent_counter(camp_id,agent_id,total,today,day) values(old.camp_id,old.agent_id,0,0,d) on conflict do nothing;
  update easycall_private_v2.agent_counter set total=greatest(0,total-1),today=greatest(0,case when day=d then today else 0 end-case when (old.created_at at time zone 'Asia/Seoul')::date=d then 1 else 0 end),day=d where camp_id=old.camp_id and agent_id=old.agent_id;
 end if;
 if tg_op in ('INSERT','UPDATE') then
  insert into easycall_private_v2.agent_counter(camp_id,agent_id,total,today,day) values(new.camp_id,new.agent_id,1,case when (new.created_at at time zone 'Asia/Seoul')::date=d then 1 else 0 end,d)
   on conflict(camp_id,agent_id) do update set total=agent_counter.total+1,today=(case when agent_counter.day=d then agent_counter.today else 0 end)+excluded.today,day=d;
 end if;
 return coalesce(new,old);
end $$;
insert into easycall_private_v2.agent_counter(camp_id,agent_id,total,today)
 select camp_id,agent_id,count(*),count(*) filter(where (created_at at time zone 'Asia/Seoul')::date=(now() at time zone 'Asia/Seoul')::date) from public.easycall_call_logs group by camp_id,agent_id
 on conflict(camp_id,agent_id) do update set total=excluded.total,today=excluded.today,day=(now() at time zone 'Asia/Seoul')::date;
drop trigger if exists easycall_log_counter on public.easycall_call_logs;
create trigger easycall_log_counter after insert or update or delete on public.easycall_call_logs for each row execute function easycall_private_v2.count_log_trigger();

create or replace function easycall_private_v2.camp_json(p_camp_id text)
returns jsonb language sql stable security definer set search_path='' as $$ select payload from easycall_private_v2.camp_registry where camp_id=p_camp_id $$;

create or replace function public.easycall_claim_voter(p_camp_id text)
returns setof public.easycall_voters language plpgsql security definer set search_path='' as $$
declare m jsonb:=public.easycall_require_camp(p_camp_id);aid text:=m->>'agent_id';v public.easycall_voters;
begin
 if m->>'easycall_role'<>'agent' then raise exception 'Agent required' using errcode='42501';end if;
 -- Import/restore use the exclusive counterpart. Agents share this gate.
 perform pg_advisory_xact_lock_shared(hashtextextended('easycall:'||p_camp_id,0));
 perform pg_advisory_xact_lock(hashtextextended('easycall-agent:'||p_camp_id||':'||aid,0));
 perform public.easycall_check_calling(p_camp_id);
 if not exists(select 1 from easycall_private_v2.agent_registry where camp_id=p_camp_id and agent_id=aid) then raise exception 'Agent disabled';end if;
 select * into v from public.easycall_voters t where t.camp_id=p_camp_id and t.locked_by=aid and t.lock_expires_at>now() and t.last_result<>'REJECT'
  and not exists(select 1 from easycall_private_v2.blocked_phone b where b.camp_id=p_camp_id and b.phone=regexp_replace(t.phone,'[^0-9]','','g')) order by voter_id for update limit 1;
 if not found then
  select * into v from public.easycall_voters t where t.camp_id=p_camp_id and coalesce(t.last_result,'READY')='READY' and (t.locked_by is null or t.lock_expires_at is null or t.lock_expires_at<=now())
   and not exists(select 1 from easycall_private_v2.blocked_phone b where b.camp_id=p_camp_id and b.phone=regexp_replace(t.phone,'[^0-9]','','g')) order by voter_id for update skip locked limit 1;
 end if;
 if not found then return;end if;
 update public.easycall_voters t set locked_by=aid,lock_expires_at=now()+interval '15 minutes',updated_at=now() where t.camp_id=p_camp_id and t.voter_id=v.voter_id returning t.* into v;
 return next v;
end $$;

create or replace function public.easycall_complete_call(p_entry jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare cid text:=p_entry->>'camp_id';m jsonb:=public.easycall_require_camp(cid);aid text:=m->>'agent_id';vid text:=p_entry->>'voter_id';result text:=p_entry->>'call_result';callid uuid:=(p_entry->>'call_id')::uuid;
 v public.easycall_voters;existing public.easycall_call_logs;inserted public.easycall_call_logs;line text;secs integer:=(p_entry->>'duration_seconds')::integer;
begin
 if m->>'easycall_role'<>'agent' then raise exception 'Agent required' using errcode='42501';end if;
 if callid is null then raise exception 'Call ID required';end if;
 perform pg_advisory_xact_lock_shared(hashtextextended('easycall:'||cid,0));
 perform pg_advisory_xact_lock(hashtextextended('easycall-agent:'||cid||':'||aid,0));
 perform pg_advisory_xact_lock(hashtextextended('easycall-call:'||callid::text,0));
 select * into existing from public.easycall_call_logs where call_id=callid;
 if found then
  if existing.camp_id<>cid or existing.agent_id<>aid or existing.voter_id::text<>vid then raise exception 'Call ID conflict';end if;return to_jsonb(existing);
 end if;
 if result is null or result not in ('CONNECTED','ABSENT','CALLBACK','REJECT','INVALID') or secs is null or secs<0 or secs>86400 then raise exception 'Invalid result';end if;
 if result='CONNECTED' and coalesce(p_entry->>'status','') not in ('SUPPORT','FAVORABLE','VOLUNTEER','OPPOSE') then raise exception 'Explicit response required';end if;
 if length(coalesce(p_entry->>'memo',''))>5000 then raise exception 'Memo too long';end if;
 select payload->>'assignedPhone' into line from easycall_private_v2.agent_registry where camp_id=cid and agent_id=aid;
 if not found then raise exception 'Agent disabled';end if;
 select * into v from public.easycall_voters t where t.camp_id=cid and t.voter_id=vid for update;
 if not found or v.locked_by is distinct from aid or v.lock_expires_at is null or v.lock_expires_at<=now() then raise exception 'Assignment expired';end if;
 insert into public.easycall_call_logs(call_id,camp_id,agent_id,used_phone,voter_id,voter_name,voter_phone,dong,gender,age,call_result,status,duration,duration_seconds,memo,call_time,created_at)
 values(callid,cid,aid,line,v.voter_id,v.name,v.phone,v.dong,left(p_entry->>'gender',20),left(p_entry->>'age',20),result,case when result='CONNECTED' then p_entry->>'status' else 'NONE' end,
 (case when secs/60<10 then '0' else '' end)||(secs/60)::text||':'||lpad((secs%60)::text,2,'0'),secs,p_entry->>'memo',to_char(now() at time zone 'Asia/Seoul','YYYY-MM-DD HH24:MI:SS'),now()) returning * into inserted;
 update public.easycall_voters t set last_result=result,last_memo=coalesce(p_entry->>'memo',''),locked_by=null,lock_expires_at=null,updated_at=now() where t.camp_id=cid and t.voter_id=vid;
 if result='REJECT' then insert into easycall_private_v2.blocked_phone(camp_id,phone) values(cid,regexp_replace(v.phone,'[^0-9]','','g')) on conflict do nothing;end if;
 return to_jsonb(inserted);
end $$;

create or replace function public.easycall_authorize_call(p_camp_id text,p_voter_id text)
returns void language plpgsql security definer set search_path='' as $$
declare m jsonb:=public.easycall_require_camp(p_camp_id);aid text:=m->>'agent_id';n integer;
begin
 if m->>'easycall_role'<>'agent' then raise exception 'Agent required' using errcode='42501';end if;
 perform pg_advisory_xact_lock_shared(hashtextextended('easycall:'||p_camp_id,0));
 perform pg_advisory_xact_lock(hashtextextended('easycall-agent:'||p_camp_id||':'||aid,0));
 perform public.easycall_check_calling(p_camp_id);
 if not exists(select 1 from easycall_private_v2.agent_registry where camp_id=p_camp_id and agent_id=aid) then raise exception 'Agent disabled';end if;
 update public.easycall_voters t set lock_expires_at=now()+interval '15 minutes' where t.camp_id=p_camp_id and t.voter_id=p_voter_id and t.locked_by=aid and t.lock_expires_at>now() and t.last_result<>'REJECT'
  and not exists(select 1 from easycall_private_v2.blocked_phone b where b.camp_id=p_camp_id and b.phone=regexp_replace(t.phone,'[^0-9]','','g'));
 get diagnostics n=row_count;if n<>1 then raise exception 'Assignment expired or blocked';end if;
end $$;

create or replace function public.easycall_agent_control(p_known_revision timestamptz default null,p_state text default 'online',p_voter_id text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare m jsonb:=public.easycall_identity();cid text:=m->>'camp_id';aid text:=m->>'agent_id';a easycall_private_v2.agent_registry;c easycall_private_v2.camp_registry;s public.easycall_sync_store;rev timestamptz;
begin
 if m->>'easycall_role'<>'agent' or p_state is null or p_state not in ('online','break','offline') then raise exception 'Agent control required' using errcode='42501';end if;
 perform public.easycall_require_camp(cid);
 select * into a from easycall_private_v2.agent_registry where camp_id=cid and agent_id=aid;if not found then raise exception 'Agent disabled';end if;
 select * into c from easycall_private_v2.camp_registry where camp_id=cid;
 select * into s from public.easycall_sync_store where store_key='STATE_'||cid;
 rev:=greatest(a.revision,c.revision,s.updated_at);
 insert into public.easycall_agent_presence(camp_id,agent_id,actor_id,state) values(cid,aid,auth.uid(),p_state)
  on conflict(camp_id,agent_id) do update set actor_id=excluded.actor_id,state=excluded.state,last_seen=now();
 if p_voter_id is not null then
  update public.easycall_voters set lock_expires_at=now()+interval '15 minutes' where camp_id=cid and voter_id=p_voter_id and locked_by=aid and lock_expires_at>now() and last_result<>'REJECT';
 end if;
 return jsonb_build_object('revision',rev,'serverTime',now(),'camp',case when p_known_revision is distinct from rev then c.payload else null end,
  'agent',case when p_known_revision is distinct from rev then a.payload else null end,
  'config',case when p_known_revision is distinct from rev then coalesce(s.payload->'config','{}')-'dncPhones' else null end,
  'ownCounts',coalesce((select jsonb_build_object('total',total,'today',case when day=(now() at time zone 'Asia/Seoul')::date then today else 0 end) from easycall_private_v2.agent_counter where camp_id=cid and agent_id=aid),'{"total":0,"today":0}'::jsonb));
end $$;

-- Existing exact aggregates remain the source; share short-lived results, never auth.
do $$ begin
 if to_regprocedure('public.easycall_camp_counts_source_v4(text)') is null then
  alter function public.easycall_camp_counts(text) rename to easycall_camp_counts_source_v4;
 end if;
end $$;
revoke all on function public.easycall_camp_counts_source_v4(text) from public,anon,authenticated;
create or replace function public.easycall_camp_counts(p_camp_id text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare m jsonb:=public.easycall_require_camp(p_camp_id);k text:='counts:'||p_camp_id||':'||case when m->>'easycall_role'='agent' then m->>'agent_id' else 'admin' end;r jsonb;cached easycall_private_v2.runtime_cache;
begin
 select * into cached from easycall_private_v2.runtime_cache where cache_key=k;
 if cached.expires_at>clock_timestamp() then return cached.payload;end if;
 if pg_try_advisory_xact_lock(hashtextextended('cache:'||k,0)) then
  r:=public.easycall_camp_counts_source_v4(p_camp_id);
  insert into easycall_private_v2.runtime_cache(cache_key,payload,expires_at) values(k,r,clock_timestamp()+interval '30 seconds') on conflict(cache_key) do update set payload=excluded.payload,expires_at=excluded.expires_at,computed_at=clock_timestamp();
  return r;
 end if;
 if cached.payload is not null then return cached.payload;end if;
 perform pg_advisory_xact_lock(hashtextextended('cache:'||k,0));
 select payload into r from easycall_private_v2.runtime_cache where cache_key=k;return coalesce(r,public.easycall_camp_counts_source_v4(p_camp_id));
end $$;
create or replace function public.easycall_runtime_status()
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin perform easycall_private_v2.require_super();return jsonb_build_object('version',4,'targetConcurrentDevices',2000,'capacityCertified',false,'connectedDevices',(select count(*) from public.easycall_agent_presence where state<>'offline' and last_seen>now()-interval '90 seconds'),'lastCacheAt',(select max(computed_at) from easycall_private_v2.runtime_cache));end $$;
create or replace function public.easycall_admin_overview_fast(p_force boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare cached easycall_private_v2.runtime_cache;r jsonb;
begin
 perform easycall_private_v2.require_super();select * into cached from easycall_private_v2.runtime_cache where cache_key='overview';
 if not coalesce(p_force,false) and cached.expires_at>clock_timestamp() then return cached.payload;end if;
 perform pg_advisory_xact_lock(hashtextextended('cache:overview',0));
 select * into cached from easycall_private_v2.runtime_cache where cache_key='overview';
 if not coalesce(p_force,false) and cached.expires_at>clock_timestamp() then return cached.payload;end if;
 r:=public.easycall_admin_overview();
 insert into easycall_private_v2.runtime_cache(cache_key,payload,expires_at) values('overview',r,clock_timestamp()+interval '20 seconds') on conflict(cache_key) do update set payload=excluded.payload,expires_at=excluded.expires_at,computed_at=clock_timestamp();return r;
end $$;
create or replace function easycall_private_v2.invalidate_overview_trigger()
returns trigger language plpgsql security definer set search_path='' as $$ begin delete from easycall_private_v2.runtime_cache where cache_key='overview';return null;end $$;
drop trigger if exists easycall_payments_overview_invalidate on public.easycall_payments;
create trigger easycall_payments_overview_invalidate after insert or update or delete on public.easycall_payments for each statement execute function easycall_private_v2.invalidate_overview_trigger();
drop trigger if exists easycall_contracts_overview_invalidate on public.easycall_camp_contracts;
create trigger easycall_contracts_overview_invalidate after insert or update or delete on public.easycall_camp_contracts for each statement execute function easycall_private_v2.invalidate_overview_trigger();

-- Preserve new DNC records in private backups. Restoring a backup never unblocks
-- a number that opted out after that backup was taken.
do $migration$
declare definition text;
begin
 select pg_get_functiondef('easycall_private_v2.snapshot(text)'::regprocedure) into definition;
 if strpos(definition,'''blocked''')=0 then
  definition:=replace(definition,'  return backup_key;',$patch$  insert into easycall_private_v2.backup_rows select backup_key,'blocked',to_jsonb(t) from easycall_private_v2.blocked_phone t;
  return backup_key;$patch$);
 end if;
 if strpos(definition,'Backup requires a maintenance window')=0 then
  definition:=replace(definition,'  perform pg_advisory_xact_lock(hashtextextended(''easycall-backup'',0));',$patch$  if exists(select 1 from public.easycall_agent_presence where state<>'offline' and last_seen>now()-interval '90 seconds') then raise exception 'Backup requires a maintenance window: 단말 접속을 종료한 뒤 백업하세요. 대규모 운영은 관리형 백업을 사용하세요.';end if;
  perform pg_advisory_xact_lock(hashtextextended('easycall-backup',0));$patch$);
 end if;
 execute definition;
 select pg_get_functiondef('easycall_private_v2.restore_core(uuid,text)'::regprocedure) into definition;
 if strpos(definition,'collection=''blocked''')=0 then
  definition:=replace(definition,'  -- Receipt records are voided',$patch$  insert into easycall_private_v2.blocked_phone(camp_id,phone) select p_camp,row_data->>'phone' from easycall_private_v2.backup_rows where backup_id=p_backup and collection='blocked' and row_data->>'camp_id'=p_camp on conflict do nothing;
  -- Receipt records are voided$patch$);
 end if;
 execute definition;
end $migration$;

-- Private function ACLs and new RPCs. Replaced public RPC signatures keep old ACLs.
do $$ declare f record;begin
 for f in select oid::regprocedure signature from pg_proc where pronamespace='easycall_private_v2'::regnamespace loop execute format('revoke all on function %s from public,anon,authenticated',f.signature);end loop;
 for f in select oid::regprocedure signature from pg_proc where pronamespace='public'::regnamespace and proname in ('easycall_agent_control','easycall_runtime_status','easycall_camp_counts','easycall_admin_overview_fast') loop
  execute format('revoke all on function %s from public,anon,authenticated',f.signature);execute format('grant execute on function %s to authenticated',f.signature);
 end loop;
end $$;
notify pgrst,'reload schema';
commit;
