-- Append in place of the migration COMMIT; all fixture/security changes roll back.
select set_config('request.jwt.claim.sub',(select id::text from auth.users where raw_app_meta_data->>'easycall_role'='super' order by created_at limit 1),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',auth.uid(),'aal','aal1')::text,true);
do $$ declare d jsonb;r jsonb;u uuid:=auth.uid();
begin
 d:=jsonb_build_object('campId','paging_test','name','Paging Test','candidate','Test','sido','서울특별시','city','중구','party','무소속','staff','Test','manager','Test','electionStage','본선','electionType','국회의원','tablets',3,'unitPrice',0,'contractAmount',0,'startsOn',current_date-1,'endsOn',current_date+30);
 perform public.easycall_admin_save_camp(d,null,gen_random_uuid());
 insert into public.easycall_voters(camp_id,voter_id,name,phone,dong,last_result) select 'paging_test','p'||i,'Fixture '||i,'01000000000','Test',case when i=605 then 'CALLBACK' else 'READY' end from generate_series(1,605) i;
 insert into public.easycall_call_logs(call_id,camp_id,agent_id,call_result,status,duration_seconds,created_at) select gen_random_uuid(),'paging_test',case when i%2=0 then 'test02' else 'test01' end,'ABSENT','UNKNOWN',0,now()-i*interval '1 second' from generate_series(1,1105) i;
 r:=public.easycall_list_page('paging_test','voters',550,50);
 if (r->>'total')::int<>605 or jsonb_array_length(r->'items')<>50 then raise exception 'voter pagination failed';end if;
 r:=public.easycall_list_page('paging_test','voters',0,50,'Fixture 605',true);
 if (r->>'total')::int<>1 or r->'items'->0->>'voter_id'<>'p605' then raise exception 'search beyond old limit failed';end if;
 r:=public.easycall_list_page('paging_test','logs',1100,50);
 if (r->>'total')::int<>1105 or jsonb_array_length(r->'items')<>5 then raise exception 'log pagination failed';end if;
 r:=public.easycall_camp_counts('paging_test');
 if (r->'logs'->>'total')::int<>1105 or (r->'voters'->>'total')::int<>605 then raise exception 'full counts failed';end if;
 begin perform public.easycall_admin_mfa_policy(true,'test');raise exception 'aal1 changed MFA policy' using errcode='ZC002';exception when insufficient_privilege then null;end;
 update easycall_private_v2.security_policy set require_super_mfa=true;
 begin perform public.easycall_identity();raise exception 'MFA policy bypass' using errcode='ZC002';exception when insufficient_privilege then null;end;
 update easycall_private_v2.security_policy set require_super_mfa=false;
 update auth.users set raw_app_meta_data=jsonb_build_object('easycall_role','agent','camp_id','paging_test','agent_id','test01') where id=u;
 r:=public.easycall_list_page('paging_test','history',0,50);
 if (r->>'total')::int<>553 then raise exception 'agent history isolation failed';end if;
 begin perform public.easycall_list_page('paging_test','logs');raise exception 'agent read all logs' using errcode='ZC002';exception when insufficient_privilege then null;end;
 begin perform public.easycall_list_page('other_camp','voters');raise exception 'cross camp read' using errcode='ZC002';exception when insufficient_privilege then null;end;
end $$;
select 'PASS: 605 contacts, 1105 logs, search, full totals, agent isolation and MFA server enforcement' as result;
rollback;
