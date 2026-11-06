// Run against a fresh scripts/reels-preview.mjs fixture and isolated Chrome CDP port19488.
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
const evalJS=c.evaluate;
const click=id=>evalJS(`document.getElementById(${JSON.stringify(id)}).click()`,true);
const state=()=>evalJS(`({id:new URL(location.href).searchParams.get('at'),rs:new URL(location.href).searchParams.get('rs'),seed:new URL(location.href).searchParams.get('seed'),position:document.getElementById('reels-position')?.textContent,time:document.querySelector('video')?.currentTime,paused:document.querySelector('video')?.paused,muted:document.querySelector('video')?.muted,sources:document.querySelectorAll('video[src]').length})`);
const ready=()=>c.wait(`document.getElementById('reels-video')?.readyState>=2`);
const step=async id=>{await click(id);await ready();await new Promise(r=>setTimeout(r,250));};
const output='docs/research/assets/2026-11-06-reels-implementation';await mkdir(output,{recursive:true});
try{
 await c.call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 await c.navigate('/?tag=travel&q=Trail&page=2&perPage=10');
 const href=await evalJS(`Array.from(document.querySelectorAll('a')).find(a=>a.textContent.trim()==='Reels').getAttribute('href')`);
 assert.equal(new URL(href,'http://local').searchParams.get('at'),'61014');
 await c.navigate(href);await ready();
 let s=await state();assert.equal(s.id,'61014');assert.equal(s.position,'11 of 24');assert.equal(s.muted,true);assert.equal(s.paused,false);assert.equal(s.sources,1);note('Library page2 enters complete24-item selection at first displayed card; muted playback');
 await step('reels-next');s=await state();assert.equal(s.id,'61013');
 await step('reels-previous');assert.equal((await state()).id,'61014');note('Previous/Next reverse exactly one item');
 await evalJS(`document.getElementById('reels-video').pause();document.getElementById('reels-video').currentTime=3;`,true);
 await c.wait(`Math.abs(document.querySelector('video').currentTime-3)<.1`);
 await click('reels-shuffle');s=await state();assert.notEqual(s.seed,'00000001');assert.equal(s.id,'61014');assert.equal(s.paused,true);const shuffled=await evalJS(`JSON.parse(sessionStorage.getItem('reels:sessions:v1')).find(s=>s.rs===new URL(location.href).searchParams.get('rs')).shuffled`);assert.equal(new Set(shuffled).size,24);
 await click('reels-ordered');await click('reels-shuffle');assert.deepEqual(await evalJS(`JSON.parse(sessionStorage.getItem('reels:sessions:v1')).find(s=>s.rs===new URL(location.href).searchParams.get('rs')).shuffled`),shuffled);note('Shuffle generates seed, visits unique full membership, preserves current time/pause and saved permutation');
 await click('reels-reshuffle');assert.equal((await state()).position,'1 of 24');assert.equal((await state()).id,'61014');note('Reshuffle pins current item without restarting');
 const original=await state();await click('reels-details');await c.wait(`location.pathname==='/watch/61014'`);await c.wait(`document.querySelector('a[href^="/reels"]')!==null`);
 await evalJS(`Array.from(document.querySelectorAll('a')).find(a=>a.textContent==='Back to Reels').click()`,true);await c.wait(`location.pathname==='/reels'`);await ready();s=await state();assert.equal(s.id,original.id);assert.equal(s.rs,original.rs);assert.equal(s.paused,true);assert.ok(Math.abs(s.time-3)<.3);note('Details return restores same session/item/time paused');
 const library=await evalJS(`document.getElementById('reels-library').getAttribute('href')`);assert.match(library,/page=2/);assert.match(library,/#video-61014$/);note('Original Library filters/page/card preserved after shuffle');
 await c.screenshot(output+'/desktop.png');
 // Real wheel gesture through the snap track, body receives no separate scrolling.
 await click('reels-ordered');const before=await state();
 const rect=await evalJS(`(()=>{const r=document.getElementById('reels-track').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,height:r.height}})()`);
 await c.call('Input.synthesizeScrollGesture',{x:rect.x,y:rect.y,yDistance:-Math.round(rect.height),speed:1800,gestureSourceType:'mouse'});
 await c.wait(`new URL(location.href).searchParams.get('at')==='61013'`);assert.equal((await state()).sources,1);note('Wheel snap advances one item with one active source');
 // Mobile viewports and short landscape remain usable.
 for(const [width,height,name] of [[390,844,'mobile'],[320,700,'narrow'],[844,390,'landscape']]){
  await c.call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:true});await new Promise(r=>setTimeout(r,350));
  const geometry=await evalJS(`({overflow:document.documentElement.scrollWidth>innerWidth,bodyScroll:document.documentElement.scrollHeight>innerHeight+1,buttons:['reels-library','reels-fresh','reels-previous','reels-next','reels-details'].map(id=>{const e=document.getElementById(id),r=e.getBoundingClientRect();return {id,visible:r.width>0&&r.height>0,x:r.x,y:r.y,right:r.right,bottom:r.bottom}})})`);
  assert.equal(geometry.overflow,false,JSON.stringify(geometry));assert.ok(geometry.buttons.every(x=>x.visible&&x.x>=0&&x.right<=width&&x.bottom<=height),JSON.stringify(geometry));
  await c.screenshot(output+'/'+name+'.png');note(`${width}x${height} controls visible without horizontal overflow`);
 }
 await c.call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
 await c.call('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});
 const touchRect=await evalJS(`(()=>{document.activeElement?.blur();const r=document.getElementById('reels-track').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height*.75,height:r.height}})()`);
 await c.call('Input.synthesizeScrollGesture',{x:touchRect.x,y:touchRect.y,yDistance:-Math.round(touchRect.height*.75),speed:900,gestureSourceType:'touch'});
 await c.wait(`new URL(location.href).searchParams.get('at')==='61012'`);note('Emulated touch swipe advances one reel');
 await evalJS(`document.querySelector('video').pause()`,true);const paused=await state();
 await c.call('Emulation.setDeviceMetricsOverride',{width:400,height:850,deviceScaleFactor:1,mobile:true});await new Promise(r=>setTimeout(r,300));assert.equal((await state()).paused,true);assert.equal((await state()).id,paused.id);note('Explicit pause survives resize/recenter');
 await c.navigate('/reels?tag=broken');await c.wait(`document.getElementById('reels-status')?.textContent==='This video could not be played.'`);assert.equal(await evalJS(`document.getElementById('reels-retry').hidden`),false);await click('reels-retry');await c.wait(`document.getElementById('reels-status')?.textContent==='This video could not be played.'`);note('Missing media gives retry/reload without silent skip');
 await c.navigate('/reels?q=no-such-fixture');assert.match(await evalJS('document.body.textContent'),/No videos match this selection/);assert.equal(await evalJS('document.querySelectorAll("video[src]").length'),0);note('Empty selection has no media source');
 await c.navigate('/reels?tag=travel&at=61001');await ready();assert.deepEqual(await evalJS(`({width:document.querySelector('video').videoWidth,height:document.querySelector('video').videoHeight,fit:getComputedStyle(document.querySelector('video')).objectFit})`),{width:640,height:360,fit:'contain'});note('Landscape source keeps full aspect ratio');
 // Exercise policy/state fixes against native Chrome media, not doubles.
 await c.navigate('/reels?tag=travel');await ready();const traceStart=c.events.length;
 await evalJS(`document.getElementById('reels-speed').value='1.5';document.getElementById('reels-speed').dispatchEvent(new Event('change'));`,true);
 await step('reels-next');assert.equal(await evalJS(`document.querySelector('video').playbackRate`),1.5);assert.equal(await evalJS(`document.getElementById('reels-speed').value`),'1.5');note('Playback speed persists across actual source load');
 await step('reels-previous');await evalJS(`document.querySelector('video').focus()`,true);
 const focusRect=await evalJS(`(()=>{const r=document.getElementById('reels-track').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height*.75,height:r.height}})()`);
 await c.call('Input.synthesizeScrollGesture',{x:focusRect.x,y:focusRect.y,yDistance:-Math.round(focusRect.height*.75),speed:900,gestureSourceType:'touch'});
 await c.wait(`new URL(location.href).searchParams.get('at')==='61023'`);note('Swipe works after native video retains focus');
 await evalJS(`document.querySelector('video').focus()`,true);const nativeId=(await state()).id;
 await c.call('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowRight',code:'ArrowRight',windowsVirtualKeyCode:39});await c.call('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowRight',code:'ArrowRight',windowsVirtualKeyCode:39});assert.equal((await state()).id,nativeId);note('Native video keyboard seeking does not navigate reels');
 await evalJS(`document.querySelector('video').blur();document.getElementById('reels-play').click()`,true);
 const extra=await c.call('Target.createTarget',{url:'about:blank'});await c.call('Target.activateTarget',{targetId:extra.targetId});
 await c.wait('document.hidden');assert.equal((await state()).paused,true);
 await c.call('Target.activateTarget',{targetId:c.targetId});await c.wait('!document.hidden');assert.equal((await state()).paused,true);await c.call('Target.closeTarget',{targetId:extra.targetId});note('Actual tab hide/show pauses and does not restart');
 const reelRequests=c.events.slice(traceStart).filter(x=>x.method==='Network.requestWillBeSent').map(x=>x.params.request);assert.equal(reelRequests.filter(x=>x.method!=='GET').length,0);note('Reels interactions make no metadata/progress writes');
 // Existing Details editor remains authoritative, with refreshed metadata on return.
 await click('reels-details');await c.wait(`location.pathname==='/watch/61023'`);await c.wait(`document.getElementById('meta')!==null`);
 await evalJS(`document.querySelector('#meta input[name="title"]').value='Edited trail study';document.getElementById('meta').requestSubmit()`,true);await c.wait(`document.getElementById('msg').textContent.includes('Saved')`);
 await evalJS(`Array.from(document.querySelectorAll('a')).find(a=>a.textContent==='Back to Reels').click()`,true);await c.wait(`location.pathname==='/reels'`);await ready();assert.equal(await evalJS(`document.getElementById('reels-title').textContent`),'Edited trail study');assert.equal((await state()).id,'61023');assert.equal((await state()).paused,true);note('Details title edit refreshes metadata without changing current item');
 await click('reels-details');await c.wait(`location.pathname==='/watch/61023'`);await c.wait(`document.getElementById('del')!==null`);
 await evalJS(`window.confirm=()=>true;document.getElementById('del').click()`,true);await c.wait(`location.pathname==='/reels'`);await ready();assert.equal((await state()).id,'61022');assert.equal((await state()).paused,true);note('Details Delete returns to deterministic surviving successor paused');
 // Storage loss falls back honestly and stays paused on a return URL.
 const fallbackUrl=await evalJS('location.href');await click('reels-details');await c.wait(`location.pathname.startsWith('/watch/')`);await evalJS('sessionStorage.clear()');await c.navigate(fallbackUrl);await ready();assert.equal((await state()).paused,true);assert.match(await evalJS(`document.getElementById('reels-notice').textContent`),/Previous session unavailable/);note('Lost storage preserves requested item and reports fallback, paused');
 // Viewers get the same player and read-only Details, with no mutation surface.
 await evalJS(`fetch('/__qa/role?viewer=1')`);await c.navigate('/reels?tag=travel');await ready();await click('reels-details');await c.wait(`location.pathname.startsWith('/watch/')`);await c.wait('document.readyState==="complete"');assert.equal(await evalJS('document.getElementById("meta")'),null);assert.equal(await evalJS(`fetch('/api/videos/61024',{method:'POST',headers:{'content-type':'application/json'},body:'{}'}).then(r=>r.status)`),403);note('Viewer can browse Reels/Details but mutation remains403');await evalJS(`fetch('/__qa/role?viewer=0')`);
 const errors=c.events.filter(x=>x.method==='Runtime.exceptionThrown');assert.deepEqual(errors,[]);note('No uncaught browser exceptions');
 await writeFile('.superpowers/reels-browser-results.json',JSON.stringify({passed:results},null,2));
}finally{c.close();}
