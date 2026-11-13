import './camp-admin-accounts.js';
import {previewAgentRows,deliveryText,spreadsheetXml} from './agent-account-tools.mjs';
const $=id=>document.getElementById(id),esc=v=>escapeHTML(String(v??''));
const box=document.createElement('section');box.id='agent-accounts';box.className='ga-hidden';box.setAttribute('role','dialog');box.setAttribute('aria-modal','true');box.setAttribute('aria-labelledby','ga-title');
box.innerHTML=`<style>
#agent-accounts{position:fixed;inset:0;z-index:10060;background:#020617e8;display:flex;align-items:center;justify-content:center;padding:16px;color:#f8fafc;font-size:14px}
#agent-accounts.ga-hidden,#agent-accounts .ga-hidden{display:none!important}
#agent-accounts .ga-card{background:#0f172a;border:1px solid #334155;border-radius:20px;padding:24px;max-width:1050px;width:100%;max-height:92vh;overflow:auto}
#agent-accounts h2{font-size:22px;font-weight:800}#agent-accounts h3{font-size:18px;font-weight:700;margin:12px 0}
#agent-accounts p{margin:8px 0;line-height:1.6}#agent-accounts button{background:#334155;border-radius:10px;padding:10px 14px;margin:3px;color:white;font-weight:600}
#agent-accounts button.ga-primary{background:#4f46e5}#agent-accounts button:disabled{opacity:.45;cursor:wait}
#agent-accounts input,#agent-accounts textarea,#agent-accounts select{background:#020617;border:1px solid #475569;border-radius:10px;color:white;padding:10px;width:100%}
#agent-accounts textarea{font-family:inherit;line-height:1.6}#agent-accounts label{display:block;margin:10px 0 6px;font-weight:600}
#agent-accounts table{width:100%;text-align:left;border-collapse:collapse}#agent-accounts td,#agent-accounts th{border-bottom:1px solid #334155;padding:10px;vertical-align:middle;overflow-wrap:anywhere}
#agent-accounts th{color:#94a3b8;white-space:nowrap}#agent-accounts .ga-muted{color:#94a3b8}#agent-accounts .ga-warning{color:#fcd34d;white-space:pre-wrap}
#agent-accounts .ga-scroll{overflow-x:auto}#agent-accounts .ga-flex{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
#agent-accounts .ga-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}#agent-accounts .ga-summary{background:#1e293b;border-radius:12px;padding:12px;margin:12px 0}
#agent-accounts .ga-note{background:#312e8155;border:1px solid #6366f155;border-radius:12px;padding:12px}#agent-accounts .ga-error{color:#fda4af}
@media(max-width:600px){#agent-accounts .ga-card{padding:16px}#agent-accounts .ga-grid{grid-template-columns:1fr}#agent-accounts td,#agent-accounts th{padding:7px}}
</style><div class="ga-card"><div class="ga-flex"><div><h2 id="ga-title">홍보요원 계정 관리</h2><p id="ga-context" class="ga-muted"></p></div><button id="ga-close">닫기</button></div>
<div id="ga-camp-picker" class="ga-hidden"><label for="ga-camp">관리할 캠프</label><select id="ga-camp"></select></div>
<p id="ga-message" class="ga-warning" role="status" aria-live="polite"></p><div id="ga-capacity" class="ga-summary"></div>
<section id="ga-list-panel"><div class="ga-flex"><div><h3>우리 캠프 홍보요원</h3><p class="ga-muted">발급된 ID를 확인하거나 비밀번호 재발급·사용 중지를 선택하세요.</p></div><button id="ga-bulk" class="ga-primary">+ 홍보요원 한꺼번에 발급</button></div>
<label for="ga-search">이름 또는 ID로 찾기</label><input id="ga-search" placeholder="이름, ID, 전화번호 검색"><p id="ga-list-count" class="ga-muted"></p>
<div class="ga-scroll"><table><thead><tr><th>이름 / 로그인 ID</th><th>배정 전화번호</th><th>계정 상태</th><th>관리</th></tr></thead><tbody id="ga-list"></tbody></table></div>
<div class="ga-flex"><div><button id="ga-list-prev">이전</button><span id="ga-list-page"></span><button id="ga-list-next">다음</button></div><button id="ga-reload">목록 새로고침</button></div></section>
<section id="ga-input-panel" class="ga-hidden"><h3>1. 이름과 배정 전화번호 입력</h3><p class="ga-note">엑셀의 <strong>이름 · 배정 전화번호</strong> 두 열만 복사해 아래에 붙여넣으세요.<br>ID와 6자리 임시 비밀번호는 자동으로 만들어 드립니다. 최대 2,000명까지 처리합니다.</p>
<div class="ga-flex"><button id="ga-template">엑셀 입력 양식 받기</button><label style="font-weight:400;margin:0">엑셀·CSV 파일로 가져오기<input id="ga-file" type="file" accept=".xlsx,.xls,.csv,.tsv,.txt" style="padding:6px"></label></div>
<label for="ga-paste">요원 목록 (이름, 배정 전화번호)</label><textarea id="ga-paste" rows="6" placeholder="김영희,0419301001&#10;이철수,0419301002"></textarea>
<p class="ga-muted">이름과 전화번호를 쉼표로 구분해 한 줄에 한 명씩 직접 입력해도 됩니다. 전화번호는 앞의 0을 포함해 입력하세요.</p>
<button id="ga-preview" class="ga-primary">다음 · 발급할 목록 확인</button><button id="ga-input-back">취소 · 목록으로</button></section>
<section id="ga-preview-panel" class="ga-hidden"><h3>2. 발급할 목록 확인</h3><p id="ga-preview-summary" class="ga-summary"></p><p id="ga-preview-error" class="ga-error" role="alert"></p>
<div class="ga-scroll"><table><thead><tr><th>번호</th><th>이름</th><th>전화번호</th><th>자동 생성 ID</th><th>처리 내용</th></tr></thead><tbody id="ga-preview-rows"></tbody></table></div>
<div><button id="ga-preview-prev">이전</button><span id="ga-preview-page"></span><button id="ga-preview-next">다음</button></div>
<p class="ga-muted">이미 발급된 계정은 비밀번호를 바꾸지 않습니다. 발급하는 인원과 캠프를 확인한 뒤 진행하세요.</p><button id="ga-issue" class="ga-primary">계정 일괄 발급</button><button id="ga-edit">입력 수정</button></section>
<section id="ga-results-panel" class="ga-hidden"><h3 id="ga-result-title">3. 발급 결과</h3><p id="ga-progress" class="ga-summary" role="status" aria-live="polite"></p><p class="ga-warning">임시 비밀번호는 이 화면을 닫으면 다시 조회할 수 없습니다. 파일로 저장하거나 해당 요원에게 개별 전달하세요.</p>
<button id="ga-export" class="ga-primary">발급 명세 엑셀 저장</button>
<div class="ga-scroll"><table><thead><tr><th>이름 / ID</th><th>처리 결과</th><th>임시 비밀번호</th><th>전달</th></tr></thead><tbody id="ga-results"></tbody></table></div>
<div><button id="ga-result-prev">이전</button><span id="ga-result-page"></span><button id="ga-result-next">다음</button></div><button id="ga-results-back">확인 · 요원 목록으로</button></section>
<section id="ga-confirm-panel" class="ga-hidden"><h3 id="ga-action-title"></h3><p id="ga-action-text"></p><button id="ga-action-confirm" class="ga-primary">확인</button><button id="ga-action-cancel">취소</button></section>
<div id="ga-guide-panel" class="ga-note ga-hidden"><h3>개별 전달 안내</h3><textarea id="ga-guide" readonly rows="7" aria-label="요원에게 전달할 로그인 안내"></textarea><button id="ga-copy" class="ga-primary">이 요원 안내 복사</button><button id="ga-guide-close">안내 접기</button><p class="ga-muted">문자·카카오톡 등의 개인 메시지로 해당 요원에게 전달하세요. 자동 발송은 하지 않습니다.</p></div>
</div>`;document.body.append(box);
let snapshot=null,campId='',busy=false,epoch=0,plan=null,results=[],selected=null,listPage=1,previewPage=1,resultPage=1,returnFocus=null;
const allowed=()=>verifiedIdentity&&['admin','super'].includes(verifiedIdentity.role)&&!sessionStorage.getItem('easycall_master_impersonator');
const actor=()=>[verifiedIdentity?.uid,verifiedIdentity?.role,verifiedIdentity?.campId].join(':');
function valid(ticket,who){return ticket===epoch&&who===actor()&&allowed()&&!box.classList.contains('ga-hidden');}
const say=s=>{$('ga-message').textContent=s;};
function panel(n){for(const p of ['list','input','preview','results','confirm'])$('ga-'+p+'-panel').classList.toggle('ga-hidden',p!==n);$('ga-guide-panel').classList.add('ga-hidden');$('ga-guide').value='';}
function lock(v){busy=v;for(const el of box.querySelectorAll('button,input,textarea,select'))el.disabled=v;$('ga-guide').disabled=false;if(!v){$('ga-issue').disabled=!plan||!plan.eligible.length||plan.errors>0||plan.overQuota;$('ga-export').disabled=!results.some(r=>r.success&&r.password);if(snapshot)drawList();if(plan)drawPreview();drawResults();}}
function hasSecrets(){return results.some(r=>r.success&&r.password);}
function mayDiscard(){return !hasSecrets()||confirm('발급 명세를 저장하거나 전달하셨습니까? 계속하면 표시된 임시 비밀번호가 지워집니다.');}
function clearSecrets(){results=[];$('ga-results').innerHTML='';$('ga-guide').value='';$('ga-guide-panel').classList.add('ga-hidden');}
function capacity(){const s=snapshot;$('ga-capacity').textContent=s?'등록 단말 '+s.registered+' / '+s.limit+'명 · 신규 등록 가능 '+s.remaining+'명 · 계정 발급 '+s.accounts.filter(a=>a.hasAccount).length+'명':'등록 가능 인원을 확인하는 중입니다.';}
async function load(){const ticket=epoch,who=actor(),cid=campId;const {data,error}=await sbClient.rpc('easycall_agent_accounts',{p_camp:cid});if(!valid(ticket,who))return false;if(error)throw Error('요원 목록을 불러오지 못했습니다. 목록 새로고침으로 다시 시도하세요.');if(!data||data.campId!==cid||!Array.isArray(data.accounts))throw Error('캠프 계정 정보를 확인할 수 없습니다. 다시 로그인하세요.');snapshot=data;capacity();drawList();return true;}
async function refresh(){if(busy)return;lock(true);say('요원 목록을 불러오는 중입니다.');try{if(await load())say('');}catch(e){snapshot=null;capacity();$('ga-list').innerHTML='';say(e.message);}finally{lock(false);}}
function paging(id,page,total){const pages=Math.max(1,Math.ceil(total/50));$(id+'-page').textContent=page+' / '+pages+'페이지';$(id+'-prev').disabled=busy||page<=1;$(id+'-next').disabled=busy||page>=pages;}
function listRows(){const q=$('ga-search').value.trim().toLowerCase();return (snapshot?.accounts||[]).filter(r=>[r.name,r.loginId,r.phone].join(' ').toLowerCase().includes(q));}
function drawList(){const all=listRows();listPage=Math.max(1,Math.min(listPage,Math.ceil(all.length/50)||1));$('ga-list-count').textContent='검색 '+all.length+'명 / 전체 '+(snapshot?.accounts.length||0)+'명';
 $('ga-list').innerHTML=all.slice((listPage-1)*50,listPage*50).map(r=>{const i=snapshot.accounts.indexOf(r),b=(action,label)=>`<button data-ga-action="${action}" data-ga-index="${i}">${label}</button>`;
 const status=!r.hasAccount?'계정 미발급':r.status==='disabled'?'사용 중지':r.status==='pending'?'발급 확인 필요':'사용 중';
 return `<tr><td><strong>${esc(r.name)}</strong><div class="ga-muted">${esc(r.loginId)}</div></td><td>${esc(r.phone||'-')}</td><td>${status}${r.initialPassword?'<div class="ga-muted">임시 비밀번호 사용 중</div>':''}${r.legacy?'<div class="ga-muted">기존 이메일 계정</div>':''}</td><td>${!r.hasAccount?b('issue','계정 발급'):b('guide','로그인 안내')+(r.legacy?'':b('reset',r.status==='pending'?'발급 복구':'비밀번호 재발급')+(r.status==='pending'?'':b(r.status==='disabled'?'enable':'disable',r.status==='disabled'?'사용 재개':'사용 중지')))}</td></tr>`;}).join('')||'<tr><td colspan="4">등록된 요원이 없습니다. “홍보요원 한꺼번에 발급”에서 시작하세요.</td></tr>';paging('ga-list',listPage,all.length);}
function drawPreview(){if(!plan)return;const count=plan.rows.length;previewPage=Math.max(1,Math.min(previewPage,Math.ceil(count/50)||1));
 $('ga-preview-summary').textContent='입력 '+count+'명 · 발급 대상 '+plan.eligible.length+'명 · 기존/중복 제외 '+plan.skipped+'명 · 입력 오류 '+plan.errors+'명';
 $('ga-preview-error').textContent=plan.overQuota?'신규 등록 '+plan.newCount+'명이 잔여 한도 '+snapshot.remaining+'명을 초과합니다. 인원을 줄이거나 본사에 한도 증설을 요청하세요.':plan.errors?'오류가 있는 행을 수정한 뒤 다시 확인해 주세요.':'';
 $('ga-preview-rows').innerHTML=plan.rows.slice((previewPage-1)*50,previewPage*50).map(r=>`<tr><td>${r.line}</td><td>${esc(r.name)}</td><td>${esc(r.phone)}</td><td>${esc(r.loginId||'-')}</td><td class="${r.kind==='error'?'ga-error':'ga-muted'}">${esc(r.message)}</td></tr>`).join('');
 $('ga-issue').textContent=plan.eligible.length+'명 계정 발급';$('ga-issue').disabled=busy||!plan.eligible.length||plan.errors>0||plan.overQuota;paging('ga-preview',previewPage,count);}
function drawResults(){resultPage=Math.max(1,Math.min(resultPage,Math.ceil(results.length/50)||1));$('ga-results').innerHTML=results.slice((resultPage-1)*50,resultPage*50).map((r,index)=>`<tr><td>${esc(r.name)}<div class="ga-muted">${esc(r.loginId)}</div></td><td class="${r.success?'':'ga-error'}">${r.success?'발급 완료':esc(r.error||'결과 확인 필요')}</td><td><strong>${esc(r.password||'-')}</strong></td><td>${r.success&&r.password?`<button data-ga-result="${(resultPage-1)*50+index}">개별 전달 안내</button>`:''}</td></tr>`).join('');$('ga-export').disabled=busy||!hasSecrets();paging('ga-result',resultPage,results.length);}
function guide(row){$('ga-guide').value=deliveryText(campId,{...row,loginId:row.legacy?row.email:row.loginId},location.origin+location.pathname);$('ga-guide-panel').classList.remove('ga-hidden');$('ga-guide').focus();}
function download(rows,name){if(window.XLSX){const sheet=window.XLSX.utils.aoa_to_sheet(rows.map(r=>r.map(v=>String(v??''))));for(const key of Object.keys(sheet))if(!key.startsWith('!')){sheet[key].t='s';sheet[key].z='@';delete sheet[key].f;}sheet['!cols']=rows[0].map(()=>({wch:24}));const wb=window.XLSX.utils.book_new();window.XLSX.utils.book_append_sheet(wb,sheet,'계정 발급 명세');window.XLSX.writeFile(wb,name+'.xlsx');}else{const url=URL.createObjectURL(new Blob([spreadsheetXml(rows)],{type:'application/xml;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download=name+'.xml';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}}
window.openAgentAccounts=async function(id){
 if(!allowed()){showToast('본인 캠프 관리자 계정으로 로그인하세요.');return;}if(busy||!mayDiscard())return;
 returnFocus=document.activeElement;epoch++;clearSecrets();snapshot=null;plan=null;selected=null;listPage=previewPage=resultPage=1;
 campId=verifiedIdentity.role==='admin'?verifiedIdentity.campId:(typeof id==='string'?id:campsList[0]?.campId||'');
 $('ga-search').value='';$('ga-camp-picker').classList.toggle('ga-hidden',verifiedIdentity.role!=='super');
 $('ga-camp').innerHTML=(campsList||[]).map(c=>`<option value="${esc(c.campId)}">${esc(c.name)} (${esc(c.campId)})</option>`).join('');$('ga-camp').value=campId;
 $('ga-context').textContent=(campsList.find(c=>c.campId===campId)?.name||'우리 캠프')+' · 캠프 ID: '+campId;
 box.classList.remove('ga-hidden');panel('list');if(!campId){say('먼저 관리할 캠프를 등록해 주세요.');lock(true);$('ga-close').disabled=false;busy=false;return;}
 await refresh();$('ga-close').focus();
};
$('ga-camp').onchange=()=>window.openAgentAccounts($('ga-camp').value);
function close(){if(busy||!mayDiscard())return;epoch++;clearSecrets();snapshot=null;plan=null;box.classList.add('ga-hidden');$('ga-paste').value='';$('ga-file').value='';returnFocus?.focus?.();}
$('ga-close').onclick=close;$('ga-reload').onclick=refresh;
$('ga-bulk').onclick=()=>{if(!snapshot){say('먼저 목록 새로고침으로 캠프 정보를 확인하세요.');return;}if(!mayDiscard())return;clearSecrets();plan=null;$('ga-paste').value='';$('ga-file').value='';panel('input');say('');$('ga-paste').focus();};
$('ga-input-back').onclick=()=>{panel('list');say('');};
$('ga-template').onclick=()=>download([['이름','배정 전화번호']],'홍보요원_입력양식');
$('ga-file').onchange=async()=>{const file=$('ga-file').files[0];if(!file)return;if(file.size>5*1024*1024){say('파일은 5MB 이하로 선택하세요.');return;}lock(true);try{let data;if(/\.xlsx?$/i.test(file.name)){if(!window.XLSX)throw Error('엑셀 읽기를 준비하지 못했습니다. 엑셀의 두 열을 복사해 직접 붙여넣으세요.');const wb=window.XLSX.read(await file.arrayBuffer(),{type:'array'});const rows=window.XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{header:1,defval:'',raw:false});data=rows.map(r=>r.join('\t')).join('\n');}else data=await file.text();$('ga-paste').value=data;say('파일을 가져왔습니다. “다음 · 발급할 목록 확인”을 눌러 주세요.');}catch(e){say(e.message);}finally{lock(false);}};
$('ga-preview').onclick=async()=>{if(busy)return;lock(true);say('기존 계정과 등록 가능 인원을 확인하는 중입니다.');try{if(!await load())return;plan=previewAgentRows($('ga-paste').value,snapshot);if(!plan.rows.length)throw Error('이름과 배정 전화번호를 먼저 입력하세요.');previewPage=1;panel('preview');drawPreview();say('');}catch(e){say(e.message);}finally{lock(false);drawPreview();}};
$('ga-edit').onclick=()=>{plan=null;panel('input');say('');};
$('ga-issue').onclick=async()=>{
 if(busy||!plan||!plan.eligible.length||plan.errors||plan.overQuota||!allowed())return;const ticket=epoch,who=actor(),cid=campId,queue=plan.eligible.map(r=>({...r}));lock(true);clearSecrets();resultPage=1;panel('results');say('');$('ga-result-title').textContent='3. 발급 결과';
 for(let i=0;i<queue.length;i+=25){
  if(!valid(ticket,who))break;const chunk=queue.slice(i,i+25);$('ga-progress').textContent=results.length+' / '+queue.length+'명 처리 중 · 창을 닫지 마세요.';
  try{const {data,error}=await sbClient.functions.invoke('easycall-work-accounts',{body:{action:'create',rows:chunk.map(r=>({campId:cid,role:'agent',loginId:r.loginId,alias:r.name,phone:r.phone}))}});
   if(!valid(ticket,who))break;if(error||data?.error||!Array.isArray(data?.results)||data.results.length!==chunk.length)throw Error('서버 응답을 확인하지 못했습니다.');
   for(let j=0;j<chunk.length;j++){const reply=data.results[j];if(reply.loginId!==chunk[j].loginId)throw Error('계정 응답이 일치하지 않습니다.');results.push({...chunk[j],success:reply.success===true&&typeof reply.password==='string',password:reply.success?reply.password:undefined,error:reply.error||'결과 확인 필요'});}
   drawResults();
  }catch(e){if(!valid(ticket,who))break;const completed=new Set(results.map(r=>r.loginId));for(const r of chunk)if(!completed.has(r.loginId))results.push({...r,success:false,error:'결과 확인 필요 · 목록 확인 후 재발급'});say('응답 확인이 중단됐습니다. 성공한 명세를 먼저 저장하고 요원 목록에서 나머지 계정을 확인하세요. 같은 목록을 바로 다시 발급하지 마세요.');drawResults();break;}
 }
 if(valid(ticket,who)){$('ga-progress').textContent='발급 완료 '+results.filter(r=>r.success).length+'명 / 확인 필요 '+results.filter(r=>!r.success).length+'명 / 미처리 '+(queue.length-results.length)+'명';lock(false);drawResults();}
};
$('ga-export').onclick=()=>download([['캠프 ID','이름','로그인 ID','임시 비밀번호','배정 전화번호'],...results.filter(r=>r.success&&r.password).map(r=>[campId,r.name,r.loginId,r.password,r.phone])],'홍보요원_계정발급_'+campId);
$('ga-results').onclick=e=>{const b=e.target.closest('[data-ga-result]');if(b&&!busy){const r=results[Number(b.dataset.gaResult)];if(r?.success)guide(r);}};
$('ga-copy').onclick=async()=>{try{await navigator.clipboard.writeText($('ga-guide').value);say('이 요원의 로그인 안내를 복사했습니다. 개인 메시지로 전달하세요.');}catch{$('ga-guide').focus();$('ga-guide').select();say('안내를 선택했습니다. 직접 복사해 주세요.');}};
$('ga-guide-close').onclick=()=>{$('ga-guide').value='';$('ga-guide-panel').classList.add('ga-hidden');};
$('ga-results-back').onclick=async()=>{if(busy||!mayDiscard())return;clearSecrets();plan=null;panel('list');await refresh();};
$('ga-list').onclick=e=>{const b=e.target.closest('[data-ga-action]');if(!b||busy||!snapshot)return;const r=snapshot.accounts[Number(b.dataset.gaIndex)],action=b.dataset.gaAction;if(!r)return;
 if(action==='guide'){guide(r);return;}
 if(action==='issue'){if(!/^[a-z0-9_-]{1,32}$/.test(r.loginId||'')){say('기존 단말 ID 형식이 로그인 ID 기준(영문·숫자·밑줄·하이픈 1~32자)에 맞지 않습니다. 본사에 확인하세요.');return;}plan={rows:[{...r,line:1,kind:'registered',message:'등록된 단말기에 로그인 계정 발급'}],eligible:[r],newCount:0,errors:0,overQuota:false,skipped:0};previewPage=1;panel('preview');drawPreview();say('');return;}
 selected={row:r,action};panel('confirm');$('ga-action-title').textContent=action==='reset'?'비밀번호 재발급':action==='disable'?'요원 사용 중지':'요원 사용 재개';
 $('ga-action-text').textContent='대상: '+r.name+' / '+r.loginId+' · 캠프 '+campId+'\n'+(action==='reset'?'기존 비밀번호를 새 숫자 6자리로 바꿉니다. 새 비밀번호를 이 요원에게 전달하세요.':action==='disable'?'이 요원의 업무 접근을 차단합니다. 추후 사용 재개가 가능합니다.':'이 요원의 업무 접근을 다시 허용합니다.');say('');
};
$('ga-action-cancel').onclick=()=>{selected=null;panel('list');say('');};
$('ga-action-confirm').onclick=async()=>{if(busy||!selected||!allowed())return;const target=selected,ticket=epoch,who=actor();lock(true);say('처리 중입니다.');
 try{const {data,error}=await sbClient.functions.invoke('easycall-work-accounts',{body:{action:target.action,campId,loginId:target.row.loginId,role:'agent'}});
 if(!valid(ticket,who))return;if(error||data?.error)throw Error(data?.error||'서버 응답을 확인하지 못했습니다. 목록을 새로고침하세요.');
 if(target.action==='reset'){if(typeof data?.password!=='string')throw Error('비밀번호 응답이 없습니다. 목록에서 상태를 확인하세요.');results=[{...target.row,success:true,password:data.password}];resultPage=1;panel('results');$('ga-result-title').textContent='비밀번호 재발급 완료';$('ga-progress').textContent='1명 재발급 완료';drawResults();say('');}
 else{panel('list');await load();say(target.action==='disable'?'요원 사용을 중지했습니다.':'요원 사용을 재개했습니다.');}
 }catch(e){if(valid(ticket,who)){panel('list');say(e.message);}}finally{if(valid(ticket,who)){selected=null;lock(false);drawList();drawResults();}}};
$('ga-search').oninput=()=>{listPage=1;drawList();};
for(const [prefix,get,set,draw,total] of [
 ['ga-list',()=>listPage,v=>listPage=v,drawList,()=>listRows().length],
 ['ga-preview',()=>previewPage,v=>previewPage=v,drawPreview,()=>plan?.rows.length||0],
 ['ga-result',()=>resultPage,v=>resultPage=v,drawResults,()=>results.length]]){
 $(prefix+'-prev').onclick=()=>{if(busy)return;set(Math.max(1,get()-1));draw();};$(prefix+'-next').onclick=()=>{if(busy)return;set(Math.min(Math.ceil(total()/50)||1,get()+1));draw();};
}
for(const [view,oldLabel] of [['admin-view','업무용 계정 발급·관리'],['super-view','홍보요원 대량 발급']])for(const b of document.querySelectorAll('#'+view+' button'))if(b.textContent===oldLabel){b.textContent='홍보요원 계정 관리';b.onclick=()=>window.openAgentAccounts();}
const previousOpen=window.openWorkAccounts;window.openWorkAccounts=function(id){if(verifiedIdentity?.role==='admin')return window.openAgentAccounts();return previousOpen(id);};
const logout=window.handleLogout;window.handleLogout=async function(...args){epoch++;clearSecrets();plan=null;snapshot=null;busy=false;box.classList.add('ga-hidden');return logout(...args);};
box.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();close();}if(e.key==='Tab'){const controls=Array.from(box.querySelectorAll('button,input,textarea,select')).filter(el=>!el.disabled&&el.getClientRects().length),first=controls[0],last=controls.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}});
