begin;
create table if not exists easycall_private_v2.security_policy(singleton boolean primary key default true check(singleton),require_super_mfa boolean not null default false);
insert into easycall_private_v2.security_policy values(true,false) on conflict do nothing;
revoke all on easycall_private_v2.security_policy from public,anon,authenticated;

-- Recheck live membership and MFA for every RPC and RLS policy using identity.
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
 return m;
end $$;
create or replace function public.easycall_mfa_policy_status()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare m jsonb;
begin
 select raw_app_meta_data into m from auth.users where id=auth.uid();
 if coalesce(m->>'easycall_role','') not in ('super','admin','agent') then raise exception '인증 계정이 필요합니다.' using errcode='42501';end if;
 return jsonb_build_object('required',m->>'easycall_role'='super' and (select require_super_mfa from easycall_private_v2.security_policy where singleton));
end $$;
create or replace function public.easycall_admin_mfa_policy(p_required boolean,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform easycall_private_v2.require_super();
 if p_required is null or length(trim(coalesce(p_reason,''))) not between 1 and 500 then raise exception '변경 사유를 입력하세요.';end if;
 if coalesce(auth.jwt()->>'aal','aal1')<>'aal2' then raise exception '2단계 인증 후 정책을 변경하세요.' using errcode='42501';end if;
 if p_required and exists(select 1 from auth.users u where u.raw_app_meta_data->>'easycall_role'='super' and (select count(*) from auth.mfa_factors f where f.user_id=u.id and f.status='verified' and f.factor_type='totp')<2) then raise exception '모든 최고관리자가 기본·보조 인증 앱 2개를 먼저 등록해야 합니다.';end if;
 update easycall_private_v2.security_policy set require_super_mfa=p_required where singleton;
 perform easycall_private_v2.audit('security.mfa_policy',null,null,jsonb_build_object('required',p_required,'reason',p_reason));
 return jsonb_build_object('required',p_required);
end $$;

create index if not exists easycall_voters_camp_uid_idx on public.easycall_voters(camp_id,uid);
create index if not exists easycall_logs_camp_created_id_idx on public.easycall_call_logs(camp_id,created_at desc,id desc);
create or replace function public.easycall_list_page(p_camp_id text,p_kind text,p_offset integer default 0,p_limit integer default 50,p_query text default '',p_callback boolean default false,p_as_of timestamptz default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare m jsonb:=public.easycall_require_camp(p_camp_id);items jsonb;total bigint;cutoff timestamptz:=coalesce(p_as_of,now());q text:=lower(trim(coalesce(p_query,'')));off integer:=greatest(0,coalesce(p_offset,0));lim integer:=coalesce(p_limit,50);
begin
 if p_kind not in ('voters','logs','history') or lim not between 1 and 100 or length(q)>200 then raise exception '목록 조회 조건 오류';end if;
 if p_kind='logs' and m->>'easycall_role'='agent' then raise exception '관리자 권한 필요' using errcode='42501';end if;
 if p_kind='voters' then
   select count(*) into total from public.easycall_voters v where camp_id=p_camp_id and (not coalesce(p_callback,false) or last_result in ('ABSENT','CALLBACK')) and (q='' or strpos(lower(concat_ws(' ',v.name,v.phone,v.dong,v.voter_id)),q)>0);
   select coalesce(jsonb_agg(to_jsonb(t) order by t.uid),'[]') into items from (select uid,voter_id,camp_id,name,phone,dong,last_result,last_memo,case when lock_expires_at>now() then locked_by else null end as locked_by from public.easycall_voters v where camp_id=p_camp_id and (not coalesce(p_callback,false) or last_result in ('ABSENT','CALLBACK')) and (q='' or strpos(lower(concat_ws(' ',v.name,v.phone,v.dong,v.voter_id)),q)>0) order by uid offset off limit lim) t;
 else
   select count(*) into total from public.easycall_call_logs l where camp_id=p_camp_id and (created_at<=cutoff or created_at is null) and (p_kind<>'history' or l.agent_id=m->>'agent_id');
   select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc nulls last,t.id desc),'[]') into items from (select * from public.easycall_call_logs l where camp_id=p_camp_id and (created_at<=cutoff or created_at is null) and (p_kind<>'history' or l.agent_id=m->>'agent_id') order by created_at desc nulls last,id desc offset off limit lim) t;
 end if;
 return jsonb_build_object('items',items,'total',total,'offset',off,'limit',lim,'asOf',cutoff);
end $$;
create or replace function public.easycall_camp_counts(p_camp_id text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare m jsonb:=public.easycall_require_camp(p_camp_id);aid text:=case when m->>'easycall_role'='agent' then m->>'agent_id' else null end;v jsonb;l jsonb;groups jsonb;agents jsonb;
begin
 select jsonb_build_object('total',count(*),'ready',count(*) filter(where last_result='READY'),'callback',count(*) filter(where last_result in ('ABSENT','CALLBACK'))) into v from public.easycall_voters where camp_id=p_camp_id;
 select jsonb_build_object('total',count(*),'results',coalesce(jsonb_object_agg(result,n),'{}')) into l from (select coalesce(call_result,'UNKNOWN') result,count(*) n from public.easycall_call_logs where camp_id=p_camp_id and (aid is null or agent_id=aid) group by call_result) t;
 -- Sum grouped counts; count(*) above is the number of groups, not calls.
 l:=jsonb_set(l,'{total}',to_jsonb(coalesce((select sum(value::bigint) from jsonb_each_text(l->'results')),0)));
 select coalesce(jsonb_agg(to_jsonb(t)),'[]') into groups from (
  select call_result as "callResult",status,coalesce(gender,'미상') gender,coalesce(dong,'기타') dong,count(*) n
  from public.easycall_call_logs where camp_id=p_camp_id and (aid is null or agent_id=aid) group by call_result,status,coalesce(gender,'미상'),coalesce(dong,'기타')
 ) t;
 select coalesce(jsonb_agg(to_jsonb(t)),'[]') into agents from (
  select agent_id as "agentId",count(*) total,count(*) filter(where call_result='CONNECTED') connected,count(*) filter(where (created_at at time zone 'Asia/Seoul')::date=(now() at time zone 'Asia/Seoul')::date) today
  from public.easycall_call_logs where camp_id=p_camp_id and (aid is null or agent_id=aid) group by agent_id
 ) t;
 return jsonb_build_object('voters',v,'logs',l,'groups',groups,'agents',agents,'serverTime',now());
end $$;
do $$ declare f record;begin
 for f in select oid::regprocedure signature from pg_proc where pronamespace='public'::regnamespace and proname in ('easycall_mfa_policy_status','easycall_admin_mfa_policy','easycall_list_page','easycall_camp_counts') loop
  execute format('revoke all on function %s from public,anon,authenticated',f.signature);execute format('grant execute on function %s to authenticated',f.signature);
 end loop;
end $$;
notify pgrst,'reload schema';
commit;
