const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
function harness(){
 const nodes=new Map(),storage=new Map(),session=new Map(),events=new Map();
 const node=id=>{if(!nodes.has(id))nodes.set(id,{value:'',textContent:'',innerHTML:'',disabled:false,style:{},classList:{add(){},remove(){},toggle(){}},querySelector(){return null;}});return nodes.get(id);};
 const ctx=vm.createContext({document:{getElementById:node,querySelectorAll(){return [];},addEventListener(type,fn){if(!events.has(type))events.set(type,[]);events.get(type).push(fn);}},localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},sessionStorage:{getItem:k=>session.get(k)||null,setItem:(k,v)=>session.set(k,v),removeItem:k=>session.delete(k)},navigator:{onLine:true},location:{hash:''},addEventListener(){},setInterval(){return 1;},clearInterval(){},setTimeout(){return 1;},clearTimeout(){},crypto:crypto.webcrypto,console,Date,Intl,URL,Blob,alert(){},confirm(){return true;},prompt(){return 'test';}});
 vm.runInContext('window=globalThis',ctx);
 vm.runInContext(fs.readFileSync(__dirname+'/../index.html','utf8').match(/<script>([\s\S]*?)<\/script>/)[1],ctx);
 vm.runInContext(fs.readFileSync(__dirname+'/../admin-console.js','utf8'),ctx);
 return {run:s=>vm.runInContext(s,ctx),nodes,session,node,events};
}
test('disconnected writes fail instead of pretending to save',async()=>{const h=harness();assert.equal(await h.run('savePersistentData()'),false);});
test('delegated password changes never call authentication update',async()=>{const h=harness();h.session.set('easycall_master_impersonator','super');h.run("verifiedIdentity={role:'super'}; calls=0;sbClient={auth:{updateUser(){calls++;}}}");await h.run('changeAdminPassword()');await h.run('saveMyPassword()');assert.equal(h.run('calls'),0);});
test('quota failure preserves shared camp state',async()=>{const h=harness();h.run("verifiedIdentity={role:'super'};campsList=[{campId:'c1',name:'A',region:'서울특별시 중구',tablets:2,registeredCount:0}]; sbClient={rpc:async()=>({error:{message:'failed'}})}");await h.run("adjustCampTabletLimit('c1',1)");assert.equal(h.run('campsList[0].tablets'),2);});
test('invalid registration does not reach server',async()=>{const h=harness();h.run("verifiedIdentity={role:'super'};calls=0;sbClient={rpc:async()=>{calls++;return {}}}");await h.run('registerNewCampByMaster()');assert.equal(h.run('calls'),0);});
test('editing draft survives overview object replacement and keeps its revision',async()=>{
 const h=harness();h.run("verifiedIdentity={role:'super'}; campsList=[{campId:'c1',name:'A',candidate:'B',region:'서울특별시 중구',district:'중구',electionStage:'본선',electionType:'국회의원',party:'무소속',staff:'담당',manager:'관리자',tablets:2,unitPrice:700000,contractAmount:1400000,startsOn:'2026-01-01',endsOn:'2027-01-01',revision:'r1'}];openCampDetailModalById('c1'); campsList=[{campId:'c1',name:'server-new',tablets:99}];sent=null;sbClient={rpc:async(name,args)=>{if(name==='easycall_admin_save_camp'){sent=args;return {error:{message:'conflict',code:'40001'}}}return {data:{camps:[]}}}};");
 h.node('edit-camp-name').value='draft';await h.run('saveCampEdit()');assert.equal(h.run('sent.p_camp.name'),'draft');assert.equal(h.run('sent.p_camp.tablets'),2);assert.equal(h.run('sent.p_expected_revision'),'r1');assert.equal(h.node('edit-camp-name').value,'draft');
});
test('server aggregates render beyond the old client data cap and escape camp names',()=>{const h=harness();h.run("campsList=[{campId:'c1',name:'<img onerror=alert(1)>',candidate:'A',region:'서울특별시 중구',tablets:2,voterCount:20001,callCount:10001,paidAmount:0,contractAmount:1400000,effectiveStatus:'ready'}];renderSuperCampsTable()");const html=h.node('super-camps-body').innerHTML;assert.ok(!html.includes('<img'));assert.match(html,/20,001/);assert.match(html,/10,001/);assert.ok(!html.includes('onclick='));});

test('administrator label uses issued login ID and hides internal auth email',()=>{const h=harness();const email='a'.repeat(64)+'@login.easycall.invalid';for(const login of ['manager01','<img src=x>','']){h.run('campsList='+JSON.stringify([{campId:'camp01',name:'Camp',region:'Seoul',tablets:1,adminEmail:email,adminLoginId:login}])+';renderSuperCampsTable()');const html=h.node('super-camps-body').innerHTML;assert.ok(!html.includes(email));assert.ok(!html.includes('<img'));if(login==='manager01')assert.ok(html.includes('manager01'));}});

function fillNewCamp(h){const values={'new-camp-name':'Test camp','new-camp-candidate':'Candidate','new-camp-admin':'testcamp','new-camp-stage':'본선','new-camp-election-type':'국회의원','new-camp-sido':'서울특별시','new-camp-sigungu':'중구','new-camp-party':'무소속','new-camp-staff':'Staff','new-camp-manager':'Manager','new-camp-start':'2026-01-01','new-camp-end':'2027-01-01','new-camp-limit':'2','new-camp-unit-price':'700000','new-camp-contract-amount':'1400000'};for(const [id,value]of Object.entries(values))h.node(id).value=value;h.run("verifiedIdentity={role:'super',uid:'root'};calls=0;sent=null;sbClient={rpc:async(name,args)=>{calls++;sent=args;return {error:{message:'keep draft'}}}};");}
test('new camps submit smartphone, pending SIP or configured SIP atomically with registration',async()=>{for(const mode of ['smartphone','sip','configured']){const h=harness();fillNewCamp(h);h.node('new-camp-call-transport').value=mode==='configured'?'sip':mode;if(mode==='configured'){h.node('new-camp-sip-wss').value='wss://pbx.example.com/ws';h.node('new-camp-sip-domain').value='pbx.example.com';}await h.run('registerNewCampByMaster()');assert.equal(h.run('calls'),1);assert.equal(h.run('sent.p_camp.callPolicy.callTransport'),mode==='configured'?'sip':mode);assert.equal(h.run('sent.p_camp.callPolicy.sipWss'),mode==='configured'?'wss://pbx.example.com/ws':'');assert.equal(h.node('new-camp-call-transport').value,mode==='configured'?'sip':mode);}});
test('incomplete or insecure SIP registration never reaches the server',async()=>{for(const wss of ['ws://pbx.example.com','wss://user:secret@pbx.example.com/ws','wss://pbx.example.com/ws?password=x','wss://pbx.example.com/ws']){const h=harness();fillNewCamp(h);h.node('new-camp-call-transport').value='sip';h.node('new-camp-sip-wss').value=wss;if(wss!=='wss://pbx.example.com/ws')h.node('new-camp-sip-domain').value='pbx.example.com';await h.run('registerNewCampByMaster()');assert.equal(h.run('calls'),0);}});
test('new camp form defaults reset mode and clear SIP endpoints',()=>{const h=harness();h.node('new-camp-call-transport').value='sip';h.node('new-camp-sip-wss').value='wss://old.example.com/ws';h.run('initNewCampFormDefaults()');assert.equal(h.node('new-camp-call-transport').value,'smartphone');assert.equal(h.node('new-camp-sip-wss').value,'');assert.equal(h.node('new-camp-sip-options').hidden,true);});

test('background refresh cannot give an old draft a newer revision or undo a stop',async()=>{
 const h=harness();
 h.run(`verifiedIdentity={role:'admin',campId:'c1',uid:'manager'};currentAdminId='c1';localStorage.setItem('easycall_role','admin');
 stateRevisions.set('MASTER_META','m1');stateRevisions.set('STATE_c1','s1');campSettingsMap.c1={globalStopped:false,stepScripts:{1:'my draft'}};
 window.easycallLoadLists=async()=>({voters:[],logs:[]});window.sent=null;
 sbClient={rpc:async(name,args)=>name==='easycall_save_state'?(window.sent=args,{error:{code:'40001',message:'conflict'}}):{data:[
 {store_key:'MASTER_META',updated_at:'m2',payload:{campsList:[{campId:'c1',tablets:2}],agentsList:[]}},
 {store_key:'STATE_c1',updated_at:'s2',payload:{config:{globalStopped:true,stepScripts:{1:'other draft'}}}}]}};`);
 for(const fn of h.events.get('input')||[])fn({target:{closest:selector=>selector==='#admin-pane-config'}});
 await h.run('pullStateFromSupabase()');
 assert.equal(h.run("stateRevisions.get('STATE_c1')"),'s1');
 assert.equal(h.run('campSettingsMap.c1.globalStopped'),true);
 assert.equal(h.run('campSettingsMap.c1.stepScripts[1]'),'my draft');
 assert.equal(await h.run("savePersistentData('c1')"),false);
 assert.equal(h.run('sent.p_state_revision'),'s1');
 assert.equal(h.run('sent.p_meta_revision'),'m1');
 assert.equal(h.run('campSettingsMap.c1.stepScripts[1]'),'my draft');
});

test('stop uses the dedicated RPC and failed resume never changes the local stopped state',async()=>{
 const h=harness();h.run(`verifiedIdentity={role:'admin',campId:'c1'};currentAdminId='c1';campSettingsMap.c1={globalStopped:false};stateRevisions.set('STATE_c1','s1');
 requests=[];sbClient={rpc:async(name,args)=>{requests.push({name,args});return args.p_stopped?{data:{globalStopped:true,revision:'s2'}}:{error:{code:'40001',message:'conflict'}};}};`);
 await h.run('toggleCampGlobalCalling()');
 assert.equal(h.run('requests[0].name'),'easycall_set_calling_state');
 assert.equal(h.run('campSettingsMap.c1.globalStopped'),true);
 await h.run('toggleCampGlobalCalling()');
 assert.equal(h.run('requests[1].args.p_expected_revision'),'s2');
 assert.equal(h.run('campSettingsMap.c1.globalStopped'),true);
});

