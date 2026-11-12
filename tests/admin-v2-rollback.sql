-- Append after v2 migration BEGIN/body in place of COMMIT. Never commits fixtures.
select set_config('request.jwt.claim.sub',(select id::text from auth.users where raw_app_meta_data->>'easycall_role'='super' order by created_at limit 1),true);
do $$
declare d jsonb; r jsonb; rev timestamptz; req uuid:=gen_random_uuid(); pay uuid; bak uuid;
  before_count bigint; old_meta jsonb; old_rev timestamptz; cfg jsonb; cfg_rev timestamptz;
begin
  d:=jsonb_build_object('campId','validation_v2','name','검증 캠프','candidate','검증 후보','sido','서울특별시','city','중구','district','중구','party','무소속','staff','검증 담당','manager','검증 관리자','phone','01012345678','electionStage','본선','electionType','국회의원','tablets',2,'unitPrice',700000,'contractAmount',1400000,'startsOn',current_date-1,'endsOn',current_date+30);
  r:=public.easycall_admin_save_camp(d,null,req);
  perform public.easycall_admin_save_camp(d,null,req);
  if (select count(*) from public.easycall_admin_events where request_id=req)<>1 then raise exception 'idempotency failed';end if;
  select revision into rev from public.easycall_camp_contracts where camp_id='validation_v2';
  begin perform public.easycall_admin_save_camp(d,null,gen_random_uuid());raise exception 'stale revision accepted';exception when serialization_failure then null;end;
  begin perform public.easycall_admin_save_camp(d||'{"tablets":-1}',rev,gen_random_uuid());raise exception 'negative accepted' using errcode='ZC002';exception when sqlstate 'P0001' then null;end;
  begin perform public.easycall_admin_save_camp(d||jsonb_build_object('endsOn',current_date-2),rev,gen_random_uuid());raise exception 'reverse dates accepted' using errcode='ZC002';exception when sqlstate 'P0001' then null;end;
  req:=gen_random_uuid();r:=public.easycall_admin_record_payment('validation_v2',700000,current_date,'검증',req);pay:=(r->>'id')::uuid;
  perform public.easycall_admin_record_payment('validation_v2',700000,current_date,'검증',req);
  if (select count(*) from public.easycall_payments where camp_id='validation_v2')<>1 then raise exception 'duplicate payment';end if;
  r:=public.easycall_admin_overview();
  if not exists(select 1 from jsonb_array_elements(r->'camps') c where c->>'campId'='validation_v2' and (c->>'paidAmount')::bigint=700000 and c->>'effectiveStatus'='ready') then raise exception 'overview failed';end if;
  perform public.easycall_admin_save_camp(d||'{"tablets":3}',rev,gen_random_uuid());
  if (select sum(amount) from public.easycall_payments where camp_id='validation_v2')<>700000 then raise exception 'quota changed payment';end if;
  perform public.easycall_admin_void_payment(pay,'검증 취소',gen_random_uuid());
  perform public.easycall_admin_camp_payments('validation_v2');
  perform public.easycall_admin_audit('validation_v2',0);
  select payload,updated_at into old_meta,old_rev from public.easycall_sync_store where store_key='MASTER_META';
  select payload->'config',updated_at into cfg,cfg_rev from public.easycall_sync_store where store_key='STATE_validation_v2';
  begin
    perform public.easycall_save_state('validation_v2',jsonb_build_object('agentsList',(select jsonb_agg(jsonb_build_object('campId','validation_v2','agentId','test'||i)) from generate_series(1,4) i)),cfg,old_rev,cfg_rev);
    raise exception 'license accepted' using errcode='ZC002';
  exception when sqlstate 'P0001' then null;end;
  perform public.easycall_save_state('validation_v2',old_meta,cfg,old_rev,cfg_rev);
  bak:=(public.easycall_admin_create_backup()->>'id')::uuid;
  select count(*) into before_count from public.easycall_voters;
  r:=public.easycall_admin_restore_check(bak,'validation_v2');
  if r->>'passed'<>'true' or (select count(*) from public.easycall_voters)<>before_count then raise exception 'restore probe changed data';end if;
  perform public.easycall_admin_restore_backup(bak,'validation_v2','검증 복원');
  perform public.easycall_admin_backup_list();
  perform public.easycall_read_state();
  begin perform public.easycall_admin_link_account('validation_v2',(select email from auth.users where id=auth.uid()),gen_random_uuid());raise exception 'super downgraded' using errcode='ZC002';exception when sqlstate 'P0001' then null;end;
  if has_table_privilege('authenticated','public.easycall_payments','INSERT') or has_schema_privilege('authenticated','easycall_private_v2','USAGE') then raise exception 'privilege leak';end if;
end $$;
select 'PASS: v2 validation, conflict, idempotency, ledger, quota, overview, audit, backup and restore' as result;
rollback;
