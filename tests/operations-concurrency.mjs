// Concurrent HTTP requests against the disposable local PostgreSQL/PostgREST fixture.
// It authorizes synthetic records; it never launches a phone app or SIP call.
import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {validateTarget,signToken} from '../loadtest/run.mjs';
const origin=validateTarget(process.env.TEST_URL||'http://127.0.0.1:54330');
const env=Object.fromEntries(fs.readFileSync(new URL('../loadtest/.env',import.meta.url),'utf8').trim().split(/\r?\n/).map(line=>line.split('=')));
const token=index=>signToken(index,env.TEST_JWT_SECRET);
const manager={token:token('admin')},first={token:token(1),session:crypto.randomUUID()},duplicate={token:token(1),session:crypto.randomUUID()},second={token:token(2),session:crypto.randomUUID()};
async function request(client,name,args={}){
 for(let attempt=0;attempt<12;attempt++){
  const response=await fetch(origin+'/rpc/'+name,{method:'POST',headers:{Authorization:'Bearer '+client.token,'Content-Type':'application/json',...(client.session?{'x-easycall-session':client.session}:{})},body:JSON.stringify(args),signal:AbortSignal.timeout(10000)});
  const text=await response.text(),data=text?JSON.parse(text):null;
  if(data?.code==='PGRST202'&&attempt<11){await new Promise(resolve=>setTimeout(resolve,250));continue;}
  return {ok:response.ok,status:response.status,data};
 }
}
async function rpc(client,name,args){const r=await request(client,name,args);assert.equal(r.ok,true,JSON.stringify({name,...r}));return r.data;}
const marker=await rpc(manager,'easycall_loadtest_environment');
assert.equal(marker.environment,'isolated-local-loadtest');assert.ok(marker.devices>=2);
for(let i=0;i<12;i++){
 const rows=await rpc(manager,'easycall_read_state'),meta=rows.find(r=>r.store_key==='MASTER_META'),state=rows.find(r=>r.store_key==='STATE_load1');
 // Two independently submitted actions contend on the same revision.
 const results=await Promise.all([
  request(manager,'easycall_save_state',{p_camp_id:'load1',p_meta:meta.payload,p_config:{...state.payload.config,globalStopped:false,dailyGoal:250+i},p_meta_revision:meta.updated_at,p_state_revision:state.updated_at}),
  request(manager,'easycall_set_calling_state',{p_camp_id:'load1',p_stopped:true,p_expected_revision:state.updated_at})
 ]);
 assert.equal(results[1].ok,true);assert.ok(results[0].ok||results[0].data?.code==='PT409');
 const current=(await rpc(manager,'easycall_read_state')).find(r=>r.store_key==='STATE_load1');
 assert.equal(current.payload.config.globalStopped,true,'A concurrent settings save resumed calling');
 const stale=await request(manager,'easycall_set_calling_state',{p_camp_id:'load1',p_stopped:false,p_expected_revision:state.updated_at});
 assert.equal(stale.data?.code,'PT409');
 await rpc(manager,'easycall_set_calling_state',{p_camp_id:'load1',p_stopped:false,p_expected_revision:current.updated_at});
}
const opened=await Promise.all([request(first,'easycall_open_agent_session'),request(duplicate,'easycall_open_agent_session')]);
assert.equal(opened.filter(r=>r.ok&&r.data?.active).length,1,'Two documents acquired the same account');
const winner=opened[0].data?.active?first:duplicate,loser=winner===first?duplicate:first;
const row=(await rpc(manager,'easycall_list_page',{p_camp_id:'load1',p_kind:'voters',p_limit:1})).items[0];assert.ok(row);
const denied=await request(loser,'easycall_claim_selected_voter',{p_camp_id:'load1',p_voter_id:row.voter_id});assert.equal(denied.data?.code,'42501');
assert.equal((await rpc(second,'easycall_open_agent_session')).active,true);
for(let i=0;i<20;i++){
 const choices=await Promise.all([request(winner,'easycall_claim_selected_voter',{p_camp_id:'load1',p_voter_id:row.voter_id}),request(second,'easycall_claim_selected_voter',{p_camp_id:'load1',p_voter_id:row.voter_id})]);
 assert.equal(choices.filter(r=>r.ok&&r.data?.length===1).length,1,'Two agents acquired the same contact');
 const owner=choices[0].ok?winner:second;
 await rpc(owner,'easycall_release_unstarted_claim',{p_camp_id:'load1',p_voter_id:row.voter_id});
}
await rpc(winner,'easycall_close_agent_session');await rpc(second,'easycall_close_agent_session');
console.log('PASS: 12 concurrent stop/save races, two same-account documents and 20 same-contact assignment races. Isolated fixture only.');
