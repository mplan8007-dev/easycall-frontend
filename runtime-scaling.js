import './access-and-lists.js';
import {AdaptivePoller} from './runtime-scheduler.mjs';

(() => {
 'use strict';
 let poller=null,flight=null,revision=null,identityKey=null,lastGood=0,ownCounts={total:0,today:0};
 const key=()=>verifiedIdentity?[verifiedIdentity.uid,verifiedIdentity.role,verifiedIdentity.campId,verifiedIdentity.agentId].join(':'):null;
 const legacyLogout=window.handleLogout,legacyTabs=window.switchAgentTab,legacyGauge=window.updateAgentGoalGauge,legacyBadge=window.updateCallbackBadgeCount;
 async function easycallPullAgentState(){
  if(verifiedIdentity?.role!=='agent'||!sbClient)return;
  const actor=key(),cid=verifiedIdentity.campId;
  if(identityKey!==actor){revision=null;identityKey=actor;}
  if(flight?.actor===actor)return flight.promise;
  const promise=(async()=>{
   const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),12000);
   try{
    let request=sbClient.rpc('easycall_agent_control',{p_known_revision:revision,p_state:isAgentOnBreak?'break':'online',p_voter_id:activeClaim?.voterId||null});
    if(request.abortSignal)request=request.abortSignal(abort.signal);
    const {data,error}=await request;if(error)throw error;
    if(key()!==actor)return;
    if(data.camp)campsList=[ensureCampStructure(data.camp)];
    if(data.agent)agentsList=[ensureAgentStructure(data.agent)];
    if(data.config)campSettingsMap[cid]=data.config;
    if(data.ownCounts)ownCounts=data.ownCounts;
    window.easycallPrepareLists?.(cid);
    revision=data.revision;lastGood=Date.now();
    // Keep the current assignment and unsaved inputs; lists load only on demand.
    votersList=activeClaim?[activeClaim.voter]:[];
    if(activeClaim)currentVoterIdx=0;
    updateCloudStatusBadges(true);refreshActiveRoleUI();
   }finally{clearTimeout(timer);}
  })();
  flight={actor,promise};try{return await promise;}finally{if(flight?.promise===promise)flight=null;}
 }
 async function easycallStartRuntime(){
  poller?.stop();clearInterval(controlPollTimer);
  const agent=verifiedIdentity?.role==='agent';
  poller=new AdaptivePoller(async()=>{
   if(isSavingResult||isUploading)return;
   if(agent)await easycallPullAgentState();else{await pullStateFromSupabase();refreshActiveRoleUI();}
  },{interval:agent?25000:30000,hiddenInterval:60000,isHidden:()=>document.hidden,isOnline:()=>navigator.onLine!==false,onError:()=>updateCloudStatusBadges(false)});
  poller.start();
 }
 async function handleLogout(){poller?.stop();identityKey=null;revision=null;await legacyLogout();}
 function switchAgentTab(name){legacyTabs(name);if(name==='history')refreshDataPage('history');}
 function updateAgentGoalGauge(){
  if(verifiedIdentity?.role!=='agent'){legacyGauge();return;}
  const goal=Number(getCampConfig(getActiveCampId()).dailyGoal)||250,n=Number(ownCounts.today)||0,pct=Math.min(100,Math.round(n/goal*100));
  const txt=document.getElementById('agent-goal-txt'),bar=document.getElementById('agent-goal-bar');if(txt)txt.textContent=n+' / '+goal+'건 ('+pct+'%) · 오늘';if(bar)bar.style.width=pct+'%';
 }
 function updateCallbackBadgeCount(){if(verifiedIdentity?.role!=='agent'){legacyBadge();return;}const el=document.getElementById('callback-count-badge');if(el)el.textContent='조회';}
 function easycallRuntimeHealth(){return {backgroundMode:'compact-polling',lastSuccess:lastGood||null,requestPending:Boolean(flight),failures:poller?.failures||0,targetDevices:2000,capacityCertified:false};}
 Object.assign(window,{easycallPullAgentState,easycallStartRuntime,easycallRuntimeHealth,handleLogout,switchAgentTab,updateAgentGoalGauge,updateCallbackBadgeCount});
 window.addEventListener('online',()=>poller?.poke());
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)poller?.poke();});
 window.addEventListener('pagehide',()=>poller?.stop());
 window.addEventListener('pageshow',event=>{if(event.persisted&&verifiedIdentity)easycallStartRuntime();});
})();
