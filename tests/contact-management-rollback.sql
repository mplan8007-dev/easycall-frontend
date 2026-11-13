-- Disposable isolated fixtures only; all changes roll back.
begin;
select set_config('request.jwt.claim.sub',md5('easycall-loadtest-admin')::uuid::text,true);
select set_config('request.jwt.claims',jsonb_build_object('sub',auth.uid(),'aal','aal2')::text,true);
delete from public.easycall_voters where camp_id='load1';
insert into public.easycall_voters(camp_id,voter_id,name,phone,dong,last_result) select 'load1','manage-'||i,'Fixture '||i,'0000000000'||i,'Test',case when i=4 then 'REJECT' when i=1 then 'CONNECTED' else 'READY' end from generate_series(1,5) i;
insert into easycall_private_v2.blocked_phone(camp_id,phone) values('load1','00000000099') on conflict do nothing;
insert into public.easycall_call_logs(camp_id,agent_id,voter_id,call_result) values('load1','device1','manage-4','REJECT');
set local role authenticated;
do $$ declare v public.easycall_voters;r jsonb;patch jsonb;req uuid:=gen_random_uuid();rows jsonb;begin
 if has_function_privilege('anon','public.easycall_admin_delete_voters(text,jsonb,uuid)','execute') then raise exception 'Anonymous mutation allowed';end if;
 r:=public.easycall_admin_voter_page('load1',0,50,'','REJECT');if (r->>'total')::int<>1 or r->'items'->0->>'updated_at' is null then raise exception 'Status/revision paging failed';end if;
 select * into v from public.easycall_voters where camp_id='load1' and voter_id='manage-1';
 patch:=jsonb_build_object('name','Edited','phone','000-0000-0011','dong','Other','memo','Memo');
 r:=public.easycall_admin_update_voter('load1',v.voter_id,v.updated_at,patch,req);
 if r->>'updated'<>'1' then raise exception 'Edit failed';end if;
 if public.easycall_admin_update_voter('load1',v.voter_id,v.updated_at,patch,req)<>r then raise exception 'Edit replay failed';end if;
 begin perform public.easycall_admin_update_voter('load1',v.voter_id,v.updated_at,patch,gen_random_uuid());raise exception 'Stale edit allowed' using errcode='ZM001';exception when raise_exception then null;end;
 select * into v from public.easycall_voters where camp_id='load1' and voter_id='manage-1';
 if v.name<>'Edited' or v.phone<>'00000000011' or v.last_memo<>'Memo' or v.last_result<>'READY' then raise exception 'Stored edit mismatch';end if;
 begin perform public.easycall_admin_update_voter('load1',v.voter_id,v.updated_at,patch||'{"phone":"00000000002"}',gen_random_uuid());raise exception 'Duplicate allowed' using errcode='ZM001';exception when raise_exception then null;end;
 begin perform public.easycall_admin_update_voter('load1',v.voter_id,v.updated_at,patch||'{"phone":"00000000099"}',gen_random_uuid());raise exception 'DNC phone allowed' using errcode='ZM001';exception when raise_exception then null;end;
 begin perform public.easycall_admin_update_voter('load1',v.voter_id,v.updated_at,patch||'{"phone":"bad"}',gen_random_uuid());raise exception 'Bad phone allowed' using errcode='ZM001';exception when raise_exception then null;end;
end $$;
reset role;
update public.easycall_voters set locked_by='device1',lock_expires_at=now()+interval '15 minutes' where camp_id='load1' and voter_id='manage-2';
set local role authenticated;
do $$ declare v public.easycall_voters;rows jsonb;r jsonb;before_logs bigint;req uuid:=gen_random_uuid();begin
 select * into v from public.easycall_voters where camp_id='load1' and voter_id='manage-2';
 begin perform public.easycall_admin_update_voter('load1',v.voter_id,v.updated_at,'{"name":"Active","phone":"00000000002"}',gen_random_uuid());raise exception 'Active edit allowed' using errcode='ZM001';exception when raise_exception then null;end;
 select jsonb_agg(jsonb_build_object('voter_id',voter_id,'updated_at',updated_at)) into rows from public.easycall_voters where camp_id='load1' and voter_id in ('manage-1','manage-2');
 begin perform public.easycall_admin_delete_voters('load1',rows,gen_random_uuid());raise exception 'Active delete allowed' using errcode='ZM001';exception when raise_exception then null;end;
 if (select count(*) from public.easycall_voters where camp_id='load1')<>5 then raise exception 'Partial delete was committed';end if;
 begin perform public.easycall_admin_delete_voters('load1',jsonb_build_array(jsonb_build_object('voter_id','manage-1','updated_at','2000-01-01')),gen_random_uuid());raise exception 'Stale delete allowed' using errcode='ZM001';exception when raise_exception then null;end;
 perform public.easycall_camp_counts('load1');
 select count(*) into before_logs from public.easycall_call_logs where camp_id='load1';
 select jsonb_agg(jsonb_build_object('voter_id',voter_id,'updated_at',updated_at)) into rows from public.easycall_voters where camp_id='load1' and voter_id in ('manage-3','manage-4');
 r:=public.easycall_admin_delete_voters('load1',rows,req);if r->>'deleted'<>'2' then raise exception 'Bulk delete failed';end if;
 if public.easycall_admin_delete_voters('load1',rows,req)<>r then raise exception 'Delete replay failed';end if;
 if (public.easycall_camp_counts('load1')->'voters'->>'total')::int<>3 then raise exception 'Cached contact counts stale';end if;
 if (select count(*) from public.easycall_call_logs where camp_id='load1')<>before_logs then raise exception 'Call history lost';end if;
end $$;
reset role;
do $$ begin
 if not exists(select 1 from easycall_private_v2.blocked_phone where camp_id='load1' and phone='00000000004') then raise exception 'DNC lost on delete';end if;
 update auth.users set raw_app_meta_data='{"easycall_role":"admin","camp_id":"load1"}' where id=auth.uid();
end $$;
set local role authenticated;
do $$ begin
 begin perform public.easycall_admin_voter_page('load2');raise exception 'Cross camp list allowed' using errcode='ZM001';exception when insufficient_privilege then null;end;
 begin perform public.easycall_admin_delete_voters('load2','[]',gen_random_uuid());raise exception 'Cross camp delete allowed' using errcode='ZM001';exception when insufficient_privilege then null;end;
 begin perform public.easycall_admin_update_voter('load2','manage-1',now(),'{}',gen_random_uuid());raise exception 'Cross camp edit allowed' using errcode='ZM001';exception when insufficient_privilege then null;end;
end $$;
reset role;
update auth.users set raw_app_meta_data='{"easycall_role":"agent","camp_id":"load1","agent_id":"device1"}' where id=auth.uid();
set local role authenticated;
do $$ begin
 begin perform public.easycall_admin_voter_page('load1');raise exception 'Agent list allowed' using errcode='ZM001';exception when insufficient_privilege then null;end;
 begin perform public.easycall_admin_delete_voters('load1','[]',gen_random_uuid());raise exception 'Agent delete allowed' using errcode='ZM001';exception when insufficient_privilege then null;end;
 begin perform public.easycall_admin_update_voter('load1','manage-1',now(),'{}',gen_random_uuid());raise exception 'Agent edit allowed' using errcode='ZM001';exception when insufficient_privilege then null;end;
end $$;
reset role;
select 'PASS: contact paging, edit, validation, revision conflicts, active lease protection, atomic bulk delete, replay, DNC/history preservation and camp/role isolation' as validation;
rollback;
