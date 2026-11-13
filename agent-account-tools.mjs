// Pure validation used before any account is created.
export function parseAgentRows(text){
 const source=String(text||'').replace(/^\uFEFF/,'').trim();if(!source)return [];
 const delimiter=source.includes('\t')?'\t':',',rows=[];let row=[],cell='',quoted=false;
 for(let i=0;i<=source.length;i++){const ch=source[i];if(quoted){if(ch==='"'&&source[i+1]==='"'){cell+='"';i++;}else if(ch==='"')quoted=false;else if(ch===undefined)throw Error('따옴표가 닫히지 않은 행이 있습니다.');else cell+=ch;}
 else if(ch==='"'&&cell==='')quoted=true;else if(ch===delimiter){row.push(cell.trim());cell='';}
 else if(ch==='\n'||ch===undefined){row.push(cell.trim().replace(/\r$/,''));if(row.some(Boolean))rows.push(row);row=[];cell='';}else if(ch!=='\r')cell+=ch;}
 if(rows.length&&/^(이름|성명|요원명|홍보요원명)$/.test(rows[0][0])&&/전화|회선|번호/.test(rows[0][1]||''))rows.shift();
 if(rows.length>2000)throw Error('한 번에 최대 2,000명까지 입력하세요.');
 return rows;
}
const phoneKey=x=>String(x||'').replace(/[^0-9]/g,'');
export function previewAgentRows(text,snapshot){
 const raw=parseAgentRows(text),reserved=new Set(snapshot.reservedIds||[]),seen=new Set(),accounts=snapshot.accounts||[];let next=1;
 const result=raw.map((cells,index)=>{const name=String(cells[0]||'').trim(),phone=phoneKey(cells[1]),item={line:index+1,name,phone,loginId:'',kind:'new',message:''};
 if(cells.length!==2||!name||name.length>80||!/^0[0-9]{8,10}$/.test(phone))return {...item,kind:'error',message:'이름과 0으로 시작하는 배정 전화번호(9~11자리)를 2개 열로 입력하세요.'};
 const key=name+'\0'+phone;if(seen.has(key))return {...item,kind:'duplicate',message:'입력 목록 내 중복 · 제외'};seen.add(key);
 const matches=accounts.filter(a=>a.name===name&&phoneKey(a.phone)===phone);
 if(matches.length>1)return {...item,kind:'error',message:'동일한 이름·전화번호의 기존 요원이 여러 명입니다. 기존 계정 목록에서 확인하세요.'};
 if(matches.length){const a=matches[0];if(!a.hasAccount&&!/^[a-z0-9_-]{1,32}$/.test(a.loginId||''))return {...item,kind:'error',message:'기존 단말 ID 형식을 확인하세요. 영문·숫자·밑줄·하이픈 1~32자가 필요합니다.'};return {...item,loginId:a.loginId,kind:a.hasAccount?'existing':'registered',message:a.hasAccount?'이미 발급된 계정 · 제외':'등록된 단말기에 로그인 계정 발급'};}
 let login;do{login='agent'+String(next++).padStart(4,'0');}while(reserved.has(login));reserved.add(login);return {...item,loginId:login,message:'신규 발급'};
 });
 const newCount=result.filter(r=>r.kind==='new').length,eligible=result.filter(r=>['new','registered'].includes(r.kind)),errors=result.filter(r=>r.kind==='error').length;
 return {rows:result,eligible,newCount,errors,overQuota:newCount>Number(snapshot.remaining||0),skipped:result.length-eligible.length-errors};
}
export function deliveryText(campId,row,origin){
 return ['이지콜 홍보요원 계정 안내','접속 주소: '+origin,'캠프 ID: '+campId,'사용자 ID: '+row.loginId,...(row.password?['임시 비밀번호: '+row.password]:['비밀번호: 기존에 전달받은 비밀번호를 사용하세요.']),'비밀번호 변경은 선택사항이며, 새 비밀번호는 6자 이상으로 설정할 수 있습니다.'].join('\n');
}
export function spreadsheetXml(rows){
 const xml=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
 return '<?xml version="1.0" encoding="UTF-8"?><?mso-application progid="Excel.Sheet"?>'+'<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="계정 발급 명세"><Table>'+rows.map(row=>'<Row>'+row.map(cell=>'<Cell><Data ss:Type="String">'+xml(cell)+'</Data></Cell>').join('')+'</Row>').join('')+'</Table></Worksheet></Workbook>';
}
