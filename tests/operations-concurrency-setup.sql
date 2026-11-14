-- Disposable local loadtest fixture only. Run after the rollback suites.
begin;
do $$ begin
 if current_database()<>'easycall_test' then raise exception 'Isolated test database required';end if;
end $$;
select set_config('request.jwt.claim.sub',md5('easycall-loadtest-admin')::uuid::text,true);
select set_config('request.jwt.claims',jsonb_build_object('sub',auth.uid(),'aal','aal2')::text,true);
update auth.users set raw_app_meta_data=jsonb_set(raw_app_meta_data,'{camp_id}','"load1"') where id=md5('easycall-loadtest-2')::uuid;
update public.easycall_sync_store set payload=jsonb_set(payload,'{agentsList}',
 (select jsonb_agg(case when a->>'agentId'='device2' then jsonb_set(a,'{campId}','"load1"') else a end) from jsonb_array_elements(payload->'agentsList') a)),updated_at=clock_timestamp()
 where store_key='MASTER_META';
update public.easycall_voters set locked_by=null,lock_expires_at=null,locked_session=null,claim_call_id=null where camp_id='load1';
delete from easycall_private_v2.agent_sessions where camp_id='load1';
commit;
