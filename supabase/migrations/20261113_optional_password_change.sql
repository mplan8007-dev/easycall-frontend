begin;
create or replace function public.easycall_identity()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare m jsonb;has_factor boolean;must_enroll boolean;
begin
 select raw_app_meta_data into m from auth.users where id=auth.uid();
 if m is null or coalesce(m->>'easycall_role','') not in ('super','admin','agent') then raise exception 'Authenticated EasyCall account required' using errcode='42501';end if;
 if m->>'easycall_role'<>'super' and coalesce(m->>'camp_id','')!~'^[a-z0-9_-]{1,64}$' then raise exception 'Invalid camp identity' using errcode='42501';end if;
 if m->>'easycall_role'='agent' and coalesce(m->>'agent_id','')!~'^[a-z0-9_-]{1,64}$' then raise exception 'Invalid agent identity' using errcode='42501';end if;
 select exists(select 1 from auth.mfa_factors where user_id=auth.uid() and status='verified') into has_factor;
 select require_super_mfa and m->>'easycall_role'='super' into must_enroll from easycall_private_v2.security_policy where singleton;
 if (has_factor or coalesce(must_enroll,false)) and coalesce(auth.jwt()->>'aal','aal1')<>'aal2' then raise exception 'MFA_REQUIRED: 2단계 인증이 필요합니다.' using errcode='42501';end if;
 if coalesce(must_enroll,false) and not has_factor then raise exception 'MFA_ENROLL_REQUIRED: 인증 앱을 등록하세요.' using errcode='42501';end if;
 if m->>'easycall_work_status' in ('pending','disabled') then raise exception 'ACCOUNT_DISABLED' using errcode='42501';end if;
 if m->>'easycall_auth_version' is not null and (auth.jwt()->'app_metadata'->>'easycall_auth_version') is distinct from m->>'easycall_auth_version' then raise exception 'SESSION_REFRESH_REQUIRED' using errcode='42501';end if;
 return m;
end $$;

notify pgrst,'reload schema';
commit;
