/* Layout annotations only; no account, assignment or calling state changes. */
const excluded='#briefing-report-modal';
let queued=false;
function enhanceTables(){
 queued=false;
 for(const table of document.querySelectorAll('#super-view table,#admin-view table,#agent-view table,[role="dialog"] table')){
  if(table.closest(excluded))continue;
  const headings=Array.from(table.querySelectorAll('thead tr:first-child th')).map(h=>h.textContent.replace(/\s+/g,' ').trim());
  if(!headings.length)continue;
  table.classList.add('ec-responsive-table');
  let parent=table.parentElement;
  if(parent&&!parent.matches('.ec-table-scroll,.overflow-x-auto,.ga-scroll')){const wrap=document.createElement('div');wrap.className='ec-table-scroll';parent.insertBefore(wrap,table);wrap.append(table);parent=wrap;}
  if(parent)parent.classList.add('ec-table-scroll');
  for(const body of table.tBodies)for(const row of body.rows){if(row.cells.length!==headings.length)continue;Array.from(row.cells).forEach((cell,i)=>{if(cell.colSpan===1&&cell.getAttribute('data-label')!==headings[i])cell.setAttribute('data-label',headings[i]);});}
 }
}
function schedule(){if(queued)return;queued=true;requestAnimationFrame(enhanceTables);}
const observer=new MutationObserver(changes=>{if(changes.some(c=>Array.from(c.addedNodes).some(n=>n.nodeType===1&&(n.matches('table,tr,td,th')||n.querySelector('table,tr')))))schedule();});
observer.observe(document.body,{childList:true,subtree:true});enhanceTables();

// Keep secondary work controls available without consuming the mobile header.
const agentHeader=document.querySelector('#agent-view>header');
if(agentHeader){
 document.getElementById('tab-dialer-btn')?.parentElement.classList.add('ec-agent-tabs');
 const host=agentHeader.lastElementChild,menu=document.createElement('details');menu.className='ec-work-menu';
 const summary=document.createElement('summary');summary.textContent='업무 메뉴';menu.append(summary);
 const panel=document.createElement('div');panel.className='ec-work-menu-panel';menu.append(panel);
 const goal=host.querySelector('.w-44'),identity=document.getElementById('agent-display-id')?.parentElement,logout=host.querySelector('button[onclick="handleLogout()"]');
 for(const item of [goal,identity,logout])if(item)panel.append(item);
 host.append(menu);
 document.addEventListener('click',event=>{if(!menu.contains(event.target))menu.open=false;});
 menu.addEventListener('keydown',event=>{if(event.key==='Escape'){menu.open=false;summary.focus();}});
}

