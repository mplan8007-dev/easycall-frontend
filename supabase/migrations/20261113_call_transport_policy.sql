begin;
create or replace function easycall_private_v2.call_transport_fields(p_config jsonb)
returns jsonb language sql immutable set search_path='' as $$
 select jsonb_build_object('callTransport',coalesce(p_config->>'callTransport','smartphone'),'sipWss',coalesce(p_config->>'sipWss',''),'sipDomain',coalesce(p_config->>'sipDomain',''),'sipStun',coalesce(p_config->>'sipStun',''))
$$;
create or replace function easycall_private_v2.guard_call_transport()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.store_key like 'STATE_%' and easycall_private_v2.call_transport_fields(new.payload->'config') is distinct from easycall_private_v2.call_transport_fields(case when tg_op='INSERT' then '{}'::jsonb else old.payload->'config' end) then
  perform easycall_private_v2.require_super();
 end if;
 return new;
end $$;
drop trigger if exists easycall_call_transport_guard on public.easycall_sync_store;
create trigger easycall_call_transport_guard before insert or update on public.easycall_sync_store for each row execute function easycall_private_v2.guard_call_transport();

create or replace function public.easycall_call_transport_get(p_camp text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare s public.easycall_sync_store;
begin
 perform easycall_private_v2.require_super();
 if easycall_private_v2.camp_json(p_camp) is null then raise exception 'Unknown camp';end if;
 select * into s from public.easycall_sync_store where store_key='STATE_'||p_camp;
 return jsonb_build_object('campId',p_camp,'revision',s.updated_at,'config',easycall_private_v2.call_transport_fields(s.payload->'config'));
end $$;
create or replace function public.easycall_call_transport_set(p_camp text,p_config jsonb,p_expected_revision timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.easycall_sync_store;c jsonb;mode text;wss text;domain text;stun text;
begin
 perform easycall_private_v2.require_super();
 if easycall_private_v2.camp_json(p_camp) is null then raise exception 'Unknown camp';end if;
 if jsonb_typeof(p_config) is distinct from 'object' or length(p_config::text)>2000 then raise exception 'Invalid configuration';end if;
 c:=easycall_private_v2.call_transport_fields(p_config);mode:=c->>'callTransport';wss:=c->>'sipWss';domain:=c->>'sipDomain';stun:=c->>'sipStun';
 if mode not in ('smartphone','sip') then raise exception 'Invalid transport';end if;
 if length(wss)>512 or length(domain)>255 or length(stun)>255 then raise exception 'Configuration too long';end if;
 if wss<>'' and wss!~'^wss://[A-Za-z0-9.-]+(:[0-9]{1,5})?(/[A-Za-z0-9/_~.%-]*)?$' then raise exception 'Invalid WSS URL';end if;
 if domain<>'' and domain!~'^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?(:[0-9]{1,5})?$' then raise exception 'Invalid SIP domain';end if;
 if stun<>'' and stun!~'^stuns?:[A-Za-z0-9.-]+(:[0-9]{1,5})?$' then raise exception 'Invalid STUN URL';end if;
 if mode='sip' and (wss='' or domain='') then raise exception 'SIP endpoint required';end if;
 select * into s from public.easycall_sync_store where store_key='STATE_'||p_camp for update;
 if not found then raise exception 'Camp state unavailable';end if;
 if s.updated_at is distinct from p_expected_revision then raise exception 'Settings changed; reload and retry' using errcode='40001';end if;
 update public.easycall_sync_store set payload=jsonb_set(s.payload,'{config}',coalesce(s.payload->'config','{}')||c),updated_at=clock_timestamp() where store_key=s.store_key;
 perform easycall_private_v2.audit('camp.call_transport',p_camp,null,c);
 return public.easycall_call_transport_get(p_camp);
end $$;
revoke all on function easycall_private_v2.call_transport_fields(jsonb),easycall_private_v2.guard_call_transport() from public,anon,authenticated;
revoke all on function public.easycall_call_transport_get(text),public.easycall_call_transport_set(text,jsonb,timestamptz) from public,anon;
grant execute on function public.easycall_call_transport_get(text),public.easycall_call_transport_set(text,jsonb,timestamptz) to authenticated;
notify pgrst,'reload schema';
commit;

