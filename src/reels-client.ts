/** The deliberately small media boundary keeps browser policy races testable without a DOM dependency. */
export interface ReelsMedia {
  src: string; currentTime: number; duration: number; muted: boolean; playbackRate: number; defaultPlaybackRate: number; paused: boolean; readyState: number; error?: unknown | null;
  play(): Promise<void>; pause(): void; load(): void; removeAttribute(name: string): void;
  addEventListener(name: string, listener: () => void): void;
  removeEventListener(name: string, listener: () => void): void;
}
export interface ReelsMediaHooks {
  visible(): boolean;
  status(value: string): void;
  save(id: string, position: number, paused: boolean): void;
  preferences(muted: boolean, speed: number): void;
}

// Self-contained: the renderer emits this exact tested implementation into the page.
export function createReelsController(media: ReelsMedia, hooks: ReelsMediaHooks) {
  let id = '', source = '', generation = 0, attempt = 0, intended = false, ready = false, savedPosition = 0;
  let listeners: Array<[string, () => void]> = [];
  const position = () => { const value = ready ? media.currentTime : savedPosition; return Number.isFinite(value) ? Math.max(0, value) : 0; };
  const capture = () => { if (id) hooks.save(id, position(), !intended); };
  const status = (value: string) => hooks.status(value);
  const pause = () => { intended = false; attempt++; media.pause(); capture(); status('paused'); };
  const play = async (fallback = false) => {
    if (!hooks.visible()) { pause(); return; }
    intended = true;
    const ownGeneration = generation, ownAttempt = ++attempt;
    try {
      await media.play();
      if (ownGeneration !== generation) return;
      if (ownAttempt !== attempt || !intended || !hooks.visible()) { if (!intended || !hooks.visible()) media.pause(); return; }
      status(media.paused ? 'paused' : 'playing');
    } catch (error) {
      if (ownGeneration !== generation || ownAttempt !== attempt || !intended) return;
      const name = error && typeof error === 'object' && 'name' in error ? error.name : '';
      if (name === 'AbortError') return;
      if (name !== 'NotAllowedError') { intended = false; status('error'); capture(); return; }
      if (!media.muted && !fallback) {
        media.muted = true; hooks.preferences(true, media.playbackRate); status('muted'); await play(true);
      } else { intended = false; status('tap'); capture(); }
    }
  };
  const bind = (name: string, callback: () => void) => {
    const ownGeneration = generation;
    const listener = () => { if (ownGeneration === generation) callback(); };
    listeners.push([name, listener]); media.addEventListener(name, listener);
  };
  const open = (nextId: string, nextSource: string, position: number, autoplay: boolean, muted: boolean, speed: number) => {
    capture(); generation++; attempt++;
    for (const [name, listener] of listeners) media.removeEventListener(name, listener);
    listeners = []; ready = false; intended = false;
    // load() restores defaultPlaybackRate; set both rates before any new-source events.
    media.defaultPlaybackRate = speed;
    media.pause(); media.removeAttribute('src'); media.load();
    id = nextId; source = nextSource; savedPosition = position;
    intended = autoplay && hooks.visible(); media.muted = muted; media.playbackRate = speed;
    bind('loadedmetadata', () => {
      if (ready || media.readyState < 1) return;
      ready = true;
      if (Number.isFinite(media.duration) && media.duration > 0) media.currentTime = Number.isFinite(savedPosition) && savedPosition > 0 && savedPosition < media.duration ? savedPosition : 0;
      if (intended) void play(); else status('paused');
    });
    bind('play', () => {
      if (!ready || !hooks.visible()) { if (!hooks.visible()) pause(); return; }
      if (!media.paused) intended = true;
    });
    bind('playing', () => { if (ready && hooks.visible() && !media.paused) { intended = true; status('playing'); } });
    bind('pause', () => { if (ready && media.paused) { intended = false; attempt++; capture(); status('paused'); } });
    bind('seeked', capture);
    bind('volumechange', () => hooks.preferences(media.muted, media.playbackRate));
    bind('ratechange', () => {
      if (media.defaultPlaybackRate !== media.playbackRate) media.defaultPlaybackRate = media.playbackRate;
      hooks.preferences(media.muted, media.playbackRate);
    });
    bind('waiting', () => { if (ready && intended) status('buffering'); });
    bind('stalled', () => { if (intended) status('buffering'); });
    bind('error', () => { if (media.error === null) return; intended = false; attempt++; status('error'); capture(); });
    bind('ended', () => { if (ready && intended && hooks.visible()) { media.currentTime = 0; void play(); } });
    media.src = source; media.load(); media.playbackRate = speed; status('loading');
  };
  return {
    open, capture, suspend: pause,
    toggle() { if (intended && !media.paused) pause(); else void play(); },
    retry() { open(id, source, position(), true, media.muted, media.playbackRate); },
    seek(delta: number) { if (ready && Number.isFinite(media.duration)) { media.currentTime = Math.max(0, Math.min(media.duration, media.currentTime + delta)); capture(); } },
    mute() { media.muted = !media.muted; hooks.preferences(media.muted, media.playbackRate); },
    speed(value: number) { if ([0.5,0.75,1,1.25,1.5,1.75,2].includes(value)) { media.defaultPlaybackRate = value; media.playbackRate = value; hooks.preferences(media.muted,value); } },
  };
}

// Browser-only DOM wiring stays plain JavaScript: Worker TypeScript intentionally excludes lib.dom.
// The media and session algorithms above/alongside this module remain directly executable in tests.
export const REELS_BROWSER = String.raw`
(function(items, context, state, urls, createController) {
  const byId = new Map(items.map(item => [item.postId, item]));
  const $ = id => document.getElementById(id);
  const video = $('reels-video'), track = $('reels-track');
  const random = bytes => Array.from(crypto.getRandomValues(new Uint8Array(bytes)), n => n.toString(16).padStart(2,'0')).join('');
  const seed = () => { let value; do { value = random(4); } while(value === '00000000'); return value; };
  let storage;
  try { storage = sessionStorage; } catch {}
  const unavailable = { getItem() { throw Error('unavailable'); }, setItem() { throw Error('unavailable'); } };
  const read = state.read(storage || unavailable, context.rs);
  const base = { ...context, from: undefined, library: {...context.library, page:1, perPage:10} };
  const initialAt = context.from && items.length ? items[Math.min(items.length-1, Math.max(0,((context.library.page || 1)-1)*(context.library.perPage || 10)))].postId : undefined;
  const restored = state.restore(items, { filterKey:urls.libraryHref(base), libraryKey:urls.libraryHref(context), at:context.at, initialAt, order:context.order, seed:context.seed, pin:context.pin, rs:context.rs, hadSession:context.hadSession, newSeed:seed(), newRs:random(16) }, read.session);
  let session = restored.session, recentering = false, pointerDown = false, timer, reloadStarted = false;
  const notices = {refreshed:'Browsing session refreshed.',fallback:'Previous session unavailable. Order or position may have changed.','order-changed':'Playback order updated from this link.'};
  let storageFailed = !read.available;
  const notice = () => { $('reels-notice').textContent = [notices[restored.notice] || '', storageFailed ? 'Session storage unavailable. Restoration is limited to this page.' : ''].filter(Boolean).join(' '); };
  const currentContext = () => ({...context, at:session.currentId || undefined, rs:session.rs, order:session.order, seed:session.seed || context.seed, pin:session.pin});
  const persist = () => { if (!state.write(storage || unavailable,session)) storageFailed=true; notice(); };
  const preferences = () => { $('reels-mute').textContent=session.muted?'Unmute':'Mute'; $('reels-mute').setAttribute('aria-pressed',String(!session.muted)); $('reels-speed').value=String(session.speed); };
  const controller = createController(video, {
    visible: () => !document.hidden,
    save(id,position,paused) { session.positions[id]=position; session.paused=paused; persist(); },
    preferences(muted,speed) { session.muted=muted; session.speed=speed; preferences(); persist(); },
    status(value) {
      const labels={loading:'Loading video…',buffering:'Buffering…',tap:'Tap Play to start.',muted:'Muted. Tap Unmute for sound.',error:'This video could not be played.',paused:'Paused',playing:''};
      $('reels-status').textContent=labels[value] || '';
      $('reels-play').textContent=value==='playing'||value==='buffering'?'Pause':'Play';
      $('reels-retry').hidden=!['error','buffering'].includes(value);
      $('reels-reload').hidden=value!=='error';
    }
  });
  function recenter() {
    recentering=true;
    track.scrollTop=track.clientHeight;
    requestAnimationFrame(() => requestAnimationFrame(() => { recentering=false; }));
  }
  function poster(element,item) {
    if (item && item.hasPoster) { element.src='/p/'+item.postId; element.hidden=false; }
    else { element.removeAttribute('src'); element.hidden=true; }
  }
  function refresh(announce) {
    const sequence=state.sequence(session), index=sequence.indexOf(session.currentId), item=byId.get(session.currentId);
    $('reels-player').hidden=!item;
    $('reels-empty').hidden=!!item;
    session.currentIndex=index;
    const fresh = new URL(urls.href(currentContext()),location.origin);
    fresh.searchParams.delete('rs'); fresh.searchParams.delete('pin');
    if(session.order==='shuffle') fresh.searchParams.set('seed',seed());
    $('reels-fresh').href=fresh.pathname+fresh.search;
    history.replaceState(null,'',urls.href(currentContext()));
    if (!item) { $('reels-empty').textContent=restored.restored?'No videos remain in this session.':'No videos match this selection.'; persist(); return; }
    $('reels-title').textContent=item.title;
    $('reels-position').textContent=(index+1)+' of '+sequence.length;
    $('reels-previous').disabled=index<=0;
    $('reels-next').disabled=index>=sequence.length-1;
    $('reels-end').textContent=index===sequence.length-1?'End of selection':'Swipe up for next';
    $('reels-reshuffle').hidden=session.order!=='shuffle';
    $('reels-reshuffle').disabled=sequence.length<2;
    $('reels-ordered').setAttribute('aria-pressed',String(session.order==='ordered'));
    $('reels-shuffle').setAttribute('aria-pressed',String(session.order==='shuffle'));
    $('reels-details').href=urls.watchHref(item.postId,currentContext());
    poster($('reels-before'),byId.get(sequence[index-1]));
    poster($('reels-after'),byId.get(sequence[index+1]));
    if(item.hasPoster) video.poster='/p/'+item.postId; else video.removeAttribute('poster');
    if(announce) $('reels-live').textContent='Video '+(index+1)+' of '+sequence.length+': '+item.title;
    preferences(); persist();
  }
  function openCurrent(autoplay) {
    const item=byId.get(session.currentId);
    if(item) controller.open(item.postId,'/v/'+item.videoKey,session.positions[item.postId] || 0,autoplay,session.muted,session.speed);
  }
  function navigate(delta) {
    if(document.fullscreenElement || video.webkitDisplayingFullscreen || video.seeking || pointerDown) { recenter(); return; }
    const sequence=state.sequence(session), index=sequence.indexOf(session.currentId), next=sequence[index+delta];
    if(next && next!==session.currentId) {
      controller.capture(); session.currentId=next; session.currentIndex=index+delta; session.paused=false;
      openCurrent(true); refresh(true);
    }
    recenter();
  }
  function settled() {
    if(recentering || pointerDown || !track.clientHeight) return;
    const ratio=track.scrollTop/track.clientHeight;
    const slot=Math.round(ratio);
    if(Math.abs(ratio-slot)>.04) return;
    if(slot!==1) navigate(slot<1?-1:1);
  }
  track.addEventListener('pointerdown',() => {pointerDown=true;},{capture:true});
  window.addEventListener('pointerup',() => {pointerDown=false;clearTimeout(timer);timer=setTimeout(settled,180);});
  window.addEventListener('pointercancel',() => {pointerDown=false;});
  track.addEventListener('scrollend',settled);
  track.addEventListener('scroll',() => {clearTimeout(timer);if(!('onscrollend' in track)) timer=setTimeout(settled,180);},{passive:true});
  window.addEventListener('resize',recenter);
  $('reels-previous').addEventListener('click',() => { $('reels-previous').focus({preventScroll:true}); navigate(-1); });
  $('reels-next').addEventListener('click',() => { $('reels-next').focus({preventScroll:true}); navigate(1); });
  $('reels-play').addEventListener('click',() => controller.toggle());
  $('reels-mute').addEventListener('click',() => controller.mute());
  $('reels-speed').addEventListener('change',event => controller.speed(Number(event.target.value)));
  $('reels-retry').addEventListener('click',() => controller.retry());
  $('reels-reload').addEventListener('click',() => {controller.suspend();location.reload();});
  function changeOrder(order,reshuffle) {
    controller.capture();
    session=state.setOrder(session,order,reshuffle || (order==='shuffle' && !session.seed)?seed():undefined,reshuffle?session.currentId:undefined);
    refresh(true); recenter();
  }
  $('reels-ordered').addEventListener('click',() => changeOrder('ordered',false));
  $('reels-shuffle').addEventListener('click',() => changeOrder('shuffle',false));
  $('reels-reshuffle').addEventListener('click',() => changeOrder('shuffle',true));
  for(const id of ['reels-details','reels-library','reels-fresh']) $(id).addEventListener('click',() => controller.suspend());
  document.addEventListener('visibilitychange',() => {if(document.hidden) controller.suspend();});
  window.addEventListener('pagehide',() => controller.suspend());
  window.addEventListener('pageshow',event => {if(event.persisted && !reloadStarted) {reloadStarted=true;controller.suspend();location.replace(urls.href(currentContext()));}});
  document.addEventListener('keydown',event => {
    if(event.ctrlKey || event.altKey || event.metaKey || (event.shiftKey && !['<','>'].includes(event.key)) || document.fullscreenElement || video.webkitDisplayingFullscreen) return;
    if(event.target.closest('video,button,a,input,textarea,select,[contenteditable]:not([contenteditable="false"])')) return;
    const key=event.key.toLowerCase(), speeds=[.5,.75,1,1.25,1.5,1.75,2];
    if(!['arrowup','pageup','arrowdown','pagedown',' ','k','j','l','arrowleft','arrowright','m','f','<','>'].includes(key)) return;
    event.preventDefault();
    if(['arrowup','pageup'].includes(key)) navigate(-1);
    else if(['arrowdown','pagedown'].includes(key)) navigate(1);
    else if([' ','k'].includes(key)) controller.toggle();
    else if(key==='m') controller.mute();
    else if(key==='f') { if(video.requestFullscreen) video.requestFullscreen().catch(() => {}); else if(video.webkitEnterFullscreen) video.webkitEnterFullscreen(); }
    else if(key==='<' || key==='>') controller.speed(speeds[Math.max(0,Math.min(speeds.length-1,speeds.indexOf(session.speed)+(key==='>'?1:-1)))]);
    else controller.seek(key==='j'?-10:key==='l'?10:key==='arrowleft'?-5:5);
  });
  $('reels-app').hidden=false;
  refresh(true); recenter(); openCurrent(!restored.restored && (!context.hadSession || restored.notice==='refreshed'));
})(REELS_ITEMS, REELS_CONTEXT, REELS_STATE, REELS_URLS, REELS_CONTROLLER);
`;
