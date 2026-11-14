-- Apply atomically before deploying the matching frontend. Old clients fail closed.
begin;

-- Business revision conflicts are permanent for a request, not serialization retries.
-- Preserve installed function bodies and grants while correcting their error code.
do $migration$ declare f record;begin
 for f in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname in ('easycall_admin_save_camp','easycall_admin_set_approval','easycall_call_transport_set') loop
  execute replace(pg_get_functiondef(f.oid),'errcode=''40001''','errcode=''PT409''');
 end loop;
end $migration$;

create or replace function public.easycall_save_state(p_camp_id text,p_meta jsonb,p_config jsonb,p_meta_revision timestamptz,p_state_revision timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare m jsonb:=public.easycall_require_camp(p_camp_id);oldmeta public.easycall_sync_store;oldstate public.easycall_sync_store;
  a jsonb;agents jsonb;oldagents jsonb;quota integer;rev timestamptz:=clock_timestamp();cfg jsonb;
begin
  if m->>'easycall_role' not in ('super','admin') then raise exception '관리자 권한이 필요합니다.' using errcode='42501';end if;
  if jsonb_typeof(p_meta->'agentsList') is distinct from 'array' or jsonb_typeof(p_config) is distinct from 'object' then raise exception '설정 형식 오류';end if;
  select * into oldmeta from public.easycall_sync_store where store_key='MASTER_META' for update;
  select * into oldstate from public.easycall_sync_store where store_key='STATE_'||p_camp_id for update;
  if oldmeta.updated_at is distinct from p_meta_revision or oldstate.updated_at is distinct from p_state_revision then raise exception '설정 변경 충돌' using errcode='PT409';end if;
  quota:=(easycall_private_v2.camp_json(p_camp_id)->>'tablets')::integer;
  select coalesce(jsonb_agg(e),'[]') into agents from jsonb_array_elements(p_meta->'agentsList') e where e->>'campId'=p_camp_id;
  if jsonb_array_length(agents)>quota then raise exception '서버 라이선스 한도를 초과했습니다.';end if;
  for a in select * from jsonb_array_elements(agents) loop
    if coalesce(a->>'agentId','')!~'^[a-z0-9_-]{1,64}$' or a->>'agentId'='super' or a->>'agentId' like '%master%' or a->>'agentId' like '%camp%' then raise exception '단말기 ID 형식 오류';end if;
    if length(coalesce(a->>'alias',''))>200 or length(coalesce(a->>'assignedPhone',''))>30 then raise exception '단말기 정보가 너무 깁니다.';end if;
    if exists(select 1 from jsonb_array_elements(coalesce(oldmeta.payload->'agentsList','[]')) e where e->>'campId'<>p_camp_id and e->>'agentId'=a->>'agentId') then raise exception '이미 사용 중인 단말기 ID';end if;
  end loop;
  if exists(select 1 from jsonb_array_elements(agents) e group by e->>'agentId' having count(*)>1) then raise exception '중복 단말기 ID';end if;
  if coalesce(p_config->>'startTime','08:00')!~'^([01][0-9]|2[0-3]):[0-5][0-9]$' or coalesce(p_config->>'endTime','21:00')!~'^([01][0-9]|2[0-3]):[0-5][0-9]$' then raise exception '발신 시간 형식 오류';end if;
  if length(p_config::text)>1000000 then raise exception '설정 용량 초과';end if;
  cfg:=jsonb_set(p_config,'{dncPhones}',coalesce((select jsonb_agg(distinct e) from jsonb_array_elements(coalesce(oldstate.payload->'config'->'dncPhones','[]')||coalesce(p_config->'dncPhones','[]')) e),'[]'));
  -- Stop/resume is owned exclusively by easycall_set_calling_state.
  cfg:=jsonb_set(cfg,'{globalStopped}',coalesce(oldstate.payload->'config'->'globalStopped','false'::jsonb));
  oldagents:=coalesce(oldmeta.payload->'agentsList','[]');
  update public.easycall_sync_store set payload=jsonb_set(oldmeta.payload,'{agentsList}',coalesce((select jsonb_agg(e) from jsonb_array_elements(oldagents) e where e->>'campId'<>p_camp_id),'[]')||agents),updated_at=rev where store_key='MASTER_META';
  update public.easycall_sync_store set payload=jsonb_build_object('campId',p_camp_id,'config',cfg),updated_at=rev where store_key='STATE_'||p_camp_id;
  perform easycall_private_v2.audit('camp.settings',p_camp_id,jsonb_build_object('config',oldstate.payload->'config','agents',oldagents),jsonb_build_object('config',cfg,'agents',agents));
  return jsonb_build_object('meta_revision',rev,'state_revision',rev);
end $$;

create or replace function public.easycall_set_calling_state(p_camp_id text,p_stopped boolean,p_expected_revision timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare m jsonb:=public.easycall_require_camp(p_camp_id);s public.easycall_sync_store;rev timestamptz;
begin
 if m->>'easycall_role' not in ('super','admin') or p_stopped is null then raise exception '관리자 권한이 필요합니다.' using errcode='42501';end if;
 -- Exclusive stop gate; all dialing checks acquire its shared counterpart first.
 perform pg_advisory_xact_lock(hashtextextended('easycall:'||p_camp_id,0));
 select * into s from public.easycall_sync_store where store_key='STATE_'||p_camp_id for update;
 if not found then raise exception '캠프 설정을 확인하세요.';end if;
 -- Stopping is always safe. Resuming requires a fresh, explicitly confirmed view.
 if not p_stopped and s.updated_at is distinct from p_expected_revision then raise exception '설정 변경 충돌: 최신 상태를 확인한 뒤 재개하세요.' using errcode='PT409';end if;
 rev:=clock_timestamp();
 update public.easycall_sync_store set payload=jsonb_set(s.payload,'{config}',coalesce(s.payload->'config','{}')||jsonb_build_object('globalStopped',p_stopped)),updated_at=rev where store_key=s.store_key;
 perform easycall_private_v2.audit('camp.calling_state',p_camp_id,jsonb_build_object('stopped',s.payload->'config'->'globalStopped'),jsonb_build_object('stopped',p_stopped));
 return jsonb_build_object('globalStopped',p_stopped,'revision',rev);
end $$;

alter table public.easycall_voters add column if not exists locked_session uuid;
alter table public.easycall_voters add column if not exists claim_call_id uuid;
alter table public.easycall_voters add column if not exists callback_at timestamptz;
alter table public.easycall_call_logs add column if not exists callback_at timestamptz;
create index if not exists easycall_callback_due_idx on public.easycall_voters(camp_id,callback_at) where last_result='CALLBACK';
create table if not exists easycall_private_v2.agent_sessions(
 camp_id text not null,agent_id text not null,actor_id uuid not null,session_id uuid not null,
 expires_at timestamptz not null,primary key(camp_id,agent_id)
);
alter table easycall_private_v2.agent_sessions enable row level security;
revoke all on easycall_private_v2.agent_sessions from public,anon,authenticated;

create or replace function easycall_private_v2.session_header()
returns uuid language plpgsql stable set search_path='' as $$
declare value text;
begin
 value:=coalesce(nullif(current_setting('request.headers',true),'')::jsonb,'{}')->>'x-easycall-session';
 if value is null or value!~'^[0-9a-fA-F-]{36}$' then raise exception '화면을 새로고침하고 다시 로그인하세요.' using errcode='42501';end if;
 -- Public voter rows must never reveal a usable device bearer token.
 return md5('easycall-device:'||(value::uuid)::text)::uuid;
end $$;

create or replace function easycall_private_v2.require_agent_session(p_camp_id text)
returns uuid language plpgsql security definer set search_path='' as $$
declare m jsonb:=public.easycall_require_camp(p_camp_id);sid uuid:=easycall_private_v2.session_header();
begin
 if m->>'easycall_role'<>'agent' then raise exception 'Agent required' using errcode='42501';end if;
 perform pg_advisory_xact_lock_shared(hashtextextended('easycall:'||p_camp_id,0));
 perform pg_advisory_xact_lock(hashtextextended('easycall-agent:'||p_camp_id||':'||(m->>'agent_id'),0));
 if not exists(select 1 from easycall_private_v2.agent_sessions where camp_id=p_camp_id and agent_id=m->>'agent_id' and actor_id=auth.uid() and session_id=sid and expires_at>now()) then
  raise exception '다른 기기에서 업무 중이거나 세션이 만료되었습니다. 다시 로그인하세요.' using errcode='42501';
 end if;
 if not exists(select 1 from easycall_private_v2.agent_registry where camp_id=p_camp_id and agent_id=m->>'agent_id') then raise exception 'Agent disabled' using errcode='42501';end if;
 return sid;
end $$;

create or replace function public.easycall_open_agent_session(p_previous_session uuid default null,p_takeover boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare m jsonb:=public.easycall_identity();cid text:=m->>'camp_id';aid text:=m->>'agent_id';sid uuid:=easycall_private_v2.session_header();s easycall_private_v2.agent_sessions;
begin
 perform public.easycall_require_camp(cid);
 if m->>'easycall_role'<>'agent' then raise exception 'Agent required' using errcode='42501';end if;
 perform pg_advisory_xact_lock_shared(hashtextextended('easycall:'||cid,0));
 perform pg_advisory_xact_lock(hashtextextended('easycall-agent:'||cid||':'||aid,0));
 if not exists(select 1 from easycall_private_v2.agent_registry where camp_id=cid and agent_id=aid) then raise exception 'Agent disabled';end if;
 select * into s from easycall_private_v2.agent_sessions where camp_id=cid and agent_id=aid for update;
 if found and s.session_id<>sid and s.expires_at>now() and not coalesce(s.actor_id=auth.uid() and s.session_id=md5('easycall-device:'||p_previous_session::text)::uuid,false) then
  if not coalesce(p_takeover,false) then return jsonb_build_object('active',false,'reason','다른 기기에서 이 계정으로 전화 업무를 사용 중입니다.');end if;
  if exists(select 1 from public.easycall_voters where camp_id=cid and locked_by=aid and lock_expires_at>now() and call_started_at is not null) then
   raise exception '이전 기기에서 통화를 종료하고 결과를 저장한 뒤 전환하세요.';
  end if;
 end if;
 insert into easycall_private_v2.agent_sessions values(cid,aid,auth.uid(),sid,now()+interval '4 hours')
 on conflict(camp_id,agent_id) do update set actor_id=excluded.actor_id,session_id=excluded.session_id,expires_at=excluded.expires_at;
 -- Reload rotates the document token. The previous document immediately loses access.
 update public.easycall_voters set locked_session=sid,claim_call_id=coalesce(claim_call_id,gen_random_uuid())
 where camp_id=cid and locked_by=aid and lock_expires_at>now() and (locked_session=s.session_id or locked_session is null);
 return jsonb_build_object('active',true);
end $$;

create or replace function public.easycall_close_agent_session()
returns void language plpgsql security definer set search_path='' as $$
declare m jsonb:=public.easycall_identity();sid uuid:=easycall_private_v2.require_agent_session(m->>'camp_id');
begin
 if exists(select 1 from public.easycall_voters where camp_id=m->>'camp_id' and locked_by=m->>'agent_id' and locked_session=sid and lock_expires_at>now() and call_started_at is not null) then raise exception '통화 결과를 저장한 뒤 로그아웃하세요.';end if;
 update public.easycall_voters set locked_by=null,locked_session=null,lock_expires_at=null,claim_call_id=null where camp_id=m->>'camp_id' and locked_by=m->>'agent_id' and locked_session=sid;
 delete from easycall_private_v2.agent_sessions where camp_id=m->>'camp_id' and agent_id=m->>'agent_id' and session_id=sid;
end $$;

create or replace function easycall_private_v2.claim_contact(p_camp_id text,p_voter_id text default null)
returns setof public.easycall_voters language plpgsql security definer set search_path='' as $$
declare sid uuid:=easycall_private_v2.require_agent_session(p_camp_id);m jsonb:=public.easycall_identity();aid text:=m->>'agent_id';v public.easycall_voters;prior public.easycall_voters;
begin
 perform public.easycall_check_calling(p_camp_id);
 select * into prior from public.easycall_voters where camp_id=p_camp_id and locked_by=aid and locked_session=sid and lock_expires_at>now() order by voter_id for update limit 1;
 if found and (p_voter_id is null or prior.voter_id=p_voter_id) then v:=prior;
 else
  if prior.call_started_at is not null then raise exception '진행 중인 통화 결과를 먼저 저장하세요.';end if;
  select * into v from public.easycall_voters t where t.camp_id=p_camp_id
   and (case when p_voter_id is not null then t.voter_id=p_voter_id else
     coalesce(t.last_result,'READY')='READY' or (t.last_result='CALLBACK' and coalesce(t.callback_at,now())<=now()) or (t.last_result='ABSENT' and t.updated_at<=now()-interval '30 minutes') end)
   and coalesce(t.last_result,'READY') not in ('REJECT','INVALID')
   and (t.locked_by is null or t.lock_expires_at is null or t.lock_expires_at<=now())
   and not exists(select 1 from easycall_private_v2.blocked_phone b where b.camp_id=p_camp_id and b.phone=regexp_replace(t.phone,'[^0-9]','','g'))
   order by case when t.last_result='CALLBACK' then 0 when t.last_result='READY' then 1 else 2 end,t.callback_at nulls last,t.voter_id for update skip locked limit 1;
  if not found then
   if p_voter_id is not null then raise exception '다른 담당자가 사용 중이거나 발신할 수 없는 연락처입니다.';end if;
   return;
  end if;
  if prior.voter_id is not null then update public.easycall_voters set locked_by=null,locked_session=null,lock_expires_at=null,claim_call_id=null where camp_id=p_camp_id and voter_id=prior.voter_id;end if;
  update public.easycall_voters set locked_by=aid,locked_session=sid,claim_call_id=gen_random_uuid(),lock_expires_at=now()+interval '15 minutes',updated_at=now() where camp_id=p_camp_id and voter_id=v.voter_id returning * into v;
 end if;
 if v.last_result='REJECT' or exists(select 1 from easycall_private_v2.blocked_phone where camp_id=p_camp_id and phone=regexp_replace(v.phone,'[^0-9]','','g')) then raise exception '수신거부 대상입니다.';end if;
 return next v;
end $$;

create or replace function public.easycall_claim_voter(p_camp_id text)
returns setof public.easycall_voters language sql security definer set search_path='' as $$select * from easycall_private_v2.claim_contact(p_camp_id)$$;
create or replace function public.easycall_claim_selected_voter(p_camp_id text,p_voter_id text)
returns setof public.easycall_voters language sql security definer set search_path='' as $$select * from easycall_private_v2.claim_contact(p_camp_id,p_voter_id)$$;

create or replace function public.easycall_resume_assignment(p_call_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare m jsonb:=public.easycall_identity();sid uuid:=easycall_private_v2.require_agent_session(m->>'camp_id');v public.easycall_voters;
begin
 if p_call_id is not null and exists(select 1 from public.easycall_call_logs where call_id=p_call_id and camp_id=m->>'camp_id' and agent_id=m->>'agent_id') then return jsonb_build_object('completed',true);end if;
 select * into v from public.easycall_voters where camp_id=m->>'camp_id' and locked_by=m->>'agent_id' and locked_session=sid and lock_expires_at>now() order by voter_id limit 1;
 return jsonb_build_object('assignment',case when found then to_jsonb(v) else null end,'serverTime',now());
end $$;

create or replace function public.easycall_authorize_call(p_camp_id text,p_voter_id text)
returns void language plpgsql security definer set search_path='' as $$
declare sid uuid:=easycall_private_v2.require_agent_session(p_camp_id);m jsonb:=public.easycall_identity();n integer;
begin
 perform public.easycall_check_calling(p_camp_id);
 update public.easycall_voters t set lock_expires_at=now()+interval '4 hours',call_started_at=coalesce(call_started_at,now())
 where t.camp_id=p_camp_id and t.voter_id=p_voter_id and t.locked_by=m->>'agent_id' and t.locked_session=sid and t.lock_expires_at>now() and t.last_result not in ('REJECT','INVALID')
 and not exists(select 1 from easycall_private_v2.blocked_phone b where b.camp_id=p_camp_id and b.phone=regexp_replace(t.phone,'[^0-9]','','g'));
 get diagnostics n=row_count;if n<>1 then raise exception '배정이 만료되었거나 발신이 차단되었습니다. 입력을 보존하고 업무 복구를 확인하세요.';end if;
 update easycall_private_v2.agent_sessions set expires_at=now()+interval '4 hours' where camp_id=p_camp_id and agent_id=m->>'agent_id';
end $$;


create or replace function public.easycall_complete_call(p_entry jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare cid text:=p_entry->>'camp_id';m jsonb:=public.easycall_require_camp(cid);aid text:=m->>'agent_id';vid text:=p_entry->>'voter_id';result text:=p_entry->>'call_result';callid uuid:=(p_entry->>'call_id')::uuid;
 sid uuid;callbacktime timestamptz;v public.easycall_voters;existing public.easycall_call_logs;inserted public.easycall_call_logs;line text;secs integer:=(p_entry->>'duration_seconds')::integer;
begin
 if m->>'easycall_role'<>'agent' then raise exception 'Agent required' using errcode='42501';end if;
 sid:=easycall_private_v2.require_agent_session(cid);
 callbacktime:=nullif(p_entry->>'callback_at','')::timestamptz;
 if callid is null then raise exception 'Call ID required';end if;
 perform pg_advisory_xact_lock_shared(hashtextextended('easycall:'||cid,0));
 perform pg_advisory_xact_lock(hashtextextended('easycall-agent:'||cid||':'||aid,0));
 perform pg_advisory_xact_lock(hashtextextended('easycall-call:'||callid::text,0));
 select * into existing from public.easycall_call_logs where call_id=callid;
 if found then
  if existing.camp_id<>cid or existing.agent_id<>aid or existing.voter_id::text<>vid then raise exception 'Call ID conflict';end if;return to_jsonb(existing);
 end if;
 if callbacktime is not null and (result<>'CALLBACK' or callbacktime<=now() or callbacktime>now()+interval '1 year') then raise exception '재통화 예약 시간을 확인하세요.';end if;
 if result is null or result not in ('CONNECTED','ABSENT','CALLBACK','REJECT','INVALID') or secs is null or secs<0 or secs>86400 then raise exception 'Invalid result';end if;
 if result='CONNECTED' and coalesce(p_entry->>'status','') not in ('SUPPORT','FAVORABLE','VOLUNTEER','OPPOSE','NO_OPINION','NO_RESPONSE') then raise exception 'Explicit response required';end if;
 if length(coalesce(p_entry->>'memo',''))>5000 then raise exception 'Memo too long';end if;
 select payload->>'assignedPhone' into line from easycall_private_v2.agent_registry where camp_id=cid and agent_id=aid;
 if not found then raise exception 'Agent disabled';end if;
 select * into v from public.easycall_voters t where t.camp_id=cid and t.voter_id=vid for update;
 if not found or v.locked_by is distinct from aid or v.locked_session is distinct from sid or v.claim_call_id is distinct from callid or v.lock_expires_at is null or v.lock_expires_at<=now() then raise exception 'Assignment expired';end if;
 insert into public.easycall_call_logs(call_id,camp_id,agent_id,used_phone,voter_id,voter_name,voter_phone,dong,gender,age,call_result,status,duration,duration_seconds,memo,call_time,created_at)
 values(callid,cid,aid,line,v.voter_id,v.name,v.phone,v.dong,left(p_entry->>'gender',20),left(p_entry->>'age',20),result,case when result='CONNECTED' then p_entry->>'status' else 'NONE' end,
 (case when secs/60<10 then '0' else '' end)||(secs/60)::text||':'||lpad((secs%60)::text,2,'0'),secs,p_entry->>'memo',to_char(now() at time zone 'Asia/Seoul','YYYY-MM-DD HH24:MI:SS'),now()) returning * into inserted;
 update public.easycall_voters t set last_result=result,last_memo=coalesce(p_entry->>'memo',''),locked_by=null,locked_session=null,claim_call_id=null,lock_expires_at=null,callback_at=case when result='CALLBACK' then callbacktime else null end,updated_at=now() where t.camp_id=cid and t.voter_id=vid;
 if result='REJECT' then insert into easycall_private_v2.blocked_phone(camp_id,phone) values(cid,regexp_replace(v.phone,'[^0-9]','','g')) on conflict do nothing;end if;
 update public.easycall_call_logs set callback_at=callbacktime where call_id=callid returning * into inserted;
 return to_jsonb(inserted);
end $$;

create or replace function public.easycall_agent_control(p_known_revision timestamptz default null,p_state text default 'online',p_voter_id text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare m jsonb:=public.easycall_identity();cid text:=m->>'camp_id';aid text:=m->>'agent_id';a easycall_private_v2.agent_registry;c easycall_private_v2.camp_registry;s public.easycall_sync_store;rev timestamptz;sid uuid;
begin
 if m->>'easycall_role'<>'agent' or p_state is null or p_state not in ('online','break','offline') then raise exception 'Agent control required' using errcode='42501';end if;
 sid:=easycall_private_v2.require_agent_session(cid);
 update easycall_private_v2.agent_sessions set expires_at=now()+interval '4 hours' where camp_id=cid and agent_id=aid;
 select * into a from easycall_private_v2.agent_registry where camp_id=cid and agent_id=aid;if not found then raise exception 'Agent disabled';end if;
 select * into c from easycall_private_v2.camp_registry where camp_id=cid;
 select * into s from public.easycall_sync_store where store_key='STATE_'||cid;
 rev:=greatest(a.revision,c.revision,s.updated_at);
 insert into public.easycall_agent_presence(camp_id,agent_id,actor_id,state) values(cid,aid,auth.uid(),p_state)
  on conflict(camp_id,agent_id) do update set actor_id=excluded.actor_id,state=excluded.state,last_seen=now();
 if p_voter_id is not null then
  update public.easycall_voters set lock_expires_at=greatest(lock_expires_at,now()+interval '15 minutes') where camp_id=cid and voter_id=p_voter_id and locked_by=aid and locked_session=sid and lock_expires_at>now() and last_result<>'REJECT';
 end if;
 return jsonb_build_object('revision',rev,'serverTime',now(),'assignmentValid',case when p_voter_id is null then null else exists(select 1 from public.easycall_voters where camp_id=cid and voter_id=p_voter_id and locked_by=aid and locked_session=sid and lock_expires_at>now()) end,'camp',case when p_known_revision is distinct from rev then c.payload else null end,
  'agent',case when p_known_revision is distinct from rev then a.payload else null end,
  'config',case when p_known_revision is distinct from rev then coalesce(s.payload->'config','{}')-'dncPhones'-'sosAlert' else null end,
  'ownCounts',coalesce((select jsonb_build_object('total',total,'today',case when day=(now() at time zone 'Asia/Seoul')::date then today else 0 end) from easycall_private_v2.agent_counter where camp_id=cid and agent_id=aid),'{"total":0,"today":0}'::jsonb));
end $$;

create or replace function public.easycall_release_unstarted_claim(p_camp_id text,p_voter_id text)
returns integer language plpgsql security definer set search_path='' as $$
declare m jsonb:=public.easycall_require_camp(p_camp_id);n integer;
begin
 if m->>'easycall_role'<>'agent' then raise exception 'Agent required' using errcode='42501';end if;
 perform easycall_private_v2.require_agent_session(p_camp_id);
 update public.easycall_voters set locked_by=null,lock_expires_at=null,locked_session=null,claim_call_id=null where camp_id=p_camp_id and voter_id=p_voter_id and locked_by=m->>'agent_id' and call_started_at is null;
 get diagnostics n=row_count;return n;
end $$;

create or replace function public.easycall_authorize_message(p_camp_id text, p_voter_id text)
returns void language plpgsql security definer set search_path='' as $$
declare m jsonb:=public.easycall_require_camp(p_camp_id); cfg jsonb;
begin
 if m->>'easycall_role'<>'agent' then raise exception 'Agent required' using errcode='42501'; end if;
 perform easycall_private_v2.require_agent_session(p_camp_id);
 perform public.easycall_check_calling(p_camp_id);

 if not exists(select 1 from public.easycall_sync_store s, lateral jsonb_array_elements(s.payload->'agentsList') e
   where s.store_key='MASTER_META' and e->>'campId'=p_camp_id and e->>'agentId'=m->>'agent_id') then
  raise exception 'Agent disabled';
 end if;
 select payload->'config' into cfg from public.easycall_sync_store where store_key='STATE_'||p_camp_id;
 if not exists(select 1 from public.easycall_voters t where t.camp_id=p_camp_id and t.voter_id=p_voter_id
   and t.locked_by=m->>'agent_id' and t.lock_expires_at>now() and t.last_result<>'REJECT'
   and not coalesce(cfg->'dncPhones','[]') ? regexp_replace(t.phone,'[^0-9]','','g')
   and not exists(select 1 from easycall_private_v2.blocked_phone b where b.camp_id=p_camp_id
     and b.phone=regexp_replace(t.phone,'[^0-9]','','g'))) then
  raise exception 'Assignment expired or blocked';
 end if;
end $$;

create or replace function public.easycall_list_page(p_camp_id text,p_kind text,p_offset integer default 0,p_limit integer default 50,p_query text default '',p_callback boolean default false,p_as_of timestamptz default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare m jsonb:=public.easycall_require_camp(p_camp_id);items jsonb;total bigint;cutoff timestamptz:=coalesce(p_as_of,now());q text:=lower(trim(coalesce(p_query,'')));off integer:=greatest(0,coalesce(p_offset,0));lim integer:=coalesce(p_limit,50);
begin
 if p_kind not in ('voters','logs','history') or lim not between 1 and 100 or length(q)>200 then raise exception '목록 조회 조건 오류';end if;
 if p_kind='logs' and m->>'easycall_role'='agent' then raise exception '관리자 권한 필요' using errcode='42501';end if;
 if p_kind='voters' then
   select count(*) into total from public.easycall_voters v where camp_id=p_camp_id and (not coalesce(p_callback,false) or last_result in ('ABSENT','CALLBACK')) and (q='' or strpos(lower(concat_ws(' ',v.name,v.phone,v.dong,v.voter_id)),q)>0);
   select coalesce(jsonb_agg(to_jsonb(t) order by t.uid),'[]') into items from (select uid,voter_id,camp_id,name,phone,dong,last_result,last_memo,callback_at,case when lock_expires_at>now() then locked_by else null end as locked_by from public.easycall_voters v where camp_id=p_camp_id and (not coalesce(p_callback,false) or last_result in ('ABSENT','CALLBACK')) and (q='' or strpos(lower(concat_ws(' ',v.name,v.phone,v.dong,v.voter_id)),q)>0) order by uid offset off limit lim) t;
 else
   select count(*) into total from public.easycall_call_logs l where camp_id=p_camp_id and (created_at<=cutoff or created_at is null) and (p_kind<>'history' or l.agent_id=m->>'agent_id');
   select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc nulls last,t.id desc),'[]') into items from (select * from public.easycall_call_logs l where camp_id=p_camp_id and (created_at<=cutoff or created_at is null) and (p_kind<>'history' or l.agent_id=m->>'agent_id') order by created_at desc nulls last,id desc offset off limit lim) t;
 end if;
 return jsonb_build_object('items',items,'total',total,'offset',off,'limit',lim,'asOf',cutoff);
end $$;



revoke all on function easycall_private_v2.session_header(),easycall_private_v2.require_agent_session(text),easycall_private_v2.claim_contact(text,text) from public,anon,authenticated;
revoke all on function public.easycall_set_calling_state(text,boolean,timestamptz),public.easycall_open_agent_session(uuid,boolean),public.easycall_close_agent_session(),public.easycall_claim_selected_voter(text,text),public.easycall_resume_assignment(uuid) from public,anon;
grant execute on function public.easycall_set_calling_state(text,boolean,timestamptz),public.easycall_open_agent_session(uuid,boolean),public.easycall_close_agent_session(),public.easycall_claim_selected_voter(text,text),public.easycall_resume_assignment(uuid) to authenticated;
notify pgrst,'reload schema';
commit;
