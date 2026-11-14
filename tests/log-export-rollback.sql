begin;
do $$ begin if current_database()<>'easycall_test' then raise exception 'Isolated test database required';end if;end $$;
select set_config('request.jwt.claim.sub',md5('easycall-loadtest-admin')::uuid::text,true);
select set_config('request.jwt.claims',jsonb_build_object('sub',auth.uid(),'aal','aal2')::text,true);
delete from public.easycall_call_logs where camp_id='load1';
insert into public.easycall_call_logs(camp_id,agent_id,call_id,created_at,call_result,status,memo)
select 'load1','device1',md5('export-fixture-'||i)::uuid,'2020-01-01T15:00:00Z','CONNECTED',case when i%2=0 then 'SUPPORT' else 'NO_RESPONSE' end,'Fixture' from generate_series(1,1003) i;
insert into public.easycall_call_logs(camp_id,agent_id,created_at,call_result,status,memo)
values('load1','device1',null,'ABSENT','NONE','No date');
set local role authenticated;
do $$ declare first_page jsonb;last_page jsonb;r jsonb;begin
 first_page:=public.easycall_export_logs_page('load1');
 if jsonb_array_length(first_page->'items')<>1000 or (first_page->>'done')::boolean then raise exception 'First page not bounded';end if;
 if first_page->'items'->0->>'created_at' is not null then raise exception 'Missing dates not included first';end if;
 last_page:=public.easycall_export_logs_page('load1',false,null,null,first_page->'cursor',(first_page->>'asOf')::timestamptz);
 if jsonb_array_length(last_page->'items')<>4 or not (last_page->>'done')::boolean then raise exception 'Equal timestamp cursor lost rows';end if;
 if exists(select 1 from jsonb_array_elements(first_page->'items') a join jsonb_array_elements(last_page->'items') b on a->>'call_id'=b->>'call_id') then raise exception 'Repeated rows';end if;
 r:=public.easycall_export_logs_page('load1',true,'2020-01-02','2020-01-02');
 if jsonb_array_length(r->'items')<>501 then raise exception 'Positive filter or Korea date boundary incorrect';end if;
 r:=public.easycall_export_logs_page('load1',false,'2020-01-01','2020-01-01');
 if jsonb_array_length(r->'items')<>0 then raise exception 'Range included null or next day';end if;
end $$;
reset role;
-- An ordinary administrator can export only their camp.
update auth.users set raw_app_meta_data='{"easycall_role":"admin","camp_id":"load1"}' where id=auth.uid();
set local role authenticated;
do $$ declare denied boolean:=false;begin
 begin perform public.easycall_export_logs_page('load2');exception when others then denied:=true;end;
 if not denied then raise exception 'Cross-camp export allowed';end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub',md5('easycall-loadtest-1')::uuid::text,true);
select set_config('request.jwt.claims',jsonb_build_object('sub',auth.uid(),'aal','aal2')::text,true);
set local role authenticated;
do $$ declare denied boolean:=false;begin
 begin perform public.easycall_export_logs_page('load1');exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Agent export allowed';end if;
end $$;
rollback;
