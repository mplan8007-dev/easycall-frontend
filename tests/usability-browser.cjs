// Browser regressions with every request fulfilled in memory: no live accounts or calls.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
let chromium;
try { ({chromium} = require('playwright')); }
catch { ({chromium} = require(path.resolve(process.execPath, '../../node_modules/playwright'))); }

(async () => {
  const root = path.resolve(__dirname, '..');
  const origin = 'http://localhost:49189';
  const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  const browser = await chromium.launch(fs.existsSync(chrome) ? {headless:true, executablePath:chrome} : {headless:true});
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin === origin) {
        const file = path.resolve(root, '.' + decodeURIComponent(url.pathname));
        if (!file.startsWith(root + path.sep)) return route.abort();
        let body = fs.readFileSync(file, 'utf8');
        if (file.endsWith('.html')) body = body.replace('</head>', '<style>.hidden{display:none!important}</style></head>');
        return route.fulfill({contentType:file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : 'text/javascript', body});
      }
      const body = url.href.includes('supabase-js')
        ? 'window.supabase={createClient:()=>({auth:{getUser:async()=>({data:{user:null},error:{name:"AuthSessionMissingError"}}),getSession:async()=>({data:{session:null}}),onAuthStateChange:()=>({})}})};'
        : '';
      return route.fulfill({contentType:route.request().resourceType() === 'stylesheet' ? 'text/css' : 'text/javascript', body});
    });
    await page.goto(origin + '/index.html');
    await page.waitForFunction(() => typeof openAgentAccounts === 'function' && !document.body.classList.contains('auth-restoring'));
    assert.equal(await page.locator('#login-error').innerText(), '');
    assert.equal(await page.locator('#super-new-camp-panel #new-camp-call-settings').count(), 1);
    assert.equal(await page.locator('#login-id').getAttribute('autocomplete'), 'username');
    assert.equal(await page.locator('#login-id').evaluate(el => el.labels.length), 1);
    await page.locator('#login-id').fill('worker01');
    await page.locator('#login-pw').fill('test-password');
    await page.locator('#login-submit').click();
    assert.match(await page.locator('#login-error').innerText(), /캠프 ID/);
    assert.equal(await page.locator('#work-login-camp').evaluate(el => el === document.activeElement), true);

    await page.locator('#login-id').fill('manager@example.test');
    await page.evaluate(() => {
      window.loginRequests = 0;
      sbClient = {auth:{signInWithPassword:() => { window.loginRequests++; return new Promise(resolve => { window.finishLogin = resolve; }); },signOut:async()=>{throw Error('offline');}}};
    });
    await page.locator('#login-submit').click();
    await page.waitForFunction(() => typeof window.finishLogin === 'function');
    assert.equal(await page.locator('#login-submit').isDisabled(), true);
    await page.locator('#login-pw').press('Enter');
    assert.equal(await page.evaluate(() => window.loginRequests), 1);
    await page.evaluate(() => window.finishLogin({error:{message:'denied'}}));
    await page.waitForFunction(() => !document.getElementById('login-submit').disabled);
    assert.match(await page.locator('#login-error').innerText(), /로그인 실패/);
    assert.equal(await page.locator('#login-id').inputValue(), 'manager@example.test');

    await page.evaluate(() => {
      document.getElementById('login-view').classList.add('hidden');
      document.getElementById('agent-view').classList.remove('hidden');
      verifiedIdentity={role:'agent',uid:'tester',campId:'camp01',agentId:'tab01'};
      localStorage.setItem('easycall_role','agent');currentAgentId='tab01';currentAdminId='camp01';
      campsList=[{campId:'camp01',name:'검증 캠프'}];agentsList=[{campId:'camp01',agentId:'tab01',alias:'검증 담당자'}];
      campSettingsMap.camp01={callTransport:'smartphone',dialMode:'manual',nightLock:false};
      const voter={id:'1',campId:'camp01',name:'테스트',phone:'01012345678'};
      votersList=[voter];activeClaim={voterId:'1',callId:'test-save',voter};
      sbClient={rpc:()=>new Promise(resolve=>{window.finishSave=resolve;})};
      document.getElementById('memo-input').value='실패 후에도 보존할 메모';
      selectSupportStatus('SUPPORT');
      void saveResultToStorage('SUPPORT');
    });
    await page.waitForFunction(() => typeof window.finishSave === 'function');
    assert.equal(await page.locator('#memo-input').isDisabled(), true);
    assert.equal(await page.locator('#btn-status-OPPOSE').isDisabled(), true);
    assert.match(await page.locator('#btn-save-next').innerText(), /저장 중/);
    await page.evaluate(() => window.finishSave({error:{message:'offline'}}));
    await page.waitForFunction(() => !document.getElementById('memo-input').disabled);
    assert.equal(await page.locator('#memo-input').inputValue(), '실패 후에도 보존할 메모');
    assert.match(await page.locator('#result-save-status').innerText(), /다시 저장/);
    assert.equal(await page.evaluate(() => activeClaim.callId), 'test-save');
    await page.evaluate(() => {
      clearAgentDraft();activeClaim=null;selectedStatus=null;isEnterpriseRpcAvailable=true;document.getElementById('memo-input').value='';
      window.selectedRequests=[];
      window.selectedFixture={voter_id:'selected-contact',camp_id:'camp01',claim_call_id:'stable-server-call',name:'검색한 연락처',phone:'00000000001',last_result:'CALLBACK',callback_at:'2026-12-01T00:00:00Z'};
      sbClient={rpc:async(name,args)=>{window.selectedRequests.push({name,args});
        if(name==='easycall_claim_selected_voter')return {data:[window.selectedFixture]};
        if(name==='easycall_resume_assignment')return {data:{assignment:window.selectedFixture}};
        return {data:{items:[window.selectedFixture],total:1}};
      }};
      return switchAgentTab('search');
    });
    await page.locator('[data-claim-voter="selected-contact"]').click();
    await page.waitForFunction(() => activeClaim?.callId==='stable-server-call');
    assert.equal(await page.locator('#voter-name').innerText(), '검색한 연락처');
    assert.equal(await page.evaluate(() => window.selectedRequests.some(r=>r.name==='easycall_authorize_call')), false);
    await page.locator('#memo-input').fill('새로고침 복구 검증');
    await page.locator('#btn-status-NO_RESPONSE').click();
    await page.evaluate(() => {persistAgentDraft();activeClaim=null;document.getElementById('memo-input').value='';selectedStatus=null;return recoverAgentAssignment();});
    assert.equal(await page.locator('#memo-input').inputValue(), '새로고침 복구 검증');
    assert.equal(await page.evaluate(() => selectedStatus), 'NO_RESPONSE');
    assert.equal(await page.evaluate(() => activeClaim.callId), 'stable-server-call');
    assert.deepEqual(errors, []);
    console.log('PASS: anonymous login, form placement, login concurrency, save locking, searched contact assignment and server-matched draft recovery. All services mocked; CDN visual styling is not assessed.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode=1; });
