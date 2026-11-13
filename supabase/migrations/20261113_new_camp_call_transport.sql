begin;
create or replace function public.easycall_admin_save_camp(p_camp jsonb,p_expected_revision timestamptz,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare cid text:=nullif(p_camp->>'campId',''); meta jsonb; old jsonb; next jsonb; stored public.easycall_camp_contracts;
  policy jsonb;mode text;wss text;domain text;stun text;
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
  if old is null and exists(select 1 from public.easycall_sync_store where store_key='STATE_'||cid) then raise exception 'Camp ID has existing operational state; use another ID or review the existing state';end if;
  if old is not null and p_camp ? 'callPolicy' then raise exception '기존 캠프의 통화 방식은 별도 통화 방식 설정에서 변경하세요.';end if;
  if old is null then
    if jsonb_typeof(coalesce(p_camp->'callPolicy','{}')) is distinct from 'object' or length(coalesce(p_camp->'callPolicy','{}')::text)>2000 then raise exception 'Invalid call policy';end if;
    if coalesce(p_camp->'callPolicy','{}')-array['callTransport','sipWss','sipDomain','sipStun']<>'{}'::jsonb then raise exception 'Unexpected call policy field';end if;
    policy:=easycall_private_v2.call_transport_fields(coalesce(p_camp->'callPolicy','{}'));
    mode:=policy->>'callTransport';wss:=policy->>'sipWss';domain:=policy->>'sipDomain';stun:=policy->>'sipStun';
    if mode not in ('smartphone','sip') then raise exception 'Invalid transport';end if;
    if mode='smartphone' then policy:=easycall_private_v2.call_transport_fields('{}');end if;
    if mode='sip' then
      if (wss='')<>(domain='') then raise exception 'SIP server and domain must both be supplied or both left pending';end if;
      if length(wss)>512 or (wss<>'' and wss!~'^wss://[A-Za-z0-9.-]+(:[0-9]{1,5})?(/[A-Za-z0-9/_~.%-]*)?$') then raise exception 'Invalid WSS URL';end if;
      if length(domain)>255 or (domain<>'' and domain!~'^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?(:[0-9]{1,5})?$') then raise exception 'Invalid SIP domain';end if;
      if length(stun)>255 or (stun<>'' and stun!~'^stuns?:[A-Za-z0-9.-]+(:[0-9]{1,5})?$') then raise exception 'Invalid STUN URL';end if;
    end if;
  end if;
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
  insert into public.easycall_sync_store(store_key,payload) values('STATE_'||cid,jsonb_build_object('campId',cid,'config',jsonb_build_object('nightLock',true,'startTime','08:00','endTime','21:00','globalStopped',false)||coalesce(policy,'{}'))) on conflict(store_key) do nothing;
  r:=jsonb_build_object('campId',cid);
  perform easycall_private_v2.audit('camp.save',nullif(p_camp->>'campId',''),old,next,p_request_id,p_camp,r);
  return r;
end $$;
notify pgrst,'reload schema';
commit;
