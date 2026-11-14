import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {fileURLToPath} from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url));
export function validateTarget(target){const u=new URL(target);if(u.protocol!=='http:'||!['localhost','127.0.0.1','[::1]'].includes(u.hostname)||u.username||u.password||u.search||u.hash)throw Error('Load tests are restricted to an isolated loopback server. Production is prohibited.');return u.origin;}
export function percentile(values,p){if(!values.length)return null;const a=[...values].sort((a,b)=>a-b);return a[Math.min(a.length-1,Math.ceil(a.length*p)-1)];}
export async function decodeResponse(response){if(response.status===204)return null;const body=await response.text();return body?JSON.parse(body):null;}
export function signToken(index,secret){const uuid=crypto.createHash('md5').update('easycall-loadtest-'+index).digest('hex').replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/,'$1-$2-$3-$4-$5');const encode=x=>Buffer.from(JSON.stringify(x)).toString('base64url');const msg=encode({alg:'HS256',typ:'JWT'})+'.'+encode({sub:uuid,role:'authenticated',aal:'aal1',aud:'authenticated',exp:Math.floor(Date.now()/1000)+21600});return msg+'.'+crypto.createHmac('sha256',secret).update(msg).digest('base64url');}
export function validateProfile({devices,duration,ramp,callInterval},availableDevices){if(!Number.isInteger(devices)||devices<1||devices>availableDevices||devices>2500||!Number.isInteger(duration)||duration<10||duration>18000||!Number.isInteger(ramp)||ramp<0||ramp>900||!Number.isFinite(callInterval)||callInterval<5||callInterval>3600)throw Error('Invalid load profile');}
export async function main(){
 const origin=validateTarget(process.env.TEST_URL||'http://127.0.0.1:54330');
 const env=Object.fromEntries(fs.readFileSync(path.join(dir,'.env'),'utf8').trim().split(/\r?\n/).map(l=>l.split('=')));
 const dimensions=JSON.parse(fs.readFileSync(path.join(dir,'generated/dimensions.json'),'utf8'));
 const devices=Number(process.env.DEVICES||dimensions.devices),duration=Number(process.env.DURATION_SECONDS||900),ramp=Number(process.env.RAMP_SECONDS||300),callInterval=Number(process.env.CALL_INTERVAL_SECONDS||60);
 validateProfile({devices,duration,ramp,callInterval},dimensions.devices);
 const metrics={requests:0,errors:0,duplicateAssignments:0,uncertainWrites:0,acknowledgedCalls:0,replayChecks:0,peakDevices:0,latencies:{},timeouts:0,failureReasons:{},minimumSustainedDevices:null,sustainedSamples:0};
 const assignment=new Map(),acked=new Set(),sessions=new Map();let active=0,halt=false;
 const sleep=ms=>new Promise(r=>setTimeout(r,ms));
 async function rpc(token,name,args={}){
  const start=performance.now();metrics.requests++;
  try{
   const response=await fetch(origin+'/rpc/'+name,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',...(sessions.has(token)?{'x-easycall-session':sessions.get(token)}:{})},body:JSON.stringify(args),signal:AbortSignal.timeout(12000)});
   if(!response.ok){metrics.errors++;throw Error('RPC '+name+' HTTP '+response.status);}
   return await decodeResponse(response);
  }catch(e){if(e.name==='TimeoutError'||e.name==='AbortError')metrics.timeouts++;throw e;}
  finally{(metrics.latencies[name]||=[]).push(performance.now()-start);}
 }
 const admin=signToken('admin',env.TEST_JWT_SECRET);
 const marker=await rpc(admin,'easycall_loadtest_environment');
 if(marker.environment!=='isolated-local-loadtest'||marker.devices<devices)throw Error('Isolated fixture marker missing. Test refused.');
 if(marker.schemaVersion!=='20261114_operations_reliability')throw Error('Prepare the latest isolated schema with CURRENT_SCHEMA=1 before testing.');
 const startTime=Date.now(),endTime=startTime+(ramp+duration)*1000;
 const timers=setInterval(()=>{const seconds=(Date.now()-startTime)/1000;if(seconds>ramp+1&&Date.now()<endTime){metrics.minimumSustainedDevices=Math.min(metrics.minimumSustainedDevices??devices,active);metrics.sustainedSamples++;}const progress={seconds:Math.round(seconds),active,requests:metrics.requests,errors:metrics.errors,acknowledgedCalls:metrics.acknowledgedCalls,heapMB:Math.round(process.memoryUsage().heapUsed/1048576)};console.log(JSON.stringify(progress));fs.mkdirSync(path.join(dir,'results'),{recursive:true});fs.writeFileSync(path.join(dir,'results','progress.json'),JSON.stringify(progress));},10000);
 try{await Promise.all(Array.from({length:devices},(_,index)=>(async()=>{
  const i=index+1,token=signToken(i,env.TEST_JWT_SECRET),camp='load'+((i-1)%dimensions.camps+1);
  await sleep(ramp*1000*index/Math.max(1,devices-1));active++;metrics.peakDevices=Math.max(metrics.peakDevices,active);
  let revision=null,controlAt=0,callAt=Date.now()+Math.random()*callInterval*1000;
  try{
   sessions.set(token,crypto.randomUUID());
   const opened=await rpc(token,'easycall_open_agent_session');if(!opened.active)throw Error('Test device session refused');
   while(Date.now()<endTime&&!halt){
    if(Date.now()>=controlAt){const c=await rpc(token,'easycall_agent_control',{p_known_revision:revision,p_state:'online'});revision=c.revision;controlAt=Date.now()+(20000+Math.random()*10000);}
    if(Date.now()>=callAt){
     const rows=await rpc(token,'easycall_claim_voter',{p_camp_id:camp}),v=rows[0];
     if(!v){metrics.errors++;throw Error('Fixture queue depleted');}
     const key=camp+':'+v.voter_id,owner=assignment.get(key);if(owner&&owner!==i){metrics.duplicateAssignments++;halt=true;throw Error('Duplicate assignment');}assignment.set(key,i);
     await rpc(token,'easycall_authorize_call',{p_camp_id:camp,p_voter_id:v.voter_id});
     if(!v.claim_call_id)throw Error('Stable server call identity missing');
     const entry={call_id:v.claim_call_id,camp_id:camp,voter_id:v.voter_id,call_result:'ABSENT',status:'NONE',duration_seconds:0,memo:'Synthetic capacity test'};
     let saved=false;
     for(let attempt=0;attempt<3&&!saved;attempt++){try{const row=await rpc(token,'easycall_complete_call',{p_entry:entry});if(row.call_id!==entry.call_id)throw Error('Acknowledgement mismatch');saved=true;}catch(e){if(attempt===2){metrics.uncertainWrites++;halt=true;throw e;}await sleep(250*2**attempt);}}
     if(!acked.has(entry.call_id)){acked.add(entry.call_id);metrics.acknowledgedCalls++;}
     if(i%20===0){const replay=await rpc(token,'easycall_complete_call',{p_entry:entry});if(replay.call_id!==entry.call_id){metrics.errors++;halt=true;throw Error('Replay mismatch');}metrics.replayChecks++;}
     assignment.delete(key);callAt=Date.now()+callInterval*1000*(0.8+Math.random()*0.4);
    }
    await sleep(250);
   }
  }catch(e){metrics.errors++;const reason=String(e.message).slice(0,200);metrics.failureReasons[reason]=(metrics.failureReasons[reason]||0)+1;}finally{try{await rpc(token,'easycall_agent_control',{p_known_revision:revision,p_state:'offline'});}catch(e){}active--;}
 })()));}finally{clearInterval(timers);}
 const totals=await rpc(admin,'easycall_admin_overview_fast',{p_force:true});
 const storedCalls=(totals.camps||[]).reduce((n,c)=>n+Number(c.callCount||0),0);
 const latency=Object.fromEntries(Object.entries(metrics.latencies).map(([name,list])=>[name,{samples:list.length,p95ms:percentile(list,.95),p99ms:percentile(list,.99)}]));
 const thresholds={easycall_agent_control:300,easycall_claim_voter:500,easycall_authorize_call:500,easycall_complete_call:800};
 const completedDuration=!halt&&Date.now()>=endTime;
 const minimumCalls=Math.floor(devices*duration/callInterval*.8);
 const passed=completedDuration&&metrics.minimumSustainedDevices===devices&&metrics.sustainedSamples>0&&metrics.acknowledgedCalls>=minimumCalls&&metrics.peakDevices===devices&&metrics.errors/Math.max(1,metrics.requests)<.001&&metrics.duplicateAssignments===0&&metrics.uncertainWrites===0&&storedCalls===metrics.acknowledgedCalls&&Object.entries(thresholds).every(([name,budget])=>latency[name]?.samples>0&&latency[name].p95ms<budget);
 const report={completedDuration,minimumCalls,environment:'isolated-local-loadtest',capacityCertified:false,note:'Local stack result only; production hardware, network, Auth login and SIP calling are not certified.',devices,camps:dimensions.camps,durationSeconds:duration,rampSeconds:ramp,callIntervalSeconds:callInterval,passed,storedCalls,metrics:{...metrics,latencies:latency},thresholds,createdAt:new Date().toISOString()};
 fs.mkdirSync(path.join(dir,'results'),{recursive:true});const file=path.join(dir,'results','capacity-'+Date.now()+'.json');fs.writeFileSync(file,JSON.stringify(report,null,2));console.log(JSON.stringify({passed,report:file,peakDevices:metrics.peakDevices,errors:metrics.errors,storedCalls,acknowledgedCalls:metrics.acknowledgedCalls}));if(!passed)process.exitCode=1;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error(e.message);process.exitCode=1;});
