// One server page and one encoded chunk at a time. The sink supplies backpressure.
export const columns=['기록ID','캠프','전화담당자','발신회선','이름','연락처','그룹명','성별','연령','통화결과','응답결과','경과시간(초)','경과시간(기존표기)','메모','기록시각(UTC)','재통화시각(UTC)'];
export function csvCell(value){
 let text=String(value??'');
 if(/^[\s\u0000-\u001f]*[=+@-]/.test(text)||/^[\t\r\n]/.test(text))text="'"+text;
 return '"'+text.replace(/"/g,'""')+'"';
}
const line=values=>values.map(csvCell).join(',')+'\r\n';
const fields=['call_id','camp_id','agent_id','used_phone','voter_name','voter_phone','dong','gender','age','call_result','status','duration_seconds','duration','memo','created_at','callback_at'];
export async function streamCallLogs({fetchPage,sink,check=()=>{},onProgress=()=>{}}){
 let cursor=null,asOf=null,count=0;
 const encoder=new TextEncoder();
 try{
  check();await sink.write(encoder.encode('\uFEFF'+line(columns)));
  while(true){
   check();const page=await fetchPage({cursor,asOf});check();
   if(!Array.isArray(page?.items)||page.items.length>1000||typeof page.done!=='boolean'||!page.asOf)throw Error('서버 응답을 확인할 수 없습니다.');
   if(asOf&&page.asOf!==asOf)throw Error('내려받기 기준 시각이 변경되었습니다.');
   if(!page.done&&(!page.items.length||!page.cursor||JSON.stringify(cursor)===JSON.stringify(page.cursor)))throw Error('내려받기 위치가 진행되지 않았습니다.');
   if(page.items.length)await sink.write(encoder.encode(page.items.map(row=>line(fields.map(key=>row[key]))).join('')));
   count+=page.items.length;cursor=page.cursor;asOf=page.asOf;
   onProgress(count);check();if(page.done)break;
  }
  await sink.close();return count;
 }catch(error){await sink.abort().catch(()=>{});throw error;}
}

// Browsers without file streaming may download only a bounded small file.
export function memorySink(onSave,maxBytes=16*1024*1024){
 let parts=[],bytes=0;
 return {async write(chunk){if(bytes+chunk.byteLength>maxBytes)throw Error('이 브라우저의 내려받기 한도를 넘었습니다. 기간을 줄이거나 PC의 파일 직접 저장 지원 브라우저를 사용하세요.');bytes+=chunk.byteLength;parts.push(chunk);},
  async close(){await onSave(new Blob(parts,{type:'text/csv;charset=utf-8;'}));parts=[];},async abort(){parts=[];bytes=0;}};
}
