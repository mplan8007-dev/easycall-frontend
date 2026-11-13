begin;
create or replace function public.easycall_admin_overview()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  perform easycall_private_v2.require_super();
  with camps as (
    select c from public.easycall_sync_store s,lateral jsonb_array_elements(coalesce(s.payload->'campsList','[]')) c where s.store_key='MASTER_META'
  ), voters as (select camp_id,count(*) as n from public.easycall_voters group by camp_id),
  logs as (select camp_id,count(*) as n from public.easycall_call_logs group by camp_id),
  paid as (select camp_id,sum(amount) as amount from public.easycall_payments where voided_at is null group by camp_id),
  agents as (select a->>'campId' as camp_id,count(*) as n from public.easycall_sync_store s,lateral jsonb_array_elements(coalesce(s.payload->'agentsList','[]')) a where s.store_key='MASTER_META' group by a->>'campId'),
  presence as (select camp_id,count(*) as n from public.easycall_agent_presence where state<>'offline' and last_seen>now()-interval '90 seconds' group by camp_id),
  accounts as (select distinct on(raw_app_meta_data->>'camp_id') raw_app_meta_data->>'camp_id' as camp_id,raw_app_meta_data->>'easycall_login_id' as login_id,email,email_confirmed_at is not null as confirmed from auth.users where raw_app_meta_data->>'easycall_role'='admin' order by raw_app_meta_data->>'camp_id',created_at)
  select coalesce(jsonb_agg(c.c||jsonb_build_object('startsOn',k.starts_on,'endsOn',k.ends_on,'unitPrice',coalesce(k.unit_price,700000),
    'contractAmount',coalesce(k.contract_amount,0),'paidAmount',coalesce(p.amount,0),'outstandingAmount',greatest(0,coalesce(k.contract_amount,0)-coalesce(p.amount,0)),
    'revision',k.revision,'effectiveStatus',easycall_private_v2.operating_status(c.c->>'campId'),
    'billingStatus',case when k.contract_amount=0 then '시범운영(무료)' when coalesce(p.amount,0)>=k.contract_amount then '완납(가동중)' when coalesce(p.amount,0)>0 then '일부입금' else '미입금' end,
    'voterCount',coalesce(v.n,0),'callCount',coalesce(l.n,0),'registeredCount',coalesce(a.n,0),'onlineCount',coalesce(pr.n,0),
    'adminLoginId',ac.login_id,'adminEmail',ac.email,'adminConfirmed',coalesce(ac.confirmed,false)) order by c.c->>'campId'),'[]') into result
  from camps c left join public.easycall_camp_contracts k on k.camp_id=c.c->>'campId'
  left join voters v on v.camp_id=c.c->>'campId' left join logs l on l.camp_id=c.c->>'campId'
  left join paid p on p.camp_id=c.c->>'campId' left join agents a on a.camp_id=c.c->>'campId'
  left join presence pr on pr.camp_id=c.c->>'campId' left join accounts ac on ac.camp_id=c.c->>'campId';
  return jsonb_build_object('camps',result,'serverTime',now());
end $$;

delete from easycall_private_v2.runtime_cache where cache_key='overview';
notify pgrst,'reload schema';
commit;
