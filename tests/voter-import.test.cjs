const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
function harness(mode='ok',size=4){const nodes=new Map();const ctx=vm.createContext({window:{addEventListener(){},location:{}},document:{getElementById(id){if(!nodes.has(id))nodes.set(id,{innerText:'',value:'',classList:{add(){},remove(){}},style:{}});return nodes.get(id)},querySelectorAll(){return []}},localStorage:{getItem(){return 'admin'},removeItem(){},setItem(){}},sessionStorage:{getItem(){return null},removeItem(){}},setTimeout(){},clearTimeout(){},setInterval(){},clearInterval(){},crypto:crypto.webcrypto,Date,Intl,Blob,URL,console,confirm(){return true},alert(){}});vm.runInContext(fs.readFileSync(__dirname+'/../index.html','utf8').match(/<script>([\s\S]*?)<\/script>/)[1],ctx);vm.runInContext(`
verifiedIdentity={role:'admin',campId:'camp01'};currentAdminId='camp01';refreshes=0;mode=${JSON.stringify(mode)};size=${size};
pullStateFromSupabase=async()=>{refreshes++};updateVoterQueueStatusText=()=>{};
calls=[];sbClient={rpc:async(name,args)=>{calls.push(name);if(name==='easycall_replace_voters'){savedRows=args.p_rows;if(mode==='locked')return {error:{message:'Active assignments exist'}};return {data:mode==='bad-receipt'?null:mode==='dnc'?size-1:size}}
if(mode==='read-fail')return {error:{message:'network unavailable'}};
let items=savedRows.map(r=>({voter_id:r.id,name:r.name,phone:r.phone,dong:r.dong}));
if(mode==='old')items=[{voter_id:'1042',name:'Old sample',phone:'01012345678',dong:'Test'}];
if(mode==='same-count-old')items[0].phone='01099999999';
if(mode==='dnc')items=items.slice(0,-1);
return {data:{total:mode==='old'?5:items.length,items:items.slice(args.p_offset,args.p_offset+args.p_limit)}}}};
file={name:'four-test.csv',size:100,text:async()=>['voter_name,phone,dong',...Array.from({length:size},(_,i)=>'Import '+i+',010'+String(i).padStart(8,'0')+',Test')].join('\\n')};
event={target:{files:[file],value:'selected'}};`,ctx);return {run:s=>vm.runInContext(s,ctx),status:()=>nodes.get('upload-status').innerText};}
test('four imported contacts require server receipt and exact saved contacts before success',async()=>{const h=harness();await h.run('handleCsvUpload(event)');assert.match(h.status(),/4건 확인 완료/);assert.equal(h.run('refreshes'),1);assert.equal(h.run('event.target.value'),'');});
for(const mode of ['old','same-count-old','bad-receipt','read-fail','locked'])test('never reports success for '+mode,async()=>{const h=harness(mode);await h.run('handleCsvUpload(event)');assert.match(h.status(),/확인 실패/);assert.doesNotMatch(h.status(),/확인 완료/);assert.equal(h.run('refreshes'),0);if(mode==='locked')assert.match(h.status(),/배정된 대상/);});
test('large imports verify every page and explain DNC exclusions',async()=>{const h=harness('ok',205);await h.run('handleCsvUpload(event)');assert.match(h.status(),/205건 확인 완료/);assert.equal(h.run("calls.filter(n=>n==='easycall_list_page').length"),3);const d=harness('dnc');await d.run('handleCsvUpload(event)');assert.match(d.status(),/3건 확인 완료.*제외 1건/);});
