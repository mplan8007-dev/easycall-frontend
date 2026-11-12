-- Review and apply to a BACKUP/STAGING Supabase database before frontend deployment.
-- Existing table columns must match the original index.html contract.
begin;

create table if not exists public.easycall_sync_store (
  store_key text primary key, payload jsonb not null default '{}',
  updated_at timestamptz not null default clock_timestamp()
);
create table if not exists public.easycall_voters (
  uid uuid primary key default gen_random_uuid(), camp_id text not null,
  voter_id text not null, name text not null, phone text not null, dong text default '',
  last_result text default 'READY', last_memo text default '', locked_by text,
  updated_at timestamptz default now()
);
create table if not exists public.easycall_call_logs (
  id uuid primary key default gen_random_uuid(), camp_id text not null, agent_id text not null,
  used_phone text, voter_id text, voter_name text, voter_phone text, dong text,
  gender text, age text, call_result text, status text, duration text, memo text, call_time text
);
alter table public.easycall_voters add column if not exists lock_expires_at timestamptz;
alter table public.easycall_call_logs add column if not exists call_id uuid default gen_random_uuid();
alter table public.easycall_call_logs add column if not exists created_at timestamptz default now();
alter table public.easycall_call_logs add column if not exists duration_seconds integer default 0;
create unique index if not exists easycall_call_id_unique on public.easycall_call_logs(call_id);
create unique index if not exists easycall_voter_id_unique on public.easycall_voters(camp_id,voter_id);
create index if not exists easycall_queue_idx on public.easycall_voters(camp_id,last_result,lock_expires_at);
create index if not exists easycall_log_date_idx on public.easycall_call_logs(camp_id,created_at desc);

-- Live Auth metadata is checked on every operation, including after role revocation.
create or replace function public.easycall_identity()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare m jsonb;
begin
  select raw_app_meta_data into m from auth.users where id = auth.uid();
  if m is null or coalesce(m->>'easycall_role','') not in ('super','admin','agent') then
    raise exception 'Authenticated EasyCall account required' using errcode='42501';
  end if;
  if m->>'easycall_role' <> 'super' and coalesce(m->>'camp_id','') !~ '^[a-z0-9_-]{1,64}$' then
    raise exception 'Invalid camp identity' using errcode='42501';
  end if;
  if m->>'easycall_role' = 'agent' and coalesce(m->>'agent_id','') !~ '^[a-z0-9_-]{1,64}$' then
    raise exception 'Invalid agent identity' using errcode='42501';
  end if;
  return m;
end $$;

create or replace function public.easycall_require_camp(p_camp_id text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare m jsonb := public.easycall_identity(); c jsonb;
begin
  if p_camp_id is null or p_camp_id !~ '^[a-z0-9_-]{1,64}$' then raise exception 'Invalid camp'; end if;
  if m->>'easycall_role' <> 'super' and m->>'camp_id' <> p_camp_id then
    raise exception 'Camp access denied' using errcode='42501';
  end if;
  if m->>'easycall_role' <> 'super' then
    select e into c from public.easycall_sync_store s,
      lateral jsonb_array_elements(coalesce(s.payload->'campsList','[]')) e
      where s.store_key='MASTER_META' and e->>'campId'=p_camp_id;
    if c is null or coalesce((c->>'approved')::boolean,false) is not true then
      raise exception 'Camp disabled' using errcode='42501';
    end if;
  end if;
  return m;
end $$;

create or replace function public.easycall_read_state()
returns table(store_key text,payload jsonb,updated_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare m jsonb := public.easycall_identity(); cid text := m->>'camp_id';
begin
  if m->>'easycall_role'='super' then
    return query select s.store_key,s.payload,s.updated_at from public.easycall_sync_store s
      where s.store_key='MASTER_META' or s.store_key like 'STATE_%';
  else
    perform public.easycall_require_camp(cid);
    return query select s.store_key,
      case when s.store_key='MASTER_META' then jsonb_build_object(
        'campsList',coalesce((select jsonb_agg(e) from jsonb_array_elements(s.payload->'campsList') e where e->>'campId'=cid),'[]'),
        'agentsList',coalesce((select jsonb_agg(e) from jsonb_array_elements(s.payload->'agentsList') e
          where e->>'campId'=cid and (m->>'easycall_role'='admin' or e->>'agentId'=m->>'agent_id')),'[]'))
      else jsonb_build_object('campId',cid,'config',coalesce(s.payload->'config','{}')) end,
      s.updated_at from public.easycall_sync_store s
      where s.store_key in ('MASTER_META','STATE_'||cid);
  end if;
end $$;

-- Both revisions are checked and both rows are changed in one transaction.
create or replace function public.easycall_save_state(
  p_camp_id text,p_meta jsonb,p_config jsonb,p_meta_revision timestamptz,p_state_revision timestamptz
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare m jsonb := public.easycall_require_camp(p_camp_id); oldmeta public.easycall_sync_store;
  oldstate public.easycall_sync_store; nextmeta jsonb; a jsonb; c jsonb;
  rev timestamptz := clock_timestamp(); combined jsonb;
begin
  if m->>'easycall_role' not in ('super','admin') then raise exception 'Administrator required' using errcode='42501'; end if;
  if jsonb_typeof(p_meta->'campsList') <> 'array' or jsonb_typeof(p_meta->'agentsList') <> 'array'
    or jsonb_typeof(p_config) <> 'object' then raise exception 'Invalid state'; end if;
  select * into oldmeta from public.easycall_sync_store where store_key='MASTER_META' for update;
  if oldmeta.updated_at is distinct from p_meta_revision then raise exception 'State conflict: reload first' using errcode='40001'; end if;
  select * into oldstate from public.easycall_sync_store where store_key='STATE_'||p_camp_id for update;
  if oldstate.updated_at is distinct from p_state_revision then raise exception 'Camp state conflict: reload first' using errcode='40001'; end if;
  -- An administrative settings save cannot erase previously recorded opt-outs.
  p_config := jsonb_set(p_config,'{dncPhones}',
    coalesce((select jsonb_agg(distinct e) from jsonb_array_elements(
      coalesce(oldstate.payload->'config'->'dncPhones','[]') || coalesce(p_config->'dncPhones','[]')) e),'[]'));
  if m->>'easycall_role'='super' then nextmeta := p_meta;
  else
    combined := coalesce((select jsonb_agg(e) from jsonb_array_elements(oldmeta.payload->'agentsList') e where e->>'campId'<>p_camp_id),'[]')
      || coalesce((select jsonb_agg(e) from jsonb_array_elements(p_meta->'agentsList') e where e->>'campId'=p_camp_id),'[]');
    nextmeta := jsonb_set(oldmeta.payload,'{agentsList}',combined);
  end if;
  for c in select * from jsonb_array_elements(nextmeta->'campsList') loop
    if coalesce(c->>'campId','') !~ '^[a-z0-9_-]{1,64}$' then raise exception 'Invalid camp ID'; end if;
  end loop;
  for a in select * from jsonb_array_elements(nextmeta->'agentsList') loop
    if coalesce(a->>'agentId','') !~ '^[a-z0-9_-]{1,64}$' or coalesce(a->>'campId','') !~ '^[a-z0-9_-]{1,64}$' then raise exception 'Invalid agent ID'; end if;
  end loop;
  if exists(select 1 from jsonb_array_elements(nextmeta->'agentsList') e group by e->>'agentId' having count(*)>1)
    or exists(select 1 from jsonb_array_elements(nextmeta->'campsList') e group by e->>'campId' having count(*)>1) then raise exception 'Duplicate identity'; end if;
  insert into public.easycall_sync_store(store_key,payload,updated_at) values('MASTER_META',nextmeta,rev)
    on conflict(store_key) do update set payload=excluded.payload,updated_at=excluded.updated_at;
  insert into public.easycall_sync_store(store_key,payload,updated_at)
    values('STATE_'||p_camp_id,jsonb_build_object('campId',p_camp_id,'config',p_config),rev)
    on conflict(store_key) do update set payload=excluded.payload,updated_at=excluded.updated_at;
  -- New camps start with empty operational state, never sample contacts.
  for c in select * from jsonb_array_elements(nextmeta->'campsList') loop
    insert into public.easycall_sync_store(store_key,payload,updated_at)
      values('STATE_'||(c->>'campId'),jsonb_build_object('campId',c->>'campId','config','{}'::jsonb),rev)
      on conflict(store_key) do nothing;
  end loop;
  return jsonb_build_object('meta_revision',rev,'state_revision',rev);
end $$;

-- Calling controls use server time in Asia/Seoul. These are operational settings,
-- not a statement that any particular calling hours are legally permitted.
create or replace function public.easycall_check_calling(p_camp_id text)
returns void language plpgsql stable security definer set search_path = '' as $$
declare cfg jsonb; hm text := to_char(now() at time zone 'Asia/Seoul','HH24:MI');
  st text; en text;
begin
  perform public.easycall_require_camp(p_camp_id);
  select payload->'config' into cfg from public.easycall_sync_store where store_key='STATE_'||p_camp_id;
  if coalesce((cfg->>'globalStopped')::boolean,false) then raise exception 'Calling stopped'; end if;
  st := coalesce(cfg->>'startTime','08:00'); en := coalesce(cfg->>'endTime','21:00');
  if st !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or en !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then raise exception 'Invalid calling hours'; end if;
  if coalesce((cfg->>'nightLock')::boolean,true) and not
    (case when st<=en then hm>=st and hm<=en else hm>=st or hm<=en end) then raise exception 'Outside configured hours'; end if;
end $$;

create or replace function public.easycall_claim_voter(p_camp_id text)
returns setof public.easycall_voters language plpgsql security definer set search_path = '' as $$
declare m jsonb := public.easycall_require_camp(p_camp_id); aid text := m->>'agent_id'; v public.easycall_voters; cfg jsonb;
begin
  if m->>'easycall_role'<>'agent' then raise exception 'Agent required' using errcode='42501'; end if;
  perform public.easycall_check_calling(p_camp_id);
  -- Serialize claim/import for one camp; row locks still use SKIP LOCKED.
  perform pg_advisory_xact_lock(hashtextextended('easycall:'||p_camp_id,0));
  if not exists(select 1 from public.easycall_sync_store s,
    lateral jsonb_array_elements(s.payload->'agentsList') e
    where s.store_key='MASTER_META' and e->>'campId'=p_camp_id and e->>'agentId'=aid) then raise exception 'Agent disabled'; end if;
  select payload->'config' into cfg from public.easycall_sync_store where store_key='STATE_'||p_camp_id;
  -- Reuse a still-active assignment when a request is repeated or page is reloaded.
  select * into v from public.easycall_voters t where t.camp_id=p_camp_id and t.locked_by=aid
    and t.lock_expires_at>now() and t.last_result<>'REJECT'
    order by t.voter_id for update skip locked limit 1;
  if not found then
    select * into v from public.easycall_voters t where t.camp_id=p_camp_id
      and coalesce(t.last_result,'READY')='READY'
      and (t.locked_by is null or t.lock_expires_at is null or t.lock_expires_at<=now())
      and not coalesce(cfg->'dncPhones','[]') ? regexp_replace(t.phone,'[^0-9]','','g')
      order by t.voter_id for update skip locked limit 1;
  end if;
  if not found then return; end if;
  update public.easycall_voters t set locked_by=aid,lock_expires_at=now()+interval '15 minutes',updated_at=now()
    where t.camp_id=p_camp_id and t.voter_id=v.voter_id returning t.* into v;
  return next v;
end $$;

create or replace function public.easycall_complete_call(p_entry jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare cid text := p_entry->>'camp_id'; m jsonb := public.easycall_require_camp(cid);
  aid text := m->>'agent_id'; vid text := p_entry->>'voter_id'; result text := p_entry->>'call_result';
  callid uuid := (p_entry->>'call_id')::uuid; v public.easycall_voters; existing public.easycall_call_logs;
  inserted public.easycall_call_logs; cfg jsonb; line text; secs integer := (p_entry->>'duration_seconds')::integer;
begin
  if m->>'easycall_role'<>'agent' then raise exception 'Agent required' using errcode='42501'; end if;
  if callid is null then raise exception 'Call ID required'; end if;
  perform pg_advisory_xact_lock(hashtextextended('easycall:'||cid,0));
  select * into existing from public.easycall_call_logs where call_id=callid;
  if found then
    if existing.camp_id<>cid or existing.agent_id<>aid or existing.voter_id::text<>vid then raise exception 'Call ID conflict'; end if;
    return to_jsonb(existing);
  end if;
  if result is null or result not in ('CONNECTED','ABSENT','CALLBACK','REJECT','INVALID') or secs is null or secs<0 or secs>86400 then raise exception 'Invalid result'; end if;
  if result='CONNECTED' and coalesce(p_entry->>'status','') not in ('SUPPORT','FAVORABLE','VOLUNTEER','OPPOSE') then raise exception 'Explicit response required'; end if;
  if length(coalesce(p_entry->>'memo',''))>5000 then raise exception 'Memo too long'; end if;
  select * into v from public.easycall_voters t where t.camp_id=cid and t.voter_id::text=vid for update;
  if not found or v.locked_by is distinct from aid or v.lock_expires_at is null or v.lock_expires_at<=now() then raise exception 'Assignment expired'; end if;
  select e->>'assignedPhone' into line from public.easycall_sync_store s,
    lateral jsonb_array_elements(s.payload->'agentsList') e
    where s.store_key='MASTER_META' and e->>'campId'=cid and e->>'agentId'=aid;
  if not found then raise exception 'Agent disabled'; end if;
  insert into public.easycall_call_logs(call_id,camp_id,agent_id,used_phone,voter_id,voter_name,voter_phone,dong,
    gender,age,call_result,status,duration,duration_seconds,memo,call_time,created_at)
    values(callid,cid,aid,line,v.voter_id,v.name,v.phone,v.dong,left(p_entry->>'gender',20),left(p_entry->>'age',20),
      result,case when result='CONNECTED' then p_entry->>'status' else 'NONE' end,
      (case when secs/60<10 then '0' else '' end)||(secs/60)::text||':'||lpad((secs%60)::text,2,'0'),secs,p_entry->>'memo',
      to_char(now() at time zone 'Asia/Seoul','YYYY-MM-DD HH24:MI:SS'),now()) returning * into inserted;
  update public.easycall_voters t set last_result=result,last_memo=coalesce(p_entry->>'memo',''),
    locked_by=null,lock_expires_at=null,updated_at=now() where t.camp_id=cid and t.voter_id=v.voter_id;
  if result='REJECT' then
    select payload->'config' into cfg from public.easycall_sync_store where store_key='STATE_'||cid for update;
    if not coalesce(cfg->'dncPhones','[]') ? regexp_replace(v.phone,'[^0-9]','','g') then
      cfg := jsonb_set(coalesce(cfg,'{}'),'{dncPhones}',coalesce(cfg->'dncPhones','[]')||to_jsonb(regexp_replace(v.phone,'[^0-9]','','g')));
      update public.easycall_sync_store set payload=jsonb_set(payload,'{config}',cfg),updated_at=clock_timestamp() where store_key='STATE_'||cid;
    end if;
  end if;
  return to_jsonb(inserted);
end $$;

create or replace function public.easycall_authorize_call(p_camp_id text,p_voter_id text)
returns void language plpgsql security definer set search_path = '' as $$
declare m jsonb := public.easycall_require_camp(p_camp_id); cfg jsonb; n integer;
begin
  if m->>'easycall_role'<>'agent' then raise exception 'Agent required' using errcode='42501'; end if;
  perform public.easycall_check_calling(p_camp_id);
  perform pg_advisory_xact_lock(hashtextextended('easycall:'||p_camp_id,0));
  if not exists(select 1 from public.easycall_sync_store s,
    lateral jsonb_array_elements(s.payload->'agentsList') e where s.store_key='MASTER_META'
    and e->>'campId'=p_camp_id and e->>'agentId'=m->>'agent_id') then raise exception 'Agent disabled'; end if;
  select payload->'config' into cfg from public.easycall_sync_store where store_key='STATE_'||p_camp_id;
  update public.easycall_voters t set lock_expires_at=now()+interval '15 minutes'
    where t.camp_id=p_camp_id and t.voter_id::text=p_voter_id and t.locked_by=m->>'agent_id'
    and t.lock_expires_at>now() and t.last_result<>'REJECT'
    and not coalesce(cfg->'dncPhones','[]') ? regexp_replace(t.phone,'[^0-9]','','g');
  get diagnostics n = row_count;
  if n<>1 then raise exception 'Assignment expired or blocked'; end if;
end $$;

create or replace function public.easycall_agent_signal(p_status text,p_sos boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare m jsonb := public.easycall_identity(); cid text := m->>'camp_id'; aid text := m->>'agent_id';
  meta jsonb; agents jsonb; a jsonb; cfg jsonb; contact public.easycall_voters;
begin
  perform public.easycall_require_camp(cid);
  if m->>'easycall_role'<>'agent' then raise exception 'Agent required' using errcode='42501'; end if;
  if p_status not in ('근무 중 🟢','휴식 중 ☕') then raise exception 'Invalid status'; end if;
  select payload into meta from public.easycall_sync_store where store_key='MASTER_META' for update;
  select e into a from jsonb_array_elements(meta->'agentsList') e where e->>'campId'=cid and e->>'agentId'=aid;
  if not found then raise exception 'Agent disabled'; end if;
  select jsonb_agg(case when e->>'campId'=cid and e->>'agentId'=aid then jsonb_set(e,'{status}',to_jsonb(p_status)) else e end)
    into agents from jsonb_array_elements(meta->'agentsList') e;
  update public.easycall_sync_store set payload=jsonb_set(meta,'{agentsList}',agents),updated_at=clock_timestamp() where store_key='MASTER_META';
  if p_sos then
    select payload->'config' into cfg from public.easycall_sync_store where store_key='STATE_'||cid for update;
    select * into contact from public.easycall_voters where camp_id=cid and locked_by=aid and lock_expires_at>now() limit 1;
    cfg := jsonb_set(coalesce(cfg,'{}'),'{sosAlert}',jsonb_build_object('agentId',aid,'alias',a->>'alias',
      'voterName',coalesce(contact.name,'미상'),'voterPhone',coalesce(contact.phone,'-'),
      'time',to_char(now() at time zone 'Asia/Seoul','HH24:MI:SS')));
    update public.easycall_sync_store set payload=jsonb_set(payload,'{config}',cfg),updated_at=clock_timestamp() where store_key='STATE_'||cid;
  end if;
end $$;

-- Validate before deleting; any exception rolls the entire replacement back.
create or replace function public.easycall_replace_voters(p_camp_id text,p_rows jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare m jsonb := public.easycall_require_camp(p_camp_id); r jsonb; cfg jsonb; n integer := 0;
begin
  if m->>'easycall_role' not in ('super','admin') then raise exception 'Administrator required' using errcode='42501'; end if;
  if jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows) not between 1 and 10000 then raise exception 'Invalid import size'; end if;
  perform pg_advisory_xact_lock(hashtextextended('easycall:'||p_camp_id,0));
  if exists(select 1 from public.easycall_voters where camp_id=p_camp_id and locked_by is not null and lock_expires_at>now()) then raise exception 'Active assignments exist'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    if coalesce(r->>'id','') !~ '^[a-f0-9-]{36}$' or coalesce(r->>'phone','') !~ '^0[0-9]{8,10}$'
      or length(coalesce(r->>'name','')) not between 1 and 100 or length(coalesce(r->>'dong',''))>200 then raise exception 'Invalid import row'; end if;
  end loop;
  if exists(select 1 from jsonb_array_elements(p_rows) e group by e->>'phone' having count(*)>1)
    or exists(select 1 from jsonb_array_elements(p_rows) e group by e->>'id' having count(*)>1) then raise exception 'Duplicate import row'; end if;
  select payload->'config' into cfg from public.easycall_sync_store where store_key='STATE_'||p_camp_id for update;
  delete from public.easycall_voters where camp_id=p_camp_id;
  for r in select * from jsonb_array_elements(p_rows) loop
    if not coalesce(cfg->'dncPhones','[]') ? (r->>'phone') then
      insert into public.easycall_voters(camp_id,voter_id,name,phone,dong,last_result,last_memo,locked_by,lock_expires_at)
        values(p_camp_id,r->>'id',r->>'name',r->>'phone',r->>'dong','READY','',null,null);
      n := n+1;
    end if;
  end loop;
  return n;
end $$;

-- Remove prior permissive policies. Save their definitions before applying this migration.
do $$ declare p record; f record; begin
  for p in select schemaname,tablename,policyname from pg_policies where schemaname='public'
    and tablename in ('easycall_sync_store','easycall_voters','easycall_call_logs') loop
    execute format('drop policy %I on %I.%I',p.policyname,p.schemaname,p.tablename);
  end loop;
  -- The original claim RPC must not remain an alternative authorization bypass.
  for f in select oid::regprocedure as signature from pg_proc where pronamespace='public'::regnamespace and proname='claim_next_voter' loop
    execute format('revoke all on function %s from public, anon, authenticated',f.signature);
  end loop;
end $$;
alter table public.easycall_sync_store enable row level security;
alter table public.easycall_voters enable row level security;
alter table public.easycall_call_logs enable row level security;
revoke all on public.easycall_sync_store,public.easycall_voters,public.easycall_call_logs from public,anon,authenticated;
grant select on public.easycall_sync_store,public.easycall_voters,public.easycall_call_logs to authenticated;
create policy easycall_state_read on public.easycall_sync_store for select to authenticated using (
  case when (public.easycall_identity()->>'easycall_role')='super' then true
    when store_key='STATE_'||(public.easycall_identity()->>'camp_id') then
      (public.easycall_require_camp(public.easycall_identity()->>'camp_id')->>'camp_id')=(public.easycall_identity()->>'camp_id')
    else false end
);
create policy easycall_voters_read on public.easycall_voters for select to authenticated using (
  case when (public.easycall_identity()->>'easycall_role')='super' then true
    when camp_id=(public.easycall_identity()->>'camp_id') then
      (public.easycall_require_camp(camp_id)->>'camp_id')=camp_id and
      ((public.easycall_identity()->>'easycall_role')='admin' or locked_by=(public.easycall_identity()->>'agent_id'))
    else false end
);
create policy easycall_logs_read on public.easycall_call_logs for select to authenticated using (
  case when (public.easycall_identity()->>'easycall_role')='super' then true
    when camp_id=(public.easycall_identity()->>'camp_id') then
      (public.easycall_require_camp(camp_id)->>'camp_id')=camp_id and
      ((public.easycall_identity()->>'easycall_role')='admin' or agent_id=(public.easycall_identity()->>'agent_id'))
    else false end
);

do $$ declare f record; begin
  for f in select oid::regprocedure as signature from pg_proc where pronamespace='public'::regnamespace
    and proname in ('easycall_identity','easycall_require_camp','easycall_read_state','easycall_save_state',
      'easycall_check_calling','easycall_claim_voter','easycall_complete_call','easycall_replace_voters','easycall_authorize_call','easycall_agent_signal') loop
    execute format('revoke all on function %s from public, anon, authenticated',f.signature);
    execute format('grant execute on function %s to authenticated',f.signature);
  end loop;
end $$;

-- An empty installation has no demo accounts or sample contacts.
insert into public.easycall_sync_store(store_key,payload)
  values('MASTER_META','{"campsList":[],"agentsList":[]}') on conflict(store_key) do nothing;
notify pgrst,'reload schema';
commit;
