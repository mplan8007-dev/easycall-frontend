// Keep original controls and listeners while giving each task its own panel.
const $=id=>document.getElementById(id),config=$('admin-pane-config');
const tabs=['stats','contacts','agents','scripts','logs','config'];
const labels={stats:'현황',contacts:'연락처',agents:'전화담당자',scripts:'대본',logs:'통화기록',config:'설정'};
const nav=$('admin-tab-config-btn').parentElement;
nav.className='ec-admin-tabs';nav.setAttribute('aria-label','캠프 관리 메뉴');nav.setAttribute('role','tablist');
for(const tab of tabs){
 let button=$('admin-tab-'+tab+'-btn');
 if(!button){button=document.createElement('button');button.type='button';button.id='admin-tab-'+tab+'-btn';button.onclick=()=>window.switchAdminTab(tab);}
 button.textContent=labels[tab];button.setAttribute('role','tab');button.setAttribute('aria-controls',tab==='stats'||tab==='logs'?'admin-pane-'+tab:'admin-section-'+tab);nav.append(button);
}
const oldColumns=[...config.children];
const sections={};
for(const tab of ['contacts','agents','scripts','config']){const section=document.createElement('section');section.id='admin-section-'+tab;section.className='ec-admin-section';section.setAttribute('role','tabpanel');section.setAttribute('aria-labelledby','admin-tab-'+tab+'-btn');sections[tab]=section;config.append(section);}
function card(id){const node=$(id);return oldColumns.flatMap(col=>[...col.children]).find(el=>el.contains(node));}
const guide=config.querySelector('section[aria-label="캠프 업무 시작 안내"]');
const toolbar=document.createElement('div');toolbar.className='ec-admin-feedback';
toolbar.append(guide.querySelector('button'),$('admin-settings-status'));
$('admin-view').querySelector('header').after(toolbar);
guide.innerHTML='<h2>업무 준비 상태</h2><div id="admin-setup-checklist" class="ec-setup-grid"></div><p>통화 준비는 회선 설정을 검토한 뒤 전화담당자 기기에서 확인하세요.</p>';
$('admin-pane-stats').prepend(guide);
for(const [id,tab] of [['csv-file-input','contacts'],['agent-list-body','agents'],['scenario-step-1','scripts'],['faq-q-1','scripts']]){const el=card(id);if(el)sections[tab].append(el);}
// The stop/resume action remains readily available on the overview.
const operations=card('night-lock-enable'),statusCard=document.createElement('section');statusCard.className='ec-operation-status';statusCard.append(operations.firstElementChild);guide.after(statusCard);
for(const col of oldColumns){for(const item of [...col.children])sections.config.append(item);col.remove();}
config.classList.add('ec-admin-content');
for(const tab of ['stats','logs']){$('admin-pane-'+tab).setAttribute('role','tabpanel');$('admin-pane-'+tab).setAttribute('aria-labelledby','admin-tab-'+tab+'-btn');}
function readiness(){
 const cid=getActiveCampId(),stats=window.easycallAdminCounts?.(cid),agents=agentsList.filter(a=>a.campId===cid),cfg=getCampConfig(cid);
 const rows=[
  ['계정 준비',agents.length?agents.length+'명 등록 · 로그인 계정 상태 확인':'전화담당자를 등록하세요.','agents',agents.length?'계정 확인':'담당자 등록'],
  ['명부 등록',stats?Number(stats.voters.total).toLocaleString()+'명 · 서버 기준':'서버 명부 건수 확인 필요','contacts','명부 확인'],
  ['통화 준비 확인',cfg.callTransport==='sip'?'인터넷전화 · 각 기기에서 회선 연결 확인':'스마트폰 · 발신번호와 운영시간 확인','config','설정 확인'],
  ['업무 시작',cfg.globalStopped?'전화 업무 중지 중':'전화 업무 허용 중','stats','운영 상태 확인']
 ];
 const host=$('admin-setup-checklist');host.replaceChildren();
 for(const [heading,message,tab,action]of rows){const item=document.createElement('div'),title=document.createElement('h3'),text=document.createElement('p'),button=document.createElement('button');title.textContent=heading;text.textContent=message;button.type='button';button.textContent=action;button.onclick=()=>{window.switchAdminTab(tab);if(tab==='stats')$('btn-toggle-camp-call').focus();};item.append(title,text,button);host.append(item);}
}
window.easycallRefreshSetup=readiness;
window.switchAdminTab=tab=>{
 if(!tabs.includes(tab))tab='stats';
 for(const name of ['config','stats','logs'])$('admin-pane-'+name).classList.toggle('hidden',name!==(sections[tab]?'config':tab));
 for(const [name,section]of Object.entries(sections))section.hidden=name!==tab;
 for(const name of tabs){const button=$('admin-tab-'+name+'-btn');button.className='ec-admin-tab'+(name===tab?' is-active':'');button.setAttribute('aria-selected',String(name===tab));button.tabIndex=name===tab?0:-1;}
 sessionStorage.setItem('easycall_admin_tab',tab);
 if(tab==='stats'){renderStatsAndCharts();readiness();}
 if(tab==='agents')renderAdminAgentsList();
 if(tab==='contacts')updateVoterQueueStatusText();
 if(tab==='logs')renderAdminLogsTable();
};
nav.addEventListener('keydown',event=>{
 if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
 const buttons=[...nav.querySelectorAll('button')],index=buttons.indexOf(document.activeElement);if(index<0)return;
 event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?tabs.length-1:(index+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;
 window.switchAdminTab(tabs[next]);buttons[next].focus();
});
