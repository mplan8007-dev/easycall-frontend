// Contact import controls and durable server processing history. No contact values are stored here.
(() => {
 'use strict';
 const $=id=>document.getElementById(id),esc=escapeHTML;
 const controls=document.createElement('div');controls.className='my-3 space-y-2';
 controls.innerHTML='<label for="voter-import-mode" class="block font-bold">연락처 등록 방식</label><select id="voter-import-mode" class="w-full border border-slate-300 rounded-lg p-3"><option value="replace">전체 교체 · 새 파일을 최신 명부로 적용 (기본)</option><option value="append">추가 등록 · 기존 연락처 유지</option></select><p id="voter-import-help" class="text-sm text-slate-600"></p>';
 $('csv-file-input').before(controls);
 function help(){$('voter-import-help').textContent=$('voter-import-mode').value==='replace'?'주의: 기존 명부를 교체합니다. 통화기록은 유지하며, 배정 중인 대상이 있으면 교체하지 않습니다.':'기존 명부와 배정 중인 대상은 유지합니다. 같은 전화번호는 건너뛰고 새 번호만 추가합니다.';}
 $('voter-import-mode').onchange=help;help();
 const history=document.createElement('section');history.id='voter-import-history';history.className='mt-5 space-y-3';
 history.innerHTML='<h3 class="font-extrabold">업로드 처리 이력 · 최근 20건</h3><p class="text-xs text-slate-600">서버에서 처리한 성공·실패 이력입니다. 파일 검증 오류나 취소는 위 안내를 확인하세요.</p><button id="voter-history-refresh" type="button" class="px-4 py-3 bg-slate-700 text-white rounded-lg">이력 새로고침</button><p id="voter-history-status" role="status">조회 전</p><div class="overflow-x-auto"><table class="w-full text-sm text-left"><thead><tr><th class="p-3">처리 시각</th><th class="p-3">파일</th><th class="p-3">방식</th><th class="p-3">결과</th></tr></thead><tbody id="voter-history-body"></tbody></table></div>';
 ($('admin-voter-list')||$('upload-status')).after(history);
 let ticket=0;
 window.easycallRefreshImportHistory=async()=>{
  if(!verifiedIdentity||verifiedIdentity.role==='agent'||!sbClient)return;
  const cid=getActiveCampId(),who=verifiedIdentity,n=++ticket;
  $('voter-history-status').textContent='이력 조회 중…';
  try {
   const {data,error}=await sbClient.rpc('easycall_import_history',{p_camp_id:cid});
   if(n!==ticket||verifiedIdentity!==who||getActiveCampId()!==cid)return;
   if(error)throw error;
   if(!Array.isArray(data))throw Error('이력 응답을 확인하지 못했습니다.');
   $('voter-history-body').innerHTML=data.map(r=>'<tr><td class="p-3">'+esc(new Date(r.createdAt).toLocaleString('ko-KR'))+'</td><td class="p-3">'+esc(r.filename)+'</td><td class="p-3">'+(r.mode==='replace'?'전체 교체':'추가 등록')+'</td><td class="p-3">'+esc(r.success?'완료 · 신규 '+r.inserted+' / 중복 '+r.duplicates+' / 차단 '+r.blocked+' / 전체 '+r.total:'실패 · '+r.error)+'</td></tr>').join('')||'<tr><td colspan="4" class="p-3">서버 처리 이력이 없습니다.</td></tr>';
   $('voter-history-status').textContent='캠프 '+cid+' · '+data.length+'건';
  } catch(e){if(n===ticket){$('voter-history-body').innerHTML='';$('voter-history-status').textContent='이력 조회 실패: '+e.message;}}
 };
 $('voter-history-refresh').onclick=()=>window.easycallRefreshImportHistory();
 const prior=window.pullStateFromSupabase;
 window.pullStateFromSupabase=async function(...args){const r=await prior(...args);await window.easycallRefreshImportHistory();return r;};
})();
