begin;
-- Durable, private evidence. No password, hash, token, email or arbitrary payload columns.
create table if not exists easycall_private_v2.credential_requests (
 request_id uuid primary key, actor_id uuid not null, user_id uuid not null,
 camp_id text not null, target_role text not null,
 path text not null check(path in ('self_change','admin_reset','agent_common')),
 outcome text not null default 'requested' check(outcome in ('requested','succeeded','rejected','unknown')),
 requested_at timestamptz not null default clock_timestamp(), completed_at timestamptz
);
create index if not exists credential_requests_user_time on easycall_private_v2.credential_requests(user_id,requested_at desc);
create table if not exists easycall_private_v2.credential_changes (
 id bigint generated always as identity primary key, user_id uuid not null,
 camp_id text, target_role text, changed_at timestamptz not null default clock_timestamp()
);
create index if not exists credential_changes_user_time on easycall_private_v2.credential_changes(user_id,changed_at desc);
alter table easycall_private_v2.credential_requests enable row level security;
alter table easycall_private_v2.credential_changes enable row level security;
revoke all on easycall_private_v2.credential_requests,easycall_private_v2.credential_changes from public,anon,authenticated,service_role;
revoke all on sequence easycall_private_v2.credential_changes_id_seq from public,anon,authenticated,service_role;

create or replace function public.easycall_credential_audit_begin(p_request uuid,p_actor uuid,p_user uuid,p_path text,p_camp text,p_role text)
returns void language plpgsql security definer set search_path='' as $$
declare m jsonb;
begin
 select raw_app_meta_data into m from auth.users where id=p_user;
 if m is null or m->>'camp_id' is distinct from p_camp or m->>'easycall_role' is distinct from p_role
  or (p_path='agent_common' and p_role<>'agent')
  or (p_path='self_change' and (p_actor is distinct from p_user or m->>'easycall_work_status' is distinct from 'active'))
 then raise exception 'Credential target changed' using errcode='42501';end if;
 insert into easycall_private_v2.credential_requests(request_id,actor_id,user_id,path,camp_id,target_role)
 values(p_request,p_actor,p_user,p_path,p_camp,p_role);
end $$;

create or replace function public.easycall_credential_audit_finish(p_request uuid,p_outcome text)
returns void language plpgsql security definer set search_path='' as $$
begin
 if p_outcome is null or p_outcome not in ('succeeded','rejected','unknown') then raise exception 'Invalid credential outcome';end if;
 update easycall_private_v2.credential_requests set outcome=p_outcome,completed_at=clock_timestamp()
 where request_id=p_request and outcome='requested';
 if not found and not exists(select 1 from easycall_private_v2.credential_requests where request_id=p_request and outcome=p_outcome)
 then raise exception 'Credential audit request unavailable';end if;
end $$;

create or replace function easycall_private_v2.observe_credential_change()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 -- This is a database observation, NOT proof of who initiated a change.
 insert into easycall_private_v2.credential_changes(user_id,camp_id,target_role)
 values(new.id,new.raw_app_meta_data->>'camp_id',new.raw_app_meta_data->>'easycall_role');
 return new;
end $$;
drop trigger if exists easycall_credential_changed on auth.users;
create trigger easycall_credential_changed after update of encrypted_password on auth.users
for each row when (old.encrypted_password is distinct from new.encrypted_password)
execute function easycall_private_v2.observe_credential_change();

revoke all on function easycall_private_v2.observe_credential_change() from public,anon,authenticated,service_role;
revoke all on function public.easycall_credential_audit_begin(uuid,uuid,uuid,text,text,text),public.easycall_credential_audit_finish(uuid,text) from public,anon,authenticated;
grant execute on function public.easycall_credential_audit_begin(uuid,uuid,uuid,text,text,text),public.easycall_credential_audit_finish(uuid,text) to service_role;
notify pgrst,'reload schema';
commit;
