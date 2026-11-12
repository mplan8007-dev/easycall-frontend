-- Append to the migration after removing its final COMMIT; ends in ROLLBACK.
-- Uses only an existing project owner's Auth UUID, supplied via replace before execution.
-- No calls or messages are sent. Validation fixtures and metadata changes are rolled back.
update public.easycall_sync_store set payload=jsonb_set(jsonb_set(payload,'{campsList}',
  (payload->'campsList')||'[{"campId":"validation_20261112","name":"Rollback test","approved":true,"tablets":2}]'),
  '{agentsList}',(payload->'agentsList')||'[{"agentId":"validation_agent","campId":"validation_20261112","alias":"Rollback test","assignedPhone":"00000000000"}]')
  where store_key='MASTER_META';
insert into public.easycall_sync_store(store_key,payload) values('STATE_validation_20261112',
  '{"campId":"validation_20261112","config":{"nightLock":false,"globalStopped":false,"dncPhones":[]}}');
insert into public.easycall_voters(camp_id,voter_id,name,phone) values
  ('validation_20261112','validation_voter_1','Rollback test 1','00000000001'),
  ('validation_20261112','validation_voter_2','Rollback test 2','00000000002');
update auth.users set raw_app_meta_data=coalesce(raw_app_meta_data,'{}')||
  '{"easycall_role":"agent","camp_id":"validation_20261112","agent_id":"validation_agent"}'
  where id='OWNER_AUTH_USER_UUID'::uuid;
set local request.jwt.claim.sub='OWNER_AUTH_USER_UUID';
set local role authenticated;
do $$ declare a public.easycall_voters; b public.easycall_voters; logged jsonb; replay jsonb; n integer; denied boolean:=false; entry jsonb;
begin
  select * into a from public.easycall_claim_voter('validation_20261112');
  if a.voter_id<>'validation_voter_1' then raise exception 'Test failed: first assignment'; end if;
  select * into b from public.easycall_claim_voter('validation_20261112');
  if b.voter_id<>a.voter_id then raise exception 'Test failed: repeated claim must reuse assignment'; end if;
  perform public.easycall_authorize_call('validation_20261112',a.voter_id);
  begin
    perform public.easycall_claim_voter('camp01');
  exception when insufficient_privilege then denied:=true;
  end;
  if not denied then raise exception 'Test failed: cross-camp RPC'; end if;
  select count(*) into n from public.easycall_voters where camp_id<>'validation_20261112';
  if n<>0 then raise exception 'Test failed: voter RLS'; end if;
  select count(*) into n from public.easycall_call_logs where camp_id<>'validation_20261112';
  if n<>0 then raise exception 'Test failed: log RLS'; end if;
  entry:=jsonb_build_object('call_id','22222222-2222-4222-8222-222222222222','camp_id','validation_20261112',
    'voter_id',a.voter_id,'call_result','CONNECTED','status','OPPOSE','duration_seconds',0,'memo','Rollback test');
  logged:=public.easycall_complete_call(entry);
  replay:=public.easycall_complete_call(entry);
  if logged->>'call_id' is distinct from replay->>'call_id' then raise exception 'Test failed: retry ID'; end if;
  select count(*) into n from public.easycall_call_logs where call_id='22222222-2222-4222-8222-222222222222';
  if n<>1 or logged->>'duration'<>'00:00' then raise exception 'Test failed: idempotency or zero duration'; end if;
  select * into b from public.easycall_claim_voter('validation_20261112');
  if b.voter_id<>'validation_voter_2' then raise exception 'Test failed: completed record reselected'; end if;
  entry:=jsonb_build_object('call_id','33333333-3333-4333-8333-333333333333','camp_id','validation_20261112',
    'voter_id',b.voter_id,'call_result','REJECT','status','NONE','duration_seconds',0,'memo','Rollback test DNC');
  perform public.easycall_complete_call(entry);
  if not exists(select 1 from public.easycall_sync_store where store_key='STATE_validation_20261112'
    and (payload->'config'->'dncPhones') ? '00000000002') then raise exception 'Test failed: atomic DNC'; end if;
  select count(*) into n from public.easycall_claim_voter('validation_20261112');
  if n<>0 then raise exception 'Test failed: exhausted queue'; end if;
  if has_table_privilege('authenticated','public.easycall_voters','INSERT') then raise exception 'Test failed: direct write grant'; end if;
  if has_schema_privilege('authenticated','easycall_backup_20261112','USAGE') then raise exception 'Test failed: backup exposed'; end if;
end $$;
reset role;
select 'PASS: migration, assignment, lease, cross-camp isolation, RLS, idempotency, zero duration, DNC, empty queue and backup isolation; all changes rolled back' as validation;
rollback;
