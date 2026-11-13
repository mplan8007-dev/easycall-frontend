begin;
select set_config('request.jwt.claim.sub',md5('easycall-loadtest-admin')::uuid::text,true);
select set_config('request.jwt.claims',jsonb_build_object('sub',auth.uid(),'aal','aal2')::text,true);
do $$
declare root uuid:=auth.uid();manager uuid:=gen_random_uuid();s jsonb;r jsonb;old_config jsonb;
begin
 select payload->'config' into old_config from public.easycall_sync_store where store_key='STATE_load1';
 s:=public.easycall_call_transport_get('load1');
 r:=public.easycall_call_transport_set('load1','{"callTransport":"sip","sipWss":"wss://pbx.example.com/ws","sipDomain":"pbx.example.com","sipStun":""}',(s->>'revision')::timestamptz);
 if r->'config'->>'callTransport'<>'sip' then raise exception 'Policy not saved';end if;
 if exists(select 1 from jsonb_each(old_config) e where e.key not in ('callTransport','sipWss','sipDomain','sipStun') and e.value is distinct from (select payload->'config'->e.key from public.easycall_sync_store where store_key='STATE_load1')) then raise exception 'Other camp settings lost';end if;
 begin perform public.easycall_call_transport_set('load1','{"callTransport":"smartphone"}',(s->>'revision')::timestamptz);raise exception 'Stale overwrite allowed' using errcode='ZC003';exception when serialization_failure then null;end;
 begin perform public.easycall_call_transport_set('load1','{"callTransport":"sip","sipWss":"ws://pbx.example.com","sipDomain":"pbx.example.com"}',(r->>'revision')::timestamptz);raise exception 'Plaintext SIP allowed' using errcode='ZC003';exception when sqlstate 'P0001' then null;end;
 insert into auth.users(id,email,raw_app_meta_data) values(manager,'policy-manager@example.invalid',jsonb_build_object('easycall_role','admin','camp_id','load1'));
 perform set_config('request.jwt.claim.sub',manager::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',manager,'aal','aal2')::text,true);
 begin perform public.easycall_call_transport_get('load1');raise exception 'Manager read administrative policy' using errcode='ZC003';exception when insufficient_privilege then null;end;
 begin perform public.easycall_call_transport_set('load1','{"callTransport":"smartphone"}',(r->>'revision')::timestamptz);raise exception 'Manager changed transport' using errcode='ZC003';exception when insufficient_privilege then null;end;
 -- Existing broad state save paths cannot bypass the protected-field guard.
 begin update public.easycall_sync_store set payload=jsonb_set(payload,'{config,callTransport}','"smartphone"') where store_key='STATE_load1';raise exception 'Trigger bypass allowed' using errcode='ZC003';exception when insufficient_privilege then null;end;
 update public.easycall_sync_store set payload=jsonb_set(payload,'{config,dialMode}','"auto"') where store_key='STATE_load1';
 if not exists(select 1 from public.easycall_sync_store where store_key='STATE_load1' and payload->'config'->>'callTransport'='sip' and payload->'config'->>'dialMode'='auto') then raise exception 'Ordinary camp settings blocked';end if;
 if has_function_privilege('anon','public.easycall_call_transport_get(text)','execute') or has_function_privilege('anon','public.easycall_call_transport_set(text,jsonb,timestamptz)','execute') then raise exception 'Anonymous policy access';end if;
 perform set_config('request.jwt.claim.sub',root::text,true);
end $$;
rollback;
