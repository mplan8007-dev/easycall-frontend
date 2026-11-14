// Isolated database/API benchmark; no phone, SIP, SMS or production target.
import fs from 'node:fs';
import crypto from 'node:crypto';
import {performance} from 'node:perf_hooks';
import assert from 'node:assert/strict';
import {validateTarget,signToken,percentile} from './run.mjs';
import {streamCallLogs} from '../log-export.mjs';
const origin=validateTarget(process.env.TEST_URL||'http://127.0.0.1:54330');
const env=Object.fromEntries(fs.readFileSync(new URL('.env',import.meta.url),'utf8').trim().split(/\r?\n/).map(l=>l.split('=')));
const headers={Authorization:'Bearer '+signToken('admin',env.TEST_JWT_SECRET),'Content-Type':'application/json'};
async function rpc(name,args={}){
 const response=await fetch(origin+'/rpc/'+name,{method:'POST',headers,body:JSON.stringify(args),signal:AbortSignal.timeout(30000)});
 if(!response.ok)throw Error(name+' HTTP '+response.status);
 return response.json();
}
const marker=await rpc('easycall_loadtest_environment');
assert.equal(marker.environment,'isolated-local-loadtest');assert.equal(marker.schemaVersion,'20261114_operations_reliability');
const reports=[];
for(const positive of [false,true]){
 const latencies=[],hash=crypto.createHash('sha256');let bytes=0,maxHeap=0,previous=null;
 const started=performance.now();
 const count=await streamCallLogs({fetchPage:async({cursor,asOf})=>{
  const before=performance.now();const page=await rpc('easycall_export_logs_page',{p_camp_id:'load1',p_positive:positive,p_from:'2020-01-01',p_through:'2020-01-02',p_cursor:cursor,p_as_of:asOf});latencies.push(performance.now()-before);
  for(const row of page.items){
   assert.equal(row.camp_id,'load1');assert.equal(row.memo,'Synthetic export fixture');
   if(positive)assert.equal(row.status,'SUPPORT');
   const key=[Date.parse(row.created_at),row.call_id];
   if(previous)assert.ok(key[0]>previous[0]||key[0]===previous[0]&&key[1]>previous[1],'Cursor repeated or skipped ordering');previous=key;
  }
  maxHeap=Math.max(maxHeap,process.memoryUsage().heapUsed);return page;
 },sink:{async write(chunk){hash.update(chunk);bytes+=chunk.byteLength;},async close(){},async abort(){}}});
 assert.equal(count,positive?200000:400000);
 reports.push({positive,count,bytes,pages:latencies.length,seconds:(performance.now()-started)/1000,p95ms:percentile(latencies,.95),maxHeapMB:maxHeap/1048576,sha256:hash.digest('hex')});
 console.log(JSON.stringify(reports.at(-1)));
}
fs.mkdirSync(new URL('results/',import.meta.url),{recursive:true});
fs.writeFileSync(new URL('results/export.json',import.meta.url),JSON.stringify({environment:'isolated-local-loadtest',productionCapacityCertified:false,createdAt:new Date().toISOString(),reports},null,2));
