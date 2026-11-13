begin;
create or replace function public.easycall_admin_accounts(p_camp text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 perform easycall_private_v2.require_super();
 if easycall_private_v2.camp_json(p_camp) is null then raise exception 'Unknown camp';end if;
 return coalesce((select jsonb_agg(jsonb_build_object(
 'loginId',u.raw_app_meta_data->>'easycall_login_id',
 'name',coalesce(u.raw_app_meta_data->'easycall_work_profile'->>'alias',u.raw_user_meta_data->>'name','관리자'),
 'email',case when u.raw_app_meta_data->>'easycall_login_id' is null then u.email else null end,
 'status',coalesce(u.raw_app_meta_data->>'easycall_work_status','active'),
 'mustChange',coalesce((u.raw_app_meta_data->>'easycall_must_change')::boolean,false),
 'lastLogin',u.last_sign_in_at) order by u.created_at)
 from auth.users u where u.raw_app_meta_data->>'easycall_role'='admin' and u.raw_app_meta_data->>'camp_id'=p_camp),'[]'::jsonb);
end $$;
revoke all on function public.easycall_admin_accounts(text) from public,anon;
grant execute on function public.easycall_admin_accounts(text) to authenticated;
notify pgrst,'reload schema';
commit;
