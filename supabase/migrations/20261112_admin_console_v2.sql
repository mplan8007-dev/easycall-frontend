-- Apply after 20261112_safe_operations.sql. All changes are transactional.
begin;
create schema if not exists easycall_private_v2;
revoke all on schema easycall_private_v2 from public,anon,authenticated;

create table if not exists public.easycall_camp_contracts (
  camp_id text primary key, starts_on date, ends_on date,
  unit_price bigint not null default 700000 check(unit_price between 0 and 1000000000000),
  contract_amount bigint not null default 0 check(contract_amount between 0 and 1000000000000),
  revision timestamptz not null default clock_timestamp(),
  check(starts_on is null or ends_on is null or starts_on<=ends_on)
);
create table if not exists public.easycall_payments (
  id uuid primary key default gen_random_uuid(), camp_id text not null,
  amount bigint not null check(amount between 1 and 1000000000000), paid_on date not null,
  memo text not null default '' check(length(memo)<=500), created_at timestamptz not null default now(),
  actor_id uuid not null, voided_at timestamptz, void_reason text,
  request_id uuid not null unique
);
create index if not exists easycall_payments_camp_idx on public.easycall_payments(camp_id,paid_on);
create table if not exists public.easycall_admin_events (
  id bigint generated always as identity primary key, request_id uuid not null unique,
  actor_id uuid, actor_email text, action text not null, camp_id text,
  before_data jsonb, after_data jsonb, request_hash text, result jsonb,
  created_at timestamptz not null default now()
);
create index if not exists easycall_admin_events_camp_idx on public.easycall_admin_events(camp_id,created_at desc,id desc);
create table if not exists public.easycall_agent_presence (
  camp_id text not null,agent_id text not null,actor_id uuid not null,
  last_seen timestamptz not null default now(),state text not null check(state in ('online','break','offline')),
  primary key(camp_id,agent_id)
);
create table if not exists public.easycall_backup_catalog (
  id uuid primary key default gen_random_uuid(),kind text not null,
  created_at timestamptz not null default now(),created_by uuid,
  voter_count bigint not null default 0,log_count bigint not null default 0,tested_at timestamptz
);
create table if not exists easycall_private_v2.backup_rows (
  backup_id uuid not null references public.easycall_backup_catalog(id),collection text not null,row_data jsonb not null
);
create index if not exists easycall_backup_rows_idx on easycall_private_v2.backup_rows(backup_id,collection);
revoke all on all tables in schema easycall_private_v2 from public,anon,authenticated;

create or replace function easycall_private_v2.safe_date(p_text text)
returns date language plpgsql immutable set search_path='' as $$
begin return nullif(trim(p_text),'')::date; exception when others then return null; end $$;

-- Preserve legacy contract dates/amounts, but never invent evidence of receipt.
insert into public.easycall_camp_contracts(camp_id,starts_on,ends_on,contract_amount)
select c->>'campId',easycall_private_v2.safe_date(split_part(c->>'period','~',1)),
  easycall_private_v2.safe_date(split_part(c->>'period','~',2)),
  case when c->>'billingStatus'='시범운영(무료)' then 0 else greatest(0,coalesce((c->>'tablets')::bigint,0))*700000 end
from public.easycall_sync_store s,lateral jsonb_array_elements(coalesce(s.payload->'campsList','[]')) c
where s.store_key='MASTER_META'
  and (easycall_private_v2.safe_date(split_part(c->>'period','~',1)) is null
    or easycall_private_v2.safe_date(split_part(c->>'period','~',2)) is null
    or easycall_private_v2.safe_date(split_part(c->>'period','~',1))<=easycall_private_v2.safe_date(split_part(c->>'period','~',2)))
on conflict(camp_id) do nothing;

create or replace function easycall_private_v2.require_super()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare m jsonb:=public.easycall_identity();
begin if m->>'easycall_role'<>'super' then raise exception '최고관리자 권한이 필요합니다.' using errcode='42501'; end if; return m; end $$;

create or replace function easycall_private_v2.camp_json(p_camp_id text)
returns jsonb language sql stable security definer set search_path='' as $$
select c from public.easycall_sync_store s,lateral jsonb_array_elements(coalesce(s.payload->'campsList','[]')) c
where s.store_key='MASTER_META' and c->>'campId'=p_camp_id limit 1
$$;
create or replace function easycall_private_v2.operating_status(p_camp_id text)
returns text language plpgsql stable security definer set search_path='' as $$
declare c jsonb:=easycall_private_v2.camp_json(p_camp_id); k public.easycall_camp_contracts; d date:=(now() at time zone 'Asia/Seoul')::date;
begin
  if c is null then return 'unconfigured'; end if;
  if not coalesce((c->>'approved')::boolean,false) then return 'stopped'; end if;
  select * into k from public.easycall_camp_contracts where camp_id=p_camp_id;
  if not found or k.starts_on is null or k.ends_on is null then return 'unconfigured'; end if;
  if d<k.starts_on then return 'future'; end if;
  if d>k.ends_on then return 'expired'; end if;
  return 'ready';
end $$;

create or replace function public.easycall_require_camp(p_camp_id text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare m jsonb:=public.easycall_identity();
begin
  if p_camp_id is null or p_camp_id!~'^[a-z0-9_-]{1,64}$' then raise exception '잘못된 캠프 ID'; end if;
  if m->>'easycall_role'='super' then return m; end if;
  if m->>'camp_id'<>p_camp_id then raise exception '다른 캠프 접근은 허용하지 않습니다.' using errcode='42501'; end if;
  if easycall_private_v2.operating_status(p_camp_id)<>'ready' then raise exception '캠프가 중지되었거나 계약기간이 유효하지 않습니다.' using errcode='42501'; end if;
  return m;
end $$;

create or replace function easycall_private_v2.request_replay(p_id uuid,p_action text,p_camp text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare e public.easycall_admin_events;
begin
  if p_id is null then raise exception '요청 식별자가 필요합니다.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('easycall-request:'||p_id::text,0));
  select * into e from public.easycall_admin_events where request_id=p_id;
  if not found then return null; end if;
  if e.actor_id is distinct from auth.uid() or e.action<>p_action or e.camp_id is distinct from p_camp
    or e.request_hash is distinct from md5(coalesce(p_payload,'{}')::text) then raise exception '요청 식별자가 다른 작업에 사용되었습니다.'; end if;
  return coalesce(e.result,'{}');
end $$;
create or replace function easycall_private_v2.audit(p_action text,p_camp text,p_before jsonb,p_after jsonb,p_id uuid default gen_random_uuid(),p_payload jsonb default '{}',p_result jsonb default '{}')
returns void language plpgsql security definer set search_path='' as $$
begin
  insert into public.easycall_admin_events(request_id,actor_id,actor_email,action,camp_id,before_data,after_data,request_hash,result)
  values(p_id,auth.uid(),(select email from auth.users where id=auth.uid()),p_action,p_camp,p_before,p_after,md5(coalesce(p_payload,'{}')::text),p_result);
end $$;

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
  accounts as (select distinct on(raw_app_meta_data->>'camp_id') raw_app_meta_data->>'camp_id' as camp_id,email,email_confirmed_at is not null as confirmed from auth.users where raw_app_meta_data->>'easycall_role'='admin' order by raw_app_meta_data->>'camp_id',created_at)
  select coalesce(jsonb_agg(c.c||jsonb_build_object('startsOn',k.starts_on,'endsOn',k.ends_on,'unitPrice',coalesce(k.unit_price,700000),
    'contractAmount',coalesce(k.contract_amount,0),'paidAmount',coalesce(p.amount,0),'outstandingAmount',greatest(0,coalesce(k.contract_amount,0)-coalesce(p.amount,0)),
    'revision',k.revision,'effectiveStatus',easycall_private_v2.operating_status(c.c->>'campId'),
    'billingStatus',case when k.contract_amount=0 then '시범운영(무료)' when coalesce(p.amount,0)>=k.contract_amount then '완납(가동중)' when coalesce(p.amount,0)>0 then '일부입금' else '미입금' end,
    'voterCount',coalesce(v.n,0),'callCount',coalesce(l.n,0),'registeredCount',coalesce(a.n,0),'onlineCount',coalesce(pr.n,0),
    'adminEmail',ac.email,'adminConfirmed',coalesce(ac.confirmed,false)) order by c.c->>'campId'),'[]') into result
  from camps c left join public.easycall_camp_contracts k on k.camp_id=c.c->>'campId'
  left join voters v on v.camp_id=c.c->>'campId' left join logs l on l.camp_id=c.c->>'campId'
  left join paid p on p.camp_id=c.c->>'campId' left join agents a on a.camp_id=c.c->>'campId'
  left join presence pr on pr.camp_id=c.c->>'campId' left join accounts ac on ac.camp_id=c.c->>'campId';
  return jsonb_build_object('camps',result,'serverTime',now());
end $$;

create or replace function public.easycall_admin_save_camp(p_camp jsonb,p_expected_revision timestamptz,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare cid text:=nullif(p_camp->>'campId',''); meta jsonb; old jsonb; next jsonb; stored public.easycall_camp_contracts;
  st date; en date; qty integer; price bigint; amount bigint; n integer; r jsonb; email text:=lower(trim(coalesce(p_camp->>'requestedAdminEmail','')));
begin
  perform easycall_private_v2.require_super();
  r:=easycall_private_v2.request_replay(p_request_id,'camp.save',cid,p_camp); if r is not null then return r; end if;
  select payload into meta from public.easycall_sync_store where store_key='MASTER_META' for update;
  if cid is null then
    select coalesce(max(substring(c->>'campId' from '^camp0*([0-9]+)$')::integer),0)+1 into n from jsonb_array_elements(meta->'campsList') c;
    cid:='camp'||lpad(n::text,greatest(2,length(n::text)),'0');
  end if;
  if cid!~'^[a-z0-9_-]{1,64}$' then raise exception '캠프 ID 형식이 올바르지 않습니다.'; end if;
  old:=easycall_private_v2.camp_json(cid);
  select * into stored from public.easycall_camp_contracts where camp_id=cid for update;
  if old is not null and stored.camp_id is not null and (p_expected_revision is null or stored.revision is distinct from p_expected_revision) then raise exception '다른 관리자가 변경했습니다. 다시 조회하세요.' using errcode='40001'; end if;
  if old is null and p_expected_revision is not null then raise exception '존재하지 않는 캠프입니다.'; end if;
  if jsonb_typeof(p_camp)<>'object' then raise exception '캠프 입력이 올바르지 않습니다.'; end if;
  foreach email in array array['name','candidate','city','party','staff','manager'] loop
    if length(trim(coalesce(p_camp->>email,''))) not between 1 and 200 then raise exception '필수 항목과 글자 수를 확인하세요: %',email; end if;
  end loop;
  email:=lower(trim(coalesce(p_camp->>'requestedAdminEmail','')));
  if email<>'' and (length(email)>254 or email!~'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') then raise exception '관리자 이메일 형식이 올바르지 않습니다.'; end if;
  if coalesce(p_camp->>'sido','') not in ('서울특별시','부산광역시','대구광역시','인천광역시','광주광역시','대전광역시','울산광역시','세종특별자치시','경기도','강원특별자치도','충청북도','충청남도','전북특별자치도','전라남도','경상북도','경상남도','제주특별자치도') then raise exception '시·도를 선택하세요.'; end if;
  if coalesce(p_camp->>'electionStage','') not in ('본선','당내 경선','예비후보') or coalesce(p_camp->>'electionType','') not in ('기초단체장(시장·군수)','광역단체장(도지사·시장)','광역의원(도의원)','기초의원(시의원)','교육감','국회의원','조합장(농·수·축협)') then raise exception '선거 구분을 확인하세요.'; end if;
  if coalesce(p_camp->>'tablets','')!~'^[0-9]+$' or coalesce(p_camp->>'unitPrice','')!~'^[0-9]+$' or coalesce(p_camp->>'contractAmount','')!~'^[0-9]+$' then raise exception '한도·금액은 0 이상의 정수로 입력하세요.'; end if;
  qty:=(p_camp->>'tablets')::integer;price:=(p_camp->>'unitPrice')::bigint;amount:=(p_camp->>'contractAmount')::bigint;
  if qty not between 1 and 2000 or price not between 0 and 1000000000000 or amount not between 0 and 1000000000000 then raise exception '한도 또는 금액 범위를 확인하세요.'; end if;
  select count(*) into n from jsonb_array_elements(coalesce(meta->'agentsList','[]')) a where a->>'campId'=cid;
  if qty<n then raise exception '현재 등록된 단말기보다 한도를 줄일 수 없습니다.'; end if;
  st:=easycall_private_v2.safe_date(p_camp->>'startsOn');en:=easycall_private_v2.safe_date(p_camp->>'endsOn');
  if st is null or en is null or st>en then raise exception '계약 시작일과 종료일을 확인하세요.'; end if;
  if coalesce(p_camp->>'phone','')<>'' and regexp_replace(p_camp->>'phone','[^0-9]','','g')!~'^0[0-9]{8,10}$' then raise exception '연락처 형식을 확인하세요.'; end if;
  if length(coalesce(p_camp->>'phone',''))>30 or length(coalesce(p_camp->>'district',''))>200 then raise exception '연락처 또는 선거구가 너무 깁니다.'; end if;
  next:=coalesce(old,'{}')||jsonb_build_object('campId',cid,'name',trim(p_camp->>'name'),'candidate',trim(p_camp->>'candidate'),
    'electionStage',p_camp->>'electionStage','electionType',p_camp->>'electionType','region',(p_camp->>'sido')||' '||trim(p_camp->>'city'),
    'district',coalesce(nullif(trim(p_camp->>'district'),''),trim(p_camp->>'city')||' 전역'),'party',trim(p_camp->>'party'),'staff',trim(p_camp->>'staff'),
    'manager',trim(p_camp->>'manager'),'phone',coalesce(p_camp->>'phone',''),'requestedAdminEmail',email,'tablets',qty,
    'period',st::text||' ~ '||en::text,'approved',coalesce((old->>'approved')::boolean,true));
  update public.easycall_sync_store set payload=jsonb_set(meta,'{campsList}',coalesce((select jsonb_agg(c) from jsonb_array_elements(meta->'campsList') c where c->>'campId'<>cid),'[]')||jsonb_build_array(next)),updated_at=clock_timestamp() where store_key='MASTER_META';
  insert into public.easycall_camp_contracts(camp_id,starts_on,ends_on,unit_price,contract_amount) values(cid,st,en,price,amount)
    on conflict(camp_id) do update set starts_on=excluded.starts_on,ends_on=excluded.ends_on,unit_price=excluded.unit_price,contract_amount=excluded.contract_amount,revision=clock_timestamp();
  insert into public.easycall_sync_store(store_key,payload) values('STATE_'||cid,jsonb_build_object('campId',cid,'config',jsonb_build_object('nightLock',true,'startTime','08:00','endTime','21:00','globalStopped',false))) on conflict(store_key) do nothing;
  r:=jsonb_build_object('campId',cid);
  perform easycall_private_v2.audit('camp.save',nullif(p_camp->>'campId',''),old,next,p_request_id,p_camp,r);
  return r;
end $$;

create or replace function public.easycall_admin_set_approval(p_camp_id text,p_approved boolean,p_reason text,p_expected_revision timestamptz,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare meta jsonb;c jsonb;k public.easycall_camp_contracts;r jsonb;request_body jsonb:=jsonb_build_object('approved',p_approved,'reason',p_reason,'revision',p_expected_revision);
begin
  perform easycall_private_v2.require_super();
  r:=easycall_private_v2.request_replay(p_request_id,'camp.approval',p_camp_id,request_body);if r is not null then return r;end if;
  if p_approved is null or length(trim(coalesce(p_reason,''))) not between 1 and 500 then raise exception '변경 사유를 입력하세요.';end if;
  select payload into meta from public.easycall_sync_store where store_key='MASTER_META' for update;
  c:=easycall_private_v2.camp_json(p_camp_id);if c is null then raise exception '존재하지 않는 캠프';end if;
  select * into k from public.easycall_camp_contracts where camp_id=p_camp_id for update;
  if k.revision is distinct from p_expected_revision then raise exception '변경 충돌' using errcode='40001';end if;
  update public.easycall_sync_store set payload=jsonb_set(meta,'{campsList}',(select jsonb_agg(case when e->>'campId'=p_camp_id then jsonb_set(e,'{approved}',to_jsonb(p_approved)) else e end) from jsonb_array_elements(meta->'campsList') e)),updated_at=clock_timestamp() where store_key='MASTER_META';
  update public.easycall_camp_contracts set revision=clock_timestamp() where camp_id=p_camp_id;
  r:=jsonb_build_object('campId',p_camp_id,'approved',p_approved);
  perform easycall_private_v2.audit('camp.approval',p_camp_id,c,r||jsonb_build_object('reason',p_reason),p_request_id,request_body,r);return r;
end $$;

create or replace function public.easycall_admin_record_payment(p_camp_id text,p_amount bigint,p_paid_on date,p_memo text,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r jsonb;id uuid;payload jsonb:=jsonb_build_object('amount',p_amount,'paidOn',p_paid_on,'memo',p_memo);
begin
  perform easycall_private_v2.require_super();r:=easycall_private_v2.request_replay(p_request_id,'payment.add',p_camp_id,payload);if r is not null then return r;end if;
  if easycall_private_v2.camp_json(p_camp_id) is null then raise exception '존재하지 않는 캠프';end if;
  if p_amount is null or p_amount not between 1 and 1000000000000 or p_paid_on is null or p_paid_on>(now() at time zone 'Asia/Seoul')::date or length(coalesce(p_memo,''))>500 then raise exception '입금액·입금일·메모를 확인하세요.';end if;
  insert into public.easycall_payments(camp_id,amount,paid_on,memo,actor_id,request_id) values(p_camp_id,p_amount,p_paid_on,coalesce(p_memo,''),auth.uid(),p_request_id) returning easycall_payments.id into id;
  r:=jsonb_build_object('id',id);perform easycall_private_v2.audit('payment.add',p_camp_id,null,payload,p_request_id,payload,r);return r;
end $$;
create or replace function public.easycall_admin_void_payment(p_payment_id uuid,p_reason text,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.easycall_payments;r jsonb;payload jsonb:=jsonb_build_object('paymentId',p_payment_id,'reason',p_reason);
begin
  perform easycall_private_v2.require_super();select * into p from public.easycall_payments where id=p_payment_id for update;
  if not found then raise exception '입금 기록을 찾을 수 없습니다.';end if;
  r:=easycall_private_v2.request_replay(p_request_id,'payment.void',p.camp_id,payload);if r is not null then return r;end if;
  if p.voided_at is not null then raise exception '이미 취소된 기록입니다.';end if;
  if length(trim(coalesce(p_reason,''))) not between 1 and 500 then raise exception '취소 사유를 입력하세요.';end if;
  update public.easycall_payments set voided_at=now(),void_reason=p_reason where id=p_payment_id;
  r:=jsonb_build_object('id',p_payment_id,'voided',true);perform easycall_private_v2.audit('payment.void',p.camp_id,to_jsonb(p),r||jsonb_build_object('reason',p_reason),p_request_id,payload,r);return r;
end $$;
create or replace function public.easycall_admin_camp_payments(p_camp_id text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin perform easycall_private_v2.require_super();return coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'amount',p.amount,'paidOn',p.paid_on,'memo',p.memo,'voidedAt',p.voided_at) order by p.paid_on desc,p.created_at desc) from public.easycall_payments p where camp_id=p_camp_id),'[]');end $$;

create or replace function public.easycall_admin_link_account(p_camp_id text,p_email text,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u auth.users;r jsonb;payload jsonb:=jsonb_build_object('email',lower(trim(p_email)));before jsonb;
begin
  perform easycall_private_v2.require_super();r:=easycall_private_v2.request_replay(p_request_id,'account.link',p_camp_id,payload);if r is not null then return r;end if;
  perform pg_advisory_xact_lock(hashtextextended('easycall-account:'||p_camp_id,0));
  if easycall_private_v2.camp_json(p_camp_id) is null then raise exception '존재하지 않는 캠프';end if;
  select * into u from auth.users where lower(email)=lower(trim(p_email)) for update;
  if not found then raise exception '등록된 인증 계정이 없습니다. 새 계정 초대를 사용하세요.';end if;
  if u.raw_app_meta_data->>'easycall_role'='super' then raise exception '최고관리자 계정은 캠프 계정으로 전환하지 않습니다.';end if;
  if u.raw_app_meta_data->>'easycall_role' is not null and (u.raw_app_meta_data->>'easycall_role'<>'admin' or u.raw_app_meta_data->>'camp_id' is distinct from p_camp_id) then raise exception '다른 역할·캠프에 연결된 계정입니다.';end if;
  if exists(select 1 from auth.users where id<>u.id and raw_app_meta_data->>'easycall_role'='admin' and raw_app_meta_data->>'camp_id'=p_camp_id) then raise exception '이미 관리자 계정이 연결되어 있습니다. 기존 연결을 먼저 점검하세요.';end if;
  before:=jsonb_build_object('userId',u.id,'email',u.email,'role',u.raw_app_meta_data->>'easycall_role');
  update auth.users set raw_app_meta_data=coalesce(raw_app_meta_data,'{}')||jsonb_build_object('easycall_role','admin','camp_id',p_camp_id) where id=u.id;
  r:=jsonb_build_object('campId',p_camp_id,'email',u.email);perform easycall_private_v2.audit('account.link',p_camp_id,before,r,p_request_id,payload,r);return r;
end $$;
create or replace function public.easycall_admin_note_reset(p_camp_id text)
returns void language plpgsql security definer set search_path='' as $$
begin perform easycall_private_v2.require_super();perform easycall_private_v2.audit('account.reset_requested',p_camp_id,null,jsonb_build_object('method','email'));end $$;
create or replace function public.easycall_admin_audit(p_camp_id text default null,p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  perform easycall_private_v2.require_super();
  return coalesce((select jsonb_agg(jsonb_build_object('createdAt',e.created_at,'actorId',e.actor_id,'actorEmail',e.actor_email,'action',e.action,'campId',e.camp_id,'before',e.before_data,'after',e.after_data) order by e.created_at desc,e.id desc)
    from (select * from public.easycall_admin_events where p_camp_id is null or camp_id=p_camp_id order by created_at desc,id desc offset greatest(0,p_offset) limit 50) e),'[]');
end $$;

-- The legacy settings RPC may update only its camp's agents and configuration.
-- Camp contracts, approval and pricing are never accepted from a snapshot.
create or replace function public.easycall_save_state(p_camp_id text,p_meta jsonb,p_config jsonb,p_meta_revision timestamptz,p_state_revision timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare m jsonb:=public.easycall_require_camp(p_camp_id);oldmeta public.easycall_sync_store;oldstate public.easycall_sync_store;
  a jsonb;agents jsonb;oldagents jsonb;quota integer;rev timestamptz:=clock_timestamp();cfg jsonb;
begin
  if m->>'easycall_role' not in ('super','admin') then raise exception '관리자 권한이 필요합니다.' using errcode='42501';end if;
  if jsonb_typeof(p_meta->'agentsList') is distinct from 'array' or jsonb_typeof(p_config) is distinct from 'object' then raise exception '설정 형식 오류';end if;
  select * into oldmeta from public.easycall_sync_store where store_key='MASTER_META' for update;
  select * into oldstate from public.easycall_sync_store where store_key='STATE_'||p_camp_id for update;
  if oldmeta.updated_at is distinct from p_meta_revision or oldstate.updated_at is distinct from p_state_revision then raise exception '설정 변경 충돌' using errcode='40001';end if;
  quota:=(easycall_private_v2.camp_json(p_camp_id)->>'tablets')::integer;
  select coalesce(jsonb_agg(e),'[]') into agents from jsonb_array_elements(p_meta->'agentsList') e where e->>'campId'=p_camp_id;
  if jsonb_array_length(agents)>quota then raise exception '서버 라이선스 한도를 초과했습니다.';end if;
  for a in select * from jsonb_array_elements(agents) loop
    if coalesce(a->>'agentId','')!~'^[a-z0-9_-]{1,64}$' or a->>'agentId'='super' or a->>'agentId' like '%master%' or a->>'agentId' like '%camp%' then raise exception '단말기 ID 형식 오류';end if;
    if length(coalesce(a->>'alias',''))>200 or length(coalesce(a->>'assignedPhone',''))>30 then raise exception '단말기 정보가 너무 깁니다.';end if;
    if exists(select 1 from jsonb_array_elements(coalesce(oldmeta.payload->'agentsList','[]')) e where e->>'campId'<>p_camp_id and e->>'agentId'=a->>'agentId') then raise exception '이미 사용 중인 단말기 ID';end if;
  end loop;
  if exists(select 1 from jsonb_array_elements(agents) e group by e->>'agentId' having count(*)>1) then raise exception '중복 단말기 ID';end if;
  if coalesce(p_config->>'startTime','08:00')!~'^([01][0-9]|2[0-3]):[0-5][0-9]$' or coalesce(p_config->>'endTime','21:00')!~'^([01][0-9]|2[0-3]):[0-5][0-9]$' then raise exception '발신 시간 형식 오류';end if;
  if length(p_config::text)>1000000 then raise exception '설정 용량 초과';end if;
  cfg:=jsonb_set(p_config,'{dncPhones}',coalesce((select jsonb_agg(distinct e) from jsonb_array_elements(coalesce(oldstate.payload->'config'->'dncPhones','[]')||coalesce(p_config->'dncPhones','[]')) e),'[]'));
  oldagents:=coalesce(oldmeta.payload->'agentsList','[]');
  update public.easycall_sync_store set payload=jsonb_set(oldmeta.payload,'{agentsList}',coalesce((select jsonb_agg(e) from jsonb_array_elements(oldagents) e where e->>'campId'<>p_camp_id),'[]')||agents),updated_at=rev where store_key='MASTER_META';
  update public.easycall_sync_store set payload=jsonb_build_object('campId',p_camp_id,'config',cfg),updated_at=rev where store_key='STATE_'||p_camp_id;
  perform easycall_private_v2.audit('camp.settings',p_camp_id,jsonb_build_object('config',oldstate.payload->'config','agents',oldagents),jsonb_build_object('config',cfg,'agents',agents));
  return jsonb_build_object('meta_revision',rev,'state_revision',rev);
end $$;

create or replace function public.easycall_heartbeat(p_state text default 'online')
returns void language plpgsql security definer set search_path='' as $$
declare m jsonb:=public.easycall_identity();cid text:=m->>'camp_id';aid text:=m->>'agent_id';
begin
  perform public.easycall_require_camp(cid);
  if m->>'easycall_role'<>'agent' or p_state not in ('online','break','offline') then raise exception '잘못된 접속 상태';end if;
  if not exists(select 1 from public.easycall_sync_store s,lateral jsonb_array_elements(s.payload->'agentsList') a where s.store_key='MASTER_META' and a->>'campId'=cid and a->>'agentId'=aid) then raise exception '회수된 단말기';end if;
  insert into public.easycall_agent_presence(camp_id,agent_id,actor_id,state) values(cid,aid,auth.uid(),p_state)
    on conflict(camp_id,agent_id) do update set actor_id=excluded.actor_id,state=excluded.state,last_seen=now();
end $$;
create or replace function public.easycall_agent_signal(p_status text,p_sos boolean)
returns void language plpgsql security definer set search_path='' as $$
declare m jsonb:=public.easycall_identity();cid text:=m->>'camp_id';aid text:=m->>'agent_id';cfg jsonb;v public.easycall_voters;
begin
  if p_status not in ('근무 중 🟢','휴식 중 ☕') then raise exception '상태 오류';end if;
  perform public.easycall_heartbeat(case when p_status='휴식 중 ☕' then 'break' else 'online' end);
  if p_sos then
    select payload->'config' into cfg from public.easycall_sync_store where store_key='STATE_'||cid for update;
    select * into v from public.easycall_voters where camp_id=cid and locked_by=aid and lock_expires_at>now() limit 1;
    cfg:=jsonb_set(coalesce(cfg,'{}'),'{sosAlert}',jsonb_build_object('agentId',aid,'voterName',coalesce(v.name,'미상'),'voterPhone',coalesce(v.phone,'-'),'time',to_char(now() at time zone 'Asia/Seoul','HH24:MI:SS')));
    update public.easycall_sync_store set payload=jsonb_set(payload,'{config}',cfg),updated_at=clock_timestamp() where store_key='STATE_'||cid;
  end if;
end $$;

create or replace function public.easycall_read_state()
returns table(store_key text,payload jsonb,updated_at timestamptz)
language plpgsql stable security definer set search_path='' as $$
declare m jsonb:=public.easycall_identity();cid text:=m->>'camp_id';
begin
  if m->>'easycall_role'<>'super' then perform public.easycall_require_camp(cid);end if;
  return query select s.store_key,
    case when s.store_key='MASTER_META' then jsonb_build_object(
      'campsList',coalesce((select jsonb_agg(c) from jsonb_array_elements(coalesce(s.payload->'campsList','[]')) c where m->>'easycall_role'='super' or c->>'campId'=cid),'[]'),
      'agentsList',coalesce((select jsonb_agg(a||jsonb_build_object('lastSeen',pr.last_seen,'status',case when pr.last_seen>now()-interval '90 seconds' and pr.state<>'offline' then case when pr.state='break' then '휴식 중 ☕' else '근무 중 🟢' end else '접속 끊김' end))
        from jsonb_array_elements(coalesce(s.payload->'agentsList','[]')) a left join public.easycall_agent_presence pr on pr.camp_id=a->>'campId' and pr.agent_id=a->>'agentId'
        where m->>'easycall_role'='super' or a->>'campId'=cid and (m->>'easycall_role'='admin' or a->>'agentId'=m->>'agent_id')),'[]'))
    else jsonb_build_object('campId',substring(s.store_key from 7),'config',coalesce(s.payload->'config','{}')) end,s.updated_at
    from public.easycall_sync_store s where s.store_key='MASTER_META' or (s.store_key like 'STATE_%' and (m->>'easycall_role'='super' or s.store_key='STATE_'||cid));
end $$;
create or replace function public.easycall_connection_status()
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin perform public.easycall_identity();return jsonb_build_object('version',2,'serverTime',now());end $$;

-- Backups stay in a private schema. Auth passwords and tokens are never included.
create or replace function easycall_private_v2.snapshot(p_kind text)
returns uuid language plpgsql security definer set search_path='' as $$
declare backup_key uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('easycall-backup',0));
  insert into public.easycall_backup_catalog(kind,created_by,voter_count,log_count)
    values(p_kind,auth.uid(),(select count(*) from public.easycall_voters),(select count(*) from public.easycall_call_logs)) returning easycall_backup_catalog.id into backup_key;
  insert into easycall_private_v2.backup_rows select backup_key,'sync',to_jsonb(t) from public.easycall_sync_store t;
  insert into easycall_private_v2.backup_rows select backup_key,'voters',to_jsonb(t) from public.easycall_voters t;
  insert into easycall_private_v2.backup_rows select backup_key,'logs',to_jsonb(t) from public.easycall_call_logs t;
  insert into easycall_private_v2.backup_rows select backup_key,'contracts',to_jsonb(t) from public.easycall_camp_contracts t;
  insert into easycall_private_v2.backup_rows select backup_key,'payments',to_jsonb(t) from public.easycall_payments t;
  return backup_key;
end $$;
create or replace function public.easycall_admin_create_backup()
returns jsonb language plpgsql security definer set search_path='' as $$
declare id uuid;
begin perform easycall_private_v2.require_super();id:=easycall_private_v2.snapshot('manual');perform easycall_private_v2.audit('backup.create',null,null,jsonb_build_object('backupId',id));return jsonb_build_object('id',id);end $$;

create or replace function easycall_private_v2.restore_core(p_backup uuid,p_camp text)
returns void language plpgsql security definer set search_path='' as $$
declare meta jsonb;oldcamp jsonb;cfg jsonb;k jsonb;r jsonb;restored_agents jsonb;
begin
  if not exists(select 1 from public.easycall_backup_catalog where id=p_backup) then raise exception '백업을 찾을 수 없습니다.';end if;
  select payload into meta from public.easycall_sync_store where store_key='MASTER_META' for update;
  select c into oldcamp from easycall_private_v2.backup_rows b,lateral jsonb_array_elements(b.row_data->'payload'->'campsList') c
    where b.backup_id=p_backup and b.collection='sync' and b.row_data->>'store_key'='MASTER_META' and c->>'campId'=p_camp;
  if oldcamp is null then raise exception '백업에 이 캠프가 없습니다.';end if;
  perform pg_advisory_xact_lock(hashtextextended('easycall:'||p_camp,0));
  if exists(select 1 from public.easycall_voters where camp_id=p_camp and locked_by is not null and lock_expires_at>now()) then raise exception '처리 중인 배정이 있어 복원할 수 없습니다.';end if;
  select coalesce(jsonb_agg(a),'[]') into restored_agents
    from easycall_private_v2.backup_rows b,lateral jsonb_array_elements(coalesce(b.row_data->'payload'->'agentsList','[]')) a
    where b.backup_id=p_backup and b.collection='sync' and b.row_data->>'store_key'='MASTER_META' and a->>'campId'=p_camp;
  if exists(select 1 from jsonb_array_elements(restored_agents) a,jsonb_array_elements(meta->'agentsList') b
    where b->>'campId'<>p_camp and a->>'agentId'=b->>'agentId') then raise exception '다른 캠프에서 사용 중인 단말기 ID가 있어 복원할 수 없습니다.';end if;
  meta:=jsonb_set(meta,'{agentsList}',coalesce((select jsonb_agg(a) from jsonb_array_elements(meta->'agentsList') a where a->>'campId'<>p_camp),'[]')||restored_agents);
  delete from public.easycall_agent_presence where camp_id=p_camp;
  update public.easycall_sync_store set payload=jsonb_set(meta,'{campsList}',coalesce((select jsonb_agg(c) from jsonb_array_elements(meta->'campsList') c where c->>'campId'<>p_camp),'[]')||jsonb_build_array(oldcamp)),updated_at=clock_timestamp() where store_key='MASTER_META';
  select row_data->'payload' into cfg from easycall_private_v2.backup_rows where backup_id=p_backup and collection='sync' and row_data->>'store_key'='STATE_'||p_camp;
  update public.easycall_sync_store set payload=coalesce(cfg,jsonb_build_object('campId',p_camp,'config','{}'::jsonb)),updated_at=clock_timestamp() where store_key='STATE_'||p_camp;
  select row_data into k from easycall_private_v2.backup_rows where backup_id=p_backup and collection='contracts' and row_data->>'camp_id'=p_camp;
  if k is null then raise exception '계약 정보가 없는 백업입니다.';end if;
  update public.easycall_camp_contracts set starts_on=(k->>'starts_on')::date,ends_on=(k->>'ends_on')::date,unit_price=(k->>'unit_price')::bigint,contract_amount=(k->>'contract_amount')::bigint,revision=clock_timestamp() where camp_id=p_camp;
  delete from public.easycall_voters where camp_id=p_camp;
  insert into public.easycall_voters(camp_id,voter_id,name,phone,dong,last_result,last_memo,locked_by,lock_expires_at)
    select p_camp,row_data->>'voter_id',row_data->>'name',row_data->>'phone',row_data->>'dong',row_data->>'last_result',row_data->>'last_memo',null,null
    from easycall_private_v2.backup_rows where backup_id=p_backup and collection='voters' and row_data->>'camp_id'=p_camp;
  delete from public.easycall_call_logs where camp_id=p_camp;
  insert into public.easycall_call_logs(call_id,camp_id,agent_id,used_phone,voter_id,voter_name,voter_phone,dong,gender,age,call_result,status,duration,duration_seconds,memo,call_time,created_at)
    select (row_data->>'call_id')::uuid,p_camp,row_data->>'agent_id',row_data->>'used_phone',row_data->>'voter_id',row_data->>'voter_name',row_data->>'voter_phone',row_data->>'dong',row_data->>'gender',row_data->>'age',row_data->>'call_result',row_data->>'status',row_data->>'duration',coalesce((row_data->>'duration_seconds')::integer,0),row_data->>'memo',row_data->>'call_time',(row_data->>'created_at')::timestamptz
    from easycall_private_v2.backup_rows where backup_id=p_backup and collection='logs' and row_data->>'camp_id'=p_camp;
  -- Receipt records are voided rather than erased; then backup records are restored.
  update public.easycall_payments set voided_at=coalesce(voided_at,now()),void_reason=coalesce(void_reason,'백업 복원에 따른 취소') where camp_id=p_camp;
  for r in select row_data from easycall_private_v2.backup_rows where backup_id=p_backup and collection='payments' and row_data->>'camp_id'=p_camp loop
    insert into public.easycall_payments(id,camp_id,amount,paid_on,memo,created_at,actor_id,voided_at,void_reason,request_id)
      values((r->>'id')::uuid,p_camp,(r->>'amount')::bigint,(r->>'paid_on')::date,r->>'memo',(r->>'created_at')::timestamptz,(r->>'actor_id')::uuid,(r->>'voided_at')::timestamptz,r->>'void_reason',(r->>'request_id')::uuid)
      on conflict(id) do update set voided_at=excluded.voided_at,void_reason=excluded.void_reason;
  end loop;
end $$;
create or replace function public.easycall_admin_restore_backup(p_backup_id uuid,p_camp_id text,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare rescue uuid;
begin perform easycall_private_v2.require_super();if length(trim(coalesce(p_reason,''))) not between 1 and 500 then raise exception '복원 사유를 입력하세요.';end if;
  rescue:=easycall_private_v2.snapshot('before_restore');perform easycall_private_v2.restore_core(p_backup_id,p_camp_id);
  perform easycall_private_v2.audit('backup.restore',p_camp_id,jsonb_build_object('rescueBackup',rescue),jsonb_build_object('restoredFrom',p_backup_id,'reason',p_reason));return jsonb_build_object('rescueBackup',rescue);
end $$;
create or replace function public.easycall_admin_restore_check(p_backup_id uuid,p_camp_id text)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  perform easycall_private_v2.require_super();
  begin
    perform easycall_private_v2.restore_core(p_backup_id,p_camp_id);
    raise exception 'rollback_restore_probe' using errcode='ZC001';
  exception when sqlstate 'ZC001' then null;
  end;
  update public.easycall_backup_catalog set tested_at=now() where id=p_backup_id;
  perform easycall_private_v2.audit('backup.test',p_camp_id,null,jsonb_build_object('backupId',p_backup_id,'result','passed_and_rolled_back'));
  return jsonb_build_object('passed',true);
end $$;

-- Cron is an official Supabase PostgreSQL extension; no API credentials are stored.
create extension if not exists pg_cron;
create or replace function public.easycall_admin_backup_schedule(p_enabled boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare job record;
begin
  perform easycall_private_v2.require_super();
  for job in select jobid from cron.job where jobname='easycall-daily-backup-v2' loop perform cron.unschedule(job.jobid);end loop;
  if p_enabled then perform cron.schedule('easycall-daily-backup-v2','0 18 * * *',$job$select easycall_private_v2.snapshot('scheduled');$job$);end if;
  perform easycall_private_v2.audit('backup.schedule',null,null,jsonb_build_object('enabled',p_enabled,'timeZone','Asia/Seoul','hour',3));
  return jsonb_build_object('enabled',p_enabled);
end $$;
create or replace function public.easycall_admin_backup_list()
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin perform easycall_private_v2.require_super();return jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_build_object('id',b.id,'kind',b.kind,'createdAt',b.created_at,'voterCount',b.voter_count,'logCount',b.log_count,'testedAt',b.tested_at) order by b.created_at desc) from (select * from public.easycall_backup_catalog order by created_at desc limit 30) b),'[]'),
  'scheduled',exists(select 1 from cron.job where jobname='easycall-daily-backup-v2' and active),'scheduleAvailable',true,'lastBackupAt',(select max(created_at) from public.easycall_backup_catalog));end $$;

-- New tables have no direct client writes. Public RPCs perform authorization first.
do $$ declare t text;f record;begin
  foreach t in array array['easycall_camp_contracts','easycall_payments','easycall_admin_events','easycall_agent_presence','easycall_backup_catalog'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated',t);
  end loop;
  for f in select p.oid::regprocedure as signature from pg_proc p where p.pronamespace='easycall_private_v2'::regnamespace loop execute format('revoke all on function %s from public,anon,authenticated',f.signature);end loop;
  for f in select p.oid::regprocedure as signature from pg_proc p where p.pronamespace='public'::regnamespace and (p.proname like 'easycall_admin_%' or p.proname in ('easycall_heartbeat','easycall_connection_status')) loop
    execute format('revoke all on function %s from public,anon,authenticated',f.signature);
    execute format('grant execute on function %s to authenticated',f.signature);
  end loop;
end $$;
-- Existing same-signature RPC ACLs are preserved by CREATE OR REPLACE.
notify pgrst,'reload schema';
commit;

