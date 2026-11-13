begin;
select set_config('request.jwt.claim.sub',md5('easycall-loadtest-admin')::uuid::text,true);
select set_config('request.jwt.claims',jsonb_build_object('sub',auth.uid(),'aal','aal2')::text,true);
do $$
declare root uuid:=auth.uid();r jsonb;
begin
 r:=public.easycall_agent_accounts('load1');
 if r->>'campId'<>'load1' or jsonb_array_length(r->'accounts')<>(select count(*) from easycall_private_v2.agent_registry where camp_id='load1') then raise exception 'Camp registry list mismatch';end if;
 if exists(select 1 from jsonb_array_elements(r->'accounts') a where a ? 'password' or a ? 'encrypted_password') then raise exception 'Password leaked';end if;
 if has_function_privilege('anon','public.easycall_agent_accounts(text)','execute') then raise exception 'Anonymous list access';end if;
 update auth.users set raw_app_meta_data=jsonb_build_object('easycall_role','admin','camp_id','load1') where id=root;
 perform public.easycall_agent_accounts('load1');
 begin perform public.easycall_agent_accounts('load2');raise exception 'Cross camp list allowed' using errcode='ZC002';exception when insufficient_privilege then null;end;
 update auth.users set raw_app_meta_data=jsonb_build_object('easycall_role','agent','camp_id','load1','agent_id','agent0001') where id=root;
 begin perform public.easycall_agent_accounts('load1');raise exception 'Agent list access allowed' using errcode='ZC002';exception when insufficient_privilege then null;end;
end $$;
select 'PASS: scoped agent account listing, no credential exposure, admin and agent isolation' as result;
rollback;
