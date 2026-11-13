begin;
create or replace function public.easycall_agent_accounts(p_camp text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare m jsonb:=public.easycall_identity();c jsonb;items jsonb;used_ids jsonb;registered integer;quota integer;
begin
 if m->>'easycall_role' not in ('super','admin') then raise exception 'Manager account required' using errcode='42501';end if;
 perform public.easycall_require_camp(p_camp);
 c:=easycall_private_v2.camp_json(p_camp);
 if c is null then raise exception 'Unknown camp';end if;
 quota:=coalesce((c->>'tablets')::integer,0);
 select count(*) into registered from easycall_private_v2.agent_registry where camp_id=p_camp;
 with accounts as (
 select distinct on(coalesce(u.raw_app_meta_data->>'easycall_login_id',u.raw_app_meta_data->>'agent_id'))
 coalesce(u.raw_app_meta_data->>'easycall_login_id',u.raw_app_meta_data->>'agent_id') as login_id,
 u.id,u.email,u.raw_app_meta_data as meta,u.last_sign_in_at
 from auth.users u where u.raw_app_meta_data->>'easycall_role'='agent' and u.raw_app_meta_data->>'camp_id'=p_camp
 order by coalesce(u.raw_app_meta_data->>'easycall_login_id',u.raw_app_meta_data->>'agent_id'),(u.raw_app_meta_data->>'easycall_login_id' is not null) desc,u.created_at
 )
 select coalesce(jsonb_agg(jsonb_build_object(
 'loginId',coalesce(r.agent_id,a.login_id),
 'name',coalesce(r.payload->>'alias',a.meta->'easycall_work_profile'->>'alias',a.login_id),
 'phone',coalesce(r.payload->>'assignedPhone',a.meta->'easycall_work_profile'->>'phone',''),
 'hasAccount',a.id is not null,'legacy',a.id is not null and a.meta->>'easycall_login_id' is null,
 'email',case when a.meta->>'easycall_login_id' is null then a.email else null end,
 'status',case when a.id is null then 'unissued' else coalesce(a.meta->>'easycall_work_status','active') end,
 'initialPassword',coalesce((a.meta->>'easycall_must_change')::boolean,false),
 'lastLogin',a.last_sign_in_at) order by coalesce(r.agent_id,a.login_id)),'[]'::jsonb) into items
 from (select * from easycall_private_v2.agent_registry where camp_id=p_camp) r full join accounts a on a.login_id=r.agent_id;
 select coalesce(jsonb_agg(login_id),'[]'::jsonb) into used_ids from (
 select agent_id as login_id from easycall_private_v2.agent_registry where camp_id=p_camp
 union select raw_app_meta_data->>'easycall_login_id' from auth.users where raw_app_meta_data->>'camp_id'=p_camp and raw_app_meta_data->>'easycall_login_id' is not null) ids;
 return jsonb_build_object('campId',p_camp,'campName',c->>'name','limit',quota,'registered',registered,'remaining',greatest(0,quota-registered),'accounts',items,'reservedIds',used_ids);
end $$;
revoke all on function public.easycall_agent_accounts(text) from public,anon;
grant execute on function public.easycall_agent_accounts(text) to authenticated;
notify pgrst,'reload schema';
commit;
