begin;
select set_config('request.jwt.claim.sub',md5('easycall-loadtest-admin')::uuid::text,true);
select set_config('request.jwt.claims',jsonb_build_object('sub',auth.uid(),'aal','aal2')::text,true);
do $$
declare d jsonb;r jsonb;policy jsonb;mode text;cid text;req uuid;rev timestamptz;manager uuid:=gen_random_uuid();
begin
 d:=jsonb_build_object('name','New test camp','candidate','Test candidate','sido','서울특별시','city','중구','party','무소속','staff','Staff','manager','Manager','electionStage','본선','electionType','국회의원','tablets',2,'unitPrice',700000,'contractAmount',1400000,'startsOn',current_date-1,'endsOn',current_date+30);
 foreach mode in array array['smartphone','pending','configured'] loop
  cid:='new_call_'||mode;req:=gen_random_uuid();
  policy:=case when mode='smartphone' then '{"callTransport":"smartphone"}'::jsonb when mode='pending' then '{"callTransport":"sip"}'::jsonb else '{"callTransport":"sip","sipWss":"wss://pbx.example.com/ws","sipDomain":"pbx.example.com"}'::jsonb end;
  r:=public.easycall_admin_save_camp(d||jsonb_build_object('campId',cid,'callPolicy',policy),null,req);
  if r->>'campId'<>cid or not exists(select 1 from public.easycall_camp_contracts where camp_id=cid) then raise exception 'Camp creation failed';end if;
  if (select payload->'config'->>'callTransport' from public.easycall_sync_store where store_key='STATE_'||cid)<>case when mode='smartphone' then 'smartphone' else 'sip' end then raise exception 'Transport not created atomically';end if;
  if mode='configured' and (select payload->'config'->>'sipWss' from public.easycall_sync_store where store_key='STATE_'||cid)<>'wss://pbx.example.com/ws' then raise exception 'Endpoint missing';end if;
  perform public.easycall_admin_save_camp(d||jsonb_build_object('campId',cid,'callPolicy',policy),null,req);
  if (select count(*) from public.easycall_admin_events where request_id=req)<>1 then raise exception 'Duplicate registration';end if;
 end loop;
 -- Invalid policy must not leave a partial camp, contract, state or audit entry.
 req:=gen_random_uuid();
 begin
  perform public.easycall_admin_save_camp(d||'{"campId":"new_call_bad","callPolicy":{"callTransport":"sip","sipWss":"ws://bad.example.com","sipDomain":"bad.example.com"}}',null,req);
  raise exception 'Insecure policy allowed' using errcode='ZC003';
 exception when sqlstate 'P0001' then null;end;
 if easycall_private_v2.camp_json('new_call_bad') is not null or exists(select 1 from public.easycall_camp_contracts where camp_id='new_call_bad') or exists(select 1 from public.easycall_sync_store where store_key='STATE_new_call_bad') or exists(select 1 from public.easycall_admin_events where request_id=req) then raise exception 'Partial registration survived';end if;
 begin perform public.easycall_admin_save_camp(d||'{"campId":"new_call_bad","callPolicy":{"callTransport":"sip","password":"secret"}}',null,gen_random_uuid());raise exception 'Credential field accepted' using errcode='ZC003';exception when sqlstate 'P0001' then null;end;
 -- Editing contract details cannot overwrite the independently selected calling policy.
 select revision into rev from public.easycall_camp_contracts where camp_id='new_call_configured';
 perform public.easycall_admin_save_camp(d||'{"campId":"new_call_configured","name":"Edited camp"}',rev,gen_random_uuid());
 if (select payload->'config'->>'callTransport' from public.easycall_sync_store where store_key='STATE_new_call_configured')<>'sip' then raise exception 'Contract edit reset transport';end if;
 insert into auth.users(id,email,raw_app_meta_data) values(manager,'new-camp-manager@example.invalid',jsonb_build_object('easycall_role','admin','camp_id','load1'));
 perform set_config('request.jwt.claim.sub',manager::text,true);perform set_config('request.jwt.claims',jsonb_build_object('sub',manager,'aal','aal2')::text,true);
 begin perform public.easycall_admin_save_camp(d||'{"campId":"new_call_forbidden","callPolicy":{"callTransport":"smartphone"}}',null,gen_random_uuid());raise exception 'Manager registered a camp' using errcode='ZC003';exception when insufficient_privilege then null;end;
end $$;
rollback;
