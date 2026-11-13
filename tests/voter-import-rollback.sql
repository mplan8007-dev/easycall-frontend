-- Isolated loadtest fixture only. All mutations roll back.
begin;
select set_config('request.jwt.claim.sub',md5('easycall-loadtest-admin')::uuid::text,true);
select set_config('request.jwt.claims',jsonb_build_object('sub',auth.uid(),'aal','aal2')::text,true);
update public.easycall_voters set locked_by=null,lock_expires_at=null where camp_id='load1';
set local role authenticated;
do $$ declare rows jsonb; saved integer; page jsonb; begin
 select jsonb_agg(jsonb_build_object('id',md5('import-test-'||i)::uuid::text,'name','Import test '||i,'phone','0000000'||lpad(i::text,4,'0'),'dong','Test')) into rows from generate_series(1,4) i;
 saved:=public.easycall_replace_voters('load1',rows);
 if saved<>4 then raise exception 'Four-row import receipt incorrect';end if;
 page:=public.easycall_list_page('load1','voters',0,100);
 if (page->>'total')::integer<>4 or jsonb_array_length(page->'items')<>4 or exists(select 1 from jsonb_array_elements(page->'items') r where not exists(select 1 from jsonb_array_elements(rows) s where s->>'id'=r->>'voter_id' and s->>'phone'=r->>'phone')) then raise exception 'Imported data mismatch';end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub',md5('easycall-loadtest-1')::uuid::text,true);
select set_config('request.jwt.claims',jsonb_build_object('sub',auth.uid(),'aal','aal2')::text,true);
set local role authenticated;
do $$ declare page jsonb; v public.easycall_voters; begin
 page:=public.easycall_list_page('load1','voters',0,100);
 if (page->>'total')::integer<>4 then raise exception 'Agent cannot see four imported contacts';end if;
 select * into v from public.easycall_claim_voter('load1');
 if v.name not like 'Import test %' then raise exception 'Agent claimed stale sample';end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub',md5('easycall-loadtest-admin')::uuid::text,true);
select set_config('request.jwt.claims',jsonb_build_object('sub',auth.uid(),'aal','aal2')::text,true);
set local role authenticated;
do $$ begin
 begin
 perform public.easycall_replace_voters('load1',jsonb_build_array(jsonb_build_object('id',gen_random_uuid()::text,'name','Blocked test','phone','00000000009','dong','Test')));
 raise exception 'Active assignment was overwritten' using errcode='ZI001';
 exception when sqlstate 'P0001' then if sqlerrm<>'Active assignments exist' then raise;end if;end;
 if (public.easycall_list_page('load1','voters',0,100)->>'total')::integer<>4 then raise exception 'Blocked import changed contacts';end if;
end $$;
reset role;
select 'PASS: four-row import, agent visibility, fresh assignment and blocked replacement' as result;
rollback;
