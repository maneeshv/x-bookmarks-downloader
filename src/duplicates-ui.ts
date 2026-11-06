import type { DuplicateScan, DuplicateItem, Fingerprint, DuplicateResolve } from '#src/duplicates';

type Group = { id: string; fingerprint: Fingerprint; items: DuplicateItem[]; keep: string | null; remove: string[] };

// Method syntax keeps this serializable without esbuild keepNames closure helpers.
export function createDuplicateReviewState() {
  const seen = new Map<string, DuplicateItem>(), pending = new Map<number, DuplicateItem[]>(), matches = new Map<string, Group>();
  let savedBytes = 0, stale = false, resolving = false;
  return {
    ingest(batch: DuplicateScan) {
      for (const entry of batch.items) {
        if (seen.has(entry.row.post_id)) continue;
        seen.set(entry.row.post_id, entry);
        const size = entry.row.bytes!;
        if (!pending.has(size)) pending.set(size, []);
        pending.get(size)!.push(entry);
      }
      const last = batch.items.at(-1)?.row.bytes;
      for (const [size, entries] of pending) {
        if (size === last && !batch.trailingSizeComplete) continue;
        const buckets = new Map<string, DuplicateItem[]>();
        for (const entry of entries) if (entry.fingerprint) {
          const key = entry.fingerprint.bytes + ':' + entry.fingerprint.md5;
          if (!buckets.has(key)) buckets.set(key, []);
          buckets.get(key)!.push(entry);
        }
        for (const [id, items] of buckets) if (items.length > 1) {
          items.sort((a, b) => a.row.first_seen_at.localeCompare(b.row.first_seen_at) || a.row.post_id.localeCompare(b.row.post_id));
          matches.set(id, { id, items, fingerprint: items[0]!.fingerprint!, keep: null, remove: [] });
        }
        pending.delete(size);
      }
    },
    groups() { return [...matches.values()]; },
    checked() { return seen.size; },
    pendingCount() { return [...pending.values()].reduce((n, entries) => n + entries.length, 0); },
    unverified() { return [...seen.values()].filter(entry => !entry.fingerprint); },
    reclaimed() { return savedBytes; },
    requiresRescan() { return stale; },
    chooseKeep(id: string, postId: string) {
      const group = matches.get(id);
      if (!group || stale || resolving || !group.items.some(entry => entry.row.post_id === postId)) return;
      group.keep = postId; group.remove = group.remove.filter(id => id !== postId);
    },
    chooseRemove(id: string, postId: string, selected: boolean) {
      const group = matches.get(id);
      if (!group || stale || resolving || postId === group.keep || !group.items.some(entry => entry.row.post_id === postId)) return;
      group.remove = group.remove.filter(id => id !== postId);
      if (selected) group.remove.push(postId);
    },
    async resolve(id: string, send: (body: DuplicateResolve) => Promise<void>, acknowledged: () => void = () => {}) {
      const group = matches.get(id);
      if (!group || !group.keep || !group.remove.length || stale || resolving) return false;
      const keep = group.keep, removals = group.remove.slice();
      resolving = true;
      try {
        for (const remove of removals) {
          await send({ keep, remove, expected: group.fingerprint });
          group.items = group.items.filter(entry => entry.row.post_id !== remove);
          group.remove = group.remove.filter(id => id !== remove);
          savedBytes += group.fingerprint.bytes;
          if (group.items.length < 2) matches.delete(id);
          acknowledged();
        }
        group.keep = null; group.remove = [];
        return true;
      } catch {
        stale = true;
        for (const match of matches.values()) { match.keep = null; match.remove = []; }
        return false;
      } finally { resolving = false; }
    },
    reset() { seen.clear(); pending.clear(); matches.clear(); savedBytes = 0; stale = false; },
  };
}

export const duplicatesBrowserScript = `
(()=>{
const state=CREATE_STATE(),byId=id=>document.getElementById(id),scan=byId('duplicate-scan'),pause=byId('duplicate-pause'),restart=byId('duplicate-rescan'),status=byId('duplicate-status'),coverage=byId('duplicate-coverage'),results=byId('duplicate-results'),unknown=byId('duplicate-unknown'),times=byId('duplicate-times');
let running=false,pauseRequested=false,busy=false,started=null,completed=null,cursor=null,counts=null,lastChecked=null;
const text=(tag,value,cls)=>{const e=document.createElement(tag);e.textContent=value;if(cls)e.className=cls;return e};
const size=n=>n>=1024**3?(n/1024**3).toFixed(2)+' GB':n>=1024**2?(n/1024**2).toFixed(1)+' MB':n.toLocaleString()+' B';
const title=r=>r.title||((r.text||'').replace(/\\s+/g,' ').trim().slice(0,100))||r.post_id;
const stamp=s=>s?s.replace('T',' ').replace(/\\.\\d{3}Z$/,' UTC'):'—';
const duration=ms=>{if(ms==null)return 'Duration unavailable';const s=Math.floor(ms/1000);return Math.floor(s/60)+':'+String(s%60).padStart(2,'0')};
const safeTags=r=>{try{const t=JSON.parse(r.tags||'[]');return Array.isArray(t)?t.filter(x=>typeof x==='string'):[]}catch{return []}};
const say=message=>{status.textContent=message};
function controls(){scan.hidden=started!==null;scan.disabled=running||busy;pause.hidden=!started||completed!==null||state.requiresRescan();pause.disabled=busy||pauseRequested;pause.textContent=running?(pauseRequested?'Pausing after this batch…':'Pause'):'Continue';restart.hidden=started===null;restart.disabled=running||busy;}
function metrics(){if(counts){const e=counts.excluded;coverage.textContent=counts.eligible+' eligible single-video entries · '+counts.candidates+' size-match candidates · '+state.checked()+' candidates checked · '+state.groups().length+' verified groups · '+state.unverified().length+' unverified candidates. Excluded: '+e.multiVideo+' multi-video, '+e.error+' with errors, '+e.unknownSize+' unknown size, '+e.invalidKey+' invalid key. '+size(state.reclaimed())+' estimated reclaimed this session.'}times.textContent='Started: '+stamp(started)+' · Completed: '+stamp(completed)+(lastChecked?' · Last batch: '+stamp(lastChecked):'');}
function updateGroup(section,group){const locked=busy||running||state.requiresRescan();section.querySelectorAll('input').forEach(input=>{input.disabled=locked||(input.type==='checkbox'&&input.value===group.keep);input.checked=input.type==='radio'?input.value===group.keep:group.remove.includes(input.value)});const button=section.querySelector('[data-delete]');button.disabled=locked||!group.keep||!group.remove.length;section.querySelector('[data-selection]').textContent=group.remove.length+' selected · '+size(group.remove.length*group.fingerprint.bytes)+' to reclaim';}
function card(entry,group,section){const r=entry.row,article=text('article','','duplicate-copy'),name=title(r),video=document.createElement('video');video.controls=true;video.preload='none';video.src='/v/'+encodeURIComponent(r.r2_key);video.poster='/p/'+encodeURIComponent(r.post_id);video.setAttribute('aria-label','Preview '+name);article.append(video,text('h3',name));
const details=text('p',size(group.fingerprint.bytes)+' · '+duration(r.duration_ms),'d');article.append(details,text('p','Posted: '+(r.posted_at||'unavailable')+' · First seen: '+r.first_seen_at,'d'));
if(r.description)article.append(text('p',r.description));const tags=safeTags(r),metadata=[];if(r.favorite)metadata.push('Favourite');if(tags.length)metadata.push('Tags: '+tags.join(', '));if(r.resume_ms)metadata.push('Saved playback position');if(metadata.length)article.append(text('p',metadata.join(' · '),'duplicate-metadata'));
const source=document.createElement('a');source.textContent='Original post ↗';source.href='https://x.com/i/status/'+encodeURIComponent(r.post_id);source.target='_blank';source.rel='noopener noreferrer';article.append(source);
const choices=text('div','','duplicate-choices');for(const kind of ['radio','checkbox']){const label=text('label','','duplicate-choice'),input=document.createElement('input');input.type=kind;input.name=kind==='radio'?'keeper-'+group.id:'remove-'+group.id;input.value=r.post_id;input.setAttribute('aria-label',(kind==='radio'?'Keep ':'Remove ')+name);label.append(input,document.createTextNode(kind==='radio'?'Keep this copy':'Remove this copy'));input.onchange=()=>{if(kind==='radio')state.chooseKeep(group.id,r.post_id);else state.chooseRemove(group.id,r.post_id,input.checked);updateGroup(section,group)};choices.append(label)}article.append(choices);return article;}
function render(){const active=document.activeElement;const restoreId=active?.closest('[data-group]')?.dataset.group;const restoreValue=active?.value;const restoreType=active?.type;const fallbackFocus=active?.hasAttribute('data-delete');results.replaceChildren();for(const group of state.groups()){const section=text('section','','duplicate-group');section.dataset.group=group.id;const heading=text('h2',group.items.length+' matching copies · '+size((group.items.length-1)*group.fingerprint.bytes)+' potentially redundant');section.append(heading,text('p','Same video size and content checksum. Choose a keeper, then select copies to remove.','d'));const cards=text('div','','duplicate-copies');for(const entry of group.items)cards.append(card(entry,group,section));section.append(cards);const footer=text('div','','duplicate-actions'),selection=text('p','','d');selection.dataset.selection='';const button=text('button','Delete selected copies','button danger');button.type='button';button.dataset.delete='';button.onclick=()=>remove(group);footer.append(selection,button);section.append(footer);results.append(section);updateGroup(section,group)}
unknown.replaceChildren();const unverified=state.unverified();if(unverified.length){unknown.append(text('summary',unverified.length+' candidates could not be verified'));const messages={missing_object:'Stored video is missing',missing_checksum:'No usable MD5 checksum',invalid_checksum:'No usable MD5 checksum',stale_size:'Stored size differs from the library',read_error:'Storage metadata could not be read',head_failed:'Storage metadata could not be read',metadata_unavailable:'Storage metadata could not be read'};for(const entry of unverified)unknown.append(text('p',title(entry.row)+' — '+(messages[entry.reason]||'Storage metadata could not be verified')))}unknown.hidden=!unverified.length;
metrics();controls();if(restoreId){const section=[...results.children].find(e=>e.dataset.group===restoreId);const target=section&&[...section.querySelectorAll('input')].find(e=>e.value===restoreValue&&e.type===restoreType);if(target&&!target.disabled)target.focus();else if(fallbackFocus&&!busy)restart.focus();}}
function finishMessage(){if(!counts.eligible)return 'No eligible single-video entries to check.';if(!counts.candidates)return 'No equal-size candidates among eligible single-video entries.';if(!state.groups().length)return 'Scan complete: no checksum matches among eligible size-match candidates.';return 'Scan complete. Review the matching groups below.';}
async function run(){if(running||busy||state.requiresRescan())return;running=true;pauseRequested=false;if(!started)started=new Date().toISOString();controls();render();try{do{say('Checking candidate metadata… '+state.checked()+' candidates checked.');const params=cursor?'?'+new URLSearchParams({afterBytes:String(cursor.bytes),afterPostId:cursor.postId}):'';const response=await fetch('/api/duplicates/scan'+params,{cache:'no-store'});if(!response.ok)throw new Error('scan');const batch=await response.json();state.ingest(batch);counts=batch.counts;lastChecked=batch.checkedAt;cursor=batch.nextCursor;if(!cursor)completed=new Date().toISOString();render();if(!cursor)break;}while(!pauseRequested);say(completed?finishMessage():'Scan paused. '+state.pendingCount()+' entries wait for the rest of their size group. Continue to finish.');}catch{say('Scan request failed. Results are partial. Continue retries from the last successful batch, or Rescan to start again.');}finally{running=false;pauseRequested=false;render();}}
async function remove(group){if(busy||running||state.requiresRescan()||!group.keep||!group.remove.length)return;const victims=group.items.filter(e=>group.remove.includes(e.row.post_id));const keeper=group.items.find(e=>e.row.post_id===group.keep);const message='Permanently delete '+victims.length+' selected '+(victims.length===1?'copy':'copies')+' ('+size(victims.length*group.fingerprint.bytes)+')?\\n\\nKeep: '+title(keeper.row)+' ['+keeper.row.post_id+']\\nRemove: '+victims.map(e=>title(e.row)+' ['+e.row.post_id+']').join('; ')+'\\n\\nDeleted entries’ titles, descriptions, tags, favourites and playback positions stay hidden on their deleted rows. They are not copied to the keeper. There is no undo. Concurrent actions in another tab can still change these copies.';if(!window.confirm(message))return;busy=true;render();say('Deleting selected copies…');const ok=await state.resolve(group.id,async body=>{const response=await fetch('/api/duplicates/resolve',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});if(response.status!==204)throw new Error('resolve');},()=>{render();say('Copy deleted. '+size(state.reclaimed())+' estimated reclaimed this session.');});busy=false;render();say(ok?'Selected copies deleted. '+size(state.reclaimed())+' estimated reclaimed this session.':'Cleanup stopped. A request may have partly completed. Confirmed deletions remain recorded above; remaining selections were cleared. Rescan before any more cleanup.');if(document.activeElement===document.body)restart.focus();}
scan.onclick=run;pause.onclick=()=>{if(running){pauseRequested=true;controls();say('Pausing after the current batch.')}else run()};restart.onclick=()=>{if(running||busy)return;state.reset();cursor=null;counts=null;started=null;completed=null;lastChecked=null;render();run()};controls();
})();`;
