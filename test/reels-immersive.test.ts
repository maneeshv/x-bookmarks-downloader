import test from 'node:test';
import assert from 'node:assert/strict';
import { createReelsPresentation, type ReelsPresentationPointer as Pointer } from '#src/reels-client';

const point = (value: Partial<Pointer> = {}): Pointer => ({id:1,x:20,y:20,time:0,primary:true,button:0,surface:true,...value});
function setup(request?: () => Promise<void>) {
  let fullscreen: 'root' | 'other' | null = null, exits = 0, focused = 0;
  const states: Array<[boolean,boolean]> = [];
  const presentation = createReelsPresentation({render:(active,visible) => states.push([active,visible]),focusEntry:() => {focused++;},fullscreen:() => fullscreen,request,exit:async () => {exits++;fullscreen=null;}});
  return {presentation,states,full:(value:typeof fullscreen) => {fullscreen=value;},get exits(){return exits;},get focused(){return focused;}};
}
const tick = async () => {await Promise.resolve();await Promise.resolve();};

test('missing or rejected browser fullscreen keeps immediate immersive viewport fallback',async () => {
  const absent=setup();absent.presentation.enter();assert.deepEqual(absent.states.at(-1),[true,true]);
  const rejected=setup(async () => {throw new Error('denied');});rejected.presentation.enter();await tick();assert.equal(rejected.presentation.active(),true);
  rejected.presentation.exit();assert.equal(rejected.focused,1);assert.deepEqual(rejected.states.at(-1),[false,true]);
});
test('native browser fullscreen exit returns to normal and restores entry focus',() => {
  const f=setup();f.presentation.enter();f.full('root');f.presentation.fullscreenChange();f.full(null);f.presentation.fullscreenChange();assert.equal(f.presentation.active(),false);assert.equal(f.focused,1);
});
test('exit before pending request resolves releases late native fullscreen without reopening mode',async () => {
  let finish!:()=>void;const f=setup(() => new Promise<void>(resolve => {finish=resolve;}));
  f.presentation.enter();f.presentation.exit();f.full('root');finish();await tick();assert.equal(f.presentation.active(),false);assert.equal(f.exits,1);
});
test('repeated entry while pending avoids duplicate requests and does not lose reentered mode',async () => {
  let finish!:()=>void,count=0;const f=setup(() => {count++;return new Promise<void>(resolve => {finish=resolve;});});
  f.presentation.enter();f.presentation.enter();f.presentation.exit();f.presentation.enter();f.full('root');finish();await tick();assert.equal(count,1);assert.equal(f.presentation.active(),true);assert.equal(f.exits,0);
});
test('only a short primary stationary video tap toggles overlays',() => {
  const f=setup();f.presentation.enter();
  const tap=(down:Partial<Pointer>={},up:Partial<Pointer>={}) => {f.presentation.pointerDown(point(down));f.presentation.pointerUp(point({time:100,...up}));};
  tap();assert.equal(f.presentation.visible(),false);tap();assert.equal(f.presentation.visible(),true);
  tap({surface:false});tap({primary:false});tap({button:2});tap({}, {time:600});tap({}, {y:90});assert.equal(f.presentation.visible(),true);
  f.presentation.pointerDown(point());f.presentation.pointerMove(point({x:80,time:20}));f.presentation.pointerUp(point({time:100}));assert.equal(f.presentation.visible(),true);
  f.presentation.pointerDown(point());f.presentation.pointerCancel(1);f.presentation.pointerUp(point({time:100}));assert.equal(f.presentation.visible(),true);
  f.presentation.pointerDown(point());f.presentation.pointerDown(point({id:2,primary:false}));f.presentation.pointerUp(point({id:2,time:100}));f.presentation.pointerUp(point({time:100}));assert.equal(f.presentation.visible(),true);
});
test('keyboard focus recovery reveals overlays before exiting to normal mode',() => {
  const f=setup();f.presentation.enter();f.presentation.pointerDown(point());f.presentation.pointerUp(point({time:100}));f.presentation.reveal();assert.equal(f.presentation.visible(),true);f.presentation.toggle();assert.equal(f.presentation.active(),false);
});

test('rendered immersive controls provide persistent exit and a labelled seek control',async () => {
  const {renderReels}=await import('#src/reels-html');
  const {parseReelsContext}=await import('#src/reels-context');
  const html=renderReels([{postId:'1',videoKey:'1-0.mp4',title:'Video',durationMs:1000,hasPoster:false}],parseReelsContext(new URL('https://test/reels'),{}));
  assert.match(html,/<main id="reels-root"/);
  assert.match(html,/<button id="reels-fullscreen"/);
  assert.match(html,/<button id="reels-exit-fullscreen"[^>]*hidden/);
  assert.match(html,/<input id="reels-seek"[^>]*aria-label="Seek video"/);
});

test('reentry during asynchronous native exit preserves latest immersive fallback intent',async () => {
  let fullscreen:'root'|null=null, requests=0, finishExit!:()=>void;
  const presentation=createReelsPresentation({render(){},focusEntry(){},fullscreen:()=>fullscreen,
    request:async()=>{requests++;fullscreen='root';},
    exit:()=>new Promise<void>(resolve=>{finishExit=()=>{fullscreen=null;presentation.fullscreenChange();resolve();};})});
  presentation.enter();await tick();presentation.fullscreenChange();
  presentation.exit();presentation.enter();await tick();finishExit();await tick();
  assert.equal(presentation.active(),true,'the latest Enter survives completion of the previous Exit');
  assert.equal(requests,1,'reentry uses fallback while native exit is pending');
  assert.equal(fullscreen,null);
});
