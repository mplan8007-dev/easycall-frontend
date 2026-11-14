-- Isolated loadtest database only. No production contacts, calls or messages.
begin;
do $$ begin
 if current_database()<>'easycall_test' then raise exception 'Isolated test database required';end if;
end $$;
select set_config('request.jwt.claim.sub',md5('easycall-loadtest-admin')::uuid::text,true);
select set_config('request.jwt.claims',jsonb_build_object('sub',auth.uid(),'aal','aal2')::text,true);
update public.easycall_voters set locked_by=null,locked_session=null,lock_expires_at=null,claim_call_id=null where camp_id='load1';
delete from easycall_private_v2.agent_sessions where camp_id='load1';
insert into public.easycall_voters(camp_id,voter_id,name,phone,last_result,updated_at) values
 ('load1','rel_callback','Callback','00000000101','CALLBACK',now()),
 ('load1','rel_absent','Absent','00000000102','ABSENT',now()-interval '1 hour'),
 ('load1','rel_blocked','Blocked','00000000103','REJECT',now());
set local role authenticated;
do $$ declare s public.easycall_sync_store;meta public.easycall_sync_store;r jsonb;conflict boolean:=false;begin
 select * into s from public.easycall_sync_store where store_key='STATE_load1';
 select * into meta from public.easycall_sync_store where store_key='MASTER_META';
 r:=public.easycall_set_calling_state('load1',true,s.updated_at);
 begin perform public.easycall_save_state('load1',meta.payload,s.payload->'config',meta.updated_at,s.updated_at);
 exception when serialization_failure then conflict:=true;end;
 if not conflict then raise exception 'Stale draft must conflict';end if;
 select * into s from public.easycall_sync_store where store_key='STATE_load1';
 -- Even a fresh revision cannot smuggle a resume into a general settings save.
 perform public.easycall_save_state('load1',meta.payload,jsonb_set(s.payload->'config','{globalStopped}','false'),meta.updated_at,s.updated_at);
 if not (select (payload->'config'->>'globalStopped')::boolean from public.easycall_sync_store where store_key='STATE_load1') then raise exception 'Settings save resumed calling';end if;
 conflict:=false;
 begin perform public.easycall_set_calling_state('load1',false,s.updated_at);exception when serialization_failure then conflict:=true;end;
 if not conflict then raise exception 'Stale resume must conflict';end if;
 select * into s from public.easycall_sync_store where store_key='STATE_load1';
 perform public.easycall_set_calling_state('load1',false,s.updated_at);
end $$;
reset role;
select set_config('request.jwt.claim.sub',md5('easycall-loadtest-1')::uuid::text,true);
select set_config('request.jwt.claims',jsonb_build_object('sub',auth.uid(),'aal','aal1')::text,true);
select set_config('request.headers','{"x-easycall-session":"10000000-0000-4000-8000-000000000001"}',true);
set local role authenticated;
do $$ declare v public.easycall_voters;r jsonb;entry jsonb;denied boolean;begin
 r:=public.easycall_open_agent_session();if not (r->>'active')::boolean then raise exception 'First device refused';end if;
 select * into v from public.easycall_claim_selected_voter('load1','rel_callback');
 if v.claim_call_id is null then raise exception 'Missing stable call ID';end if;
 if v.locked_session='10000000-0000-4000-8000-000000000001'::uuid then raise exception 'Usable session token leaked';end if;
 r:=public.easycall_resume_assignment(v.claim_call_id);
 if r->'assignment'->>'claim_call_id' is distinct from v.claim_call_id::text then raise exception 'Recovery identity changed';end if;
 perform set_config('request.headers','{"x-easycall-session":"20000000-0000-4000-8000-000000000002"}',true);
 r:=public.easycall_open_agent_session();if (r->>'active')::boolean then raise exception 'Second device admitted';end if;
 denied:=false;begin perform public.easycall_authorize_call('load1',v.voter_id);exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Second device authorized a call';end if;
 -- Document reload rotates the token and preserves the call identity.
 r:=public.easycall_open_agent_session('10000000-0000-4000-8000-000000000001');
 if not (r->>'active')::boolean then raise exception 'Reload refused';end if;
 perform public.easycall_authorize_call('load1',v.voter_id);
 if not exists(select 1 from public.easycall_voters where camp_id='load1' and voter_id=v.voter_id and lock_expires_at>now()+interval '3 hours') then raise exception 'Phone app lease too short';end if;
 perform public.easycall_agent_control(null,'online',v.voter_id);
 if not exists(select 1 from public.easycall_voters where camp_id='load1' and voter_id=v.voter_id and lock_expires_at>now()+interval '3 hours') then raise exception 'Heartbeat shortened phone app lease';end if;
 perform set_config('request.headers','{"x-easycall-session":"10000000-0000-4000-8000-000000000001"}',true);
 denied:=false;begin perform public.easycall_authorize_call('load1',v.voter_id);exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Old document still active';end if;
 denied:=false;begin perform public.easycall_open_agent_session(null,true);exception when others then denied:=true;end;
 if not denied then raise exception 'Active call allowed device takeover';end if;
 perform set_config('request.headers','{"x-easycall-session":"20000000-0000-4000-8000-000000000002"}',true);
 entry:=jsonb_build_object('camp_id','load1','voter_id',v.voter_id,'call_id',v.claim_call_id,'call_result','CONNECTED','status','NO_OPINION','duration_seconds',12,'memo','Fixture');
 r:=public.easycall_complete_call(entry);
 if r->>'status'<>'NO_OPINION' then raise exception 'Opinion classification lost';end if;
 if public.easycall_complete_call(entry)<>r then raise exception 'Retry duplicated or changed result';end if;
 if not (public.easycall_resume_assignment(v.claim_call_id)->>'completed')::boolean then raise exception 'Uncertain save not recovered';end if;
 denied:=false;begin perform public.easycall_claim_selected_voter('load1','rel_blocked');exception when others then denied:=true;end;
 if not denied then raise exception 'DNC contact assigned';end if;
 select * into v from public.easycall_claim_selected_voter('load1','rel_absent');
 entry:=jsonb_build_object('camp_id','load1','voter_id',v.voter_id,'call_id',v.claim_call_id,'call_result','CALLBACK','status','NONE','duration_seconds',0,'memo','Fixture','callback_at',now()+interval '1 day');
 perform public.easycall_complete_call(entry);
 if not exists(select 1 from public.easycall_voters where camp_id='load1' and voter_id='rel_absent' and callback_at>now()) then raise exception 'Callback schedule missing';end if;
 perform public.easycall_close_agent_session();
end $$;
rollback;
