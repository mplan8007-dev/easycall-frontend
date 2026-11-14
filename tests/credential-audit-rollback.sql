begin;
do $$ begin if current_database()<>'easycall_test' then raise exception 'Isolated test database required';end if;end $$;
do $$
declare uid uuid:=gen_random_uuid();actor uuid:=md5('easycall-loadtest-admin')::uuid;req uuid:=gen_random_uuid();n bigint;v uuid:=gen_random_uuid();b jsonb;t text;s public.easycall_sync_store;meta public.easycall_sync_store;
begin
 insert into auth.users(id,email,encrypted_password,raw_app_meta_data) values(uid,'credential-fixture@example.invalid','fictional-before',jsonb_build_object('camp_id','load1','easycall_role','admin','easycall_login_id','camp','easycall_work_status','active'));
 select count(*) into n from easycall_private_v2.credential_changes;
 update auth.users set last_sign_in_at=clock_timestamp(),raw_app_meta_data=raw_app_meta_data||'{"session_test":true}'::jsonb where id=uid;
 update auth.users set encrypted_password=encrypted_password where id=uid;
 if (select count(*) from easycall_private_v2.credential_changes)<>n then raise exception 'Session/metadata refresh falsely reported password change';end if;
 perform public.easycall_credential_audit_begin(req,actor,uid,'admin_reset','load1','admin');
 update auth.users set encrypted_password='fictional-after' where id=uid;
 perform public.easycall_credential_audit_finish(req,'succeeded');
 perform public.easycall_credential_audit_finish(req,'succeeded');
 if (select count(*) from easycall_private_v2.credential_changes where user_id=uid)<>1 then raise exception 'Missing actual password change';end if;
 if not exists(select 1 from easycall_private_v2.credential_requests where request_id=req and outcome='succeeded' and actor_id=actor and completed_at is not null) then raise exception 'Missing outcome';end if;
 -- Direct Auth/dashboard writes are visible even without an application request.
 update auth.users set encrypted_password='fictional-direct' where id=uid;
 if (select count(*) from easycall_private_v2.credential_changes where user_id=uid)<>2 then raise exception 'Direct change unobserved';end if;
 begin
  perform public.easycall_credential_audit_begin(gen_random_uuid(),actor,uid,'agent_common','load1','admin');
  raise exception 'Manager accepted for common password' using errcode='ZC001';
 exception when insufficient_privilege then null;end;
 if has_function_privilege('authenticated','public.easycall_credential_audit_begin(uuid,uuid,uuid,text,text,text)','execute')
 or has_function_privilege('anon','public.easycall_credential_audit_finish(uuid,text)','execute')
 or has_table_privilege('authenticated','easycall_private_v2.credential_changes','select')
 or has_table_privilege('service_role','easycall_private_v2.credential_requests','update') then raise exception 'Credential audit exposed';end if;
 if not has_function_privilege('service_role','public.easycall_credential_audit_begin(uuid,uuid,uuid,text,text,text)','execute') then raise exception 'Service audit unavailable';end if;
 -- Simulate common-password batch end-to-end with auth writes on the isolated fixture.
 perform set_config('request.jwt.claim.sub',actor::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'aal','aal2')::text,true);
 select * into s from public.easycall_sync_store where store_key='STATE_load1';
 select * into meta from public.easycall_sync_store where store_key='MASTER_META';
 perform public.easycall_save_state('load1',meta.payload,jsonb_set(s.payload->'config','{script}','"credential isolation fixture"'),meta.updated_at,s.updated_at);
 select * into s from public.easycall_sync_store where store_key='STATE_load1';
 perform public.easycall_set_calling_state('load1',true,s.updated_at);
 perform public.easycall_agent_common_begin('load1',repeat('x',64),v,null);
 b:=public.easycall_agent_common_claim('load1',v);
 for t in select jsonb_array_elements_text(b->'users') loop
  update auth.users set encrypted_password='fictional-agent-common' where id=t::uuid;
  perform public.easycall_agent_common_finish('load1',v,t::uuid,(b->>'lease')::uuid,true);
 end loop;
 if (select encrypted_password from auth.users where id=uid)<>'fictional-direct' then raise exception 'Common rotation changed admin password';end if;
 if (select count(*) from easycall_private_v2.credential_changes where user_id=uid)<>2 then raise exception 'Common rotation touched admin';end if;
 if exists(select 1 from information_schema.columns where table_schema='easycall_private_v2' and table_name in ('credential_requests','credential_changes') and column_name ~ '(password|token|hash|email|payload)') then raise exception 'Sensitive audit field';end if;
end $$;
-- Simulate the Auth service DB role: it can update users but cannot write audit tables directly.
create role credential_fixture_auth nologin;
grant usage on schema auth to credential_fixture_auth;
grant select,update on auth.users to credential_fixture_auth;
set local role credential_fixture_auth;
update auth.users set encrypted_password='fictional-auth-service' where id=md5('easycall-loadtest-1')::uuid;
reset role;
do $$ begin
 if not exists(select 1 from easycall_private_v2.credential_changes where user_id=md5('easycall-loadtest-1')::uuid) then raise exception 'Auth role trigger did not persist';end if;
end $$;
select 'PASS: actual password changes, session noise exclusion, direct changes, private audit, common-password admin isolation' as result;
rollback;
