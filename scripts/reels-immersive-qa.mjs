// Immersive acceptance against a fresh built-Worker fixture and isolated Chrome CDP port19488.
// Uses real Chromium media and native input; this is not physical-phone validation.
import assert from 'node:assert/strict';
import {writeFile,mkdir} from 'node:fs/promises';
async function connect(){
 const pages=await(await fetch('http://127.0.0.1:19488/json')).json();
 const ws=new WebSocket(pages.find(x=>x.type==='page').webSocketDebuggerUrl);
 await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
 let id=0;const pending=new Map(),events=[];
 ws.addEventListener('message',event=>{const x=JSON.parse(event.data);if(x.id){const p=pending.get(x.id);if(p){pending.delete(x.id);clearTimeout(p.timer);x.error?p.reject(new Error(JSON.stringify(x.error))):p.resolve(x.result);}}else events.push(x);});
 const call=(method,params={})=>new Promise((resolve,reject)=>{const next=++id;const timer=setTimeout(()=>{pending.delete(next);reject(Error('CDP timeout '+method));},20000);pending.set(next,{resolve,reject,timer});ws.send(JSON.stringify({id:next,method,params}));});
 const evaluate=async(expression,userGesture=false)=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true,userGesture});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
 const wait=async(expression,timeout=10000)=>{const end=Date.now()+timeout;while(Date.now()<end){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,100));}throw Error('Wait failed '+expression);};
 const navigate=async path=>{await call('Page.navigate',{url:path.startsWith('http')?path:'http://127.0.0.1:14888'+path});await wait('document.readyState === "complete"');};
 const screenshot=async path=>{const r=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(path,Buffer.from(r.data,'base64'));};
 await call('Runtime.enable');await call('Page.enable');await call('Network.enable');
 return {call,evaluate,wait,navigate,screenshot,events,targetId:pages.find(x=>x.type==='page').id,close:()=>ws.close()};
}

const c=await connect(), results=[];
const note=name=>{results.push(name);console.log('PASS',name);};
const output='docs/research/assets/2026-11-06-reels-immersive';await mkdir(output,{recursive:true});
const e=c.evaluate;
const click=id=>e(`document.getElementById(${JSON.stringify(id)}).click()`,true);
const ready=()=>c.wait(`document.querySelector('video')?.readyState>=2`);
const state=()=>e(`(()=>{const v=document.querySelector('video');return {src:v.getAttribute('src'),time:v.currentTime,paused:v.paused,muted:v.muted,speed:v.playbackRate,id:new URL(location.href).searchParams.get('at'),seed:new URL(location.href).searchParams.get('seed'),rs:new URL(location.href).searchParams.get('rs')}})()`);
const immersive=()=>c.wait(`document.getElementById('reels-root').classList.contains('is-immersive')`);
const normal=()=>c.wait(`!document.getElementById('reels-root').classList.contains('is-immersive')`);
const overlays=()=>e(`!document.getElementById('reels-root').classList.contains('overlays-hidden')`);
const key=async(key,code=key,windowsVirtualKeyCode)=>{await c.call('Input.dispatchKeyEvent',{type:'keyDown',key,code,windowsVirtualKeyCode});await c.call('Input.dispatchKeyEvent',{type:'keyUp',key,code,windowsVirtualKeyCode});};
const tap=async()=>{
 const r=await e(`(()=>{const r=document.getElementById('reels-track').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
 await c.call('Input.dispatchMouseEvent',{type:'mousePressed',...r,button:'left',clickCount:1});await c.call('Input.dispatchMouseEvent',{type:'mouseReleased',...r,button:'left',clickCount:1});
};
const tapControl=async id=>{const r=await e(`(()=>{const r=document.getElementById(${JSON.stringify(id)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);await c.call('Input.dispatchMouseEvent',{type:'mousePressed',...r,button:'left',clickCount:1});await c.call('Input.dispatchMouseEvent',{type:'mouseReleased',...r,button:'left',clickCount:1});};
const pause=async()=>{await ready();await e(`document.querySelector('video').pause()`,true);await c.wait(`document.querySelector('video').paused`);};
const fallback=async(kind='missing')=>{await e(`document.getElementById('reels-root').requestFullscreen=${kind==='missing'?'undefined':"()=>Promise.reject(new DOMException('Denied','NotAllowedError'))"}`);await click('reels-fullscreen');await immersive();};
const viewport=async(width,height)=>{await c.call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<900});await new Promise(r=>setTimeout(r,250));};
const geometry=()=>e(`(()=>{const r=document.getElementById('reels-track').getBoundingClientRect();const exit=document.getElementById('reels-exit-fullscreen').getBoundingClientRect();return {width:innerWidth,height:innerHeight,track:{x:r.x,y:r.y,width:r.width,height:r.height},exit:{x:exit.x,y:exit.y,width:exit.width,height:exit.height,right:exit.right,bottom:exit.bottom},scroll:document.documentElement.scrollHeight>innerHeight+1,overflow:document.documentElement.scrollWidth>innerWidth,fit:getComputedStyle(document.querySelector('video')).objectFit}})()`);
try{
 await viewport(390,844);await c.navigate('/reels?tag=travel');await ready();await pause();
 await e(`document.querySelector('video').currentTime=3;document.querySelector('video').muted=false;document.getElementById('reels-speed').value='1.5';document.getElementById('reels-speed').dispatchEvent(new Event('change'));`,true);
 await c.wait(`Math.abs(document.querySelector('video').currentTime-3)<.1 && !document.querySelector('video').seeking`);
 await click('reels-shuffle');const before=await state();
 await c.screenshot(output+'/normal-mobile.png');
 await fallback('rejected');assert.deepEqual(await state(),before);assert.equal(await e(`document.querySelector('video').controls`),false);note('Rejected browser fullscreen retains viewport fallback and exact paused media/session state');
 for(const [w,h,name] of [[390,844,'mobile'],[320,700,'narrow'],[844,390,'landscape'],[1440,1000,'desktop']]){
  await viewport(w,h);const g=await geometry();assert.ok(Math.abs(g.track.width-w)<2&&Math.abs(g.track.height-h)<2,JSON.stringify(g));assert.equal(g.overflow,false);assert.equal(g.scroll,false);assert.equal(g.fit,'contain');assert.ok(g.exit.width>=44&&g.exit.height>=44&&g.exit.x>=0&&g.exit.y>=0&&g.exit.right<=w&&g.exit.bottom<=h,JSON.stringify(g));
  const clipped=await e(`Array.from(document.querySelectorAll('[data-reels-overlay] button,[data-reels-overlay] a,[data-reels-overlay] select,[data-reels-overlay] input')).filter(x=>!x.hidden&&x.getClientRects().length).filter(x=>{const r=x.getBoundingClientRect();return r.x<0||r.y<0||r.right>innerWidth+1||r.bottom>innerHeight+1}).map(x=>x.id)`);assert.deepEqual(clipped,[]);
  await c.screenshot(output+'/'+name+'.png');note(`${w}x${h} immersive video fills viewport; controls/Exit contained; no page overflow`);
 }
 await viewport(390,844);await tap();assert.equal(await overlays(),false);assert.deepEqual(await state(),before);
 assert.equal(await e(`getComputedStyle(document.getElementById('reels-exit-fullscreen')).visibility`),'visible');
 const hiddenSafe=await e(`Array.from(document.querySelectorAll('[data-reels-overlay]')).every(x=>x.inert||x.hidden||getComputedStyle(x).visibility==='hidden')`);assert.equal(hiddenSafe,true);await c.screenshot(output+'/mobile-hidden.png');
 await tap();assert.equal(await overlays(),true);assert.deepEqual(await state(),before);note('Single tap hides/restores overlays without changing paused playback; Exit stays visible');
 await tapControl('reels-mute');assert.equal(await overlays(),true);assert.equal((await state()).muted,true);note('Overlay control action does not hide controls');
 const beforeSeek=await state();await e(`document.getElementById('reels-seek').focus()`);await key('ArrowRight','ArrowRight',39);await c.wait(`document.querySelector('video').currentTime>${beforeSeek.time}`);assert.equal((await state()).id,beforeSeek.id);assert.equal(await overlays(),true);note('Accessible seek slider changes time without navigating or hiding overlays');
 const slider=await e(`(()=>{const r=document.getElementById('reels-seek').getBoundingClientRect();return {x:r.x+r.width*.4,y:r.y+r.height/2,end:r.x+r.width*.7}})()`);
 await c.call('Input.dispatchMouseEvent',{type:'mousePressed',x:slider.x,y:slider.y,button:'left',clickCount:1});await c.call('Input.dispatchMouseEvent',{type:'mouseMoved',x:slider.end,y:slider.y,button:'left',buttons:1});await c.call('Input.dispatchMouseEvent',{type:'mouseReleased',x:slider.end,y:slider.y,button:'left',clickCount:1});assert.equal((await state()).id,beforeSeek.id);assert.equal(await overlays(),true);note('Pointer scrubbing stays on the same reel without toggling overlays');
 await tap();assert.equal(await overlays(),false);await key('Tab','Tab',9);assert.equal(await overlays(),true);
 assert.equal(await e(`!!document.activeElement.closest('[inert],[hidden]')`),false);note('Tab reveals hidden overlays and focuses an available control');
 await click('reels-ordered');await click('reels-previous');await ready(); // shuffle pinned first current; previous may be disabled at start
 await tap();assert.equal(await overlays(),false);const oldId=(await state()).id;
 await c.call('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});
 const r=await e(`(()=>{document.activeElement?.blur();const r=document.getElementById('reels-track').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height*.65,height:r.height}})()`);
 await c.call('Input.synthesizeScrollGesture',{x:r.x,y:r.y,yDistance:-Math.round(r.height*.6),speed:900,gestureSourceType:'touch'});
 await c.wait(`new URL(location.href).searchParams.get('at')!==${JSON.stringify(oldId)}`);await ready();assert.equal(await overlays(),false);assert.equal(await e(`document.querySelectorAll('video[src]').length`),1);note('Touch swipe across hidden-overlays video advances with one source and does not toggle controls');
 const wheelId=(await state()).id;await c.call('Input.synthesizeScrollGesture',{x:r.x,y:r.y,yDistance:-Math.round(r.height),speed:1600,gestureSourceType:'mouse'});await c.wait(`new URL(location.href).searchParams.get('at')!==${JSON.stringify(wheelId)}`);await ready();assert.equal(await overlays(),false);note('Wheel navigation also works across the immersive video without revealing overlays');
 await tap();assert.equal(await overlays(),true);await pause();const exitBefore=await state();await e(`document.getElementById('reels-seek').focus()`);await key('Escape','Escape',27);await normal();assert.deepEqual(await state(),exitBefore);assert.equal(await e(`document.querySelector('video').controls`),true);assert.equal(await e('document.activeElement.id'),'reels-fullscreen');note('Escape from a control restores normal layout/native controls/focus without changing media');
 await fallback();await click('reels-exit-fullscreen');await normal();assert.deepEqual(await state(),exitBefore);note('Missing fullscreen API and explicit Exit preserve state');
 await e(`document.activeElement.blur()`);await key('f','KeyF',70);await immersive();await key('Escape','Escape',27);await normal();note('F and Escape enter/exit the swipe-preserving mode');
 await c.navigate('/reels?tag=travel&at=61001');await ready();await pause();await fallback();assert.deepEqual(await e(`({width:document.querySelector('video').videoWidth,height:document.querySelector('video').videoHeight,fit:getComputedStyle(document.querySelector('video')).objectFit})`),{width:640,height:360,fit:'contain'});await c.screenshot(output+'/landscape-source.png');note('Landscape source remains uncropped in portrait viewport');
 await click('reels-exit-fullscreen');await normal();await viewport(1440,1000);await c.navigate('/reels?tag=travel');await ready();await pause();const nativeBefore=await state();await click('reels-fullscreen');await immersive();
 await c.wait(`document.fullscreenElement===document.getElementById('reels-root')`);assert.deepEqual(await state(),nativeBefore);note('Supported browser fullscreen targets the container, preserving player and overlays');
 await e(`document.getElementById('reels-exit-fullscreen').click();document.getElementById('reels-fullscreen').click()`,true);await c.wait(`!document.fullscreenElement`);await new Promise(r=>setTimeout(r,200));assert.equal(await e(`document.getElementById('reels-root').classList.contains('is-immersive')`),true);assert.deepEqual(await state(),nativeBefore);note('Rapid native Exit then re-entry retains the latest immersive intent as viewport fallback');
 await click('reels-exit-fullscreen');await normal();await click('reels-fullscreen');await c.wait(`document.fullscreenElement===document.getElementById('reels-root')`);
 await e(`document.exitFullscreen()`);await normal();assert.deepEqual(await state(),nativeBefore);assert.equal(await e('document.activeElement.id'),'reels-fullscreen');note('Browser fullscreen exit restores layout and entry focus');
 await viewport(390,844);await c.navigate('/reels?at=61024');await ready();await fallback();await tap();assert.equal(await overlays(),false);
 const errRect=await e(`(()=>{document.activeElement?.blur();const r=document.getElementById('reels-track').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height*.35,height:r.height}})()`);await c.call('Input.synthesizeScrollGesture',{x:errRect.x,y:errRect.y,yDistance:Math.round(errRect.height*.6),speed:900,gestureSourceType:'touch'});await c.wait(`document.getElementById('reels-status').textContent==='This video could not be played.'`);assert.equal(await overlays(),true);assert.equal(await e(`document.getElementById('reels-retry').hidden`),false);await c.screenshot(output+'/recovery.png');note('Missing-media failure reveals recovery controls from hidden-overlay mode');
 const log=await(await fetch('http://127.0.0.1:14888/__qa/log')).json();assert.equal(log.some(x=>x.method==='POST'||x.method==='DELETE'),false);note('Immersive interactions make no metadata/progress writes');
 // Watch retains its existing owner resume writes; check Reels-only requests before the Details round trip.
 await c.navigate('/reels?tag=travel');await ready();await pause();await fallback();const detailBefore=await state();await click('reels-details');await c.wait(`location.pathname.startsWith('/watch/')`);await e(`Array.from(document.querySelectorAll('a')).find(a=>a.textContent==='Back to Reels').click()`,true);await c.wait(`location.pathname==='/reels'`);await ready();const detailAfter=await state();assert.equal(detailAfter.id,detailBefore.id);assert.equal(detailAfter.rs,detailBefore.rs);assert.equal(detailAfter.paused,true);await normal();note('Details from immersive returns to the same reel paused in existing mode');
 assert.equal(c.events.filter(x=>x.method==='Runtime.exceptionThrown').length,0);note('No uncaught browser exceptions');
 await writeFile('.superpowers/reels-immersive-results.json',JSON.stringify({date:'2026-11-06',results},null,2));
}finally{c.close();}
