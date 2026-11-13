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
 if coalesce((m->>'easycall_must_change')::boolean,false) then raise exception 'PASSWORD_CHANGE_REQUIRED' using errcode='42501';end if;
 return m;
end $$;

create or replace function public.easycall_work_account_context(p_camp text,p_login text,p_role text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare m jsonb:=public.easycall_identity();email_alias text;u auth.users;
begin
 if p_camp is null or p_camp!~'^[a-z0-9_-]{1,64}$' or p_login is null or p_login!~'^[a-z0-9_-]{1,32}$' or p_role is null or p_role not in ('admin','agent') then raise exception 'Invalid account';end if;
 if m->>'easycall_role'<>'super' and (m->>'easycall_role'<>'admin' or m->>'camp_id'<>p_camp or p_role<>'agent') then raise exception 'Account access denied' using errcode='42501';end if;
 if easycall_private_v2.camp_json(p_camp) is null then raise exception 'Unknown camp';end if;
 if m->>'easycall_role'<>'super' then perform public.easycall_require_camp(p_camp);end if;
 email_alias:=encode(sha256(convert_to(p_camp||':'||p_login,'UTF8')),'hex')||'@login.easycall.invalid';
 select * into u from auth.users where email=email_alias;
 if found and (u.raw_app_meta_data->>'camp_id' is distinct from p_camp or u.raw_app_meta_data->>'easycall_role' is distinct from p_role or u.raw_app_meta_data->>'easycall_login_id' is distinct from p_login) then raise exception 'Account collision';end if;
 if u.id is null and p_role='agent' and not exists(select 1 from easycall_private_v2.agent_registry where camp_id=p_camp and agent_id=p_login)
  and (select count(*) from easycall_private_v2.agent_registry where camp_id=p_camp)>=coalesce((easycall_private_v2.camp_json(p_camp)->>'tablets')::int,0) then raise exception 'Tablet quota exceeded';end if;
 return jsonb_build_object('email',email_alias,'userId',u.id,'metadata',u.raw_app_meta_data);
end $$;

create or replace function public.easycall_work_account_activate(p_camp text,p_login text,p_role text,p_user uuid,p_alias text,p_phone text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare context jsonb;meta jsonb;c jsonb;n integer;u auth.users;
begin
 context:=public.easycall_work_account_context(p_camp,p_login,p_role);
 perform pg_advisory_xact_lock(hashtextextended('easycall:'||p_camp,0));
 select * into u from auth.users where id=p_user for update;
 if not found or u.email is distinct from context->>'email' or u.raw_app_meta_data->>'easycall_created_by' is distinct from auth.uid()::text or u.raw_app_meta_data->>'easycall_work_status'<>'pending' then raise exception 'Provisioning mismatch';end if;
 if length(coalesce(p_alias,'')) not between 1 and 80 or (p_role='agent' and coalesce(p_phone,'')!~'^0[0-9]{8,10}$') then raise exception 'Invalid profile';end if;
 select payload into meta from public.easycall_sync_store where store_key='MASTER_META' for update;
 c:=easycall_private_v2.camp_json(p_camp);
 if p_role='agent' and not exists(select 1 from jsonb_array_elements(coalesce(meta->'agentsList','[]'))a where a->>'campId'=p_camp and a->>'agentId'=p_login) then
  select count(*) into n from jsonb_array_elements(coalesce(meta->'agentsList','[]'))a where a->>'campId'=p_camp;
  if n>=coalesce((c->>'tablets')::int,0) then raise exception 'Tablet quota exceeded';end if;
  meta:=jsonb_set(meta,'{agentsList}',coalesce(meta->'agentsList','[]')||jsonb_build_array(jsonb_build_object('campId',p_camp,'agentId',p_login,'alias',p_alias,'assignedPhone',p_phone,'status','대기 중')));
  update public.easycall_sync_store set payload=meta,updated_at=clock_timestamp() where store_key='MASTER_META';
 end if;
 update auth.users set raw_app_meta_data=raw_app_meta_data||jsonb_build_object('easycall_work_status','active','easycall_must_change',true) where id=p_user;
 perform easycall_private_v2.audit('account.create_work',p_camp,null,jsonb_build_object('loginId',p_login,'role',p_role,'userId',p_user));
 return jsonb_build_object('userId',p_user,'loginId',p_login);
end $$;

create or replace function public.easycall_work_account_state(p_camp text,p_login text,p_role text,p_state text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare ctx jsonb;uid uuid;
begin
 ctx:=public.easycall_work_account_context(p_camp,p_login,p_role);uid:=(ctx->>'userId')::uuid;
 if uid is null or p_state is null or p_state not in ('active','disabled','reset') then raise exception 'Invalid target';end if;
 if ctx->'metadata'->>'easycall_work_status' not in ('active','disabled') then raise exception 'Account provisioning requires owner review';end if;
 if uid=auth.uid() then raise exception 'Cannot administer own account';end if;
 update auth.users set raw_app_meta_data=raw_app_meta_data||case when p_state='reset' then jsonb_build_object('easycall_must_change',true) else jsonb_build_object('easycall_work_status',p_state) end where id=uid;
 perform easycall_private_v2.audit('account.'||p_state,p_camp,null,jsonb_build_object('loginId',p_login,'role',p_role));
 return jsonb_build_object('userId',uid);
end $$;
create or replace function public.easycall_work_password_complete(p_user uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
 update auth.users set raw_app_meta_data=raw_app_meta_data||jsonb_build_object('easycall_must_change',false)
  where id=p_user and raw_app_meta_data->>'easycall_work_status'='active' and raw_app_meta_data->>'easycall_login_id' is not null;
 if not found then raise exception 'Account disabled or unavailable';end if;
end $$;
revoke all on function public.easycall_work_password_complete(uuid) from public,anon,authenticated;
grant execute on function public.easycall_work_password_complete(uuid) to service_role;
revoke all on function public.easycall_identity() from public,anon;
grant execute on function public.easycall_identity() to authenticated;
revoke all on function public.easycall_work_account_context(text,text,text),public.easycall_work_account_activate(text,text,text,uuid,text,text),public.easycall_work_account_state(text,text,text,text) from public,anon;
grant execute on function public.easycall_work_account_context(text,text,text),public.easycall_work_account_activate(text,text,text,uuid,text,text),public.easycall_work_account_state(text,text,text,text) to authenticated;
notify pgrst,'reload schema';
commit;
 then raise exception 'Invalid camp identity' using errcode='42501';end if;
 if m->>'easycall_role'='agent' and coalesce(m->>'agent_id','')!~'^[a-z0-9_-]{1,64}
revoke all on function public.easycall_identity_before_work_accounts() from public,anon,authenticated;
create or replace function public.easycall_identity() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare m jsonb:=public.easycall_identity_before_work_accounts();
begin
 if m->>'easycall_work_status' in ('pending','disabled') then raise exception 'ACCOUNT_DISABLED' using errcode='42501';end if;
 if coalesce((m->>'easycall_must_change')::boolean,false) then raise exception 'PASSWORD_CHANGE_REQUIRED' using errcode='42501';end if;
 return m;
end $$;

create or replace function public.easycall_work_account_context(p_camp text,p_login text,p_role text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare m jsonb:=public.easycall_identity();email_alias text;u auth.users;
begin
 if p_camp is null or p_camp!~'^[a-z0-9_-]{1,64}$' or p_login is null or p_login!~'^[a-z0-9_-]{1,32}$' or p_role is null or p_role not in ('admin','agent') then raise exception 'Invalid account';end if;
 if m->>'easycall_role'<>'super' and (m->>'easycall_role'<>'admin' or m->>'camp_id'<>p_camp or p_role<>'agent') then raise exception 'Account access denied' using errcode='42501';end if;
 if easycall_private_v2.camp_json(p_camp) is null then raise exception 'Unknown camp';end if;
 if m->>'easycall_role'<>'super' then perform public.easycall_require_camp(p_camp);end if;
 email_alias:=encode(sha256(convert_to(p_camp||':'||p_login,'UTF8')),'hex')||'@login.easycall.invalid';
 select * into u from auth.users where email=email_alias;
 if found and (u.raw_app_meta_data->>'camp_id' is distinct from p_camp or u.raw_app_meta_data->>'easycall_role' is distinct from p_role or u.raw_app_meta_data->>'easycall_login_id' is distinct from p_login) then raise exception 'Account collision';end if;
 return jsonb_build_object('email',email_alias,'userId',u.id,'metadata',u.raw_app_meta_data);
end $$;

create or replace function public.easycall_work_account_activate(p_camp text,p_login text,p_role text,p_user uuid,p_alias text,p_phone text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare context jsonb;meta jsonb;c jsonb;n integer;u auth.users;
begin
 context:=public.easycall_work_account_context(p_camp,p_login,p_role);
 perform pg_advisory_xact_lock(hashtextextended('easycall:'||p_camp,0));
 select * into u from auth.users where id=p_user for update;
 if not found or u.email is distinct from context->>'email' or u.raw_app_meta_data->>'easycall_created_by' is distinct from auth.uid()::text or u.raw_app_meta_data->>'easycall_work_status'<>'pending' then raise exception 'Provisioning mismatch';end if;
 if length(coalesce(p_alias,'')) not between 1 and 80 or (p_role='agent' and coalesce(p_phone,'')!~'^0[0-9]{8,10}$') then raise exception 'Invalid profile';end if;
 select payload into meta from public.easycall_sync_store where store_key='MASTER_META' for update;
 c:=easycall_private_v2.camp_json(p_camp);
 if p_role='agent' and not exists(select 1 from jsonb_array_elements(coalesce(meta->'agentsList','[]'))a where a->>'campId'=p_camp and a->>'agentId'=p_login) then
  select count(*) into n from jsonb_array_elements(coalesce(meta->'agentsList','[]'))a where a->>'campId'=p_camp;
  if n>=coalesce((c->>'tablets')::int,0) then raise exception 'Tablet quota exceeded';end if;
  meta:=jsonb_set(meta,'{agentsList}',coalesce(meta->'agentsList','[]')||jsonb_build_array(jsonb_build_object('campId',p_camp,'agentId',p_login,'alias',p_alias,'assignedPhone',p_phone,'status','대기 중')));
  update public.easycall_sync_store set payload=meta,updated_at=clock_timestamp() where store_key='MASTER_META';
 end if;
 update auth.users set raw_app_meta_data=raw_app_meta_data||jsonb_build_object('easycall_work_status','active','easycall_must_change',true) where id=p_user;
 perform easycall_private_v2.audit('account.create_work',p_camp,null,jsonb_build_object('loginId',p_login,'role',p_role,'userId',p_user));
 return jsonb_build_object('userId',p_user,'loginId',p_login);
end $$;

create or replace function public.easycall_work_account_state(p_camp text,p_login text,p_role text,p_state text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare ctx jsonb;uid uuid;
begin
 ctx:=public.easycall_work_account_context(p_camp,p_login,p_role);uid:=(ctx->>'userId')::uuid;
 if uid is null or p_state is null or p_state not in ('active','disabled','reset') then raise exception 'Invalid target';end if;
 if uid=auth.uid() then raise exception 'Cannot administer own account';end if;
 update auth.users set raw_app_meta_data=raw_app_meta_data||case when p_state='reset' then jsonb_build_object('easycall_must_change',true) else jsonb_build_object('easycall_work_status',p_state) end where id=uid;
 perform easycall_private_v2.audit('account.'||p_state,p_camp,null,jsonb_build_object('loginId',p_login,'role',p_role));
 return jsonb_build_object('userId',uid);
end $$;
revoke all on function public.easycall_identity() from public,anon;
grant execute on function public.easycall_identity() to authenticated;
revoke all on function public.easycall_work_account_context(text,text,text),public.easycall_work_account_activate(text,text,text,uuid,text,text),public.easycall_work_account_state(text,text,text,text) from public,anon;
grant execute on function public.easycall_work_account_context(text,text,text),public.easycall_work_account_activate(text,text,text,uuid,text,text),public.easycall_work_account_state(text,text,text,text) to authenticated;
notify pgrst,'reload schema';
commit;
 then raise exception 'Invalid agent identity' using errcode='42501';end if;
 select exists(select 1 from auth.mfa_factors where user_id=auth.uid() and status='verified') into has_factor;
 select require_super_mfa and m->>'easycall_role'='super' into must_enroll from easycall_private_v2.security_policy where singleton;
 if (has_factor or coalesce(must_enroll,false)) and coalesce(auth.jwt()->>'aal','aal1')<>'aal2' then raise exception 'MFA_REQUIRED: 2단계 인증이 필요합니다.' using errcode='42501';end if;
 if coalesce(must_enroll,false) and not has_factor then raise exception 'MFA_ENROLL_REQUIRED: 인증 앱을 등록하세요.' using errcode='42501';end if;
 if m->>'easycall_work_status' in ('pending','disabled') then raise exception 'ACCOUNT_DISABLED' using errcode='42501';end if;
 if coalesce((m->>'easycall_must_change')::boolean,false) then raise exception 'PASSWORD_CHANGE_REQUIRED' using errcode='42501';end if;
 return m;
end $;
revoke all on function public.easycall_identity_before_work_accounts() from public,anon,authenticated;
create or replace function public.easycall_identity() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare m jsonb:=public.easycall_identity_before_work_accounts();
begin
 if m->>'easycall_work_status' in ('pending','disabled') then raise exception 'ACCOUNT_DISABLED' using errcode='42501';end if;
 if coalesce((m->>'easycall_must_change')::boolean,false) then raise exception 'PASSWORD_CHANGE_REQUIRED' using errcode='42501';end if;
 return m;
end $$;

create or replace function public.easycall_work_account_context(p_camp text,p_login text,p_role text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare m jsonb:=public.easycall_identity();email_alias text;u auth.users;
begin
 if p_camp is null or p_camp!~'^[a-z0-9_-]{1,64}$' or p_login is null or p_login!~'^[a-z0-9_-]{1,32}$' or p_role is null or p_role not in ('admin','agent') then raise exception 'Invalid account';end if;
 if m->>'easycall_role'<>'super' and (m->>'easycall_role'<>'admin' or m->>'camp_id'<>p_camp or p_role<>'agent') then raise exception 'Account access denied' using errcode='42501';end if;
 if easycall_private_v2.camp_json(p_camp) is null then raise exception 'Unknown camp';end if;
 if m->>'easycall_role'<>'super' then perform public.easycall_require_camp(p_camp);end if;
 email_alias:=encode(sha256(convert_to(p_camp||':'||p_login,'UTF8')),'hex')||'@login.easycall.invalid';
 select * into u from auth.users where email=email_alias;
 if found and (u.raw_app_meta_data->>'camp_id' is distinct from p_camp or u.raw_app_meta_data->>'easycall_role' is distinct from p_role or u.raw_app_meta_data->>'easycall_login_id' is distinct from p_login) then raise exception 'Account collision';end if;
 return jsonb_build_object('email',email_alias,'userId',u.id,'metadata',u.raw_app_meta_data);
end $$;

create or replace function public.easycall_work_account_activate(p_camp text,p_login text,p_role text,p_user uuid,p_alias text,p_phone text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare context jsonb;meta jsonb;c jsonb;n integer;u auth.users;
begin
 context:=public.easycall_work_account_context(p_camp,p_login,p_role);
 perform pg_advisory_xact_lock(hashtextextended('easycall:'||p_camp,0));
 select * into u from auth.users where id=p_user for update;
 if not found or u.email is distinct from context->>'email' or u.raw_app_meta_data->>'easycall_created_by' is distinct from auth.uid()::text or u.raw_app_meta_data->>'easycall_work_status'<>'pending' then raise exception 'Provisioning mismatch';end if;
 if length(coalesce(p_alias,'')) not between 1 and 80 or (p_role='agent' and coalesce(p_phone,'')!~'^0[0-9]{8,10}$') then raise exception 'Invalid profile';end if;
 select payload into meta from public.easycall_sync_store where store_key='MASTER_META' for update;
 c:=easycall_private_v2.camp_json(p_camp);
 if p_role='agent' and not exists(select 1 from jsonb_array_elements(coalesce(meta->'agentsList','[]'))a where a->>'campId'=p_camp and a->>'agentId'=p_login) then
  select count(*) into n from jsonb_array_elements(coalesce(meta->'agentsList','[]'))a where a->>'campId'=p_camp;
  if n>=coalesce((c->>'tablets')::int,0) then raise exception 'Tablet quota exceeded';end if;
  meta:=jsonb_set(meta,'{agentsList}',coalesce(meta->'agentsList','[]')||jsonb_build_array(jsonb_build_object('campId',p_camp,'agentId',p_login,'alias',p_alias,'assignedPhone',p_phone,'status','대기 중')));
  update public.easycall_sync_store set payload=meta,updated_at=clock_timestamp() where store_key='MASTER_META';
 end if;
 update auth.users set raw_app_meta_data=raw_app_meta_data||jsonb_build_object('easycall_work_status','active','easycall_must_change',true) where id=p_user;
 perform easycall_private_v2.audit('account.create_work',p_camp,null,jsonb_build_object('loginId',p_login,'role',p_role,'userId',p_user));
 return jsonb_build_object('userId',p_user,'loginId',p_login);
end $$;

create or replace function public.easycall_work_account_state(p_camp text,p_login text,p_role text,p_state text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare ctx jsonb;uid uuid;
begin
 ctx:=public.easycall_work_account_context(p_camp,p_login,p_role);uid:=(ctx->>'userId')::uuid;
 if uid is null or p_state is null or p_state not in ('active','disabled','reset') then raise exception 'Invalid target';end if;
 if uid=auth.uid() then raise exception 'Cannot administer own account';end if;
 update auth.users set raw_app_meta_data=raw_app_meta_data||case when p_state='reset' then jsonb_build_object('easycall_must_change',true) else jsonb_build_object('easycall_work_status',p_state) end where id=uid;
 perform easycall_private_v2.audit('account.'||p_state,p_camp,null,jsonb_build_object('loginId',p_login,'role',p_role));
 return jsonb_build_object('userId',uid);
end $$;
revoke all on function public.easycall_identity() from public,anon;
grant execute on function public.easycall_identity() to authenticated;
revoke all on function public.easycall_work_account_context(text,text,text),public.easycall_work_account_activate(text,text,text,uuid,text,text),public.easycall_work_account_state(text,text,text,text) from public,anon;
grant execute on function public.easycall_work_account_context(text,text,text),public.easycall_work_account_activate(text,text,text,uuid,text,text),public.easycall_work_account_state(text,text,text,text) to authenticated;
notify pgrst,'reload schema';
commit;
