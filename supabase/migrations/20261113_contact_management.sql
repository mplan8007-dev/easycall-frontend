begin;
-- Administrator-only contact paging supplies revision tokens for safe edits.
create or replace function public.easycall_admin_voter_page(p_camp_id text,p_offset integer default 0,p_limit integer default 50,p_query text default '',p_status text default '')
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare m jsonb:=public.easycall_require_camp(p_camp_id);q text:=lower(trim(coalesce(p_query,'')));s text:=coalesce(p_status,'');off integer:=greatest(0,coalesce(p_offset,0));lim integer:=coalesce(p_limit,50);items jsonb;total bigint;
begin
 if m->>'easycall_role' not in ('super','admin') then raise exception '관리자 권한이 필요합니다.' using errcode='42501';end if;
 if lim not between 1 and 50 or length(q)>200 or s not in ('','READY','CONNECTED','ABSENT','CALLBACK','REJECT','INVALID') then raise exception '목록 조회 조건 오류';end if;
 select count(*) into total from public.easycall_voters v where camp_id=p_camp_id and (s='' or last_result=s) and (q='' or strpos(lower(concat_ws(' ',v.name,v.phone,v.dong,v.voter_id)),q)>0);
 select coalesce(jsonb_agg(to_jsonb(t) order by t.uid),'[]') into items from (
  select uid,voter_id,camp_id,name,phone,dong,last_result,last_memo,coalesce(updated_at,'epoch'::timestamptz) updated_at,case when lock_expires_at>now() then locked_by else null end locked_by
  from public.easycall_voters v where camp_id=p_camp_id and (s='' or last_result=s) and (q='' or strpos(lower(concat_ws(' ',v.name,v.phone,v.dong,v.voter_id)),q)>0) order by uid offset off limit lim
 ) t;
 return jsonb_build_object('items',items,'total',total,'offset',off,'limit',lim);
end $$;
create or replace function public.easycall_admin_update_voter(p_camp_id text,p_voter_id text,p_expected_updated_at timestamptz,p_patch jsonb,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare m jsonb:=public.easycall_require_camp(p_camp_id);v public.easycall_voters;n text;ph text;d text;memo text;result jsonb;payload jsonb:=jsonb_build_object('id',p_voter_id,'revision',p_expected_updated_at,'patch',p_patch);cfg jsonb;
begin
 if m->>'easycall_role' not in ('super','admin') then raise exception '관리자 권한이 필요합니다.' using errcode='42501';end if;
 result:=easycall_private_v2.request_replay(p_request_id,'voter.update',p_camp_id,payload);if result is not null then return result;end if;
 if p_expected_updated_at is null or jsonb_typeof(p_patch) is distinct from 'object' then raise exception '수정 내용을 확인하세요.';end if;
 n:=trim(coalesce(p_patch->>'name',''));ph:=regexp_replace(coalesce(p_patch->>'phone',''),'[^0-9]','','g');d:=trim(coalesce(p_patch->>'dong',''));memo:=coalesce(p_patch->>'memo','');
 if length(n) not between 1 and 100 or ph !~ '^0[0-9]{8,10}$' or length(d)>200 or length(memo)>2000 then raise exception '이름·전화번호·지역·메모 형식을 확인하세요.';end if;
 perform pg_advisory_xact_lock(hashtextextended('easycall:'||p_camp_id,0));
 select * into v from public.easycall_voters where camp_id=p_camp_id and voter_id=p_voter_id for update;
 if not found then raise exception '삭제되었거나 다른 캠프의 연락처입니다. 목록을 새로고침하세요.';end if;
 if v.locked_by is not null and v.lock_expires_at>now() then raise exception '배정 중인 연락처는 수정할 수 없습니다.';end if;
 if coalesce(v.updated_at,'epoch'::timestamptz) is distinct from p_expected_updated_at then raise exception '다른 작업으로 변경된 연락처입니다. 목록을 새로고침하세요.';end if;
 if ph<>regexp_replace(v.phone,'[^0-9]','','g') then
  if exists(select 1 from public.easycall_voters where camp_id=p_camp_id and voter_id<>p_voter_id and regexp_replace(phone,'[^0-9]','','g')=ph) then raise exception '이미 등록된 전화번호입니다.';end if;
  select s.payload->'config' into cfg from public.easycall_sync_store s where s.store_key='STATE_'||p_camp_id;
  if coalesce(cfg->'dncPhones','[]') ? ph or exists(select 1 from easycall_private_v2.blocked_phone where camp_id=p_camp_id and phone=ph) then raise exception '수신거부 번호로 변경할 수 없습니다.';end if;
 end if;
 if v.last_result='REJECT' then insert into easycall_private_v2.blocked_phone(camp_id,phone) values(p_camp_id,regexp_replace(v.phone,'[^0-9]','','g')) on conflict do nothing;end if;
 update public.easycall_voters set name=n,phone=ph,dong=d,last_memo=memo,last_result=case when ph<>regexp_replace(v.phone,'[^0-9]','','g') then 'READY' else v.last_result end,updated_at=clock_timestamp() where camp_id=p_camp_id and voter_id=p_voter_id;
 delete from easycall_private_v2.runtime_cache where cache_key='overview' or left(cache_key,length('counts:'||p_camp_id||':'))='counts:'||p_camp_id||':';
 result:=jsonb_build_object('success',true,'updated',1);
 perform easycall_private_v2.audit('voter.update',p_camp_id,jsonb_build_object('voterId',v.voter_id),jsonb_build_object('voterId',v.voter_id),p_request_id,payload,result);
 return result;
end $$;
create or replace function public.easycall_admin_delete_voters(p_camp_id text,p_rows jsonb,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare m jsonb:=public.easycall_require_camp(p_camp_id);v public.easycall_voters;r jsonb;result jsonb;payload jsonb:=jsonb_build_object('rows',p_rows);n integer:=0;
begin
 if m->>'easycall_role' not in ('super','admin') then raise exception '관리자 권한이 필요합니다.' using errcode='42501';end if;
 result:=easycall_private_v2.request_replay(p_request_id,'voter.delete',p_camp_id,payload);if result is not null then return result;end if;
 if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 50 then raise exception '현재 페이지에서 1~50건을 선택하세요.';end if;
 if exists(select 1 from jsonb_array_elements(p_rows) x where coalesce(x->>'voter_id','')='' or x->>'updated_at' is null) or exists(select 1 from jsonb_array_elements(p_rows) x group by x->>'voter_id' having count(*)>1) then raise exception '선택 목록을 확인하세요.';end if;
 perform pg_advisory_xact_lock(hashtextextended('easycall:'||p_camp_id,0));
 for r in select x from jsonb_array_elements(p_rows) x order by x->>'voter_id' loop
  select * into v from public.easycall_voters where camp_id=p_camp_id and voter_id=r->>'voter_id' for update;
  if not found then raise exception '삭제되었거나 다른 캠프의 연락처가 포함되어 있습니다. 새로고침하세요.';end if;
  if v.locked_by is not null and v.lock_expires_at>now() then raise exception '배정 중인 연락처가 포함되어 있어 삭제하지 않았습니다.';end if;
  if coalesce(v.updated_at,'epoch'::timestamptz) is distinct from (r->>'updated_at')::timestamptz then raise exception '변경된 연락처가 포함되어 있어 삭제하지 않았습니다. 새로고침하세요.';end if;
  if v.last_result='REJECT' then insert into easycall_private_v2.blocked_phone(camp_id,phone) values(p_camp_id,regexp_replace(v.phone,'[^0-9]','','g')) on conflict do nothing;end if;
  delete from public.easycall_voters where camp_id=p_camp_id and voter_id=v.voter_id;n:=n+1;
 end loop;
 delete from easycall_private_v2.runtime_cache where cache_key='overview' or left(cache_key,length('counts:'||p_camp_id||':'))='counts:'||p_camp_id||':';
 result:=jsonb_build_object('success',true,'deleted',n);
 perform easycall_private_v2.audit('voter.delete',p_camp_id,jsonb_build_object('count',n),result,p_request_id,payload,result);
 return result;
end $$;
revoke all on function public.easycall_admin_voter_page(text,integer,integer,text,text),public.easycall_admin_update_voter(text,text,timestamptz,jsonb,uuid),public.easycall_admin_delete_voters(text,jsonb,uuid) from public,anon;
grant execute on function public.easycall_admin_voter_page(text,integer,integer,text,text),public.easycall_admin_update_voter(text,text,timestamptz,jsonb,uuid),public.easycall_admin_delete_voters(text,jsonb,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
