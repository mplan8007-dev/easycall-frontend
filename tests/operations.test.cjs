const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
function harness() {
  const nodes = new Map();
  const storage = new Map();
  const session = new Map();
  const context = vm.createContext({
    window: { addEventListener() {}, location: {} },
    document: {
      getElementById(id) {
        if (!nodes.has(id)) nodes.set(id, { value:'', innerText:'', innerHTML:'', disabled:false,
          classList:{add(){},remove(){},toggle(){}}, style:{} });
        return nodes.get(id);
      },
      querySelectorAll() { return []; },
    },
    localStorage: {getItem:k=>storage.get(k) ?? null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
    sessionStorage: {getItem:k=>session.get(k)||null,setItem:(k,v)=>session.set(k,v),removeItem:k=>session.delete(k)},
    console: {log(){},warn(){},error(){}},
    setInterval(){return 1;},clearInterval(){},setTimeout(){return 1;},clearTimeout(){},
    crypto: crypto.webcrypto, Date, Intl, Blob, URL, alert(){},confirm(){return true;},
  });
  vm.runInContext(script, context);
  return { run:code=>vm.runInContext(code,context), nodes, context };
}

test('original visual CSS is preserved and administration controls are available', () => {
  const contract = require('./layout-contract.json');
  const digest = text=>crypto.createHash('sha256').update(text).digest('hex');
  assert.equal(digest(html.match(/<style>([\s\S]*?)<\/style>/)[1]), contract.style);
  for(const id of ['super-view','super-camps-body','camp-filter-sido','camp-edit-dialog','camp-payment-dialog','admin-backup-dialog'])assert.ok(html.includes('id="'+id+'"'));
});

test('script group token and the existing district token use the same contact group', () => {
  const h=harness();
  assert.equal(h.run("formatPersonalizedScript('{그룹명} / {행정동} / {유권자명}',{dong:'대천1동',name:'홍길동'})"),'대천1동 / 대천1동 / 홍길동');
  h.run("currentAdminId='camp01';campSettingsMap.camp01={stepScripts:{1:'{행정동}',2:'{그룹명}'}};loadScenarioTextsToInputs()");
  assert.equal(h.nodes.get('scenario-step-1').value,'{그룹명}');
  assert.equal(h.run('campSettingsMap.camp01.stepScripts[1]'),'{행정동}');
});

test('CSV supports BOM, escaped quotes, embedded commas and multiline cells', () => {
  const h=harness();
  assert.deepEqual(JSON.parse(h.run(`JSON.stringify(parseCsv('\uFEFFname,phone,dong\\r\\n"A, ""B""",01012345678,"line1\\nline2"'))`)),
    [['name','phone','dong'],['A, "B"','01012345678','line1\nline2']]);
  assert.throws(()=>h.run(`parseCsv('"unterminated')`));
});
test('import validates header mapping, duplicates and malformed numbers', () => {
  const h=harness();
  const rows=JSON.parse(h.run(`JSON.stringify(validateImportRows([['전화번호','이름','행정동'],['01012345678','홍길동','지역']]))`));
  assert.equal(rows[0].phone,'01012345678'); assert.equal(rows[0].name,'홍길동'); assert.equal(rows[0].dong,'지역');
  const group=JSON.parse(h.run(`JSON.stringify(validateImportRows([['그룹명','전화번호','이름'],['봉사팀','01012345678','홍길동']]))`));
  assert.equal(group[0].dong,'봉사팀'); assert.equal(group[0].name,'홍길동');
  const template=JSON.parse(h.run(`JSON.stringify(validateImportRows(parseCsv('유권자명,전화번호,그룹명\\n홍길동,01012345678,봉사팀')))`));
  assert.equal(template[0].name,'홍길동');assert.equal(template[0].dong,'봉사팀');
  assert.match(rows[0].id,/^[a-f0-9-]{36}$/);
  assert.throws(()=>h.run(`validateImportRows([['이름','전화번호'],['A','01012345678'],['B','010-1234-5678']])`));
  assert.throws(()=>h.run(`validateImportRows([['A','123']])`));
});
test('CSV export escapes formulas, commas, quotes and newlines', () => {
  const h=harness();
  assert.equal(h.run(`csvCell('=1+1')`),'"\'=1+1"');
  assert.equal(h.run(`csvCell('  @SUM(A1)')`),'"\'  @SUM(A1)"');
  assert.equal(h.run(`csvCell('a,"b"\\nc')`),'"a,""b""\nc"');
});
test('untrusted values are escaped and identifiers reject script injection', () => {
  const h=harness();
  assert.equal(h.run(`escapeHTML('<img src=x onerror="x">')`),'&lt;img src=x onerror=&quot;x&quot;&gt;');
  assert.throws(()=>h.run(`ensureCampStructure({campId:"x');alert(1);//"})`));
  h.run(`votersList=[{id:'1',campId:'camp01',name:'<img src=x onerror=alert(1)>',phone:'01012345678',dong:'<b>x</b>',lastMemo:'<svg onload=alert(1)>',lastResult:'READY'}]; currentAdminId='camp01'; renderAgentSearchTable();`);
  assert.doesNotMatch(h.nodes.get('agent-search-voters-tbody').innerHTML,/<img|<svg|<b>x/);
});
test('empty camps never generate sample contacts', () => {
  const h=harness();
  assert.equal(h.run(`getCampVoters('newcamp').length`),0);
  assert.equal(h.run('votersList.length'),0);
});
test('no claim is produced after an empty or failed RPC, including all-rejected lists', async () => {
  const h=harness();
  h.run(`verifiedIdentity={role:'agent',campId:'camp01',agentId:'tab01'};currentAgentId='tab01';isEnterpriseRpcAvailable=true;
    votersList=[{id:'1',campId:'camp01',lastResult:'REJECT'}];
    sbClient={rpc:async()=>({data:[],error:null})};`);
  assert.equal(await h.run('loadCurrentVoterToDialer(true)'),false);
  assert.equal(h.run('activeClaim'),null);
  h.run(`sbClient.rpc=async()=>({data:null,error:{message:'offline'}})`);
  assert.equal(await h.run('loadCurrentVoterToDialer(true)'),false);
  assert.equal(h.run('activeClaim'),null);
});
test('ending a call does not auto-save and leaves response unselected', () => {
  const h=harness(); h.run('endCallSimulation()');
  assert.equal(h.run('selectedStatus'),null);
  assert.equal(h.run('globalCampCallLogs.length'),0);
});
test('save failure preserves memo, assignment ID, zero duration and retry identity', async () => {
  const h=harness();
  h.run(`verifiedIdentity={role:'agent',campId:'camp01',agentId:'tab01'};currentAgentId='tab01';
    votersList=[{id:'1',campId:'camp01',name:'A',phone:'01012345678'}];
    activeClaim={voterId:'1',callId:'same-call'};selectedStatus='OPPOSE';
    sbClient={rpc:async(name,args)=>{globalThis.sent=args.p_entry;return {error:{message:'offline'}};}};`);
  h.nodes.set('memo-input',{value:'keep this memo'});
  await h.run(`saveResultToStorage('OPPOSE','CONNECTED')`);
  assert.equal(h.nodes.get('memo-input').value,'keep this memo');
  assert.equal(h.run('activeClaim.callId'),'same-call');
  assert.equal(h.run('sent.duration_seconds'),0);
  assert.equal(h.run('globalCampCallLogs.length'),0);
  assert.equal(h.run('isSavingResult'),false);
  await h.run(`saveResultToStorage('OPPOSE','CONNECTED')`);
  assert.equal(h.run('sent.call_id'),'same-call');
});
test('double click produces one concurrent save request', async () => {
  const h=harness();
  h.run(`verifiedIdentity={role:'agent',campId:'camp01',agentId:'tab01'};currentAgentId='tab01';
    votersList=[{id:'1',campId:'camp01'}];activeClaim={voterId:'1',callId:'same'};selectedStatus='SUPPORT';
    globalThis.requests=0;sbClient={rpc:()=>{requests++;return new Promise(resolve=>{globalThis.finish=resolve;});}};`);
  const saving=h.run(`saveResultToStorage('SUPPORT','CONNECTED')`);
  await h.run(`saveResultToStorage('SUPPORT','CONNECTED')`);
  assert.equal(h.run('requests'),1);
  h.run(`finish({error:{message:'offline'}})`); await saving;
});
test('clock formatting has no fabricated 15-second fallback', () => {
  const h=harness(); assert.equal(h.run('formatDuration(0)'),'00:00');
  assert.equal(h.run('formatDuration(7201)'),'120:01');
});
test('real authentication is required even if the browser role says super', async () => {
  const h=harness();
  h.run(`localStorage.setItem('easycall_role','super'); sbClient={auth:{getUser:async()=>({data:{user:null},error:{message:'unauthenticated'}})}};`);
  await assert.rejects(h.run('activateVerifiedUser()'));
  assert.equal(h.run('verifiedIdentity'),null);
});

test('camp call policy is real form markup, never CSS text', () => {
  for (const [, style] of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)) {
    assert.doesNotMatch(style, /<(?:section|input|select|div|label)\b/);
  }
  assert.equal((html.match(/id="new-camp-call-settings"/g) || []).length, 1);
  const panel = html.slice(html.indexOf('id="super-new-camp-panel"'), html.indexOf('<!-- ==================== 후보자 일일'));
  assert.match(panel, /id="new-camp-call-transport"/);
});

test('email login serializes requests and recovers even when sign-out fails', async () => {
  const h = harness();
  h.nodes.set('login-id', {value:'manager@example.test'});
  h.nodes.set('login-pw', {value:'test-password'});
  h.run(`globalThis.requests=0;sbClient={auth:{
    signInWithPassword:()=>{requests++;return new Promise(resolve=>{globalThis.finishLogin=resolve;});},
    signOut:async()=>{throw Error('offline');}
  }};`);
  const pending = h.run('handleInstantLogin()');
  await h.run('handleInstantLogin()');
  assert.equal(h.run('requests'),1);
  assert.equal(h.nodes.get('login-submit').disabled,true);
  h.run(`finishLogin({error:{message:'denied'}})`);
  await pending;
  assert.equal(h.nodes.get('login-submit').disabled,false);
  assert.match(h.nodes.get('login-error').innerText,/로그인 실패/);
  assert.equal(h.nodes.get('login-id').value,'manager@example.test');
  assert.equal(h.run('loginInFlight'),false);
});

test('saving freezes result inputs and restores them after failure with persistent guidance', async () => {
  const h=harness(),memo={value:'작성 중인 메모',disabled:false},previouslyDisabled={disabled:true};
  h.nodes.set('memo-input',memo);
  h.context.document.querySelectorAll=()=>[memo,previouslyDisabled];
  h.run(`verifiedIdentity={role:'agent',campId:'camp01',agentId:'tab01'};currentAgentId='tab01';
    votersList=[{id:'1',campId:'camp01'}];activeClaim={voterId:'1',callId:'same'};selectedStatus='SUPPORT';
    sbClient={rpc:()=>new Promise(resolve=>{globalThis.finishSave=resolve;})};`);
  const pending=h.run(`saveResultToStorage('SUPPORT')`);
  assert.equal(memo.disabled,true);
  assert.match(h.nodes.get('btn-save-next').textContent,/저장 중/);
  h.run(`updateAgentButtonTextPreview()`);
  assert.match(h.nodes.get('btn-save-next').textContent,/저장 중/);
  h.run(`finishSave({error:{message:'offline'}})`);await pending;
  assert.equal(memo.disabled,false);
  assert.equal(previouslyDisabled.disabled,true);
  assert.equal(memo.value,'작성 중인 메모');
  assert.match(h.nodes.get('result-save-status').textContent,/다시 저장/);
});

function agentFixture(h) {
 h.run(`verifiedIdentity={uid:'user1',role:'agent',campId:'c1',agentId:'a1'};currentAgentId='a1';currentAdminId='c1';localStorage.setItem('easycall_role','agent');isEnterpriseRpcAvailable=true;
 agentsList=[{campId:'c1',agentId:'a1'}];campSettingsMap.c1={nightLock:false,dncPhones:[]};
 globalThis.fixture={voter_id:'v1',camp_id:'c1',name:'Test',phone:'01012345678',last_result:'ABSENT',claim_call_id:'server-call-id'};`);
}

test('selected contact is assigned by the server and uses its stable call identity',async()=>{
 const h=harness();agentFixture(h);
 h.run(`requests=[];sbClient={rpc:async(name,args)=>{requests.push({name,args});return {data:[fixture]};}};`);
 assert.equal(await h.run("loadCurrentVoterToDialer(true,'v1')"),true);
 assert.equal(h.run('requests[0].name'),'easycall_claim_selected_voter');
 assert.equal(h.run('requests[0].args.p_voter_id'),'v1');
 assert.equal(h.run('activeClaim.callId'),'server-call-id');
 assert.equal(h.run('requests.length'),1);
 assert.equal(h.nodes.get('voter-queue-progress').innerText,'현재 대상 1명 담당 중');
 h.nodes.get('memo-input').value='not saved';
 assert.equal(await h.run("loadCurrentVoterToDialer(true,'v2')"),false);
 assert.equal(h.run('requests.length'),1);
});

test('reload restores only the draft matched to the server assignment',async()=>{
 const h=harness();agentFixture(h);
 h.run(`applyClaimRow(fixture);document.getElementById('memo-input').value='recover my memo';selectedStatus='NO_OPINION';persistAgentDraft();
 activeClaim=null;document.getElementById('memo-input').value='';selectedStatus=null;sbClient={rpc:async()=>({data:{assignment:fixture}})};`);
 await h.run('recoverAgentAssignment()');
 assert.equal(h.run('activeClaim.callId'),'server-call-id');
 assert.equal(h.nodes.get('memo-input').value,'recover my memo');
 assert.equal(h.run('selectedStatus'),'NO_OPINION');
 assert.equal(h.run('recoveryBlocked'),false);
});

test('expired assignments retain the memo and block saving; acknowledged saves clear the draft',async()=>{
 const h=harness();agentFixture(h);
 h.run(`applyClaimRow(fixture);document.getElementById('memo-input').value='keep expired memo';selectedStatus='NO_RESPONSE';persistAgentDraft();
 requests=[];sbClient={rpc:async(name,args)=>{requests.push(name);return {data:{assignment:null}};}};`);
 await h.run('recoverAgentAssignment()');
 assert.equal(h.run('recoveryBlocked'),true);
 await h.run("saveResultToStorage('NO_RESPONSE')");
 assert.equal(h.run("requests.includes('easycall_complete_call')"),false);
 assert.equal(h.nodes.get('memo-input').value,'keep expired memo');
 h.run(`sbClient={rpc:async()=>({data:{completed:true}})};`);
 await h.run('recoverAgentAssignment()');
 assert.equal(h.run('activeClaim'),null);
 assert.equal(h.run('readAgentDraft()'),null);
 assert.equal(h.nodes.get('memo-input').value,'');
});

test('a second device cannot activate business screens before explicit transfer',async()=>{
 const h=harness();h.run(`requests=[];sbClient={auth:{getUser:async()=>({data:{user:{id:'user1',app_metadata:{easycall_role:'agent',camp_id:'c1',agent_id:'a1'}}}})},rpc:async(name)=>{requests.push(name);return {data:{active:false,reason:'Other device'}};}};`);
 await assert.rejects(h.run('activateVerifiedUser()'),error=>error.code==='DEVICE_BUSY');
 assert.equal(h.run('requests.length'),1);
 assert.equal(h.run('requests[0]'),'easycall_open_agent_session');
});

test('late recovery responses cannot erase a newly assigned contact or its inputs',async()=>{
 const h=harness();agentFixture(h);h.run(`applyClaimRow(fixture);sbClient={rpc:()=>new Promise(resolve=>globalThis.finishRecovery=resolve)};`);
 const pending=h.run('recoverAgentAssignment()');
 h.run(`activeClaim={voterId:'new',callId:'new-call',voter:{id:'new',campId:'c1'}};document.getElementById('memo-input').value='new memo';finishRecovery({data:{completed:true}});`);
 await pending;
 assert.equal(h.run('activeClaim.callId'),'new-call');
 assert.equal(h.nodes.get('memo-input').value,'new memo');
 assert.equal(h.run('recoveryBlocked'),false);
});
