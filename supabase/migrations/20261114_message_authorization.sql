begin;

-- A message window is not a call: validate the assignment without changing
-- the call-start marker or extending a lease.
create or replace function public.easycall_authorize_message(p_camp_id text, p_voter_id text)
returns void language plpgsql security definer set search_path='' as $$
declare m jsonb:=public.easycall_require_camp(p_camp_id); cfg jsonb;
begin
 if m->>'easycall_role'<>'agent' then raise exception 'Agent required' using errcode='42501'; end if;
 perform public.easycall_check_calling(p_camp_id);
 perform pg_advisory_xact_lock(hashtextextended('easycall:'||p_camp_id,0));
 if not exists(select 1 from public.easycall_sync_store s, lateral jsonb_array_elements(s.payload->'agentsList') e
   where s.store_key='MASTER_META' and e->>'campId'=p_camp_id and e->>'agentId'=m->>'agent_id') then
  raise exception 'Agent disabled';
 end if;
 select payload->'config' into cfg from public.easycall_sync_store where store_key='STATE_'||p_camp_id;
 if not exists(select 1 from public.easycall_voters t where t.camp_id=p_camp_id and t.voter_id=p_voter_id
   and t.locked_by=m->>'agent_id' and t.lock_expires_at>now() and t.last_result<>'REJECT'
   and not coalesce(cfg->'dncPhones','[]') ? regexp_replace(t.phone,'[^0-9]','','g')
   and not exists(select 1 from easycall_private_v2.blocked_phone b where b.camp_id=p_camp_id
     and b.phone=regexp_replace(t.phone,'[^0-9]','','g'))) then
  raise exception 'Assignment expired or blocked';
 end if;
end $$;
revoke all on function public.easycall_authorize_message(text,text) from public,anon;
grant execute on function public.easycall_authorize_message(text,text) to authenticated;
notify pgrst,'reload schema';
commit;
