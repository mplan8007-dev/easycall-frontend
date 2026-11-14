-- Isolated fixtures only, with complete rollback.
begin;
select set_config('request.jwt.claim.sub',md5('easycall-loadtest-admin')::uuid::text,true);
select set_config('request.jwt.claims',jsonb_build_object('sub',auth.uid(),'aal','aal2')::text,true);
update public.easycall_voters set locked_by=null,lock_expires_at=null where camp_id='load1';
set local role authenticated;
do $$ declare rows jsonb;r jsonb;replay jsonb;req uuid:=gen_random_uuid();begin
 select jsonb_agg(jsonb_build_object('id',md5('life-'||i)::uuid::text,'name','Fixture '||i,'phone','0000000000'||i,'dong','Test')) into rows from generate_series(1,4) i;
 r:=public.easycall_import_voters('load1',rows,'replace','first.csv',req);
 if not (r->>'success')::boolean or (r->>'total')::int<>4 then raise exception 'Initial replace failed: %',r;end if;
 replay:=public.easycall_import_voters('load1',rows,'replace','first.csv',req);
 if replay<>r then raise exception 'Import retry not idempotent';end if;
 r:=public.easycall_import_voters('load1',rows,'append','duplicate.csv',gen_random_uuid());
 if not (r->>'success')::boolean or (r->>'inserted')::int<>0 or (r->>'duplicates')::int<>4 then raise exception 'Duplicate import failed: %',r;end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub',md5('easycall-loadtest-1')::uuid::text,true);
select set_config('request.jwt.claims',jsonb_build_object('sub',auth.uid(),'aal','aal2')::text,true);
set local role authenticated;
do $$ declare v public.easycall_voters;n integer;begin
 select * into v from public.easycall_claim_voter('load1');
 perform public.easycall_authorize_message('load1',v.voter_id);
 if exists(select 1 from public.easycall_voters where camp_id='load1' and voter_id=v.voter_id and call_started_at is not null) then raise exception 'Message marked as a call';end if;
 n:=public.easycall_release_unstarted_claim('load1',v.voter_id);if n<>1 then raise exception 'Unstarted claim not released';end if;
 select * into v from public.easycall_claim_voter('load1');
 perform public.easycall_authorize_call('load1',v.voter_id);
 n:=public.easycall_release_unstarted_claim('load1',v.voter_id);if n<>0 then raise exception 'Started call was released';end if;
 begin perform public.easycall_import_history('load1');raise exception 'Agent read admin import history' using errcode='ZI002';exception when insufficient_privilege then null;end;
 begin perform public.easycall_release_unstarted_claim('load2',v.voter_id);raise exception 'Cross-camp release allowed' using errcode='ZI002';exception when insufficient_privilege then null;end;
 begin perform public.easycall_authorize_message('load2',v.voter_id);raise exception 'Cross-camp message allowed' using errcode='ZI002';exception when insufficient_privilege then null;end;
end $$;
reset role;
select set_config('request.jwt.claim.sub',md5('easycall-loadtest-admin')::uuid::text,true);
select set_config('request.jwt.claims',jsonb_build_object('sub',auth.uid(),'aal','aal2')::text,true);
set local role authenticated;
do $$ declare rows jsonb;r jsonb;history jsonb;begin
 select jsonb_agg(jsonb_build_object('id',md5('life-more-'||i)::uuid::text,'name','Fixture '||i,'phone','0000000000'||i,'dong','Test')) into rows from generate_series(1,8) i;
 r:=public.easycall_import_voters('load1',rows,'append','eight.csv',gen_random_uuid());
 if not (r->>'success')::boolean or (r->>'inserted')::int<>4 or (r->>'duplicates')::int<>4 or (r->>'total')::int<>8 then raise exception 'Append with active call failed: %',r;end if;
 if not exists(select 1 from public.easycall_voters where camp_id='load1' and locked_by is not null and call_started_at is not null) then raise exception 'Active call changed';end if;
 r:=public.easycall_import_voters('load1',rows,'replace','blocked.csv',gen_random_uuid());
 if (r->>'success')::boolean then raise exception 'Active call replacement allowed';end if;
 history:=public.easycall_import_history('load1');
 if not exists(select 1 from jsonb_array_elements(history) h where h->>'filename'='blocked.csv' and h->>'success'='false') then raise exception 'Failure history missing';end if;
 if (public.easycall_list_page('load1','voters',0,100)->>'total')::int<>8 then raise exception 'Failed replace changed data';end if;
end $$;
reset role;
select 'PASS: safe release, started-call protection, append, duplicates, retry, durable failure history and authorization' as validation;
rollback;
