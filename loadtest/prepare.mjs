import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url));
const devices=Number(process.env.DEVICES||2000),camps=Number(process.env.CAMPS||20),contacts=Number(process.env.CONTACTS||200000);
if(!Number.isInteger(devices)||devices<1||devices>2500||!Number.isInteger(camps)||camps<1||camps>100||contacts<devices*2)throw Error('Invalid local fixture dimensions');
fs.mkdirSync(path.join(dir,'generated'),{recursive:true});
const envPath=path.join(dir,'.env');
if(!fs.existsSync(envPath))fs.writeFileSync(envPath,'TEST_DB_PASSWORD='+crypto.randomBytes(24).toString('hex')+'\nTEST_JWT_SECRET='+crypto.randomBytes(40).toString('hex')+'\n',{mode:0o600});
const migrations=['20261112_safe_operations.sql','20261112_admin_console_v2.sql','20261112_paging_mfa.sql','20261112_scale_runtime.sql'].map(name=>fs.readFileSync(path.join(dir,'../supabase/migrations',name),'utf8'));
const seed=`
insert into auth.users(id,email,raw_app_meta_data,email_confirmed_at) select md5('easycall-loadtest-'||i)::uuid,'device-'||i||'@example.invalid',jsonb_build_object('easycall_role','agent','camp_id','load'||((i-1)%${camps}+1),'agent_id','device'||i),now() from generate_series(1,${devices}) i;
insert into auth.users(id,email,raw_app_meta_data,email_confirmed_at) values(md5('easycall-loadtest-admin')::uuid,'admin@example.invalid','{"easycall_role":"super"}',now());
insert into public.easycall_sync_store(store_key,payload) values('MASTER_META',jsonb_build_object(
 'campsList',(select jsonb_agg(jsonb_build_object('campId','load'||i,'name','Load test '||i,'candidate','Fixture','region','Test','approved',true,'tablets',2000,'period',(current_date-1)::text||' ~ '||(current_date+30)::text)) from generate_series(1,${camps}) i),
 'agentsList',(select jsonb_agg(jsonb_build_object('campId','load'||((i-1)%${camps}+1),'agentId','device'||i,'alias','Fixture','assignedPhone','01000000000')) from generate_series(1,${devices}) i)))
 on conflict(store_key) do update set payload=excluded.payload,updated_at=clock_timestamp();
insert into public.easycall_camp_contracts(camp_id,starts_on,ends_on,unit_price,contract_amount) select 'load'||i,current_date-1,current_date+30,0,0 from generate_series(1,${camps}) i on conflict(camp_id) do update set starts_on=excluded.starts_on,ends_on=excluded.ends_on;
insert into public.easycall_sync_store(store_key,payload) select 'STATE_load'||i,jsonb_build_object('campId','load'||i,'config',jsonb_build_object('nightLock',false,'globalStopped',false)) from generate_series(1,${camps}) i on conflict(store_key) do nothing;
insert into public.easycall_voters(camp_id,voter_id,name,phone,dong) select 'load'||((i-1)%${camps}+1),lpad(i::text,10,'0'),'Fixture','010'||lpad(i::text,8,'0'),'Test' from generate_series(1,${contacts}) i;
create function public.easycall_loadtest_environment() returns jsonb language sql stable as $$select jsonb_build_object('environment','isolated-local-loadtest','devices',${devices},'camps',${camps})$$;
revoke all on function public.easycall_loadtest_environment() from public,anon;grant execute on function public.easycall_loadtest_environment() to authenticated;
notify pgrst,'reload schema';
`;
fs.writeFileSync(path.join(dir,'generated/init.sql'),migrations.join('\n')+seed);
fs.writeFileSync(path.join(dir,'generated/dimensions.json'),JSON.stringify({devices,camps,contacts}));
console.log(`Prepared an isolated local stack: ${devices} devices, ${camps} camps, ${contacts} fictional contacts. Credentials remain in ignored .env.`);
