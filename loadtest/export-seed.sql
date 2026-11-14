-- Run only after the call capacity assertions: these are additional synthetic logs.
begin;
do $$ begin
 if current_database()<>'easycall_test' or not exists(select 1 from public.easycall_sync_store where store_key='STATE_load1') then
  raise exception 'Isolated load fixture required';
 end if;
end $$;
insert into public.easycall_call_logs(camp_id,agent_id,call_id,created_at,voter_name,voter_phone,call_result,status,duration_seconds,memo)
select 'load1','device1',md5('export-capacity-'||i)::uuid,
 '2020-01-01T00:00:00Z'::timestamptz+(i/1000)*interval '1 second',
 '합성 기록','00000000000','CONNECTED',case when i%2=0 then 'SUPPORT' else 'NO_RESPONSE' end,0,'Synthetic export fixture'
from generate_series(1,400000) i on conflict(call_id) do nothing;
analyze public.easycall_call_logs;
commit;
