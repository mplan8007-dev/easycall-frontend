-- Bounded, authorized keyset reads; does not load the full campaign into a response.
begin;
-- The cursor tie-breaker must exist even on legacy rows explicitly saved as NULL.
update public.easycall_call_logs set call_id=gen_random_uuid() where call_id is null;
alter table public.easycall_call_logs alter column call_id set not null;
create index if not exists easycall_export_cursor_idx on public.easycall_call_logs
 (camp_id, (coalesce(created_at,'-infinity'::timestamptz)), call_id);
create index if not exists easycall_export_positive_idx on public.easycall_call_logs
 (camp_id, (coalesce(created_at,'-infinity'::timestamptz)), call_id)
 where call_result='CONNECTED' and status in ('SUPPORT','FAVORABLE','VOLUNTEER');

create or replace function public.easycall_export_logs_page(
 p_camp_id text, p_positive boolean default false, p_from date default null,
 p_through date default null, p_cursor jsonb default null, p_as_of timestamptz default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare m jsonb:=public.easycall_require_camp(p_camp_id); rows jsonb; items jsonb;
 cutoff timestamptz:=coalesce(p_as_of,statement_timestamp()); last_row jsonb;
 cursor_time timestamptz; cursor_id uuid; query text;
begin
 if m->>'easycall_role' not in ('admin','super') then
  raise exception '관리자 권한이 필요합니다.' using errcode='42501';
 end if;
 if p_from>p_through or cutoff>statement_timestamp() then raise exception '내려받기 기간을 확인하세요.';end if;
 if p_cursor is not null then
  cursor_time:=(p_cursor->>'time')::timestamptz;cursor_id:=(p_cursor->>'callId')::uuid;
  if cursor_time is null or cursor_id is null or p_as_of is null then raise exception '내려받기 위치가 올바르지 않습니다.';end if;
 end if;
 -- Omit unused predicates rather than using nullable ORs: later pages must seek
 -- the index instead of scanning all earlier pages under a generic query plan.
 query:=$query$select coalesce(jsonb_agg(to_jsonb(t) order by coalesce(t.created_at,'-infinity'::timestamptz),t.call_id),'[]')
 from (select call_id,created_at,camp_id,agent_id,used_phone,voter_id,voter_name,voter_phone,dong,
    gender,age,call_result,status,duration,duration_seconds,memo,callback_at
   from public.easycall_call_logs l
   where l.camp_id=$1 and coalesce(l.created_at,'-infinity'::timestamptz)<=$2 $query$;
 if coalesce(p_positive,false) then query:=query||$query$ and l.call_result='CONNECTED' and l.status in ('SUPPORT','FAVORABLE','VOLUNTEER') $query$;end if;
 if p_from is not null then query:=query||$query$ and coalesce(l.created_at,'-infinity'::timestamptz)>=($3::timestamp at time zone 'Asia/Seoul') $query$;end if;
 if p_through is not null then query:=query||$query$ and l.created_at is not null and coalesce(l.created_at,'-infinity'::timestamptz)<(($4+1)::timestamp at time zone 'Asia/Seoul') $query$;end if;
 if p_cursor is not null then query:=query||$query$ and (coalesce(l.created_at,'-infinity'::timestamptz),l.call_id)>($5,$6) $query$;end if;
 query:=query||$query$ order by coalesce(l.created_at,'-infinity'::timestamptz),l.call_id limit 1001) t $query$;
 execute query into rows using p_camp_id,cutoff,p_from,p_through,cursor_time,cursor_id;
 if jsonb_array_length(rows)>1000 then items:=rows-1000;else items:=rows;end if;
 last_row:=items->(jsonb_array_length(items)-1);
 return jsonb_build_object('items',items,'asOf',cutoff,'done',jsonb_array_length(rows)<=1000,
  'cursor',case when last_row is null then p_cursor else jsonb_build_object('time',coalesce(last_row->>'created_at','-infinity'),'callId',last_row->>'call_id') end);
end $$;
revoke all on function public.easycall_export_logs_page(text,boolean,date,date,jsonb,timestamptz) from public,anon;
grant execute on function public.easycall_export_logs_page(text,boolean,date,date,jsonb,timestamptz) to authenticated;
notify pgrst,'reload schema';
commit;
