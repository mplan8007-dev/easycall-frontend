begin;
create table if not exists easycall_private_v2.agent_common_policy(camp_id text primary key,ciphertext text not null,version uuid not null,updated_at timestamptz not null default now(),issue_lease uuid,issue_until timestamptz);
create table if not exists easycall_private_v2.agent_common_targets(camp_id text not null,version uuid not null,user_id uuid not null,state text not null default 'pending' check(state in ('pending','processing','done','failed')),lease uuid,lease_until timestamptz,primary key(camp_id,version,user_id));
alter table easycall_private_v2.agent_common_policy enable row level security;
alter table easycall_private_v2.agent_common_targets enable row level security;
revoke all on easycall_private_v2.agent_common_policy,easycall_private_v2.agent_common_targets from public,anon,authenticated;

create or replace function public.easycall_agent_common_state(p_camp text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare m jsonb:=public.easycall_identity();p easycall_private_v2.agent_common_policy;counts jsonb;
begin
 if m->>'easycall_role' not in ('super','admin') then raise exception 'Manager required' using errcode='42501';end if;
 perform public.easycall_require_camp(p_camp);
 if easycall_private_v2.camp_json(p_camp) is null then raise exception 'Unknown camp';end if;
 select * into p from easycall_private_v2.agent_common_policy where camp_id=p_camp;
 if not found then return jsonb_build_object('configured',false,'ready',false,'version',null,'total',0,'done',0,'pending',0,'processing',0,'failed',0);end if;
 select jsonb_build_object('total',count(*),'done',count(*) filter(where state='done'),'pending',count(*) filter(where state='pending'),'processing',count(*) filter(where state='processing'),'failed',count(*) filter(where state='failed'),'ready',count(*) filter(where state<>'done')=0) into counts from easycall_private_v2.agent_common_targets where camp_id=p_camp and version=p.version;
 return counts||jsonb_build_object('configured',true,'version',p.version,'updatedAt',p.updated_at);
end $$;

create or replace function public.easycall_agent_common_begin(p_camp text,p_cipher text,p_version uuid,p_expected uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s jsonb;p easycall_private_v2.agent_common_policy;
begin
 s:=public.easycall_agent_common_state(p_camp);
 if p_cipher is null or length(p_cipher) not between 40 and 256 or p_version is null then raise exception 'Invalid encrypted credential';end if;
 perform pg_advisory_xact_lock(hashtextextended('common-policy:'||p_camp,0));
 select * into p from easycall_private_v2.agent_common_policy where camp_id=p_camp for update;
 if p.version is distinct from p_expected then raise exception '다른 관리자가 설정을 변경했습니다. 새로고침하세요.';end if;
 if p.issue_until>clock_timestamp() then raise exception '계정 발급이 진행 중입니다. 잠시 후 다시 시도하세요.';end if;
 if exists(select 1 from easycall_private_v2.agent_common_targets where camp_id=p_camp and version=p.version and state<>'done') then raise exception '기존 전체 적용을 먼저 완료하세요. 실패 계정은 다시 적용할 수 있습니다.';end if;
 insert into easycall_private_v2.agent_common_policy(camp_id,ciphertext,version) values(p_camp,p_cipher,p_version)
 on conflict(camp_id) do update set ciphertext=excluded.ciphertext,version=excluded.version,updated_at=clock_timestamp(),issue_lease=null,issue_until=null;
 insert into easycall_private_v2.agent_common_targets(camp_id,version,user_id)
 select p_camp,p_version,id from auth.users where raw_app_meta_data->>'camp_id'=p_camp and raw_app_meta_data->>'easycall_role'='agent';
 perform easycall_private_v2.audit('agent.common_password.begin',p_camp,null,jsonb_build_object('version',p_version));
 return public.easycall_agent_common_state(p_camp);
end $$;

create or replace function public.easycall_agent_common_retry(p_camp text,p_version uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform public.easycall_agent_common_state(p_camp);
 perform 1 from easycall_private_v2.agent_common_policy where camp_id=p_camp and version=p_version for update;
 if not found then raise exception '설정이 변경됐습니다. 새로고침하세요.';end if;
 update easycall_private_v2.agent_common_targets set state='pending',lease=null,lease_until=null where camp_id=p_camp and version=p_version and (state='failed' or (state='processing' and lease_until<clock_timestamp()));
 return public.easycall_agent_common_state(p_camp);
end $$;

create or replace function public.easycall_agent_common_secret(p_camp text)
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('ciphertext',ciphertext,'version',version,'ready',not exists(select 1 from easycall_private_v2.agent_common_targets t where t.camp_id=p.camp_id and t.version=p.version and t.state<>'done')) from easycall_private_v2.agent_common_policy p where camp_id=p_camp;
$$;

create or replace function public.easycall_agent_common_claim(p_camp text,p_version uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare token uuid:=gen_random_uuid();ids jsonb;
begin
 perform 1 from easycall_private_v2.agent_common_policy where camp_id=p_camp and version=p_version for update;
 if not found then raise exception 'Policy changed';end if;
 update easycall_private_v2.agent_common_targets set state='pending',lease=null,lease_until=null where camp_id=p_camp and version=p_version and state='processing' and lease_until<clock_timestamp();
 if exists(select 1 from easycall_private_v2.agent_common_targets where camp_id=p_camp and version=p_version and state='processing') then return jsonb_build_object('busy',true,'users','[]'::jsonb);end if;
 with chosen as(select user_id from easycall_private_v2.agent_common_targets where camp_id=p_camp and version=p_version and state='pending' order by user_id limit 25),
 changed as(update easycall_private_v2.agent_common_targets t set state='processing',lease=token,lease_until=clock_timestamp()+interval '15 minutes' from chosen c where t.camp_id=p_camp and t.version=p_version and t.user_id=c.user_id returning t.user_id)
 select coalesce(jsonb_agg(user_id),'[]') into ids from changed;
 return jsonb_build_object('busy',false,'lease',token,'users',ids);
end $$;

create or replace function public.easycall_agent_common_finish(p_camp text,p_version uuid,p_user uuid,p_lease uuid,p_success boolean)
returns void language plpgsql security definer set search_path='' as $$
begin
 perform 1 from easycall_private_v2.agent_common_policy where camp_id=p_camp and version=p_version for update;
 if not found then raise exception 'Policy changed';end if;
 perform 1 from easycall_private_v2.agent_common_targets where camp_id=p_camp and version=p_version and user_id=p_user and lease=p_lease and state='processing' for update;
 if not found then raise exception 'Invalid lease';end if;
 if p_success then
 update auth.users set raw_app_meta_data=raw_app_meta_data||jsonb_build_object('easycall_auth_version',p_version,'easycall_agent_common_version',p_version,'easycall_must_change',false)
 where id=p_user and raw_app_meta_data->>'camp_id'=p_camp and raw_app_meta_data->>'easycall_role'='agent';
 end if;
 update easycall_private_v2.agent_common_targets set state=case when p_success then 'done' else 'failed' end,lease=null,lease_until=null where camp_id=p_camp and version=p_version and user_id=p_user;
end $$;

create or replace function public.easycall_agent_common_issue(p_camp text,p_version uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare p easycall_private_v2.agent_common_policy;token uuid:=gen_random_uuid();
begin
 select * into p from easycall_private_v2.agent_common_policy where camp_id=p_camp and version=p_version for update;
 if not found then raise exception 'Policy changed';end if;
 if exists(select 1 from easycall_private_v2.agent_common_targets where camp_id=p_camp and version=p_version and state<>'done') then raise exception '공통 비밀번호 전체 적용을 먼저 완료하세요.';end if;
 if p.issue_until>clock_timestamp() then raise exception '계정 발급이 진행 중입니다. 잠시 후 다시 시도하세요.';end if;
 update easycall_private_v2.agent_common_policy set issue_lease=token,issue_until=clock_timestamp()+interval '15 minutes' where camp_id=p_camp;
 return jsonb_build_object('lease',token,'ciphertext',p.ciphertext,'version',p.version);
end $$;
create or replace function public.easycall_agent_common_release(p_camp text,p_version uuid,p_lease uuid,p_user uuid default null)
returns void language plpgsql security definer set search_path='' as $$
begin
 perform 1 from easycall_private_v2.agent_common_policy where camp_id=p_camp and version=p_version and issue_lease=p_lease for update;
 if not found then raise exception 'Invalid lease';end if;
 if p_user is not null then
 update auth.users set raw_app_meta_data=raw_app_meta_data||jsonb_build_object('easycall_agent_common_version',p_version,'easycall_must_change',false)
 where id=p_user and raw_app_meta_data->>'camp_id'=p_camp and raw_app_meta_data->>'easycall_role'='agent';
 end if;
 update easycall_private_v2.agent_common_policy set issue_lease=null,issue_until=null where camp_id=p_camp;
end $$;
revoke all on function public.easycall_agent_common_state(text),public.easycall_agent_common_begin(text,text,uuid,uuid),public.easycall_agent_common_retry(text,uuid) from public,anon;
grant execute on function public.easycall_agent_common_state(text),public.easycall_agent_common_begin(text,text,uuid,uuid),public.easycall_agent_common_retry(text,uuid) to authenticated;
revoke all on function public.easycall_agent_common_secret(text),public.easycall_agent_common_claim(text,uuid),public.easycall_agent_common_finish(text,uuid,uuid,uuid,boolean),public.easycall_agent_common_issue(text,uuid),public.easycall_agent_common_release(text,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.easycall_agent_common_secret(text),public.easycall_agent_common_claim(text,uuid),public.easycall_agent_common_finish(text,uuid,uuid,uuid,boolean),public.easycall_agent_common_issue(text,uuid),public.easycall_agent_common_release(text,uuid,uuid,uuid) to service_role;
notify pgrst,'reload schema';
commit;
