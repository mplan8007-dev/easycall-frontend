// One outstanding request per browser, staggered timers, bounded outage retries.
export class AdaptivePoller {
 constructor(task,{interval=25000,hiddenInterval=60000,maxDelay=120000,random=Math.random,setTimer=setTimeout,clearTimer=clearTimeout,isHidden=()=>false,isOnline=()=>true,onError=()=>{}}={}){
  Object.assign(this,{task,interval,hiddenInterval,maxDelay,random,setTimer,clearTimer,isHidden,isOnline,onError});this.active=false;this.running=false;this.failures=0;this.generation=0;
 }
 start(){this.stop();this.active=true;this.schedule(Math.floor(this.random()*this.interval));}
 stop(){this.active=false;this.generation++;this.clearTimer(this.timer);}
 schedule(delay){if(!this.active)return;this.clearTimer(this.timer);this.timer=this.setTimer(()=>this.tick(),delay);}
 poke(){if(this.active&&!this.running)this.schedule(0);}
 async tick(){
  if(!this.active)return;if(this.running){this.schedule(250);return;}
  const generation=this.generation;
  if(!this.isOnline()){this.schedule(this.hiddenInterval);return;}
  this.running=true;
  try{await this.task();this.failures=0;}catch(e){this.failures=Math.min(8,this.failures+1);this.onError(e);}finally{
   this.running=false;
   if(this.active&&generation===this.generation){const base=this.isHidden()?this.hiddenInterval:this.interval;this.schedule(Math.min(this.maxDelay,base*2**this.failures)*(0.8+this.random()*0.4));}
  }
 }
}
