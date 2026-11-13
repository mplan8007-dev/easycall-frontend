import './admin-console.js';

(() => {
 'use strict';
 const $=id=>document.getElementById(id),esc=escapeHTML;
 const legacy={activate:window.activateVerifiedUser,account:window.openMyAccount,logs:window.renderAdminLogsTable,search:window.renderAgentSearchTable,history:window.renderAgentHistoryTable,queue:window.updateVoterQueueStatusText,report:window.openBriefingReportModal};
 const pages={camp:null,voters:{offset:0,total:0,items:[],key:'',seq:0},logs:{offset:0,total:0,items:[],seq:0,asOf:null},history:{offset:0,total:0,items:[],seq:0,asOf:null}};
 const mfa={busy:false,factor:null,enrolling:false,resume:false,required:false,epoch:0};
 const count={};
 const selectedVoters=new Map();let editDraft=null,contactBusy=false,mutationKey='',mutationId='';
 const text=(id,v)=>{if($(id))$(id).textContent=String(v??'');};
 const delegated=()=>verifiedIdentity?.role==='super'&&Boolean(sessionStorage.getItem('easycall_master_impersonator'));
 const rpc=async(name,args={})=>{if(!sbClient||navigator.onLine===false)throw Error('온라인 연결이 필요합니다.');const r=await sbClient.rpc(name,args);if(r.error)throw r.error;return r.data;};
 const error=e=>showToast(e?.message||'요청을 완료하지 못했습니다.');
 function resetCamp(cid){if(pages.camp===cid)return;clearContactSelection();closeContactEditor();pages.camp=cid;for(const p of [pages.voters,pages.logs,pages.history]){p.offset=0;p.total=0;p.items=[];p.seq++;p.asOf=null;p.key='';}}
 const adminVoters=()=>verifiedIdentity?.role==='admin'||delegated();
 const voterQuery=()=>($(adminVoters()?'admin-voter-search':'agent-voter-search')?.value||'').trim();
 function params(kind){return {p_camp_id:pages.camp,p_kind:kind,p_offset:pages[kind].offset,p_limit:50,p_query:kind==='voters'?voterQuery():'',p_callback:kind==='voters'&&!adminVoters()&&searchFilterMode==='CALLBACK_ONLY',p_as_of:pages[kind].asOf||null};}
 async function loadPage(kind){
  const p=pages[kind],cid=pages.camp,ticket=++p.seq;
  p.loading=true;drawPager(kind);
  try{
   const args=params(kind);let response;
   if(kind==='voters'&&adminVoters())response=await rpc('easycall_admin_voter_page',{p_camp_id:cid,p_offset:p.offset,p_limit:50,p_query:args.p_query,p_status:$('admin-voter-status')?.value||''});
   else response=await rpc('easycall_list_page',args);
   if(cid!==pages.camp||ticket!==p.seq)return;
   if(p.offset>0&&p.offset>=response.total){p.offset=Math.max(0,Math.ceil(response.total/50)-1)*50;return await loadPage(kind);}
   Object.assign(p,{failed:false,items:response.items||[],total:Number(response.total)||0,asOf:kind==='voters'?null:response.asOf});
   p.loading=false;renderPage(kind);
  }catch(e){if(ticket===p.seq){p.failed=true;p.items=[];p.loading=false;renderPage(kind);error(e);}throw e;}
  finally{if(ticket===p.seq){p.loading=false;drawPager(kind);}}
 }
 async function easycallLoadLists(cid){
  resetCamp(cid);
  const kind=verifiedIdentity?.role==='agent'?'history':'logs';
  const results=await Promise.all([loadPage('voters'),loadPage(kind),rpc('easycall_camp_counts',{p_camp_id:cid})]);
  if(cid!==pages.camp)return {voters:[],logs:[]};
  count[cid]=results[2];renderAggregateStats();
  return {voters:pages.voters.items,logs:pages[kind].items};
 }
 function drawPager(kind){const p=pages[kind],id='pager-'+kind,el=$(id);if(!el)return;const total=p.total,pn=Math.floor(p.offset/50)+1,last=Math.max(1,Math.ceil(total/50));
  text(id+'-status',p.loading?'조회 중…':p.failed?'조회 실패 · 새로고침으로 다시 시도':`${total.toLocaleString()}건 · ${pn}/${last}페이지 · 50개씩`);
  $(id+'-prev').disabled=Boolean(p.loading)||p.offset===0;$(id+'-next').disabled=Boolean(p.loading)||p.offset+50>=total;
  if(kind==='voters'){text('admin-voters-page',p.loading?'조회 중…':p.failed?'조회 실패 · 다시 조회하세요.':`${total.toLocaleString()}건 · ${pn}/${last}페이지 · 50개씩`);if($('admin-voters-prev'))$('admin-voters-prev').disabled=Boolean(p.loading)||p.offset===0;if($('admin-voters-next'))$('admin-voters-next').disabled=Boolean(p.loading)||p.offset+50>=total;}

 }
 function mapVoter(r){return {id:String(r.voter_id),campId:r.camp_id,name:r.name,phone:r.phone,dong:r.dong,lastResult:r.last_result,lastMemo:r.last_memo,lockedBy:r.locked_by};}
 function renderPage(kind){
  const p=pages[kind];
  if(kind==='logs'){
   const previous=globalCampCallLogs;globalCampCallLogs=p.items.map(logFromRow);try{legacy.logs();}finally{globalCampCallLogs=previous;}
   text('admin-total-calls',p.total.toLocaleString()+'건');
  }else if(kind==='history'){
   const previous=globalCampCallLogs;globalCampCallLogs=p.items.map(logFromRow);try{legacy.history();}finally{globalCampCallLogs=previous;}
   $('agent-history-tbody')?.querySelectorAll?.('tr').forEach((row,i)=>{if(row.cells?.length>1)row.cells[0].textContent=String(p.total-p.offset-i);});
   renderAggregateStats();
  }else if(adminVoters()){
   const labels={READY:'미통화',CONNECTED:'통화 완료',ABSENT:'부재중',CALLBACK:'재통화',REJECT:'수신거부',INVALID:'결번'};
   text('admin-voters-camp','캠프 '+pages.camp+' · 서버에 저장된 명부');
   renderAdminVoterRows(p,labels);
  }else{
   const previous=votersList,search=$('agent-voter-search'),q=search?.value;
   votersList=p.items.map(mapVoter);if(search)search.value='';
   try{legacy.search();}finally{votersList=previous;if(search)search.value=q;}
  }
  if(p.failed){const id=kind==='voters'?'agent-search-voters-tbody':kind==='logs'?'admin-all-logs-tbody':'agent-history-tbody';if($(id))$(id).innerHTML='<tr><td colspan="11" class="p-6 text-center text-rose-600">목록을 불러오지 못했습니다. 새로고침 후 다시 시도하세요.</td></tr>';}
  if(kind==='voters'&&p.failed&&adminVoters()&&$('admin-voters-tbody'))$('admin-voters-tbody').innerHTML='<tr><td colspan="9" class="p-5 text-center text-rose-600">명부 조회 실패 · 새로고침으로 다시 시도하세요.</td></tr>';
  drawPager(kind);
 }
 function renderAggregateStats(){
  const c=count[pages.camp];if(!c)return;
  const groups=c.groups||[],sum=fn=>groups.filter(fn).reduce((n,g)=>n+Number(g.n),0),total=Number(c.logs.total)||0;
  const connected=sum(g=>g.callResult==='CONNECTED'),pct=(n,d)=>d?Math.round(n/d*100):0;
  text('admin-total-calls',total.toLocaleString()+'건');text('my-stat-total',total.toLocaleString()+'건');
  for(const [key,result] of [['success','CONNECTED'],['absent','ABSENT'],['callback','CALLBACK'],['reject','REJECT'],['invalid','INVALID']]){const n=sum(g=>g.callResult===result);text('stat-conn-'+key,n.toLocaleString()+'건 ('+pct(n,total)+'%)');}
  for(const status of ['SUPPORT','FAVORABLE','VOLUNTEER','OPPOSE']){const n=sum(g=>g.callResult==='CONNECTED'&&g.status===status),key=status.toLowerCase();text('stat-'+key+'-txt',n.toLocaleString()+'건 ('+pct(n,connected)+'%)');text('my-stat-'+key,n.toLocaleString()+'건');if($('bar-'+key))$('bar-'+key).style.width=pct(n,connected)+'%';}
  text('my-stat-unconnected',sum(g=>g.callResult!=='CONNECTED').toLocaleString()+'건');
  const positive=g=>g.callResult==='CONNECTED'&&['SUPPORT','FAVORABLE','VOLUNTEER'].includes(g.status);
  if($('gender-cross-chart'))$('gender-cross-chart').innerHTML=['남성','여성','미상'].map(g=>{const n=sum(r=>r.callResult==='CONNECTED'&&r.gender===g),pos=sum(r=>r.gender===g&&positive(r));return '<div class="p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs">'+esc(g)+' '+n.toLocaleString()+'건 · 긍정 '+pos.toLocaleString()+'건 ('+pct(pos,n)+'%)</div>';}).join('');
  if($('dong-performance-list'))$('dong-performance-list').innerHTML=[...new Set(groups.map(g=>g.dong))].map(d=>{const n=sum(g=>g.dong===d),con=sum(g=>g.dong===d&&g.callResult==='CONNECTED'),pos=sum(g=>g.dong===d&&positive(g));return '<div class="p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs">'+esc(d)+' · '+n.toLocaleString()+'시도 / '+con.toLocaleString()+'연결 · 긍정 '+pct(pos,con)+'%</div>';}).join('')||'아직 데이터가 없습니다.';
  if($('agent-performance-list'))$('agent-performance-list').innerHTML=(c.agents||[]).map(a=>'<div class="p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs">'+esc(a.agentId)+' · 총 '+Number(a.total).toLocaleString()+'건 / 연결 '+Number(a.connected).toLocaleString()+'건</div>').join('')||'실적이 없습니다.';
  const mine=c.agents?.find(a=>a.agentId===currentAgentId),goal=Number(getCampConfig(pages.camp).dailyGoal)||250,n=Number(mine?.today)||0;
  text('agent-goal-txt',n.toLocaleString()+' / '+goal.toLocaleString()+'건 ('+Math.min(100,pct(n,goal))+'%) · 오늘');if($('agent-goal-bar'))$('agent-goal-bar').style.width=Math.min(100,pct(n,goal))+'%';
 }
 async function changeDataPage(kind,delta){if(!pages[kind]||pages[kind].loading||contactBusy)return;if(kind==='voters')clearContactSelection();pages[kind].failed=false;pages[kind].offset=Math.max(0,pages[kind].offset+delta*50);try{await loadPage(kind);}catch(e){}}
 async function easycallLoadCounts(){const cid=pages.camp;if(!cid)return;const data=await rpc('easycall_camp_counts',{p_camp_id:cid});if(cid!==pages.camp)return;count[cid]=data;renderAggregateStats();}
 async function refreshDataPage(kind){if(!pages[kind])return;if(kind==='voters'){clearContactSelection();clearTimeout(searchTimer);resetCamp(getActiveCampId());pages.voters.key=JSON.stringify([voterQuery(),adminVoters()?('ALL:'+($('admin-voter-status')?.value||'')):searchFilterMode]);}if(pages[kind].loading)return;pages[kind].offset=0;pages[kind].asOf=null;pages[kind].failed=false;try{await loadPage(kind);if(kind==='history')await easycallLoadCounts();}catch(e){}}
 let searchTimer;
 function renderAgentSearchTable(){
  if(!pages.camp){legacy.search();return;}
  const key=JSON.stringify([voterQuery(),adminVoters()?('ALL:'+($('admin-voter-status')?.value||'')):searchFilterMode]);
  if(key===pages.voters.key){renderPage('voters');return;}
  clearContactSelection();pages.voters.key=key;pages.voters.offset=0;pages.voters.seq++;clearTimeout(searchTimer);
  searchTimer=setTimeout(()=>{pages.voters.failed=false;loadPage('voters').catch(()=>{});},250);
 }
 function renderAdminLogsTable(){if(pages.camp===getActiveCampId())renderPage('logs');else legacy.logs();}
 function renderAgentHistoryTable(){if(pages.camp===getActiveCampId())renderPage('history');else legacy.history();}
 function updateVoterQueueStatusText(){const c=count[getActiveCampId()];if(!c){legacy.queue();return;}text('voter-queue-status',`총 ${c.voters.total.toLocaleString()}명 (미통화: ${c.voters.ready.toLocaleString()} / 콜백대기: ${c.voters.callback.toLocaleString()}) · 서버 전체 기준`);}
 function easycallAgentCallCount(id){return Number(count[pages.camp]?.agents?.find(a=>String(a.agentId).toLowerCase()===String(id).toLowerCase())?.total)||0;}
 function openBriefingReportModal(){
  legacy.report();const c=count[pages.camp];if(!c)return;const groups=c.groups||[],sum=fn=>groups.filter(fn).reduce((s,g)=>s+Number(g.n),0),total=Number(c.logs.total),con=sum(g=>g.callResult==='CONNECTED'),pct=(n,d)=>d?Math.round(n/d*100):0;
  text('report-date-txt','누적 전체 집계 · '+new Date(c.serverTime).toLocaleString('ko-KR')+' · 메모는 현재 조회 페이지 기준');
  text('report-camp-title',(campsList.find(c=>c.campId===pages.camp)?.name||'캠프')+' 누적 통화 상황보고서');
  text('rep-total',total+'건');text('rep-conn',con+'건 ('+pct(con,total)+'%)');const pos=sum(g=>g.callResult==='CONNECTED'&&['SUPPORT','FAVORABLE','VOLUNTEER'].includes(g.status));text('rep-pos',pos+'건 ('+pct(pos,con)+'%)');text('rep-cb',sum(g=>['ABSENT','CALLBACK'].includes(g.callResult))+'건');text('rep-dnc',sum(g=>g.callResult==='REJECT')+'건');
  $('rep-support-tbody').innerHTML=['SUPPORT','FAVORABLE','VOLUNTEER','OPPOSE'].map(s=>{const n=sum(g=>g.callResult==='CONNECTED'&&g.status===s);return '<tr><td class="p-2">'+formatSupportStatus(s,'CONNECTED')+'</td><td class="p-2 text-right">'+n+'건</td><td class="p-2 text-right">'+pct(n,con)+'%</td></tr>';}).join('');
  $('rep-dong-tbody').innerHTML=[...new Set(groups.map(g=>g.dong))].map(d=>{const n=sum(g=>g.dong===d),connected=sum(g=>g.dong===d&&g.callResult==='CONNECTED'),positive=sum(g=>g.dong===d&&g.callResult==='CONNECTED'&&['SUPPORT','FAVORABLE','VOLUNTEER'].includes(g.status));return '<tr><td class="p-2">'+esc(d)+'</td><td class="p-2 text-right">'+n+' / '+connected+'건</td><td class="p-2 text-right">'+pct(positive,connected)+'%</td></tr>';}).join('');
 }

 function mfaMessage(message){text('mfa-message',message);}
 function clearMfaSecret(){if($('mfa-qr'))$('mfa-qr').removeAttribute('src');text('mfa-secret','');if($('mfa-code'))$('mfa-code').value='';$('mfa-enrollment')?.classList.add('hidden');}
 async function factors(){const {data,error}=await sbClient.auth.mfa.listFactors();if(error)throw error;return (data.totp||[]).filter(f=>f.status==='verified');}
 async function openMfaSettings(){
  if(delegated()){error(Error('대리접속을 종료한 뒤 본인 계정에서 설정하세요.'));return;}
  clearMfaSecret();$('mfa-dialog')?.classList.remove('hidden');mfaMessage('인증 상태 확인 중…');
  try{
   const list=await factors(),level=await sbClient.auth.mfa.getAuthenticatorAssuranceLevel();if(level.error)throw level.error;
   const policy=await rpc('easycall_mfa_policy_status');mfa.required=Boolean(policy.required);
   text('mfa-factor-list',list.length?list.map((f,i)=>`${i+1}. ${f.friendly_name||'인증 앱'}`).join(' / '):'등록된 인증 앱이 없습니다.');
   const select=$('mfa-factor');if(select)select.innerHTML=list.map(f=>'<option value="'+esc(f.id)+'">'+esc(f.friendly_name||'인증 앱')+'</option>').join('');
   $('mfa-policy-controls')?.classList.toggle('hidden',verifiedIdentity?.role!=='super');
   text('mfa-policy-state',mfa.required?'최고관리자 MFA 필수 적용 중':'최고관리자 전체 필수 적용 꺼짐');
   text('mfa-policy-toggle',mfa.required?'전체 필수 적용 해제':'전체 필수 적용');
   mfaMessage(level.data.currentLevel==='aal2'?'2단계 인증된 세션입니다.':'인증 앱을 등록했으면 아래에서 인증하세요.');
  }catch(e){mfaMessage(e.message);}
 }
 async function activateVerifiedUser(){
  const level=await sbClient.auth.mfa.getAuthenticatorAssuranceLevel();if(level.error)throw level.error;
  const policy=await rpc('easycall_mfa_policy_status');
  if(level.data.currentLevel!=='aal2'&&(level.data.nextLevel==='aal2'||policy.required)){
   mfa.resume=true;await openMfaSettings();mfaMessage('로그인을 완료하려면 인증 앱의 6자리 코드를 입력하세요.');return;
  }
  mfa.resume=false;await legacy.activate();
 }
 async function startMfaEnrollment(){
  if(mfa.busy||delegated())return;if(mfa.enrolling){mfaMessage('진행 중인 등록을 완료하거나 취소한 뒤 다시 등록하세요.');return;}
  if(!confirm('본인 인증 앱에 이지콜 계정을 등록합니다. 기본 앱과 별도로 보조 기기에도 등록해 두세요. 진행하시겠습니까?'))return;
  mfa.busy=true;
  try{
   const {data,error}=await sbClient.auth.mfa.enroll({factorType:'totp',friendlyName:'이지콜 인증 앱 '+new Date().toLocaleString('ko-KR')});if(error)throw error;
   mfa.factor=data.id;mfa.enrolling=true;const qr=data.totp.qr_code;
   $('mfa-qr').src=qr.startsWith('data:image/')?qr:'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(qr);
   text('mfa-secret',data.totp.secret);$('mfa-enrollment').classList.remove('hidden');mfaMessage('본인 인증 앱으로 QR을 스캔하고 아래에 6자리 코드를 입력하세요. QR과 등록 키를 다른 사람에게 공유하지 마세요.');
  }catch(e){mfaMessage(e.message);}finally{mfa.busy=false;}
 }
 async function verifyMfaCode(){
  if(mfa.busy)return;const code=$('mfa-code').value.trim();if(!/^\d{6}$/.test(code)){mfaMessage('인증 앱의 6자리 숫자를 입력하세요.');return;}
  const factorId=mfa.enrolling?mfa.factor:$('mfa-factor').value;if(!factorId){mfaMessage('인증 앱을 먼저 등록하세요.');return;}
  mfa.busy=true;
  try{
   const {error}=await sbClient.auth.mfa.challengeAndVerify({factorId,code});if(error)throw error;
   clearMfaSecret();mfa.enrolling=false;mfa.factor=null;
   if(mfa.resume){$('mfa-dialog').classList.add('hidden');await activateVerifiedUser();}else{await openMfaSettings();mfaMessage('2단계 인증을 완료했습니다.');}
  }catch(e){mfaMessage('인증 실패: '+e.message);}finally{mfa.busy=false;}
 }
 async function closeMfa(){
  if(mfa.busy)return;
  if(mfa.enrolling&&mfa.factor){
   mfa.busy=true;try{const r=await sbClient.auth.mfa.unenroll({factorId:mfa.factor});if(r.error)throw r.error;mfa.enrolling=false;mfa.factor=null;}catch(e){mfaMessage('미완료 등록 취소 실패: '+e.message);return;}finally{mfa.busy=false;}
  }
  clearMfaSecret();$('mfa-dialog').classList.add('hidden');
  if(mfa.resume){mfa.resume=false;await sbClient.auth.signOut();}
 }
 async function toggleMfaPolicy(){
  if(mfa.busy||delegated())return;
  if(!confirm(mfa.required?'최고관리자 전체 MFA 필수 정책을 해제합니다. 등록된 인증 앱의 추가 인증은 계속 필요합니다. 진행하시겠습니까?':'모든 최고관리자에게 기본·보조 인증 앱 등록을 요구하며 이후 로그인에 2단계 인증이 필수가 됩니다. 진행하시겠습니까?'))return;
  const reason=prompt('정책 변경 사유를 입력하세요.');if(!reason?.trim())return;mfa.busy=true;
  try{await rpc('easycall_admin_mfa_policy',{p_required:!mfa.required,p_reason:reason.trim()});await openMfaSettings();}catch(e){mfaMessage(e.message);}finally{mfa.busy=false;}
 }

 function clearContactSelection(){selectedVoters.clear();mutationKey='';mutationId='';syncContactSelection();}
 function syncContactSelection(){
  const eligible=pages.voters.items.filter(r=>!r.locked_by&&r.updated_at);
  for(const [id,revision] of selectedVoters){if(!eligible.some(r=>String(r.voter_id)===id&&r.updated_at===revision))selectedVoters.delete(id);}
  text('admin-voters-selected',selectedVoters.size+'건 선택 · 현재 페이지');
  if($('admin-voters-delete-selected'))$('admin-voters-delete-selected').disabled=contactBusy||selectedVoters.size===0;
  if($('admin-voters-select-all')){const all=$('admin-voters-select-all');all.checked=eligible.length>0&&selectedVoters.size===eligible.length;all.indeterminate=selectedVoters.size>0&&selectedVoters.size<eligible.length;all.disabled=contactBusy||!eligible.length;}
 }
 function renderAdminVoterRows(p,labels){
  syncContactSelection();const body=$('admin-voters-tbody');if(!body)return;
  body.innerHTML=p.items.map((r,i)=>{
   const unavailable=Boolean(r.locked_by)||!r.updated_at||contactBusy,disabled=unavailable?' disabled':'';
   return '<tr><td class="p-3"><input type="checkbox" data-contact-select="'+i+'" aria-label="'+esc(r.name)+' 선택"'+disabled+(selectedVoters.has(String(r.voter_id))?' checked':'')+'></td><td class="p-3">'+(p.offset+i+1)+'</td><td class="p-3 font-bold">'+esc(r.name)+'</td><td class="p-3 font-mono">'+esc(r.phone)+'</td><td class="p-3">'+esc(r.dong||'-')+'</td><td class="p-3">'+esc(labels[r.last_result]||r.last_result||'미통화')+'</td><td class="p-3">'+esc(r.locked_by||'미배정')+'</td><td class="p-3 whitespace-pre-wrap">'+esc(r.last_memo||'-')+'</td><td class="p-3"><div class="flex gap-2"><button type="button" data-contact-edit="'+i+'" class="px-3 py-2 rounded-lg bg-blue-600 text-white disabled:opacity-40"'+disabled+'>수정</button><button type="button" data-contact-delete="'+i+'" class="px-3 py-2 rounded-lg bg-rose-700 text-white disabled:opacity-40"'+disabled+'>삭제</button></div>'+(r.locked_by?'<span class="text-xs">배정 중 · 변경 불가</span>':'')+'</td></tr>';
  }).join('')||'<tr><td colspan="9" class="p-5 text-center">조건에 맞는 연락처가 없습니다.</td></tr>';
  body.querySelectorAll?.('[data-contact-select]').forEach(el=>el.onchange=()=>{const r=p.items[Number(el.dataset.contactSelect)];if(el.checked)selectedVoters.set(String(r.voter_id),r.updated_at);else selectedVoters.delete(String(r.voter_id));syncContactSelection();});
  body.querySelectorAll?.('[data-contact-edit]').forEach(el=>el.onclick=()=>openContactEditor(p.items[Number(el.dataset.contactEdit)]));
  body.querySelectorAll?.('[data-contact-delete]').forEach(el=>el.onclick=()=>deleteContacts([p.items[Number(el.dataset.contactDelete)]]));
 }
 function closeContactEditor(){editDraft=null;$('contact-editor')?.classList.add('hidden');for(const id of ['contact-edit-name','contact-edit-phone','contact-edit-dong','contact-edit-memo'])if($(id))$(id).value='';text('contact-edit-error','');}
 function mountContactEditor(){
  const box=document.createElement('section');box.id='contact-editor';box.className='hidden fixed inset-0 z-[10050] bg-slate-950/80 flex items-center justify-center p-3';box.setAttribute('role','dialog');box.setAttribute('aria-modal','true');box.setAttribute('aria-label','연락처 수정');
  box.innerHTML='<form id="contact-edit-form" class="w-full max-w-lg max-h-[90dvh] overflow-auto rounded-2xl bg-white text-slate-900 p-5 space-y-3"><h3 class="text-xl font-bold">연락처 수정</h3><label class="block" for="contact-edit-name">이름 *</label><input id="contact-edit-name" required maxlength="100" class="w-full border rounded-lg p-3"><label class="block" for="contact-edit-phone">전화번호 *</label><input id="contact-edit-phone" type="tel" required maxlength="30" class="w-full border rounded-lg p-3"><label class="block" for="contact-edit-dong">그룹명</label><input id="contact-edit-dong" maxlength="200" class="w-full border rounded-lg p-3"><label class="block" for="contact-edit-memo">메모</label><textarea id="contact-edit-memo" maxlength="2000" rows="3" class="w-full border rounded-lg p-3"></textarea><p class="text-xs text-slate-600">전화번호를 변경하면 미통화로 전환합니다. 과거 통화기록은 변경하지 않습니다.</p><p id="contact-edit-error" role="alert" class="text-rose-700"></p><div class="flex gap-3"><button id="contact-edit-save" type="submit" class="bg-blue-600 text-white px-5 py-3 rounded-lg disabled:opacity-40">저장</button><button id="contact-edit-cancel" type="button" class="border px-5 py-3 rounded-lg">취소</button></div></form>';
  document.body.append(box);$('contact-edit-form').onsubmit=e=>{e.preventDefault();void saveContact();};$('contact-edit-cancel').onclick=()=>{if(!contactBusy)closeContactEditor();};
 }
 function openContactEditor(row){
  if(contactBusy||!adminVoters()||!row||row.locked_by||!row.updated_at)return;
  editDraft={row:{...row},camp:pages.camp,who:verifiedIdentity};text('contact-edit-error','');
  $('contact-edit-name').value=row.name||'';$('contact-edit-phone').value=row.phone||'';$('contact-edit-dong').value=row.dong||'';$('contact-edit-memo').value=row.last_memo||'';
  $('contact-editor').classList.remove('hidden');$('contact-edit-name').focus();
 }
 function contactRequestId(name,args){const key=JSON.stringify([name,args]);if(key!==mutationKey){mutationKey=key;mutationId=crypto.randomUUID();}return mutationId;}
 function setContactBusy(value){contactBusy=value;if($('contact-edit-save'))$('contact-edit-save').disabled=value;if($('contact-edit-cancel'))$('contact-edit-cancel').disabled=value;renderPage('voters');}
 async function afterContactChange(cid,who,message){
  if(verifiedIdentity!==who||getActiveCampId()!==cid)return;
  clearContactSelection();text('admin-voters-result',message);
  try{await loadPage('voters');await easycallLoadCounts();updateVoterQueueStatusText();}catch{text('admin-voters-result',message+' · 목록 갱신 실패: 명부 새로고침을 눌러 확인하세요.');}
 }
 async function saveContact(){
  if(contactBusy||!editDraft||!adminVoters())return;const draft=editDraft,cid=draft.camp,who=draft.who;
  if(getActiveCampId()!==cid||verifiedIdentity!==who){closeContactEditor();return;}
  const patch={name:$('contact-edit-name').value.trim(),phone:normalizePhone($('contact-edit-phone').value),dong:$('contact-edit-dong').value.trim(),memo:$('contact-edit-memo').value};
  if(!patch.name||patch.name.length>100||!/^0[0-9]{8,10}$/.test(patch.phone)||patch.dong.length>200||patch.memo.length>2000){text('contact-edit-error','이름과 올바른 전화번호, 지역·메모 길이를 확인하세요.');return;}
  const args={p_camp_id:cid,p_voter_id:String(draft.row.voter_id),p_expected_updated_at:draft.row.updated_at,p_patch:patch};
  setContactBusy(true);text('contact-edit-error','저장 중…');
  try{
   const result=await rpc('easycall_admin_update_voter',{...args,p_request_id:contactRequestId('update',args)});
   if(!result?.success||result.updated!==1)throw Error('수정 결과를 확인하지 못했습니다. 목록을 새로고침하세요.');
   if(verifiedIdentity===who&&getActiveCampId()===cid){closeContactEditor();await afterContactChange(cid,who,'1건 수정했습니다.');}
  }catch(e){if(verifiedIdentity===who&&getActiveCampId()===cid)text('contact-edit-error',e.message||'수정 결과를 확인하지 못했습니다. 목록을 새로고침하세요.');}
  finally{setContactBusy(false);}
 }
 async function deleteContacts(rows){
  if(contactBusy||!adminVoters()||!rows.length)return;
  const cid=pages.camp,who=verifiedIdentity;
  if(rows.some(r=>r.locked_by||!r.updated_at)){text('admin-voters-result','배정 중인 대상은 삭제할 수 없습니다.');return;}
  if(!confirm(rows.length+'건의 연락처를 삭제할까요? 통화기록과 수신거부 정보는 유지됩니다. 연락처 삭제는 취소할 수 없습니다.'))return;
  const args={p_camp_id:cid,p_rows:rows.map(r=>({voter_id:String(r.voter_id),updated_at:r.updated_at}))};
  setContactBusy(true);text('admin-voters-result',rows.length+'건 삭제 중…');
  try{
   const result=await rpc('easycall_admin_delete_voters',{...args,p_request_id:contactRequestId('delete',args)});
   if(!result?.success||result.deleted!==rows.length)throw Error('삭제 결과를 확인하지 못했습니다. 목록을 새로고침하세요.');
   await afterContactChange(cid,who,result.deleted+'건 삭제했습니다.');
  }catch(e){if(verifiedIdentity===who&&getActiveCampId()===cid)text('admin-voters-result','삭제 실패: '+(e.message||'목록을 새로고침하고 확인하세요.'));}
  finally{setContactBusy(false);}
 }
 const contactLogout=window.handleLogout;
 window.handleLogout=async function(...args){clearContactSelection();closeContactEditor();text('admin-voters-result','');return contactLogout(...args);};

 function mountAdminVoters(){
  if(!document.createElement||!$('upload-status')||$('admin-voter-list'))return;
  const section=document.createElement('section');section.id='admin-voter-list';section.className='mt-4 space-y-3';
  section.innerHTML='<h3 class="font-extrabold text-slate-900">등록된 연락처 명부</h3><p id="admin-voters-camp" class="text-xs text-slate-600">서버 명부 조회</p><div class="flex flex-wrap gap-2"><label class="flex-1 min-w-0"><span class="sr-only">관리자 명부 검색</span><input id="admin-voter-search" placeholder="이름, 전화번호, 그룹명 검색" class="w-full border border-slate-300 rounded-lg p-3" type="search"></label><select id="admin-voter-status" aria-label="통화상태 필터" class="border border-slate-300 rounded-lg p-3"><option value="">통화상태 전체</option><option value="READY">미통화</option><option value="CONNECTED">통화 완료</option><option value="ABSENT">부재중</option><option value="CALLBACK">재통화</option><option value="REJECT">수신거부</option><option value="INVALID">결번</option></select><button type="button" id="admin-voters-refresh" class="bg-blue-600 text-white rounded-lg px-4 py-3 font-bold">명부 새로고침</button></div><div class="flex flex-wrap gap-3 items-center"><button id="admin-voters-delete-selected" type="button" disabled class="bg-rose-700 text-white rounded-lg px-4 py-3 disabled:opacity-40">선택 삭제</button><span id="admin-voters-selected" class="text-sm">0건 선택 · 현재 페이지</span></div><p class="text-xs text-slate-600">배정 중인 대상은 수정·삭제할 수 없습니다. 전화번호 변경 시 미통화로 전환되며, 과거 통화기록과 수신거부 정보는 유지됩니다.</p><p id="admin-voters-result" role="status" class="text-sm font-bold"></p><div class="overflow-x-auto"><table class="w-full text-sm text-left"><thead><tr><th class="p-3"><input type="checkbox" id="admin-voters-select-all" aria-label="현재 페이지 전체 선택"></th><th class="p-3">순번</th><th class="p-3">이름</th><th class="p-3">전화번호</th><th class="p-3">그룹명</th><th class="p-3">통화 상태</th><th class="p-3">배정 요원</th><th class="p-3">최근 메모</th><th class="p-3">관리</th></tr></thead><tbody id="admin-voters-tbody"></tbody></table></div><div class="flex flex-wrap justify-between items-center gap-2"><span id="admin-voters-page" role="status">조회 전</span><div class="flex gap-2"><button type="button" id="admin-voters-prev" class="px-4 py-3 border rounded-lg disabled:opacity-40">이전</button><button type="button" id="admin-voters-next" class="px-4 py-3 border rounded-lg disabled:opacity-40">다음</button></div></div>';
  $('upload-status').after(section);
  $('admin-voter-search').oninput=()=>renderAgentSearchTable();
  $('admin-voter-status').onchange=()=>renderAgentSearchTable();
  $('admin-voters-select-all').onchange=e=>{for(const r of pages.voters.items){if(!r.locked_by&&r.updated_at){if(e.target.checked)selectedVoters.set(String(r.voter_id),r.updated_at);else selectedVoters.delete(String(r.voter_id));}}renderPage('voters');};
  $('admin-voters-delete-selected').onclick=()=>deleteContacts(pages.voters.items.filter(r=>selectedVoters.has(String(r.voter_id))));
  mountContactEditor();
  $('admin-voters-refresh').onclick=()=>refreshDataPage('voters');
  $('admin-voters-prev').onclick=()=>changeDataPage('voters',-1);
  $('admin-voters-next').onclick=()=>changeDataPage('voters',1);
 }
 mountAdminVoters();
 Object.assign(window,{easycallPrepareLists:resetCamp,easycallLoadLists,easycallAgentCallCount,openBriefingReportModal,changeDataPage,refreshDataPage,renderAdminLogsTable,renderAgentSearchTable,renderAgentHistoryTable,renderStatsAndCharts:renderAggregateStats,updateAgentGoalGauge:renderAggregateStats,updateVoterQueueStatusText,activateVerifiedUser,openMfaSettings,startMfaEnrollment,verifyMfaCode,closeMfa,toggleMfaPolicy});
 document.addEventListener('visibilitychange',()=>{if(document.hidden)clearMfaSecret();});
 window.addEventListener('pagehide',clearMfaSecret);
})();
