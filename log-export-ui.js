import {streamCallLogs,memorySink} from './log-export.mjs';
const $=id=>document.getElementById(id);
let job=null;
const panel=document.createElement('section');panel.className='ec-export-panel';
panel.innerHTML='<label for="log-export-from">시작일 (한국 시간)</label><input id="log-export-from" type="date"><label for="log-export-through">종료일 (한국 시간)</label><input id="log-export-through" type="date"><p>비워 두면 전체 기간을 조회합니다. 날짜가 없는 이전 기록은 전체 기간에만 포함됩니다.</p><p id="log-export-capability"></p><p id="log-export-status" role="status" aria-live="polite"></p><button id="log-export-cancel" type="button" hidden>내려받기 취소</button>';
$('admin-pane-logs').firstElementChild.after(panel);
$('log-export-capability').textContent=typeof window.showSaveFilePicker==='function'?'저장 위치를 선택하면 파일에 순서대로 저장합니다. 완료될 때까지 이 화면을 열어 두세요.':'이 브라우저는 최대 16MB까지 내려받습니다. 기록이 많으면 기간을 나누어 선택하세요.';
$('log-export-cancel').onclick=()=>{if(job){job.cancelled=true;job.controller.abort();$('log-export-status').textContent='취소 중…';}};
window.addEventListener('beforeunload',event=>{if(job){event.preventDefault();event.returnValue='';}});
window.easycallExportLogs=async filterType=>{
 if(job||!sbClient||!verifiedIdentity||verifiedIdentity.role==='agent')return;
 const from=$('log-export-from').value||null,through=$('log-export-through').value||null;
 if(from&&through&&from>through){$('log-export-status').textContent='시작일은 종료일보다 늦을 수 없습니다.';return;}
 const identity=verifiedIdentity,cid=currentAdminId,client=sbClient;
 const task={cancelled:false,controller:new AbortController()};job=task;
 const controls=[...document.querySelectorAll('[onclick^="exportCallLogsToCsv"],#log-export-from,#log-export-through')];
 controls.forEach(el=>el.disabled=true);$('log-export-cancel').hidden=false;
 const check=()=>{if(task.cancelled)throw new DOMException('취소했습니다.','AbortError');if(verifiedIdentity!==identity||currentAdminId!==cid||sbClient!==client)throw Error('계정 또는 캠프가 변경되어 내려받기를 중단했습니다.');};
 const filename='EasyCall_'+cid+'_'+new Date().toISOString().slice(0,10)+'.csv';let sink;
 try{
  // Invoke the picker directly from the click, before any network await.
  if(typeof window.showSaveFilePicker==='function'){
   const handle=await window.showSaveFilePicker({suggestedName:filename,types:[{description:'CSV',accept:{'text/csv':['.csv']}}]});check();sink=await handle.createWritable();
  }else sink=memorySink(async blob=>{check();const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);});
  $('log-export-status').textContent='내려받기를 시작합니다…';
  const count=await streamCallLogs({sink,check,onProgress:n=>{$('log-export-status').textContent=n.toLocaleString()+'건 저장 중…';},fetchPage:async({cursor,asOf})=>{
   let rejectAbort;
   const aborted=new Promise((_,reject)=>{rejectAbort=()=>reject(new DOMException('취소했습니다.','AbortError'));task.controller.signal.addEventListener('abort',rejectAbort,{once:true});});
   let response;
   try{response=await Promise.race([client.rpc('easycall_export_logs_page',{p_camp_id:cid,p_positive:filterType==='POSITIVE_ONLY',p_from:from,p_through:through,p_cursor:cursor,p_as_of:asOf}),aborted]);}
   finally{task.controller.signal.removeEventListener('abort',rejectAbort);}
   const {data,error}=response;
   if(error)throw error;return data;
  }});
  $('log-export-status').textContent=count.toLocaleString()+'건 내려받기 완료'+(count===0?' · 해당 기간에 기록이 없습니다.':'');
 }catch(error){if(sink)await sink.abort().catch(()=>{});$('log-export-status').textContent=error.name==='AbortError'?'내려받기를 취소했습니다.':'내려받기 실패: '+(error.message||'연결 상태를 확인한 후 다시 시도하세요.');}
 finally{job=null;controls.forEach(el=>el.disabled=false);$('log-export-cancel').hidden=true;}
};
