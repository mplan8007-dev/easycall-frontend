begin;
select set_config('request.jwt.claim.sub',md5('easycall-loadtest-admin')::uuid::text,true);
select set_config('request.jwt.claims',jsonb_build_object('sub',auth.uid(),'aal','aal2')::text,true);
do $$
declare root uuid:=auth.uid();v uuid:=gen_random_uuid();v2 uuid:=gen_random_uuid();disabled uuid:=gen_random_uuid();legacy uuid:=gen_random_uuid();pending uuid:=gen_random_uuid();r jsonb;b jsonb;held jsonb;uid_text text;root_meta jsonb;
begin
 select raw_app_meta_data into root_meta from auth.users where id=root;
 insert into auth.users(id,email,raw_app_meta_data) values
 (disabled,'disabled@example.invalid',jsonb_build_object('easycall_role','agent','camp_id','load1','agent_id','disabled','easycall_work_status','disabled')),
 (legacy,'legacy@example.invalid',jsonb_build_object('easycall_role','agent','camp_id','load1','agent_id','legacy')),
 (pending,'pending@example.invalid',jsonb_build_object('easycall_role','agent','camp_id','load1','agent_id','pending','easycall_work_status','pending'));
 r:=public.easycall_agent_common_begin('load1',repeat('x',64),v,null);
 if exists(select 1 from easycall_private_v2.agent_common_targets t join auth.users u on u.id=t.user_id where t.camp_id='load1' and (u.raw_app_meta_data->>'easycall_role'<>'agent' or u.raw_app_meta_data->>'camp_id'<>'load1')) then raise exception 'Wrong credential target';end if;
 if has_function_privilege('authenticated','public.easycall_agent_common_secret(text)','execute') or has_function_privilege('anon','public.easycall_agent_common_state(text)','execute') then raise exception 'Private policy exposed';end if;
 begin perform public.easycall_agent_common_begin('load1',repeat('y',64),v2,v);raise exception 'Pending rotation replaced' using errcode='ZC002';exception when sqlstate 'P0001' then null;end;
 b:=public.easycall_agent_common_claim('load1',v);
 if (public.easycall_agent_common_claim('load1',v)->>'busy')::boolean is not true then raise exception 'Concurrent apply allowed';end if;
 for uid_text in select jsonb_array_elements_text(b->'users') loop
 perform public.easycall_agent_common_finish('load1',v,uid_text::uuid,(b->>'lease')::uuid,true);
 end loop;
 if not (public.easycall_agent_common_state('load1')->>'ready')::boolean then raise exception 'Rotation not complete';end if;
 if (select raw_app_meta_data->>'easycall_work_status' from auth.users where id=disabled)<>'disabled' or (select raw_app_meta_data->>'easycall_work_status' from auth.users where id=pending)<>'pending' then raise exception 'Disabled or pending account reactivated';end if;
 if (select raw_app_meta_data from auth.users where id=root) is distinct from root_meta then raise exception 'Manager credential metadata changed';end if;
 held:=public.easycall_agent_common_issue('load1',v);
 begin perform public.easycall_agent_common_begin('load1',repeat('y',64),v2,v);raise exception 'Rotation raced issuance' using errcode='ZC002';exception when sqlstate 'P0001' then null;end;
 perform public.easycall_agent_common_release('load1',v,(held->>'lease')::uuid,disabled);
 if (select raw_app_meta_data->>'easycall_work_status' from auth.users where id=disabled)<>'disabled' then raise exception 'Issue completion reactivated user';end if;
 update auth.users set raw_app_meta_data=jsonb_build_object('easycall_role','admin','camp_id','load1') where id=root;
 perform public.easycall_agent_common_state('load1');
 begin perform public.easycall_agent_common_state('load2');raise exception 'Cross camp policy read' using errcode='ZC002';exception when insufficient_privilege then null;end;
 update auth.users set raw_app_meta_data=jsonb_build_object('easycall_role','agent','camp_id','load1','agent_id','x') where id=root;
 begin perform public.easycall_agent_common_state('load1');raise exception 'Agent policy read' using errcode='ZC002';exception when insufficient_privilege then null;end;
end $$;
select 'PASS: common-password targeting, isolation, private storage, serialized rotation and preserved account states' as result;
rollback;
