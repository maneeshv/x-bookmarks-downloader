import { POSTER_DECODER } from "#src/perceptual-browser";
import type { ThumbnailScan, ThumbnailItem } from '#src/thumbnails';
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
    // A suggestion card deleted this post; drop it so exact cleanup never targets a tombstoned row.
    forget(postId: string) {
      for (const [id, group] of matches) {
        group.items = group.items.filter(entry => entry.row.post_id !== postId);
        group.remove = group.remove.filter(id => id !== postId);
        if (group.keep === postId) group.keep = null;
        if (group.items.length < 2) matches.delete(id);
      }
    },
    reset() { seen.clear(); pending.clear(); matches.clear(); savedBytes = 0; stale = false; },
  };
}

// Poster equality is a suggestion only: no keeper/removal state. Cards delete single videos via the library API (ADR-0029).
export function createThumbnailReviewState() {
  const seen = new Map<string, ThumbnailItem>();
  return {
    ingest(batch: ThumbnailScan) { for (const item of batch.items) seen.set(item.row.post_id, item); },
    groups() {
      const groups = new Map<string, { id: string; items: ThumbnailItem[] }>();
      for (const item of seen.values()) if (item.poster) {
        const id = item.poster.bytes + ':' + item.poster.md5;
        if (!groups.has(id)) groups.set(id, { id, items: [] });
        groups.get(id)!.items.push(item);
      }
      return [...groups.values()].filter(group => group.items.length > 1);
    },
    checked() { return seen.size; },
    unverified() { return [...seen.values()].filter(item => !item.poster); },
    reset() { seen.clear(); },
  };
}

export const duplicatesBrowserScript = `
(()=>{
const state=CREATE_STATE(),byId=id=>document.getElementById(id),scan=byId('duplicate-scan'),pause=byId('duplicate-pause'),restart=byId('duplicate-rescan'),status=byId('duplicate-status'),coverage=byId('duplicate-coverage'),results=byId('duplicate-results'),unknown=byId('duplicate-unknown'),times=byId('duplicate-times');
let thumbRunning=false,similarRunning=false;const deleteButtons=new Map();
let running=false,pauseRequested=false,busy=false,started=null,completed=null,cursor=null,counts=null,lastChecked=null;
const text=(tag,value,cls)=>{const e=document.createElement(tag);e.textContent=value;if(cls)e.className=cls;return e};
const size=n=>n>=1024**3?(n/1024**3).toFixed(2)+' GB':n>=1024**2?(n/1024**2).toFixed(1)+' MB':n.toLocaleString()+' B';
const title=r=>r.title||((r.text||'').replace(/\\s+/g,' ').trim().slice(0,100))||r.post_id;
const stamp=s=>s?s.replace('T',' ').replace(/\\.\\d{3}Z$/,' UTC'):'—';
const duration=ms=>{if(ms==null)return 'Duration unavailable';const s=Math.floor(ms/1000);return Math.floor(s/60)+':'+String(s%60).padStart(2,'0')};
const safeTags=r=>{try{const t=JSON.parse(r.tags||'[]');return Array.isArray(t)?t.filter(x=>typeof x==='string'):[]}catch{return []}};
const say=message=>{status.textContent=message};
function controls(){scan.hidden=started!==null;scan.disabled=running||busy||thumbRunning||similarRunning;pause.hidden=!started||completed!==null||state.requiresRescan();pause.disabled=busy||pauseRequested||thumbRunning||similarRunning;pause.textContent=running?(pauseRequested?'Pausing after this batch…':'Pause'):'Continue';restart.hidden=started===null;restart.disabled=running||busy||thumbRunning||similarRunning;suggestionControls();}
function metrics(){if(counts){const e=counts.excluded;coverage.textContent=counts.eligible+' eligible single-video entries · '+counts.candidates+' size-match candidates · '+state.checked()+' candidates checked · '+state.groups().length+' verified groups · '+state.unverified().length+' unverified candidates. Excluded: '+e.multiVideo+' multi-video, '+e.error+' with errors, '+e.unknownSize+' unknown size, '+e.invalidKey+' invalid key. '+size(state.reclaimed())+' estimated reclaimed this session.'}times.textContent='Started: '+stamp(started)+' · Completed: '+stamp(completed)+(lastChecked?' · Last batch: '+stamp(lastChecked):'');}
function updateGroup(section,group){const locked=busy||running||thumbRunning||similarRunning||state.requiresRescan();section.querySelectorAll('input').forEach(input=>{input.disabled=locked||(input.type==='checkbox'&&input.value===group.keep);input.checked=input.type==='radio'?input.value===group.keep:group.remove.includes(input.value)});const button=section.querySelector('[data-delete]');button.disabled=locked||!group.keep||!group.remove.length;section.querySelector('[data-selection]').textContent=group.remove.length+' selected · '+size(group.remove.length*group.fingerprint.bytes)+' to reclaim';}
function card(entry,group,section,suggestion=false,preview=null,report=null){const r=entry.row,article=text('article','','duplicate-copy'),name=title(r),video=document.createElement('video');video.controls=true;video.preload='none';video.src='/v/'+encodeURIComponent(r.r2_key);if(preview===null)video.poster='/p/'+encodeURIComponent(r.post_id);else if(preview)video.poster=preview;video.setAttribute('aria-label','Preview '+name);article.append(video,text('h3',name));
const details=text('p',(suggestion?(r.bytes>0?size(r.bytes):'Size unavailable'):size(group.fingerprint.bytes))+' · '+duration(r.duration_ms),'d');article.append(details,text('p','Posted: '+(r.posted_at||'unavailable')+' · First seen: '+r.first_seen_at,'d'));
if(r.description)article.append(text('p',r.description));const tags=safeTags(r),metadata=[];if(r.favorite)metadata.push('Favourite');if(tags.length)metadata.push('Tags: '+tags.join(', '));if(r.resume_ms)metadata.push('Saved playback position');if(metadata.length)article.append(text('p',metadata.join(' · '),'duplicate-metadata'));
const source=document.createElement('a');source.textContent='Original post ↗';source.href='https://x.com/i/status/'+encodeURIComponent(r.post_id);source.target='_blank';source.rel='noopener noreferrer';article.append(source);
if(suggestion){const watch=document.createElement('a');watch.textContent='Watch video →';watch.href='/watch/'+encodeURIComponent(r.post_id);const actions=text('p','');actions.append(watch);article.append(actions);article.dataset.post=r.post_id;const del=text('button','Delete this video','button danger');del.type='button';del.dataset.deleteVideo='';del.disabled=suggestionLocked();del.setAttribute('aria-label','Delete '+name);del.onclick=()=>deleteSuggested(r,report);deleteButtons.set(del,{post:r.post_id,report});article.append(del);return article;}
const choices=text('div','','duplicate-choices');for(const kind of ['radio','checkbox']){const label=text('label','','duplicate-choice'),input=document.createElement('input');input.type=kind;input.name=kind==='radio'?'keeper-'+group.id:'remove-'+group.id;input.value=r.post_id;input.setAttribute('aria-label',(kind==='radio'?'Keep ':'Remove ')+name);label.append(input,document.createTextNode(kind==='radio'?'Keep this copy':'Remove this copy'));input.onchange=()=>{if(kind==='radio')state.chooseKeep(group.id,r.post_id);else state.chooseRemove(group.id,r.post_id,input.checked);updateGroup(section,group)};choices.append(label)}article.append(choices);return article;}
function render(){const active=document.activeElement;const restoreId=active?.closest('[data-group]')?.dataset.group;const restoreValue=active?.value;const restoreType=active?.type;const fallbackFocus=active?.hasAttribute('data-delete');results.replaceChildren();for(const group of state.groups()){const section=text('section','','duplicate-group');section.dataset.group=group.id;const heading=text('h2',group.items.length+' matching copies · '+size((group.items.length-1)*group.fingerprint.bytes)+' potentially redundant');section.append(heading,text('p','Same video size and content checksum. Choose a keeper, then select copies to remove.','d'));const cards=text('div','','duplicate-copies');for(const entry of group.items)cards.append(card(entry,group,section));section.append(cards);const footer=text('div','','duplicate-actions'),selection=text('p','','d');selection.dataset.selection='';const button=text('button','Delete selected copies','button danger');button.type='button';button.dataset.delete='';button.onclick=()=>remove(group);footer.append(selection,button);section.append(footer);results.append(section);updateGroup(section,group)}
unknown.replaceChildren();const unverified=state.unverified();if(unverified.length){unknown.append(text('summary',unverified.length+' candidates could not be verified'));const messages={missing_object:'Stored video is missing',missing_checksum:'No usable MD5 checksum',invalid_checksum:'No usable MD5 checksum',stale_size:'Stored size differs from the library',read_error:'Storage metadata could not be read',head_failed:'Storage metadata could not be read',metadata_unavailable:'Storage metadata could not be read'};for(const entry of unverified)unknown.append(text('p',title(entry.row)+' — '+(messages[entry.reason]||'Storage metadata could not be verified')))}unknown.hidden=!unverified.length;
metrics();controls();thumbnailControls();similarControls();pruneSimilar();if(restoreId){const section=[...results.children].find(e=>e.dataset.group===restoreId);const target=section&&[...section.querySelectorAll('input')].find(e=>e.value===restoreValue&&e.type===restoreType);if(target&&!target.disabled)target.focus();else if(fallbackFocus&&!busy)restart.focus();}}
function finishMessage(){if(!counts.eligible)return 'No eligible single-video entries to check.';if(!counts.candidates)return 'No equal-size candidates among eligible single-video entries.';if(!state.groups().length)return 'Scan complete: no checksum matches among eligible size-match candidates.';return 'Scan complete. Review the matching groups below.';}
async function run(){if(running||busy||thumbRunning||similarRunning||state.requiresRescan())return;running=true;pauseRequested=false;if(!started)started=new Date().toISOString();controls();render();try{do{say('Checking candidate metadata… '+state.checked()+' candidates checked.');const params=cursor?'?'+new URLSearchParams({afterBytes:String(cursor.bytes),afterPostId:cursor.postId}):'';const response=await fetch('/api/duplicates/scan'+params,{cache:'no-store'});if(!response.ok)throw new Error('scan');const batch=await response.json();state.ingest(batch);counts=batch.counts;lastChecked=batch.checkedAt;cursor=batch.nextCursor;if(!cursor)completed=new Date().toISOString();render();if(!cursor)break;}while(!pauseRequested);say(completed?finishMessage():'Scan paused. '+state.pendingCount()+' entries wait for the rest of their size group. Continue to finish.');}catch{say('Scan request failed. Results are partial. Continue retries from the last successful batch, or Rescan to start again.');}finally{running=false;pauseRequested=false;render();}}
async function remove(group){if(busy||running||thumbRunning||similarRunning||state.requiresRescan()||!group.keep||!group.remove.length)return;const victims=group.items.filter(e=>group.remove.includes(e.row.post_id));const keeper=group.items.find(e=>e.row.post_id===group.keep);const message='Permanently delete '+victims.length+' selected '+(victims.length===1?'copy':'copies')+' ('+size(victims.length*group.fingerprint.bytes)+')?\\n\\nKeep: '+title(keeper.row)+' ['+keeper.row.post_id+']\\nRemove: '+victims.map(e=>title(e.row)+' ['+e.row.post_id+']').join('; ')+'\\n\\nDeleted entries’ titles, descriptions, tags, favourites and playback positions stay hidden on their deleted rows. They are not copied to the keeper. There is no undo. Concurrent actions in another tab can still change these copies.';if(!window.confirm(message))return;resetThumbnails('Thumbnail results cleared after cleanup. Scan again to refresh.');resetSimilar('Exact cleanup changed the library. Scan similar thumbnails again.');busy=true;render();say('Deleting selected copies…');const ok=await state.resolve(group.id,async body=>{const response=await fetch('/api/duplicates/resolve',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});if(response.status!==204)throw new Error('resolve');},()=>{render();say('Copy deleted. '+size(state.reclaimed())+' estimated reclaimed this session.');});busy=false;render();say(ok?'Selected copies deleted. '+size(state.reclaimed())+' estimated reclaimed this session.':'Cleanup stopped. A request may have partly completed. Confirmed deletions remain recorded above; remaining selections were cleared. Rescan before any more cleanup.');if(document.activeElement===document.body)restart.focus();}
function suggestionLocked(){return busy||running||thumbRunning||similarRunning;}
function suggestionControls(){for(const b of deleteButtons.keys())b.disabled=suggestionLocked();}
function forgetButtons(match){for(const [b,owner] of deleteButtons)if(match(owner))deleteButtons.delete(b);}
async function deleteSuggested(r,report){if(suggestionLocked())return;const name=title(r);if(!window.confirm('Permanently delete this video'+(r.bytes>0?' ('+size(r.bytes)+')':'')+'?\\n\\n'+name+' ['+r.post_id+']\\n\\nThe stored video, its title, description, tags, favourite and playback position are removed. There is no undo.'))return;
busy=true;render();report.textContent='Deleting '+name+'…';let ok=false;try{const response=await fetch('/api/videos/'+encodeURIComponent(r.post_id),{method:'DELETE'});ok=response.status===204;}catch{}busy=false;
if(ok){state.forget(r.post_id);forgetButtons(owner=>owner.post===r.post_id);for(const root of [thumbResults,similarResults])for(const a of root.querySelectorAll('article'))if(a.dataset.post===r.post_id){a.className='duplicate-copy duplicate-deleted';a.replaceChildren(text('h3',name),text('p','Deleted from the library.','d'));}}
render();report.textContent=ok?'Deleted '+name+'. Other suggestions stay listed; deleted entries are marked.':name+' could not be deleted. It may already be gone or changed; open Watch video to check, or scan again.';}
scan.onclick=run;pause.onclick=()=>{if(running){pauseRequested=true;controls();say('Pausing after the current batch.')}else run()};restart.onclick=()=>{if(running||busy||thumbRunning||similarRunning)return;state.reset();cursor=null;counts=null;started=null;completed=null;lastChecked=null;render();run()};
const thumbnails=CREATE_THUMBNAILS(),thumbScan=byId('thumbnail-scan'),thumbPause=byId('thumbnail-pause'),thumbRestart=byId('thumbnail-rescan'),thumbStatus=byId('thumbnail-status'),thumbCoverage=byId('thumbnail-coverage'),thumbResults=byId('thumbnail-results'),thumbUnknown=byId('thumbnail-unknown'),thumbSections=new Map();
let thumbStarted=false,thumbComplete=false,thumbPauseRequested=false,thumbCursor=null,thumbEligible=0,thumbCheckedAt=null;
function thumbnailControls(){thumbScan.hidden=thumbStarted;thumbScan.disabled=thumbRunning||similarRunning||running||busy;thumbPause.hidden=!thumbStarted||thumbComplete;thumbPause.disabled=running||busy||similarRunning||thumbPauseRequested;thumbPause.textContent=thumbRunning?(thumbPauseRequested?'Pausing after this batch…':'Pause'):'Continue';thumbRestart.hidden=!thumbStarted;thumbRestart.disabled=thumbRunning||similarRunning||running||busy;}
function renderThumbnails(){for(const group of thumbnails.groups()){let view=thumbSections.get(group.id);if(!view){const section=text('section','','duplicate-group'),heading=text('h3',''),cards=text('div','','duplicate-copies');section.append(heading,text('p','Same thumbnail checksum and byte size. These videos may differ; play them to compare.','d'),cards);view={section,heading,cards,ids:new Set()};thumbSections.set(group.id,view);thumbResults.append(section);}view.heading.textContent=group.items.length+' entries with identical stored thumbnails';for(const item of group.items)if(!view.ids.has(item.row.post_id)){view.cards.append(card(item,group,view.section,true,null,thumbStatus));view.ids.add(item.row.post_id);}}
thumbUnknown.replaceChildren();const failures=thumbnails.unverified();if(failures.length){const detail=text('details','');detail.append(text('summary',failures.length+' posters could not be checked'));const reasons={missing_poster:'Stored poster missing',unsupported_poster:'Unsupported poster size or type',invalid_checksum:'No usable poster MD5',metadata_unavailable:'Poster metadata read failed'};for(const item of failures)detail.append(text('p',title(item.row)+' — '+(reasons[item.reason]||'Poster metadata unavailable')));thumbUnknown.append(detail);}
thumbCoverage.textContent=thumbnails.checked()+' of '+thumbEligible+' eligible single-video entries checked · '+thumbnails.groups().length+' suggested groups · '+failures.length+' unverified posters. '+(thumbComplete?'Scan finished.':'Partial results; groups may grow as scanning continues.')+(thumbCheckedAt?' Last batch: '+stamp(thumbCheckedAt):'');thumbnailControls();}
function resetThumbnails(message){thumbnails.reset();thumbStarted=false;thumbComplete=false;thumbCursor=null;thumbEligible=0;thumbCheckedAt=null;thumbResults.replaceChildren();thumbUnknown.replaceChildren();thumbSections.clear();forgetButtons(owner=>owner.report===thumbStatus);thumbCoverage.textContent='';thumbStatus.textContent=message;thumbnailControls();}
async function runThumbnails(){if(thumbRunning||similarRunning||running||busy)return;thumbRunning=true;thumbStarted=true;thumbPauseRequested=false;render();thumbnailControls();try{do{thumbStatus.textContent='Checking stored thumbnail metadata…';const query=thumbCursor?'?'+new URLSearchParams({afterPostId:thumbCursor}):'';const response=await fetch('/api/duplicates/thumbnails'+query,{cache:'no-store'});if(!response.ok)throw new Error('scan');const batch=await response.json();thumbnails.ingest(batch);thumbEligible=batch.eligible;thumbCheckedAt=batch.checkedAt;thumbCursor=batch.nextCursor;thumbComplete=!thumbCursor;renderThumbnails();if(thumbComplete)break;}while(!thumbPauseRequested);thumbStatus.textContent=thumbComplete?(thumbnails.unverified().length?'Thumbnail scan complete with unverified posters. Suggestions are partial coverage.':thumbnails.groups().length?'Thumbnail scan complete. Suggestions need manual video review.':'Thumbnail scan complete. No identical stored thumbnails found.'):'Thumbnail scan paused. Results are partial; Continue checks remaining entries.';}catch{thumbStatus.textContent='Thumbnail scan request failed. Results are partial. Continue retries the last batch; Rescan starts again.';}finally{thumbRunning=false;thumbPauseRequested=false;render();thumbnailControls();}}
const similarTools=CREATE_PERCEPTUAL(),similarDecoder=(${POSTER_DECODER})(similarTools),similarScan=byId('similar-scan'),similarCancel=byId('similar-cancel'),similarStatus=byId('similar-status'),similarCoverage=byId('similar-coverage'),similarResults=byId('similar-results');
let similarAbort=null,similarPairs=[],similarFinished=false;
function exactPair(a,b){return state.groups().some(group=>group.items.some(item=>item.row.post_id===a)&&group.items.some(item=>item.row.post_id===b));}
function similarControls(){similarScan.disabled=similarRunning||running||thumbRunning||busy;similarScan.textContent=similarFinished?'Scan similar thumbnails again':'Scan similar thumbnails';similarCancel.hidden=!similarRunning;similarCancel.disabled=Boolean(similarAbort?.signal.aborted);}
function pruneSimilar(){for(const pair of similarPairs){if(!pair.hidden&&exactPair(pair.a,pair.b)){pair.node.remove();pair.hidden=true;}}}
function resetSimilar(message){similarResults.replaceChildren();forgetButtons(owner=>owner.report===similarStatus);similarPairs=[];similarFinished=false;similarCoverage.textContent='';similarStatus.textContent=message;similarControls();}
function similarProgress(p){similarCoverage.textContent=p.checked+' of '+p.eligible+' eligible entries checked · '+p.hashed+' usable · '+p.skipped+' skipped · '+p.pairs+' suggested pairs before exact-video exclusions · '+size(p.bytes)+' thumbnail bytes read.';similarStatus.textContent=p.status==='running'?'Comparing thumbnails on this device…':p.message+(p.status==='limited'?' Results are partial.':'')+' Pair matches need manual review.';}
async function runSimilar(){
 if(similarRunning||running||thumbRunning||busy)return;
 resetSimilar('Starting thumbnail similarity scan…');similarRunning=true;similarAbort=new AbortController();render();
 if(typeof createImageBitmap!=='function'){similarStatus.textContent='This browser cannot decode thumbnails for comparison. Use exact-thumbnail review or a browser with createImageBitmap support.';similarRunning=false;similarFinished=true;render();return;}
 const scanner=CREATE_SIMILAR_SCANNER(similarTools,{fetch:(url,options)=>fetch(url,options),decode:(bytes,mime,dimensions)=>similarDecoder.decode(bytes,mime,dimensions),yield:()=>new Promise(resolve=>setTimeout(resolve,0))});
 try{await scanner.run({signal:similarAbort.signal,onProgress:similarProgress,excludePair:exactPair,onPair:pair=>{
  const section=text('section','','duplicate-group');section.append(text('h3',pair.similarity.toFixed(1)+'% hash similarity · '+pair.distance+' of 64 bits differ'),text('p','Similar thumbnail pattern, colors and proportions. These videos may differ.','d'));
  const cards=text('div','','duplicate-copies');cards.append(card(pair.a,null,null,true,pair.aPreview,similarStatus),card(pair.b,null,null,true,pair.bPreview,similarStatus));section.append(cards);similarResults.append(section);similarPairs.push({a:pair.a.row.post_id,b:pair.b.row.post_id,node:section,hidden:false});
 }});}finally{similarRunning=false;similarFinished=true;render();}
}
similarScan.onclick=runSimilar;similarCancel.onclick=()=>{similarAbort?.abort();similarStatus.textContent='Cancelling; completed pairs remain as partial results.';similarControls();};
thumbScan.onclick=runThumbnails;thumbPause.onclick=()=>{if(thumbRunning){thumbPauseRequested=true;thumbnailControls();thumbStatus.textContent='Pausing after the current batch.';}else runThumbnails();};thumbRestart.onclick=()=>{if(thumbRunning||similarRunning||running||busy)return;resetThumbnails('No thumbnail scan started.');runThumbnails();};controls();thumbnailControls();similarControls();
})();`;
