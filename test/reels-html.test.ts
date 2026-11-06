import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { renderReels } from '#src/reels-html';
import { parseReelsContext } from '#src/reels-context';
const context = parseReelsContext(new URL('https://test/reels'), {});

test('Reels safely embeds untrusted title and exposes one source-free native player', () => {
  const html=renderReels([{postId:'1',videoKey:'1-0.mp4',title:'</script><img src=x onerror=alert(1)>',durationMs:null,hasPoster:true}],context);
  assert.equal((html.match(/<video /g)||[]).length,1);
  assert.match(html,/<video [^>]*controls[^>]*playsinline[^>]*muted[^>]*loop/);
  assert.doesNotMatch(html,/<video [^>]*src=/);
  assert.doesNotMatch(html,/<\/script><img/);
  assert.match(html,/\\u003c\/script>/);
  const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert.equal(scripts.length,1);
  assert.doesNotThrow(() => new vm.Script(scripts[0]![1]!));
});

test('capacity and empty states contain no media or bootstrap and preserve return context', () => {
  for(const capacity of [false,true]) {
    const html=renderReels([],context,capacity);
    assert.doesNotMatch(html,/<video|<script>/);
    assert.match(html,capacity?/This selection is too large for Reels/:/No videos match this selection/);
    assert.match(html,/Back to library/);
  }
});

function browser(options: { stored?: string; suffix?: string; blocked?: boolean; empty?: boolean } = {}) {
  const c=parseReelsContext(new URL('https://test/reels?from=10001&q=mountain'+(options.suffix || '')), {q:'mountain',page:2,perPage:10});
  const html=renderReels((options.empty ? [] : [10001,10002,10003]).map(id=>({postId:String(id),videoKey:id+'-0.mp4',title:'Video '+id,durationMs:100000,hasPoster:true})),c);
  const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  const sandbox=vm.createContext({URL,URLSearchParams,crypto,Uint8Array,stored:options.stored || null,blocked:!!options.blocked});
  vm.runInContext(`
    class Element {
      constructor(){this.listeners={};this.hidden=false;this.textContent='';this.attrs={};this.clientHeight=400;this.scrollTop=0;this.src='';this.href='';this.currentTime=0;this.duration=100;this.paused=true;this.readyState=0;this.muted=true;this.playbackRate=1;this.defaultPlaybackRate=1;this.seeking=false;this.loads=0;this.plays=0;}
      addEventListener(name,fn){(this.listeners[name] ||= []).push(fn)}
      removeEventListener(name,fn){this.listeners[name]=(this.listeners[name]||[]).filter(f=>f!==fn)}
      emit(name,event={}){for(const fn of this.listeners[name]||[])fn(event)}
      setAttribute(name,value){this.attrs[name]=value}
      removeAttribute(name){delete this.attrs[name];if(name==='src')this.src=''}
      contains(value){return value===this}
      focus(){document.activeElement=this}
      closest(){return null}
      pause(){this.paused=true;this.emit('pause')}
      play(){this.plays++;this.paused=false;this.emit('play');this.emit('playing');return Promise.resolve()}
      load(){this.loads++;this.readyState=0;this.currentTime=0;this.playbackRate=this.defaultPlaybackRate;this.emit('ratechange')}
    }
    var elements={};
    var document=new Element();document.getElementById=id=>elements[id] ||= new Element();document.hidden=false;document.activeElement=null;
    var window=new Element(), frames=[],timeouts=[];
    var requestAnimationFrame=fn=>frames.push(fn);
    var setTimeout=fn=>timeouts.push(fn),clearTimeout=()=>{};
    var history={urls:[],replaceState(a,b,url){this.urls.push(url)}};
    var location={origin:'https://test',replacements:[],reloads:0,replace(url){this.replacements.push(url)},reload(){this.reloads++}};
    var sessionStorage={getItem(){if(blocked)throw Error('blocked');return stored},setItem(key,value){if(blocked)throw Error('blocked');stored=value}};
    function framesDone(){while(frames.length)frames.shift()()}
    function metadata(){elements['reels-video'].readyState=1;elements['reels-video'].emit('loadedmetadata')}
  `,sandbox);
  vm.runInContext(scripts[0]![1]!,sandbox);
  const run=(code:string) => vm.runInContext(code,sandbox);
  run('framesDone();metadata()');
  return {run,context:c};
}

test('browser navigation saves local time, replaces history and Details return stays paused', () => {
  const f=browser({suffix:'&at=10001'});
  f.run("elements['reels-video'].currentTime=27;elements['reels-next'].emit('click')");
  assert.match(f.run('history.urls.at(-1)'),/at=10002/);
  assert.match(f.run("elements['reels-details'].href"),/\/watch\/10002\?/);
  f.run("metadata();elements['reels-video'].currentTime=15;elements['reels-details'].emit('click')");
  const restored=browser({stored:f.run('stored'),suffix:new URL(f.run('history.urls.at(-1)'),'https://test').search.replace('?','&')});
  assert.equal(restored.run("elements['reels-video'].currentTime"),15);
  assert.equal(restored.run("elements['reels-video'].paused"),true);
  assert.equal(restored.run("elements['reels-video'].plays"),0);
});

test('first shuffle uses a fresh seed; order changes retain the current player and position', () => {
  const f=browser({suffix:'&at=10001'});
  f.run("elements['reels-video'].currentTime=27;elements['reels-shuffle'].emit('click')");
  const url=new URL(f.run('history.urls.at(-1)'),'https://test');
  assert.notEqual(url.searchParams.get('seed'),'00000001');
  assert.equal(f.run("elements['reels-video'].currentTime"),27);
  assert.equal(f.run("elements['reels-video'].loads"),2);
  assert.equal(url.searchParams.get('at'),'10001');
  f.run("elements['reels-ordered'].emit('click');elements['reels-shuffle'].emit('click')");
  assert.equal(new URL(f.run('history.urls.at(-1)'),'https://test').searchParams.get('seed'),url.searchParams.get('seed'));
});

test('storage failure remains usable, supplied session fallback remains paused and bfcache reloads once', () => {
  const f=browser({blocked:true,suffix:'&at=10001&rs='+ 'a'.repeat(32)});
  assert.match(f.run("elements['reels-notice'].textContent"),/storage unavailable/);
  assert.equal(f.run("elements['reels-video'].paused"),true);
  f.run("elements['reels-next'].emit('click');metadata();window.emit('pageshow',{persisted:true});window.emit('pageshow',{persisted:true});window.emit('pageshow',{persisted:false})");
  assert.equal(f.run('location.replacements.length'),1);
  assert.equal(f.run("elements['reels-video'].paused"),true);
});

test('scroll recenter cannot double navigate and keyboard respects interactive targets', () => {
  const f=browser({suffix:'&at=10001'});
  f.run("elements['reels-track'].scrollTop=800;elements['reels-track'].emit('scrollend');elements['reels-track'].emit('scrollend');framesDone()");
  assert.match(f.run('history.urls.at(-1)'),/at=10002/);
  f.run("document.emit('keydown',{key:'ArrowDown',target:{closest:()=>true},preventDefault(){throw Error('native key intercepted')}})");
  assert.match(f.run('history.urls.at(-1)'),/at=10002/);
  f.run("document.emit('keydown',{key:'ArrowDown',target:{closest:()=>null},preventDefault(){}})");
  assert.match(f.run('history.urls.at(-1)'),/at=10003/);
});

test('an emptied restored snapshot offers Start fresh with original filters and origin intact', () => {
  const first=browser({suffix:'&at=10001'});
  first.run("elements['reels-details'].emit('click')");
  const f=browser({empty:true,stored:first.run('stored'),suffix:new URL(first.run('history.urls.at(-1)'),'https://test').search.replace('?','&')});
  assert.equal(f.run("elements['reels-empty'].textContent"),'No videos remain in this session.');
  assert.equal(f.run("elements['reels-player'].hidden"),true);
  assert.equal(f.run("elements['reels-video'].src"),'');
  const fresh=new URL(f.run("elements['reels-fresh'].href"),'https://test');
  assert.equal(fresh.searchParams.get('rs'),null);
  assert.equal(fresh.searchParams.get('q'),'mountain');
  assert.equal(fresh.searchParams.get('from'),'10001');
});

test('navigation buttons take focus from native controls before changing the source', () => {
  const f=browser({suffix:'&at=10001'});
  f.run("document.activeElement=elements['reels-video'];elements['reels-next'].emit('click')");
  assert.match(f.run('history.urls.at(-1)'),/at=10002/);
  assert.equal(f.run("document.activeElement===elements['reels-next']"),true);
});


test('settled swipes work after native focus but cannot switch during an active seek or pointer interaction', () => {
  const f=browser({suffix:'&at=10001'});
  f.run("document.activeElement=elements['reels-video'];elements['reels-video'].seeking=true;elements['reels-track'].scrollTop=800;elements['reels-track'].emit('scrollend');framesDone()");
  assert.match(f.run('history.urls.at(-1)'),/at=10001/);
  f.run("elements['reels-video'].seeking=false;elements['reels-track'].emit('pointerdown');elements['reels-track'].scrollTop=800;elements['reels-track'].emit('scrollend')");
  assert.match(f.run('history.urls.at(-1)'),/at=10001/);
  f.run("window.emit('pointerup');elements['reels-track'].emit('scrollend')");
  assert.match(f.run('history.urls.at(-1)'),/at=10002/);
  assert.equal(f.run("document.activeElement===elements['reels-video']"),true);
});
