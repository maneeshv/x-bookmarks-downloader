import test from 'node:test';
import assert from 'node:assert/strict';
import { createReelsController, type ReelsMedia } from '#src/reels-client';

class Media implements ReelsMedia {
  src = ''; currentTime = 0; duration = 100; muted = true; playbackRate = 1; defaultPlaybackRate = 1; paused = true; readyState = 0;
  listeners = new Map<string, Set<() => void>>(); plays = 0; loads = 0;
  playResult: () => Promise<void> = async () => { this.paused = false; this.emit('playing'); };
  play() { this.plays++; return this.playResult(); }
  pause() { this.paused = true; this.emit('pause'); }
  load() { this.loads++; this.readyState = 0; this.playbackRate = this.defaultPlaybackRate; this.emit('ratechange'); }
  removeAttribute() { this.src = ''; }
  addEventListener(name: string, listener: () => void) { const set = this.listeners.get(name) ?? new Set(); set.add(listener); this.listeners.set(name, set); }
  removeEventListener(name: string, listener: () => void) { this.listeners.get(name)?.delete(listener); }
  emit(name: string) { for (const callback of this.listeners.get(name) ?? []) callback(); }
  metadata() { this.readyState = 1; this.emit('loadedmetadata'); }
}
const fixture = () => {
  const media = new Media(), statuses: string[] = [], positions: Array<[string,number,boolean]> = [], preferences: Array<[boolean,number]> = [];
  let visible = true;
  const controller = createReelsController(media, { visible: () => visible, status: value => statuses.push(value), save: (id, position, paused) => positions.push([id,position,paused]), preferences: (muted,speed) => preferences.push([muted,speed]) });
  return {media,controller,statuses,positions,preferences,hide: () => {visible=false;controller.suspend();}};
};
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

test('source switch captures outgoing time, restores bounded time and leaves a restored entry paused', async () => {
  const f = fixture(); f.controller.open('1','/v/1-0.mp4',20,true,true,1); f.media.metadata(); await tick();
  assert.equal(f.media.currentTime,20); assert.equal(f.media.paused,false);
  f.media.currentTime=31; f.controller.open('2','/v/2-0.mp4',150,false,false,1.5); f.media.metadata();
  assert.deepEqual(f.positions.at(-1),['1',31,false]); assert.equal(f.media.currentTime,0); assert.equal(f.media.paused,true); assert.equal(f.media.muted,false); assert.equal(f.media.playbackRate,1.5);
});

test('stale play rejection cannot change a newer current source', async () => {
  const f=fixture(); let reject!: (reason: Error) => void;
  f.media.playResult=() => new Promise((_,no) => {reject=no;});
  f.controller.open('1','/v/1-0.mp4',0,true,true,1); f.media.metadata();
  f.controller.open('2','/v/2-0.mp4',0,false,true,1); f.media.metadata();
  reject(new Error('old failure')); await tick(); assert.equal(f.statuses.at(-1),'paused'); assert.equal(f.media.src,'/v/2-0.mp4');
});

test('unmuted denial retries muted once and then offers explicit play', async () => {
  const f=fixture(); f.media.playResult=async () => {throw new DOMException('denied','NotAllowedError');};
  f.controller.open('1','/v/1-0.mp4',0,true,false,1); f.media.metadata(); await tick();
  assert.equal(f.media.plays,2); assert.equal(f.media.muted,true); assert.equal(f.statuses.at(-1),'tap');
});

test('pause and background invalidate pending playback and do not auto-resume', async () => {
  const f=fixture(); let finish!: () => void;
  f.media.playResult=() => new Promise(resolve => {finish=() => {f.media.paused=false;resolve();};});
  f.controller.open('1','/v/1-0.mp4',0,true,true,1); f.media.metadata(); f.hide(); finish(); await tick();
  assert.equal(f.media.paused,true); assert.equal(f.statuses.at(-1),'paused');
});

test('native pause persists intent, ended loops only intended playback, errors stay recoverable', async () => {
  const f=fixture(); f.controller.open('1','/v/1-0.mp4',0,true,true,1); f.media.metadata(); await tick();
  f.media.pause(); f.media.emit('ended'); await tick(); assert.equal(f.media.plays,1);
  f.controller.toggle(); await tick(); f.media.emit('ended'); await tick(); assert.equal(f.media.plays,3);
  f.media.emit('error'); assert.equal(f.statuses.at(-1),'error'); f.controller.retry(); f.media.metadata(); await tick(); assert.equal(f.media.plays,4);
});

test('loading Retry and background preserve the saved position before metadata arrives', () => {
  const f=fixture(); f.controller.open('1','/v/1-0.mp4',42,false,true,1);
  f.controller.retry(); f.hide(); f.media.metadata();
  assert.equal(f.media.currentTime,42); assert.equal(f.media.paused,true);
  assert.deepEqual(f.positions.at(-1),['1',42,true]);
});

test('unsupported or network play rejection shows a playback error rather than policy fallback', async () => {
  const f=fixture(); f.media.playResult=async () => {throw new DOMException('network unavailable','NetworkError');};
  f.controller.open('1','/v/1-0.mp4',0,true,true,1); f.media.metadata(); await tick();
  assert.equal(f.statuses.at(-1),'error'); assert.equal(f.media.plays,1);
});

test('replaced-source callbacks and canceled native errors cannot fail the current clip', () => {
  const f=fixture(); f.controller.open('1','/v/1-0.mp4',0,true,true,1);
  const staleError=[...f.media.listeners.get('error')!][0]!;
  f.controller.open('2','/v/2-0.mp4',0,false,true,1);
  staleError(); assert.equal(f.statuses.at(-1),'loading');
  Object.assign(f.media,{error:null}); f.media.emit('error');
  assert.equal(f.statuses.at(-1),'loading');
  f.media.emit('ended'); assert.equal(f.media.plays,0);
});


test('source resets retain the selected speed without persisting the load default', () => {
  const f=fixture(); f.controller.open('1','/v/1-0.mp4',0,false,true,1); f.media.metadata();
  f.controller.speed(1.5); f.preferences.length=0;
  f.controller.open('2','/v/2-0.mp4',0,false,true,1.5);
  assert.equal(f.media.playbackRate,1.5);
  assert.ok(f.preferences.every(([,speed]) => speed===1.5));
  f.media.metadata(); assert.equal(f.media.playbackRate,1.5);
  f.controller.speed(1.75); f.controller.retry(); f.media.metadata();
  assert.equal(f.media.playbackRate,1.75);
});
