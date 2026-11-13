/* EasyCall administration: server-confirmed writes, independent editor drafts. */
(() => {
  'use strict';
  const legacyActivate = window.activateVerifiedUser;
  const legacyAgentInit = window.initAgentView;
  const legacyRefresh = window.refreshActiveRoleUI;
  const legacyDefaults = window.initNewCampFormDefaults;
  const legacyLogout = window.handleLogout;
  const legacyEngine = window.initSupabaseEngine;
  const passwordFlow = /(?:type=(?:recovery|invite))/.test(window.location.hash||'');
  async function initSupabaseEngine(...args){
    await legacyEngine(...args);
    if(!sbClient)return;
    const showPasswordFlow=async()=>{
      const {data,error}=await sbClient.auth.getUser();if(error||!data?.user)return;
      const u=data.user,m=u.app_metadata||{};
      verifiedIdentity={role:m.easycall_role,campId:m.camp_id,agentId:m.agent_id,email:u.email,uid:u.id};
      await openMyAccount();
    };
    sbClient.auth.onAuthStateChange(event=>{if(event==='PASSWORD_RECOVERY')setTimeout(showPasswordFlow,0);});
    if(passwordFlow)await showPasswordFlow();
  }
  const state = { busy:false, fetched:0, page:1, pageSize:25, filterKey:'', overview:null,
    good:null, edit:null, account:null, payment:null, auditCamp:null, auditPage:0, backup:null,
    configDirty:false, lastSuccess:null, presenceTimer:null, schedule:false };
  const $ = id => document.getElementById(id);
  const text = (id,value) => { if ($(id)) $(id).textContent=String(value ?? ''); };
  const val = id => String($(id)?.value ?? '').trim();
  const esc = value => escapeHTML(value);
  const copy = value => JSON.parse(JSON.stringify(value));
  const money = value => Number(value || 0).toLocaleString('ko-KR')+'원';
  const stamp = value => value ? new Date(value).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'}) : '-';
  const today = () => { const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).map(p=>[p.type,p.value]));return p.year+'-'+p.month+'-'+p.day; };
  const delegated = () => verifiedIdentity?.role==='super' && Boolean(sessionStorage.getItem('easycall_master_impersonator'));
  const superView = () => verifiedIdentity?.role==='super' && !delegated();
  const online = () => Boolean(sbClient && verifiedIdentity && (typeof navigator==='undefined' || navigator.onLine!==false));
  const camp = id => campsList.find(c=>c.campId===id);
  function notify(message,error=false) {
    const box=$('super-save-status');
    if (box) { box.textContent=message; box.className='mt-3 text-xs rounded-xl p-3 border '+(error?'border-rose-700 bg-rose-950 text-rose-200':'border-emerald-800 bg-emerald-950 text-emerald-200'); }
    showToast(message);
  }
  function remember() { state.good=copy({campsList,agentsList,votersList,globalCampCallLogs,campSettingsMap}); }
  function restoreGood() {
    if (!state.good) return;
    ({campsList,agentsList,votersList,globalCampCallLogs,campSettingsMap}=copy(state.good));
  }
  function dialogError(id,message) {
    const el=$(id)?.querySelector?.('[data-dialog-error]');
    if (el) { el.textContent=message; el.classList.toggle('hidden',!message); }
  }
  function openDialog(id) { dialogError(id,''); $(id)?.classList.remove('hidden'); }
  function closeDialog(id) {
    if (state.busy) { notify('저장 중입니다. 완료 후 닫아 주세요.'); return; }
    $(id)?.classList.add('hidden');
    if (id==='camp-edit-dialog') state.edit=null;
  }
  async function rpc(name,args={}) {
    if (!online()) throw new Error('온라인 연결이 필요합니다. 입력을 유지한 채 연결을 확인하세요.');
    const {data,error}=await sbClient.rpc(name,args);
    if (error) { const e=new Error(error.message || '서버 요청 실패'); e.code=error.code; throw e; }
    return data;
  }
  function failMessage(error) {
    if (error.code==='40001' || /conflict/i.test(error.message)) return '다른 관리자가 먼저 변경했습니다. 입력은 유지됩니다. 닫은 뒤 최신 자료를 열어 다시 확인하세요.';
    return error.message || '처리하지 못했습니다. 입력을 유지했습니다.';
  }
  async function mutate(dialogId,operation,after) {
    if (state.busy) { notify('다른 저장 작업이 진행 중입니다.'); return false; }
    if (!online()) { const m='연결이 없어 저장하지 않았습니다. 입력은 유지됩니다.'; dialogError(dialogId,m); notify(m,true); return false; }
    state.busy=true;
    const buttons=Array.from(document.querySelectorAll?.('#super-view button, [role="dialog"] button') || []);
    const disabled=buttons.map(b=>b.disabled);
    buttons.forEach(b=>{b.disabled=true;});
    try {
      dialogError(dialogId,'');
      const result=await operation();
      await pullStateFromSupabase(true);
      if (after) await after(result);
      notify('서버 반영을 확인했습니다.');
      return true;
    } catch(error) {
      restoreGood();
      const message=failMessage(error); dialogError(dialogId,message); notify(message,true);
      console.error(error); return false;
    } finally { state.busy=false; buttons.forEach((b,i)=>{b.disabled=disabled[i];}); if(superView()) renderSuperCampsTable(); }
  }
  function fillOptions(id,values,label) {
    const el=$(id); if(!el) return;
    const selected=el.value || 'ALL';
    el.innerHTML='<option value="ALL">'+esc(label)+'</option>'+[...new Set(values.filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ko')).map(v=>'<option value="'+esc(v)+'">'+esc(v)+'</option>').join('');
    el.value=values.includes(selected)?selected:'ALL';
  }
  function updateCloudStatusBadges(connected) {
    if (connected) state.lastSuccess=new Date().toISOString();
    const label=connected?'클라우드 연결 · '+stamp(state.lastSuccess):verifiedIdentity?'연결 끊김 · 저장 불가':'로그인 필요';
    text('login-cloud-badge',connected?'클라우드 연결':'로그인 필요');
    text('super-cloud-status-txt',label); text('admin-cloud-badge',label);
    if($('super-cloud-dot')) $('super-cloud-dot').className='w-2.5 h-2.5 rounded-full '+(connected?'bg-emerald-400':'bg-rose-500');
  }
  async function pullStateFromSupabase(force=false) {
    if(!sbClient || !verifiedIdentity) return;
    if(state.busy && !force) return;
    const ticket=++state.fetched;
    if(verifiedIdentity.role==='agent' && window.easycallPullAgentState){await window.easycallPullAgentState();return;}
    if(superView()) {
      const data=await rpc('easycall_admin_overview_fast',{p_force:force});
      if(ticket!==state.fetched) return;
      state.overview=data; campsList=(data.camps || []).map(ensureCampStructure);
      agentsList=[]; votersList=[]; globalCampCallLogs=[];
      fillOptions('camp-filter-party',campsList.map(c=>c.party),'정당 전체');
      fillOptions('camp-filter-staff',campsList.map(c=>c.staff),'담당자 전체');
      remember(); updateCloudStatusBadges(true); renderSuperCampsTable(); return;
    }
    const rows=await rpc('easycall_read_state');
    if(ticket!==state.fetched) return;
    for(const row of rows || []) stateRevisions.set(row.store_key,row.updated_at);
    const meta=rows?.find(r=>r.store_key==='MASTER_META')?.payload || {};
    const cid=getActiveCampId();
    campsList=(meta.campsList || []).filter(c=>c.campId===cid).map(ensureCampStructure);
    agentsList=(meta.agentsList || []).filter(a=>a.campId===cid).map(ensureAgentStructure);
    for(const row of rows || []) if(row.store_key==='STATE_'+cid && !state.configDirty) campSettingsMap[cid]=row.payload.config || {};
    const paged=window.easycallLoadLists?await window.easycallLoadLists(cid):null;
    const [v,l]=paged?[{data:paged.voters},{data:paged.logs}]:await Promise.all([
      sbClient.from('easycall_voters').select('*').eq('camp_id',cid).order('uid').limit(50),
      sbClient.from('easycall_call_logs').select('*').eq('camp_id',cid).order('created_at',{ascending:false,nullsFirst:false}).limit(50)
    ]);
    if(v.error) throw v.error; if(l.error) throw l.error; if(ticket!==state.fetched) return;
    votersList=(v.data || []).map(r=>({id:String(r.voter_id),campId:r.camp_id,name:r.name,phone:r.phone,dong:r.dong,lastResult:r.last_result,lastMemo:r.last_memo,lockedBy:r.locked_by}));
    globalCampCallLogs=(l.data || []).map(logFromRow);
    if(activeClaim && !votersList.some(v=>v.id===activeClaim.voterId)) votersList.push(activeClaim.voter);
    if(activeClaim) currentVoterIdx=getCampVoters(cid).findIndex(v=>v.id===activeClaim.voterId);
    remember(); updateCloudStatusBadges(true);
  }
  async function savePersistentData(targetCampId=null) {
    if(!online()) { restoreGood(); notify('연결이 없어 저장하지 않았습니다.',true); return false; }
    if(verifiedIdentity.role==='agent') {
      try { await rpc('easycall_agent_signal',{p_status:isAgentOnBreak?'휴식 중 ☕':'근무 중 🟢',p_sos:Boolean(getCampConfig(getActiveCampId()).sosAlert)}); return true; }
      catch(e) { notify(failMessage(e),true); return false; }
    }
    if(state.busy) { notify('저장 중입니다. 잠시 후 다시 시도하세요.',true); return false; }
    const cid=targetCampId || getActiveCampId();
    const pending={p_camp_id:cid,p_meta:copy({campsList,agentsList}),p_config:copy(getCampConfig(cid)),p_meta_revision:stateRevisions.get('MASTER_META') || null,p_state_revision:stateRevisions.get('STATE_'+cid) || null};
    state.busy=true;
    try {
      await rpc('easycall_save_state',pending); state.configDirty=false;
      await pullStateFromSupabase(true); notify('서버 저장 완료'); return true;
    } catch(e) { restoreGood(); notify(failMessage(e),true); return false; }
    finally { state.busy=false; }
  }
  async function refreshAdminData() { if(state.busy) return; try { await pullStateFromSupabase(); refreshActiveRoleUI(); } catch(e) { updateCloudStatusBadges(false); notify(failMessage(e),true); } }
  function refreshActiveRoleUI() {
    if(superView()) renderSuperCampsTable();
    else if(!state.configDirty) legacyRefresh();
  }
  async function activateVerifiedUser() {
    await legacyActivate();
    const {data}=await sbClient.auth.getUser();
    if(verifiedIdentity) { verifiedIdentity.email=data?.user?.email || ''; verifiedIdentity.uid=data?.user?.id; }
    clearInterval(controlPollTimer); clearInterval(state.presenceTimer);
    if(window.easycallStartRuntime){await window.easycallStartRuntime();return;}
    controlPollTimer=setInterval(async()=>{
      if(document.hidden || state.busy || isSavingResult || isUploading) return;
      try { await pullStateFromSupabase(); refreshActiveRoleUI(); }
      catch(e) { updateCloudStatusBadges(false); }
    },15000);
    if(verifiedIdentity?.role==='agent') {
      const heartbeat=async()=>{try{await rpc('easycall_heartbeat',{p_state:isAgentOnBreak?'break':'online'});}catch(e){updateCloudStatusBadges(false);}};
      await heartbeat(); state.presenceTimer=setInterval(heartbeat,30000);
    }
  }
  function renderSuperCampsTable() {
    const tbody=$('super-camps-body'); if(!tbody) return;
    const filters={stage:val('camp-filter-stage') || 'ALL',election:val('camp-filter-election') || 'ALL',sido:val('camp-filter-sido') || 'ALL',billing:val('camp-filter-billing') || 'ALL',party:val('camp-filter-party') || 'ALL',status:val('camp-filter-status') || 'ALL',staff:val('camp-filter-staff') || 'ALL',query:val('camp-search-input').toLowerCase(),sort:val('camp-sort') || 'id'};
    const key=JSON.stringify(filters); if(key!==state.filterKey){state.page=1;state.filterKey=key;}
    const labels={ready:'사용 가능',future:'시작 전',expired:'기간 만료',stopped:'수동 중지',unconfigured:'계약 확인 필요'};
    let list=campsList.filter(c=>
      (filters.stage==='ALL'||c.electionStage===filters.stage) && (filters.election==='ALL'||c.electionType===filters.election) &&
      (filters.sido==='ALL'||getCampSido(c)===filters.sido) && (filters.billing==='ALL'||c.billingStatus===filters.billing) &&
      (filters.party==='ALL'||c.party===filters.party) && (filters.status==='ALL'||c.effectiveStatus===filters.status) &&
      (filters.staff==='ALL'||c.staff===filters.staff) && (!filters.query || [c.campId,c.name,c.region,c.district,c.candidate,c.staff,c.manager,c.adminEmail].join(' ').toLowerCase().includes(filters.query)));
    list.sort((a,b)=>filters.sort==='end'?String(a.endsOn||'9999').localeCompare(String(b.endsOn||'9999')):filters.sort==='outstanding'?Number(b.outstandingAmount||0)-Number(a.outstandingAmount||0):String(filters.sort==='name'?a.name:a.campId).localeCompare(String(filters.sort==='name'?b.name:b.campId),'ko',{numeric:true}));
    const pages=Math.max(1,Math.ceil(list.length/state.pageSize)); state.page=Math.min(pages,Math.max(1,state.page));
    const action=(c,action,label,cls='bg-slate-800 text-slate-200')=>'<button type="button" data-camp-action="'+action+'" data-camp-id="'+esc(c.campId)+'" class="px-2 py-1 rounded-lg text-[11px] font-bold '+cls+'">'+label+'</button>';
    tbody.innerHTML=list.slice((state.page-1)*state.pageSize,state.page*state.pageSize).map(c=>`<tr class="hover:bg-slate-800/40 transition">
      <td class="py-3 align-middle"><div class="flex gap-1 mb-1"><span class="px-1.5 py-0.5 rounded bg-purple-950 text-purple-300">${esc(c.electionStage)}</span><span class="px-1.5 py-0.5 rounded bg-indigo-950 text-indigo-300">${esc(c.electionType)}</span></div><div class="font-bold text-slate-200">${esc(c.region)} (${esc(c.district)})</div><div class="text-slate-500 text-[10px] mt-1">${esc(c.startsOn||'-')} ~ ${esc(c.endsOn||'-')}</div></td>
      <td class="py-3 align-middle"><div class="font-extrabold text-amber-300">${esc(c.party)} · ${esc(c.candidate)}</div><button type="button" data-camp-action="edit" data-camp-id="${esc(c.campId)}" class="text-indigo-400 font-bold text-left mt-1">${esc(c.name)} 🔍</button><div class="text-[10px] text-slate-500 mt-1">담당: ${esc(c.staff||'-')}</div></td>
      <td class="py-3 align-middle"><div class="font-mono font-bold">${esc(c.campId)}</div><div class="text-[10px] text-slate-400">명부 ${Number(c.voterCount||0).toLocaleString()} / 콜 ${Number(c.callCount||0).toLocaleString()}</div><div class="text-[10px] text-slate-500 mt-1">${esc(c.adminEmail||'관리자 계정 미연결')}</div></td>
      <td class="py-3 align-middle"><div class="text-emerald-400 font-mono font-bold">${Number(c.registeredCount||0)} / ${Number(c.tablets||0)}대</div><div class="text-[10px] text-slate-400">현재 접속 ${Number(c.onlineCount||0)}대</div><div class="flex gap-1 mt-1">${action(c,'quota-down','-1')}${action(c,'quota-up','+1')}${action(c,'quota-five','+5')}</div></td>
      <td class="py-3 align-middle"><span class="px-2 py-1 rounded ${c.effectiveStatus==='ready'?'bg-emerald-950 text-emerald-300':'bg-amber-950 text-amber-300'}">${esc(labels[c.effectiveStatus]||'확인 필요')}</span><div class="text-[10px] text-slate-400 mt-2">계약 ${money(c.contractAmount)}<br>입금 ${money(c.paidAmount)} / 미수 ${money(c.outstandingAmount)}</div></td>
      <td class="py-3 align-middle"><div class="flex flex-wrap gap-1 justify-end">${action(c,'visit','상황실','bg-emerald-700 text-white')}${action(c,'edit','수정')}${action(c,'account','계정')}${action(c,'payment','입금')}${action(c,'audit','이력')}${action(c,'approval',c.approved===false?'승인':'중지',c.approved===false?'bg-indigo-700 text-white':'bg-amber-700 text-white')}</div></td></tr>`).join('') || '<tr><td colspan="6" class="py-10 text-center text-slate-400">조건에 맞는 캠프가 없습니다.</td></tr>';
    const total=campsList, sum=(items,key)=>items.reduce((n,c)=>n+Number(c[key]||0),0);
    text('stat-total-camps',total.length+'개'); text('stat-active-camps-txt','사용 가능 '+total.filter(c=>c.effectiveStatus==='ready').length+'개 · 중지/만료 '+total.filter(c=>c.effectiveStatus==='stopped'||c.effectiveStatus==='expired').length+'개');
    text('stat-total-tablets',sum(total,'tablets')+'대 · 등록 '+sum(total,'registeredCount')+' · 접속 '+sum(total,'onlineCount'));
    text('stat-est-revenue','계약 '+money(sum(total,'contractAmount'))+' · 입금 '+money(sum(total,'paidAmount'))+' · 미수 '+money(sum(total,'outstandingAmount')));
    text('stat-super-total-calls',sum(total,'callCount').toLocaleString()+'건');
    text('camp-list-summary','검색 결과 '+list.length+'개 / 전체 '+total.length+'개 · 선택 범위 명부 '+sum(list,'voterCount')+'명 / 통화 '+sum(list,'callCount')+'건 / 미수 '+money(sum(list,'outstandingAmount')));
    text('camp-page-info',state.page+' / '+pages+'페이지 · 페이지당 '+state.pageSize+'개');
    if($('camp-page-prev')) $('camp-page-prev').disabled=state.page<=1;
    if($('camp-page-next')) $('camp-page-next').disabled=state.page>=pages;
  }
  function resetCampFilters(){for(const id of ['camp-filter-stage','camp-filter-election','camp-filter-sido','camp-filter-billing','camp-filter-party','camp-filter-status','camp-filter-staff']) if($(id)) $(id).value='ALL';if($('camp-search-input'))$('camp-search-input').value='';renderSuperCampsTable();}
  function changeCampPage(delta){state.page+=delta;renderSuperCampsTable();}
  function toggleNewCampForm(){const panel=$('super-new-camp-panel'),list=$('super-camp-list-panel');if(!panel||!list)return;const hidden=panel.classList.toggle('hidden');list.classList.toggle('xl:col-span-8',!hidden);list.classList.toggle('xl:col-span-12',hidden);}
  function readCampForm(prefix,isNew) {
    const id=(field)=>prefix+field;
    for(const field of [isNew?'new-camp-limit':'edit-camp-tablets',isNew?'new-camp-unit-price':'edit-camp-price',isNew?'new-camp-contract-amount':'edit-camp-amount'])if(!val(field))throw new Error('한도·단가·계약 금액을 입력하세요.');
    const data={campId:isNew?val('new-camp-admin'):state.edit?.campId,name:val(id('name')),candidate:val(id('candidate')),electionStage:val(id('stage')),electionType:val(isNew?'new-camp-election-type':'edit-camp-election'),sido:val(id('sido')),city:val(isNew?'new-camp-sigungu':'edit-camp-city'),district:val(id('district')),party:val(id('party')),staff:val(id('staff')),manager:val(id('manager')),phone:val(id('phone')),requestedAdminEmail:val(isNew?'new-camp-login-email':'edit-camp-email'),startsOn:val(id('start')),endsOn:val(id('end')),tablets:Number(val(isNew?'new-camp-limit':'edit-camp-tablets')),unitPrice:Number(val(isNew?'new-camp-unit-price':'edit-camp-price')),contractAmount:Number(val(isNew?'new-camp-contract-amount':'edit-camp-amount'))};
    if(!data.name||!data.candidate||!data.city||!data.staff||!data.manager||!data.party) throw new Error('캠프명·후보자·지역·정당·담당자를 입력하세요.');
    if(data.campId && !/^[a-z0-9_-]{1,64}$/.test(data.campId))throw new Error('캠프 ID는 영문 소문자·숫자·밑줄·하이픈만 사용할 수 있습니다.');
    if(!data.startsOn||!data.endsOn||data.startsOn>data.endsOn)throw new Error('계약 시작일과 종료일을 확인하세요.');
    if(!Number.isInteger(data.tablets)||data.tablets<1||data.tablets>2000)throw new Error('태블릿 한도는 1~2,000대의 정수여야 합니다.');
    for(const k of ['unitPrice','contractAmount'])if(!Number.isSafeInteger(data[k])||data[k]<0||data[k]>1e12)throw new Error('계약 금액과 단가는 0 이상의 정수로 입력하세요.');
    if(data.phone&&!/^0\d{8,10}$/.test(normalizePhone(data.phone)))throw new Error('연락처 형식을 확인하세요.');
    if(data.requestedAdminEmail&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.requestedAdminEmail))throw new Error('관리자 이메일 형식을 확인하세요.');
    data.region=data.sido+' '+data.city;return data;
  }
  async function registerNewCampByMaster() {
    try {
      const data=readCampForm('new-camp-',true);
      state.newRequest ||= crypto.randomUUID();
      const saved=await mutate(null,()=>rpc('easycall_admin_save_camp',{p_camp:data,p_expected_revision:null,p_request_id:state.newRequest}));
      if(saved){state.newRequest=null;for(const field of ['name','candidate','sigungu','district','staff','manager','phone','login-email'])if($('new-camp-'+field))$('new-camp-'+field).value='';initNewCampFormDefaults();notify('캠프 등록 완료. 계정 메뉴에서 관리자 아이디를 발급하세요.');}
    }catch(e){notify(failMessage(e),true);}
  }
  function initNewCampFormDefaults(){legacyDefaults();if($('new-camp-unit-price'))$('new-camp-unit-price').value='700000';updateNewCampRevenuePreview();}
  function updateNewCampRevenuePreview(){const n=Number(val('new-camp-limit')),p=Number(val('new-camp-unit-price')||700000);const amount=val('new-camp-billing')==='시범운영(무료)'?0:Number.isSafeInteger(n*p)&&n>=1&&n<=2000&&p>=0?n*p:0;text('new-camp-revenue-preview',money(amount));if($('new-camp-contract-amount'))$('new-camp-contract-amount').value=String(amount);}
  function openCampDetailModalById(id){const c=camp(id);if(!c)return;state.edit={campId:id,revision:c.revision,requestId:crypto.randomUUID()};text('camp-edit-context',c.campId+' · 변경 이력에 작업자가 기록됩니다.');const fields={name:c.name,candidate:c.candidate,stage:c.electionStage,election:c.electionType,sido:getCampSido(c),city:String(c.region||'').trim().split(/\s+/).slice(1).join(' '),district:c.district,party:c.party,staff:c.staff,manager:c.manager,phone:c.phone,email:c.adminEmail||c.requestedAdminEmail,start:c.startsOn,end:c.endsOn,tablets:c.tablets,price:c.unitPrice,amount:c.contractAmount};for(const [key,value] of Object.entries(fields))if($('edit-camp-'+key))$('edit-camp-'+key).value=String(value??'');openDialog('camp-edit-dialog');}
  async function saveCampEdit(){if(!state.edit)return;try{const draft=copy(state.edit),data=readCampForm('edit-camp-',false);await mutate('camp-edit-dialog',()=>rpc('easycall_admin_save_camp',{p_camp:data,p_expected_revision:draft.revision,p_request_id:draft.requestId}),()=>{$('camp-edit-dialog').classList.add('hidden');state.edit=null;});}catch(e){dialogError('camp-edit-dialog',failMessage(e));}}
  async function adjustCampTabletLimit(id,delta){const c=camp(id);if(!c)return;const next=Number(c.tablets)+delta;if(next<Math.max(1,c.registeredCount||0)||next>2000){notify('등록 대수 이상, 최대 2,000대 범위에서 변경하세요.',true);return;}if(!confirm(c.name+': 한도 '+c.tablets+' → '+next+'대. 계약 금액과 입금 기록은 유지됩니다. 변경하시겠습니까?'))return;const data={...copy(c),sido:getCampSido(c),city:String(c.region||'').split(/\s+/).slice(1).join(' '),tablets:next};await mutate(null,()=>rpc('easycall_admin_save_camp',{p_camp:data,p_expected_revision:c.revision,p_request_id:crypto.randomUUID()}));}
  async function masterToggleCampApproval(id){const c=camp(id);if(!c)return;const approve=c.approved===false;if(!confirm(c.name+'을 '+(approve?'승인':'중지')+'하시겠습니까? '+(approve?'계약기간이 유효할 때만 사용할 수 있습니다.':'이 캠프의 일반 계정 접근과 발신이 제한됩니다.')))return;const reason=prompt('변경 사유를 입력하세요.');if(!reason?.trim())return;await mutate(null,()=>rpc('easycall_admin_set_approval',{p_camp_id:id,p_approved:approve,p_reason:reason.trim(),p_expected_revision:c.revision,p_request_id:crypto.randomUUID()}));}
  async function openCampAccount(id){if(window.openWorkAccounts){window.openWorkAccounts(id);return;}return openLegacyCampAccount(id);}
  async function openLegacyCampAccount(id){const c=camp(id);if(!c)return;state.account={campId:id,requestId:crypto.randomUUID()};text('camp-account-context',c.name+' ('+id+')');if($('camp-account-email'))$('camp-account-email').value=c.adminEmail||c.requestedAdminEmail||'';text('camp-account-state',c.adminEmail?'연결된 계정: '+c.adminEmail+' · '+(c.adminConfirmed?'이메일 확인됨':'이메일 확인 대기'):'로그인 계정이 연결되지 않았습니다. 캠프 등록과 계정 발급은 별도입니다.');openDialog('camp-account-dialog');}
  async function linkCampAccount(){if(!state.account)return;const email=val('camp-account-email').toLowerCase();if(!confirm(email+'에 '+state.account.campId+' 캠프 관리자 권한을 연결합니다. 대상 이메일을 확인하셨습니까?'))return;const saved=await mutate('camp-account-dialog',()=>rpc('easycall_admin_link_account',{p_camp_id:state.account.campId,p_email:email,p_request_id:state.account.requestId}));if(saved)await openLegacyCampAccount(state.account.campId);}
  async function unlinkCampAccount(){const c=camp(state.account?.campId);if(!c?.adminEmail)return;if(!confirm(c.adminEmail+'의 '+c.name+' 관리자 접근 권한을 즉시 해제합니다. 진행하시겠습니까?'))return;const reason=prompt('연결 해제 사유를 입력하세요.');if(!reason?.trim())return;const ok=await mutate('camp-account-dialog',()=>rpc('easycall_admin_unlink_account',{p_camp_id:c.campId,p_email:c.adminEmail,p_reason:reason.trim(),p_request_id:crypto.randomUUID()}));if(ok)await openLegacyCampAccount(c.campId);}
  async function inviteCampAccount(){if(!state.account)return;const email=val('camp-account-email').toLowerCase();if(!confirm(email+'에 '+state.account.campId+' 관리자 초대를 발송하고 해당 캠프 관리 권한을 부여합니다. 진행하시겠습니까?'))return;const saved=await mutate('camp-account-dialog',async()=>{const {data,error}=await sbClient.functions.invoke('easycall-admin-invite',{body:{campId:state.account.campId,email,requestId:state.account.requestId,redirectTo:window.location.origin+window.location.pathname}});if(error)throw new Error('초대 함수 호출 실패: 배포 상태와 이메일 설정을 확인하세요.');if(data?.error)throw new Error(data.error);return data;});if(saved)await openLegacyCampAccount(state.account.campId);}
  async function resetCampAccountPassword(){const c=camp(state.account?.campId);if(!c?.adminEmail){dialogError('camp-account-dialog','먼저 실제 관리자 계정을 연결하세요.');return;}if(!confirm(c.adminEmail+'로 비밀번호 재설정 메일을 발송하시겠습니까?'))return;await mutate('camp-account-dialog',async()=>{const {error}=await sbClient.auth.resetPasswordForEmail(c.adminEmail,{redirectTo:window.location.origin+window.location.pathname});if(error)throw error;await rpc('easycall_admin_note_reset',{p_camp_id:c.campId});});}
  async function openCampPayments(id){const c=camp(id);if(!c)return;state.payment={campId:id,requestId:crypto.randomUUID()};text('camp-payment-context',c.name+' ('+id+')');text('camp-payment-summary','계약 '+money(c.contractAmount)+' · 실제 입금 '+money(c.paidAmount)+' · 미수 '+money(c.outstandingAmount));if($('payment-date'))$('payment-date').value=today();if($('payment-amount'))$('payment-amount').value='';openDialog('camp-payment-dialog');try{const rows=await rpc('easycall_admin_camp_payments',{p_camp_id:id});$('camp-payment-list').innerHTML=(rows||[]).map(r=>'<div class="p-3 bg-slate-950 rounded-xl">'+esc(r.paidOn)+' · '+money(r.amount)+' · '+esc(r.memo||'')+(r.voidedAt?' <span class="text-rose-400">취소됨</span>':' <button type="button" data-void-payment="'+esc(r.id)+'" class="text-amber-300 ml-2">기록 취소</button>')+'</div>').join('')||'입금 기록이 없습니다. 기존 완납 표시는 실제 입금 증빙으로 이관하지 않았습니다.';}catch(e){dialogError('camp-payment-dialog',failMessage(e));}}
  async function saveCampPayment(){if(!state.payment)return;const amount=Number(val('payment-amount'));if(!Number.isSafeInteger(amount)||amount<=0||amount>1e12){dialogError('camp-payment-dialog','입금액을 양의 정수로 입력하세요.');return;}const id=state.payment.campId;const saved=await mutate('camp-payment-dialog',()=>rpc('easycall_admin_record_payment',{p_camp_id:id,p_amount:amount,p_paid_on:val('payment-date'),p_memo:val('payment-memo'),p_request_id:state.payment.requestId}));if(saved)await openCampPayments(id);}
  async function voidPayment(id){if(!confirm('이 입금 기록을 취소 표시합니다. 실제 송금이나 환불은 실행하지 않습니다.'))return;const reason=prompt('취소 사유를 입력하세요.');if(!reason?.trim())return;const cid=state.payment?.campId;const saved=await mutate('camp-payment-dialog',()=>rpc('easycall_admin_void_payment',{p_payment_id:id,p_reason:reason.trim(),p_request_id:crypto.randomUUID()}));if(saved&&cid)await openCampPayments(cid);}
  async function openAudit(id=null){state.auditCamp=id;state.auditPage=0;openDialog('admin-audit-dialog');await loadAudit();}
  async function loadAudit(){try{const rows=await rpc('easycall_admin_audit',{p_camp_id:state.auditCamp,p_offset:state.auditPage*50});$('admin-audit-list').innerHTML=(rows||[]).map(r=>'<details class="bg-slate-950 rounded-xl p-3"><summary>'+esc(stamp(r.createdAt))+' · '+esc(r.actorEmail||r.actorId)+' · '+esc(r.action)+' · '+esc(r.campId||'전체')+'</summary><pre class="whitespace-pre-wrap break-all mt-2 text-slate-400">'+esc(JSON.stringify({before:r.before,after:r.after},null,2))+'</pre></details>').join('')||'변경 이력이 없습니다.';}catch(e){dialogError('admin-audit-dialog',failMessage(e));}}
  async function changeAuditPage(delta){state.auditPage=Math.max(0,state.auditPage+delta);await loadAudit();}
  async function openBackupManager(){openDialog('admin-backup-dialog');try{const data=await rpc('easycall_admin_backup_list');state.backup=data;state.schedule=data.scheduled;text('backup-schedule-state',data.scheduled?'매일 03:00(한국시간) 자동 백업 · 마지막 백업 '+stamp(data.lastBackupAt):'자동 백업 꺼짐 · 마지막 백업 '+stamp(data.lastBackupAt));if($('backup-schedule-button')){$('backup-schedule-button').textContent=data.scheduled?'자동 백업 끄기':'자동 백업 켜기';$('backup-schedule-button').disabled=!data.scheduleAvailable;} $('admin-backup-list').innerHTML=(data.items||[]).map(r=>'<div class="bg-slate-950 rounded-xl p-3"><div>'+esc(stamp(r.createdAt))+' · '+esc(r.kind)+' · 명부 '+r.voterCount+' / 통화 '+r.logCount+'</div><div class="text-slate-400 mt-1">복원 검증: '+esc(r.testedAt?stamp(r.testedAt):'미실행')+'</div><div class="flex flex-wrap gap-2 mt-2"><select data-backup-camp="'+esc(r.id)+'" class="bg-slate-800 rounded-lg p-1">'+campsList.map(c=>'<option value="'+esc(c.campId)+'">'+esc(c.name)+'</option>').join('')+'</select><button type="button" data-test-backup="'+esc(r.id)+'" class="text-indigo-300">복원 시험</button><button type="button" data-restore-backup="'+esc(r.id)+'" class="text-amber-300">선택 캠프 복원</button></div></div>').join('')||'백업이 없습니다.';}catch(e){dialogError('admin-backup-dialog',failMessage(e));}}
  async function createAdminBackup(){const saved=await mutate('admin-backup-dialog',()=>rpc('easycall_admin_create_backup'));if(saved)await openBackupManager();}
  async function toggleBackupSchedule(){if(!confirm(state.schedule?'정기 백업을 중지하시겠습니까?':'매일 03:00(한국시간)에 정기 백업을 실행합니다. 활성화하시겠습니까?'))return;const saved=await mutate('admin-backup-dialog',()=>rpc('easycall_admin_backup_schedule',{p_enabled:!state.schedule}));if(saved)await openBackupManager();}
  async function backupAction(id,restore){const select=document.querySelector('[data-backup-camp="'+id+'"]'),cid=select?.value;if(!cid)return;if(restore){if(!confirm(camp(cid)?.name+'의 업무 데이터를 이 백업 시점으로 복원합니다. 현재 상태를 먼저 자동 백업하며 인증 계정은 변경하지 않습니다. 진행하시겠습니까?'))return;const reason=prompt('복원 사유를 입력하세요.');if(!reason?.trim())return;const ok=await mutate('admin-backup-dialog',()=>rpc('easycall_admin_restore_backup',{p_backup_id:id,p_camp_id:cid,p_reason:reason.trim()}));if(ok)await openBackupManager();}else{const ok=await mutate('admin-backup-dialog',()=>rpc('easycall_admin_restore_check',{p_backup_id:id,p_camp_id:cid}));if(ok){await openBackupManager();notify('복원 시험 통과: 시험 변경은 모두 되돌렸습니다.');}}}
  async function openMyAccount(){text('my-account-summary',(verifiedIdentity?.email||'현재 계정')+' · '+(verifiedIdentity?.role==='super'?'최고관리자':'캠프 관리자')+' · 현재 계정만 변경합니다.');openDialog('my-account-dialog');try{const {data}=await sbClient.auth.mfa.getAuthenticatorAssuranceLevel();text('my-account-mfa',data?.currentLevel==='aal2'?'2단계 인증된 세션':'현재 세션은 1단계 인증입니다. 운영 전 2단계 인증 정책을 점검하세요.');}catch(e){text('my-account-mfa','인증 수준을 확인하지 못했습니다.');}}
  async function saveMyPassword(){
    if(delegated()){dialogError('my-account-dialog','대리접속을 종료한 뒤 본인 계정 화면에서 변경하세요.');return;}
    const password=$('my-account-password').value;
    if(password.length<12){dialogError('my-account-dialog','12자 이상의 비밀번호를 입력하세요.');return;}
    if(state.busy||!online())return;
    if(!confirm((verifiedIdentity?.email||'현재 계정')+'의 비밀번호를 변경합니다. 진행하시겠습니까?'))return;
    state.busy=true;
    try{
      const {data,error}=await sbClient.auth.getUser();if(error)throw error;
      if(!data?.user||data.user.id!==verifiedIdentity?.uid)throw new Error('현재 계정을 다시 확인한 뒤 로그인하세요.');
      const result=await sbClient.auth.updateUser({password});if(result.error)throw result.error;
      $('my-account-password').value='';dialogError('my-account-dialog','');notify('본인 계정 비밀번호를 변경했습니다.');
    }catch(e){dialogError('my-account-dialog',failMessage(e));}finally{state.busy=false;}
  }
  async function changeAdminPassword(){if(verifiedIdentity?.role!=='admin'||delegated()){notify('대리접속 중에는 비밀번호를 변경할 수 없습니다. 본사 계정 관리에서 대상 이메일을 확인하세요.',true);return;}openMyAccount();}
  async function handleLogout(){clearInterval(state.presenceTimer);if(verifiedIdentity?.role==='agent'&&online()){try{await rpc('easycall_heartbeat',{p_state:'offline'});}catch(e){}}await legacyLogout();}
  function masterResetCampPw(id){return openCampAccount(id);}
  function disconnectSupabase(){notify('온라인 연결이 필요한 서비스입니다. 연결 해제 상태에서는 저장할 수 없습니다.',true);}
  function saveAndConnectSupabase(){notify('연결 설정은 배포 환경에서 관리합니다. 이 화면에서는 설정을 변경하지 않습니다.');}
  function openSupabaseModal(){text('sb-test-result-box','인증된 연결을 기준으로 점검합니다.');if($('sb-url-input'))$('sb-url-input').value=DEFAULT_SB_URL;if($('sb-key-input'))$('sb-key-input').value='공개 키는 배포 설정에서 관리';$('supabase-config-modal').style.display='flex';}
  async function testSupabaseConnection(){try{const data=await rpc('easycall_connection_status');text('sb-test-result-box','연결 정상 · 서버 API '+data.version+' · '+stamp(data.serverTime));$('sb-test-result-box')?.classList.remove('hidden');updateCloudStatusBadges(true);}catch(e){text('sb-test-result-box',failMessage(e));$('sb-test-result-box')?.classList.remove('hidden');updateCloudStatusBadges(false);}}
  async function forcePushToCloud(){return refreshAdminData();}
  async function resetAllSystemData(){return openBackupManager();}
  Object.assign(window,{openEmailCampAccount:openLegacyCampAccount,initSupabaseEngine,activateVerifiedUser,pullStateFromSupabase,savePersistentData,refreshActiveRoleUI,updateCloudStatusBadges,renderSuperCampsTable,registerNewCampByMaster,initNewCampFormDefaults,updateNewCampRevenuePreview,openCampDetailModalById,adjustCampTabletLimit,masterToggleCampApproval,masterResetCampPw,changeAdminPassword,disconnectSupabase,saveAndConnectSupabase,openSupabaseModal,testSupabaseConnection,forcePushToCloud,resetAllSystemData,refreshAdminData,resetCampFilters,changeCampPage,toggleNewCampForm,saveCampEdit,unlinkCampAccount,linkCampAccount,inviteCampAccount,resetCampAccountPassword,saveCampPayment,changeAuditPage,openBackupManager,createAdminBackup,toggleBackupSchedule,openMyAccount,saveMyPassword,handleLogout});
  localStorage.removeItem('easycall_cloud_force_disabled');
  document.addEventListener?.('click',async event=>{
    const button=event.target.closest?.('button');if(!button)return;
    if(button.dataset.closeDialog)return closeDialog(button.dataset.closeDialog);
    const id=button.dataset.campId,action=button.dataset.campAction;
    if(action==='edit')openCampDetailModalById(id);else if(action==='visit'){state.configDirty=false;await impersonateCampAdmin(id);}else if(action==='quota-down')await adjustCampTabletLimit(id,-1);else if(action==='quota-up')await adjustCampTabletLimit(id,1);else if(action==='quota-five')await adjustCampTabletLimit(id,5);else if(action==='approval')await masterToggleCampApproval(id);else if(action==='account')await openLegacyCampAccount(id);else if(action==='payment')await openCampPayments(id);else if(action==='audit')await openAudit(id);
    if(button.dataset.voidPayment)await voidPayment(button.dataset.voidPayment);
    if(button.dataset.testBackup)await backupAction(button.dataset.testBackup,false);
    if(button.dataset.restoreBackup)await backupAction(button.dataset.restoreBackup,true);
  });
  document.addEventListener?.('input',event=>{if(event.target.closest?.('#admin-pane-config'))state.configDirty=true;});
  window.addEventListener('offline',()=>updateCloudStatusBadges(false));
  window.addEventListener('online',()=>refreshAdminData());
})();
