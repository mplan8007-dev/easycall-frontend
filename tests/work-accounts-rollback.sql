begin;
select set_config('request.jwt.claim.sub',md5('easycall-loadtest-admin')::uuid::text,true);
select set_config('request.jwt.claims',jsonb_build_object('sub',auth.uid(),'aal','aal2')::text,true);
do $$
declare root uuid:=auth.uid();ctx jsonb;u uuid:=gen_random_uuid();c jsonb;old_oid oid:='public.easycall_identity()'::regprocedure;
begin
 ctx:=public.easycall_work_account_context('load1','worker','agent');
 insert into auth.users(id,email,raw_app_meta_data) values(u,ctx->>'email',jsonb_build_object('easycall_role','agent','camp_id','load1','agent_id','worker','easycall_login_id','worker','easycall_created_by',root,'easycall_work_status','pending','easycall_must_change',true));
 -- A pending creation cannot be activated through the ordinary enable button.
 begin perform public.easycall_work_account_state('load1','worker','agent','active');raise exception 'pending account enabled' using errcode='ZC002';exception when sqlstate 'P0001' then null;end;
 perform public.easycall_work_account_activate('load1','worker','agent',u,'Worker','0419301001');
 if not exists(select 1 from easycall_private_v2.agent_registry where camp_id='load1' and agent_id='worker') then raise exception 'Missing agent registration';end if;
 update public.easycall_sync_store set payload=jsonb_set(payload,'{campsList}',(select jsonb_agg(case when c->>'campId'='load1' then c||'{"tablets":2}'::jsonb else c end) from jsonb_array_elements(payload->'campsList')c)),updated_at=clock_timestamp() where store_key='MASTER_META';
 begin perform public.easycall_work_account_context('load1','overquota','agent');raise exception 'quota bypass before Auth creation' using errcode='ZC002';exception when sqlstate 'P0001' then null;end;
 perform set_config('request.jwt.claim.sub',u::text,true);
 begin perform public.easycall_identity();raise exception 'temporary password bypass' using errcode='ZC002';exception when insufficient_privilege then null;end;
 if has_function_privilege('authenticated','public.easycall_work_password_complete(uuid)','execute') then raise exception 'password completion exposed';end if;
 perform public.easycall_work_password_complete(u);
 begin perform public.easycall_identity();raise exception 'stale token allowed' using errcode='ZC002';exception when insufficient_privilege then null;end;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'aal','aal2','app_metadata',(select raw_app_meta_data from auth.users where id=u))::text,true);
 if public.easycall_identity()->>'agent_id'<>'worker' then raise exception 'identity mismatch';end if;
 begin perform public.easycall_work_account_context('load2','worker','agent');raise exception 'agent administered account' using errcode='ZC002';exception when insufficient_privilege then null;end;
 perform set_config('request.jwt.claim.sub',root::text,true);
 perform public.easycall_work_account_state('load1','worker','agent','disabled');
 perform set_config('request.jwt.claim.sub',u::text,true);
 begin perform public.easycall_identity();raise exception 'disabled live session bypass' using errcode='ZC002';exception when insufficient_privilege then null;end;
 begin perform public.easycall_work_password_complete(u);raise exception 'password change reactivated disabled user' using errcode='ZC002';exception when sqlstate 'P0001' then null;end;
 perform set_config('request.jwt.claim.sub',root::text,true);
 perform public.easycall_work_account_state('load1','worker','agent','active');
 perform public.easycall_work_account_state('load1','worker','agent','reset');
 perform set_config('request.jwt.claim.sub',u::text,true);
 begin perform public.easycall_identity();raise exception 'reset live session bypass' using errcode='ZC002';exception when insufficient_privilege then null;end;
 perform set_config('request.jwt.claim.sub',root::text,true);
 -- A camp manager can manage only agents in the same camp.
 update auth.users set raw_app_meta_data=jsonb_build_object('easycall_role','admin','camp_id','load1') where id=root;
 perform public.easycall_work_account_context('load1','worker','agent');
 begin perform public.easycall_work_account_context('load2','worker','agent');raise exception 'cross-camp access' using errcode='ZC002';exception when insufficient_privilege then null;end;
 begin perform public.easycall_work_account_context('load1','other','admin');raise exception 'admin escalated role' using errcode='ZC002';exception when insufficient_privilege then null;end;
 if old_oid<>'public.easycall_identity()'::regprocedure then raise exception 'identity policy binding changed';end if;
end $$;
select 'PASS: email-free issuance, temporary-password gate, disabled live sessions, reset gate and camp isolation' as result;
rollback;
