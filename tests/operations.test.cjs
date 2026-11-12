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
  const context = vm.createContext({
    window: { addEventListener() {}, location: {} },
    document: {
      getElementById(id) {
        if (!nodes.has(id)) nodes.set(id, { value:'', innerText:'', innerHTML:'', disabled:false,
          classList:{add(){},remove(){}}, style:{} });
        return nodes.get(id);
      },
      querySelectorAll() { return []; },
    },
    localStorage: {getItem:k=>storage.get(k) ?? null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
    sessionStorage: {getItem(){return null;},removeItem(){}},
    console: {log(){},warn(){},error(){}},
    setInterval(){return 1;},clearInterval(){},setTimeout(){return 1;},clearTimeout(){},
    crypto: crypto.webcrypto, Date, Intl, Blob, URL, alert(){},confirm(){return true;},
  });
  vm.runInContext(script, context);
  return { run:code=>vm.runInContext(code,context), nodes, context };
}

test('original CSS, classes and IDs are preserved outside the added province filter', () => {
  const contract = require('./layout-contract.json');
  const markup = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '')
    .replace(/<select id="camp-filter-sido"[^]*?<\/select>/, '');
  const digest = text=>crypto.createHash('sha256').update(text).digest('hex');
  assert.equal(digest(html.match(/<style>([\s\S]*?)<\/style>/)[1]), contract.style);
  for (const field of ['class','id']) {
    const values = [...markup.matchAll(new RegExp('\\b'+field+'="([^"]*)"','g'))].map(m=>m[1]);
    assert.equal(digest(JSON.stringify(values)),contract[field]);
  }
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
  assert.equal(rows[0].phone,'01012345678'); assert.equal(rows[0].name,'홍길동');
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
