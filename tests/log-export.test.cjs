const test=require('node:test'),assert=require('node:assert/strict');
const api=import('../log-export.mjs');
const page=(items,done=true,cursor=null)=>({items,done,cursor,asOf:'2026-11-14T00:00:00+00:00'});
function sink(){return {chunks:[],closed:false,aborted:false,async write(x){this.chunks.push(x);},async close(){this.closed=true;},async abort(){this.aborted=true;this.chunks=[];}};}
test('CSV preserves Unicode, quotes and line breaks and neutralizes formulas',async()=>{
 const {streamCallLogs}=await api,s=sink();
 await streamCallLogs({sink:s,fetchPage:async()=>page([{voter_name:'홍길동',memo:' =HYPERLINK("x")\n한글',voter_phone:'01012345678',created_at:null}])});
 const csv=new TextDecoder().decode(Buffer.concat(s.chunks));assert.match(csv,/홍길동/);assert.match(csv,/' =HYPERLINK\(""x""\)/);assert.match(csv,/"01012345678"/);assert.equal(s.closed,true);
});
test('400,000 generated records stream in bounded pages without retaining earlier chunks',async()=>{
 const {streamCallLogs}=await api;let reads=0,writes=0,bytes=0,maxChunk=0,closed=false;
 const row={call_id:'fixture',memo:'가'.repeat(20)};
 const count=await streamCallLogs({fetchPage:async({cursor,asOf})=>{assert.equal(cursor?.callId||0,reads);if(reads)assert.equal(asOf,'2026-11-14T00:00:00+00:00');reads++;return page(Array(1000).fill(row),reads===400,{callId:reads});},sink:{async write(x){writes++;bytes+=x.length;maxChunk=Math.max(maxChunk,x.length);},async close(){closed=true;},async abort(){throw Error('unexpected abort');}}});
 assert.equal(count,400000);assert.equal(reads,400);assert.equal(writes,401);assert.ok(bytes>maxChunk*390);assert.ok(maxChunk<1024*1024);assert.equal(closed,true);
});
test('network error aborts the partial file and never closes it',async()=>{
 const {streamCallLogs}=await api,s=sink();let reads=0;
 await assert.rejects(streamCallLogs({sink:s,fetchPage:async()=>{if(reads++)throw Error('offline');return page([{memo:'first'}],false,{callId:'first'});}}),/offline/);
 assert.equal(s.aborted,true);assert.equal(s.closed,false);assert.deepEqual(s.chunks,[]);
});
test('cancellation or identity change while a page is in flight discards its data',async()=>{
 const {streamCallLogs}=await api,s=sink();let active=true;
 await assert.rejects(streamCallLogs({sink:s,check:()=>{if(!active)throw Error('identity changed');},fetchPage:async()=>{active=false;return page([{memo:'private'}]);}}),/identity changed/);
 assert.equal(s.closed,false);assert.equal(s.aborted,true);
});
test('server cursor stalling and changed cutoff fail closed',async()=>{
 const {streamCallLogs}=await api;let reads=0;const s=sink();
 await assert.rejects(streamCallLogs({sink:s,fetchPage:async()=>page([{memo:'x'}],false,{callId:'same'})}),/진행되지/);
 await assert.rejects(streamCallLogs({sink:sink(),fetchPage:async()=>({...page([{memo:'x'}],false,{callId:String(++reads)}),asOf:reads===1?'first':'changed'})}),/기준 시각/);
});
test('backpressure prevents fetching the next page before the prior write finishes',async()=>{
 const {streamCallLogs}=await api;let reads=0,release,writing=false;
 const task=streamCallLogs({fetchPage:async()=>{assert.equal(writing,false);return page([{memo:'x'}],++reads===2,{callId:reads});},sink:{async write(){if(reads===1){writing=true;await new Promise(r=>release=r);writing=false;}},async close(){},async abort(){}}});
 while(!release)await new Promise(r=>setImmediate(r));assert.equal(reads,1);release();await task;assert.equal(reads,2);
});
test('fallback enforces bytes before adding a chunk and never downloads partial data',async()=>{
 const {memorySink,streamCallLogs}=await api;let saved=false;
 await assert.rejects(streamCallLogs({sink:memorySink(async()=>saved=true,512),fetchPage:async()=>page([{memo:'가'.repeat(1000)}])}),/한도/);
 assert.equal(saved,false);
});
