import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import * as html from '#src/html';
import type { BookmarkRow } from '#src/store';

const row = (id: string, bytes = 42): BookmarkRow => ({ post_id: id, first_seen_at: '2026-11-01T00:00:00Z', posted_at: null, text: 'Video '+id, post_url: 'https://x.com/i/status/'+id, has_video: 1, status: 'downloaded', error: null, r2_key: id+'.mp4', bytes, duration_ms: 5000, preview_url: null, updated_at: '2026-11-01T00:00:00Z', title: null, description: null, favorite: 0, tags: null, deleted_at: null });
const hash = 'a'.repeat(32);
const item = (id: string, bytes = 42, md5 = hash) => ({ row: row(id, bytes), fingerprint: { bytes, md5 }, reason: null });
const batch = (items: ReturnType<typeof item>[], complete = true) => ({items, counts: {eligible: 105, candidates:105, excluded:{multiVideo:1,error:2,unknownSize:3,invalidKey:4}}, checkedAt:'2026-11-06T00:00:00Z', nextCursor: complete ? null : {bytes:42,postId:items.at(-1)!.row.post_id}, trailingSizeComplete:complete});
const factory = async () => (await import('#src/duplicates-ui')).createDuplicateReviewState;

test('owner navigation includes duplicates after queue; viewers have neither link', () => {
  const owner = html.renderIndex([], {}, {}, 0, true);
  assert.match(owner, /href="\/duplicates"/);
  assert.ok(owner.indexOf('href="/queue"') < owner.indexOf('href="/duplicates"'));
  assert.doesNotMatch(html.renderIndex([], {}, {}, 0, false), /href="\/duplicates"/);
});
test('duplicates page has manual scan and accessible status; emitted JavaScript parses', () => {
  assert.equal(typeof html.renderDuplicates, 'function');
  const page = html.renderDuplicates();
  assert.match(page, /Scan for duplicates/);
  assert.match(page, /aria-live="polite"/);
  assert.match(page, /No scan started/);
  for (const [, script] of page.matchAll(/<script>([\s\S]*?)<\/script>/g)) new vm.Script(script!);
  assert.doesNotMatch(page, /autoplay/);
});
test('scan keeps an unfinished size bucket across batches and deduplicates retries', async () => {
  const state = (await factory())();
  state.ingest(batch([item('2'),item('1')], false));
  assert.equal(state.groups().length, 0);
  assert.equal(state.pendingCount(), 2);
  state.ingest(batch([item('2'),item('3')]));
  assert.deepEqual(state.groups()[0]!.items.map(x=>x.row.post_id), ['1','2','3']);
  assert.equal(state.checked(), 3);
  assert.equal(state.pendingCount(),0);
});
test('forget drops a deleted entry from exact groups and selections without marking the scan stale', async () => {
  const state = (await factory())();
  state.ingest(batch([item('1'),item('2'),item('3')]));
  const id = state.groups()[0]!.id;
  state.chooseKeep(id,'1');state.chooseRemove(id,'2',true);state.chooseRemove(id,'3',true);
  state.forget('2');
  assert.deepEqual(state.groups()[0]!.items.map(x=>x.row.post_id),['1','3']);assert.deepEqual(state.groups()[0]!.remove,['3']);
  state.forget('1');
  assert.equal(state.groups().length,0,'a single remaining copy is no longer a match');assert.equal(state.requiresRescan(),false);
});
test('different hashes and unverifiable entries never form an actionable match', async () => {
  const state = (await factory())();
  const input = batch([item('1'),item('2',42,'b'.repeat(32))]);
  state.ingest({...input, items:[...input.items,{row:row('3'),fingerprint:null,reason:'missing_checksum'}]});
  assert.equal(state.groups().length,0);
  assert.equal(state.unverified().length,1);
});
test('selection starts empty, keeper cannot be a victim, and changing keeper clears its removal', async () => {
  const state = (await factory())(); state.ingest(batch([item('1'),item('2'),item('3')]));
  const group = state.groups()[0]!;
  assert.equal(group.keep,null); assert.deepEqual(group.remove,[]);
  state.chooseRemove(group.id,'2',true); state.chooseKeep(group.id,'2');
  assert.deepEqual(group.remove,[]);
  state.chooseRemove(group.id,'2',true); assert.deepEqual(group.remove,[]);
  state.chooseRemove(group.id,'3',true); assert.deepEqual(group.remove,['3']);
});
test('deletion is sequential and ambiguous failure retains successes, clears selection and blocks further cleanup', async () => {
  const state = (await factory())(); state.ingest(batch([item('1'),item('2'),item('3'),item('4')]));
  const group = state.groups()[0]!;
  state.chooseKeep(group.id,'1'); for(const id of ['2','3','4']) state.chooseRemove(group.id,id,true);
  const sent: string[]=[];
  const outcome = await state.resolve(group.id,async body=>{sent.push(body.remove); if(body.remove==='3')throw new Error('response lost');});
  assert.equal(outcome,false); assert.deepEqual(sent,['2','3']); assert.equal(state.reclaimed(),42);
  assert.deepEqual(group.items.map(x=>x.row.post_id),['1','3','4']); assert.deepEqual(group.remove,[]); assert.equal(group.keep,null);
  assert.equal(state.requiresRescan(),true);
  assert.equal(await state.resolve(group.id,async()=>{throw new Error('must not send');}),false);
});
test('rescan creates clean state without stale selections or pending groups', async () => {
  const state=(await factory())(); state.ingest(batch([item('1'),item('2')],false));
  state.reset(); assert.equal(state.checked(),0); assert.equal(state.pendingCount(),0); assert.deepEqual(state.groups(),[]);
});
test('a size bucket larger than a batch remains one keeper decision after continuation', async () => {
  const state=(await factory())();
  const first=Array.from({length:100},(_,i)=>item(String(i+1)));
  state.ingest(batch(first,false)); assert.equal(state.groups().length,0);
  state.ingest(batch(Array.from({length:5},(_,i)=>item(String(i+101)))));
  assert.equal(state.groups().length,1); assert.equal(state.groups()[0]!.items.length,105);
});
test('a completed earlier size bucket is published while the trailing bucket remains pending', async () => {
  const state=(await factory())();
  state.ingest(batch([item('1',10),item('2',10),item('3',42)],false));
  assert.equal(state.groups().length,1); assert.equal(state.groups()[0]!.fingerprint.bytes,10);
  assert.equal(state.pendingCount(),1);
  state.ingest(batch([item('4',42)])); assert.equal(state.groups().length,2);
});
test('successful cleanup removes a group with only its keeper left and preserves actual bytes reclaimed', async () => {
  const state=(await factory())(); state.ingest(batch([item('1'),item('2'),item('3')]));
  const group=state.groups()[0]!;state.chooseKeep(group.id,'1');state.chooseRemove(group.id,'2',true);state.chooseRemove(group.id,'3',true);
  const calls: unknown[]=[];let inFlight=0;
  const success=await state.resolve(group.id,async body=>{inFlight++;assert.equal(inFlight,1);await Promise.resolve();calls.push(body);inFlight--;});
  assert.equal(success,true);assert.equal(calls.length,2);assert.equal(state.reclaimed(),84);assert.equal(state.groups().length,0);assert.equal(state.requiresRescan(),false);
});
test('the exact serialized factory executes without server-module closures', async () => {
  const create=await factory();
  const state=vm.runInNewContext('('+create.toString()+')()');
  state.ingest(batch([item('1'),item('2')]));assert.equal(state.groups().length,1);
});
test('Wrangler-style keepNames bundling leaves emitted browser script executable without server helpers or automatic requests', async () => {
  const {build}=await import('esbuild');
  const bundle=await build({entryPoints:['src/html.ts'],bundle:true,platform:'node',format:'esm',keepNames:true,write:false});
  const renderer=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0]!.text).toString('base64'));
  const page=renderer.renderDuplicates();
  const script=page.match(/<script>([\s\S]*?)<\/script>/)![1]!;
  const elements=new Map<string, Record<string, unknown>>();
  let requests=0;
  const document={getElementById(id:string){if(!elements.has(id))elements.set(id,{});return elements.get(id);}};
  new vm.Script(script).runInNewContext({document,fetch(){requests++;throw new Error('must not auto-scan');}});
  assert.equal(requests,0);assert.equal(typeof elements.get('duplicate-scan')!.onclick,'function');assert.equal(typeof elements.get('similar-scan')!.onclick,'function');
});
test('request failure stops the controller; Continue resumes from the last acknowledged cursor without stealing focus', async () => {
  const page=html.renderDuplicates(),script=page.match(/<script>([\s\S]*?)<\/script>/)![1]!;
  const elements=new Map<string, Record<string, any>>();
  const focused={name:'outside-control',closest:()=>null,hasAttribute:()=>false};
  const document={activeElement:focused,getElementById(id:string){if(!elements.has(id))elements.set(id,{children:[],replaceChildren(...children:unknown[]){this.children=children;}});return elements.get(id);}};
  const requested:string[]=[];
  const first={...batch([item('1'),item('2',42,'b'.repeat(32))]),nextCursor:{bytes:42,postId:'2'}};
  let attempts=0;
  new vm.Script(script).runInNewContext({document,URLSearchParams,fetch:async(url:string)=>{requested.push(url);attempts++;if(attempts===2)throw new Error('network failure');return{ok:true,json:async()=>attempts===1?first:batch([item('3',84),item('4',84,'b'.repeat(32))])};}});
  await elements.get('duplicate-scan')!.onclick();
  assert.equal(requested.length,2);assert.match(elements.get('duplicate-status')!.textContent,/Scan request failed/);assert.equal(elements.get('duplicate-pause')!.textContent,'Continue');
  elements.get('duplicate-pause')!.onclick();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(requested.length,3);assert.equal(requested[1],requested[2]);assert.match(requested[2]!,/afterBytes=42&afterPostId=2/);
  assert.match(elements.get('duplicate-status')!.textContent,/Scan complete/);assert.equal(document.activeElement,focused);
});
test('coverage details start collapsed and metadata labels have no dangling separator', async () => {
  const page=html.renderDuplicates();
  assert.match(page,/<details[^>]*class="duplicate-notice[^>]*>\s*<summary>Coverage and deletion limits<\/summary>/);
  const script=page.match(/<script>([\s\S]*?)<\/script>/)![1]!;
  class Element {
    children: Element[]=[];dataset:Record<string,string>={};className='';textContent='';type='';value='';disabled=false;checked=false;
    tag:string;constructor(tag:string){this.tag=tag;}
    append(...nodes:Element[]){this.children.push(...nodes);}
    replaceChildren(...nodes:Element[]){this.children=nodes;}
    setAttribute(){}
    querySelectorAll(selector:string):Element[]{const found:Element[]=[];for(const node of this.children){if(selector==='input'?node.tag==='input':selector==='[data-delete]'?Object.hasOwn(node.dataset,'delete'):selector==='[data-selection]'?Object.hasOwn(node.dataset,'selection'):node.className===selector.slice(1))found.push(node);found.push(...node.querySelectorAll(selector));}return found;}
    querySelector(selector:string){return this.querySelectorAll(selector)[0];}
  }
  const elements=new Map<string,Element>();
  const document={activeElement:null,createElement:(tag:string)=>new Element(tag),createTextNode:(value:string)=>Object.assign(new Element('#text'),{textContent:value}),getElementById:(id:string)=>{if(!elements.has(id))elements.set(id,new Element('div'));return elements.get(id);}};
  const first=item('1');first.row.favorite=1;first.row.tags='["Coast","Travel"]';
  new vm.Script(script).runInNewContext({document,URLSearchParams,fetch:async()=>({ok:true,json:async()=>batch([first,item('2')])})});
  await (elements.get('duplicate-scan')! as unknown as {onclick:()=>Promise<void>}).onclick();
  assert.equal(elements.get('duplicate-results')!.querySelector('.duplicate-metadata')!.textContent,'Favourite · Tags: Coast, Travel');
});

test('thumbnail state accumulates large cross-page groups, ignores unknowns and has no keeper/removal state',async()=>{
 const {createThumbnailReviewState}=await import('#src/duplicates-ui');const state=createThumbnailReviewState();
 const entries=Array.from({length:105},(_,i)=>({row:row(String(10000+i),i+1),poster:{bytes:9,md5:hash},reason:null}));
 state.ingest({items:entries.slice(0,100),eligible:106,nextCursor:'10099',checkedAt:'2026-11-06'});
 state.ingest({items:entries.slice(99),eligible:106,nextCursor:null,checkedAt:'2026-11-06'});
 state.ingest({items:[{row:row('99999'),poster:null,reason:'missing_poster'}],eligible:106,nextCursor:null,checkedAt:'2026-11-06'});
 assert.equal(state.checked(),106);assert.equal(state.groups().length,1);assert.equal(state.groups()[0]!.items.length,105);assert.equal(state.unverified().length,1);
 assert.equal('resolve' in state,false);assert.equal('chooseKeep' in state,false);state.reset();assert.equal(state.checked(),0);
 const serialized=vm.runInNewContext('('+createThumbnailReviewState.toString()+')()');serialized.ingest({items:entries});assert.equal(serialized.groups().length,1);
});

test('rendered thumbnail suggestions allow different video metadata, Watch links and per-video delete, retry interrupted batches',async()=>{
 const page=html.renderDuplicates();assert.match(page,/Suggested matches — identical thumbnails/);
 const script=page.match(/<script>([\s\S]*?)<\/script>/)![1]!;
 class Element{
  children:Element[]=[];dataset:Record<string,string>={};className='';textContent='';tag:string;hidden=false;disabled=false;
  constructor(tag:string){this.tag=tag;} append(...nodes:Element[]){this.children.push(...nodes);} replaceChildren(...nodes:Element[]){this.children=nodes;}setAttribute(){}focus(){}
  querySelectorAll(selector:string):Element[]{return this.children.flatMap(n=>[...(n.tag===selector?[n]:[]),...n.querySelectorAll(selector)]);}
 }
 const elements=new Map<string,Element>();const document={activeElement:null,createElement:(tag:string)=>new Element(tag),getElementById:(id:string)=>{if(!elements.has(id))elements.set(id,new Element('div'));return elements.get(id);}};
 const first={row:row('10000',3),poster:{bytes:9,md5:hash},reason:null},second={row:{...row('10001',70),duration_ms:9000},poster:first.poster,reason:null};
 const requested:string[]=[];let attempts=0;
 new vm.Script(script).runInNewContext({document,URLSearchParams,fetch:async(url:string)=>{requested.push(url);attempts++;if(attempts===2)throw new Error('network');return {ok:true,json:async()=>({items:attempts===1?[first,second]:[{...second,row:{...second.row,post_id:'10002'}}],eligible:3,nextCursor:attempts===1?'10001':null,checkedAt:'2026-11-06'})};}});
 assert.equal(requested.length,0);
 await (elements.get('thumbnail-scan') as any).onclick();assert.match(elements.get('thumbnail-status')!.textContent,/partial/i);
 const originalVideo=elements.get('thumbnail-results')!.querySelectorAll('video')[0];
 (elements.get('thumbnail-pause') as any).onclick();await new Promise(r=>setImmediate(r));
 assert.equal(requested[1],requested[2]);assert.ok(requested.every(u=>u.startsWith('/api/duplicates/thumbnails')));
 const results=elements.get('thumbnail-results')!;assert.equal(results.querySelectorAll('video')[0],originalVideo,'later batches must preserve preview playback and focus');assert.equal(results.querySelectorAll('input').length,0);assert.equal(results.querySelectorAll('button').length,3,'one Delete this video button per suggestion card');
 const text=(e:Element):string=>e.textContent+' '+e.children.map(text).join(' ');const rendered=text(results);
 assert.match(rendered,/3 B · 0:05/);assert.match(rendered,/70 B · 0:09/);assert.doesNotMatch(rendered,/reclaim|redundant|keep this|remove this/i);
 assert.equal(results.querySelectorAll('a').filter((a:any)=>a.href?.startsWith('/watch/')).length,3);assert.match(elements.get('thumbnail-status')!.textContent,/complete/i);
});

test('approximate review renders a manual cancellable section with no probability or cleanup actions',()=>{
 const page=html.renderDuplicates();assert.match(page,/id="similar-scan"/);assert.match(page,/Scan similar thumbnails/);assert.match(page,/id="similar-cancel"/);
 assert.match(page,/hash similarity/i);assert.match(page,/32 MiB/);assert.match(page,/500/);
});

test('suggestion Delete this video confirms, sends DELETE, replaces every card for that post and reports failures', async () => {
 const script=html.renderDuplicates().match(/<script>([\s\S]*?)<\/script>/)![1]!;
 class Element{
  children:Element[]=[];parent:Element|null=null;dataset:Record<string,string>={};className='';textContent='';tag:string;hidden=false;disabled=false;onclick:any=null;
  constructor(tag:string){this.tag=tag;} append(...nodes:Element[]){for(const n of nodes)n.parent=this;this.children.push(...nodes);} replaceChildren(...nodes:Element[]){this.children=[];this.append(...nodes);}setAttribute(){}focus(){}
  querySelectorAll(selector:string):Element[]{return this.children.flatMap(n=>[...(n.tag===selector?[n]:[]),...n.querySelectorAll(selector)]);}
 }
 const elements=new Map<string,Element>();const document={activeElement:null,createElement:(tag:string)=>new Element(tag),createTextNode:(value:string)=>Object.assign(new Element('#text'),{textContent:value}),getElementById:(id:string)=>{if(!elements.has(id))elements.set(id,new Element('div'));return elements.get(id);}};
 const poster={bytes:9,md5:hash},items=['10000','10001','10002'].map(id=>({row:row(id,3),poster,reason:null}));
 const calls:{url:string;method?:string}[]=[];let answer=true,deleteStatus=204;const confirms:string[]=[];
 new vm.Script(script).runInNewContext({document,URLSearchParams,window:{confirm:(m:string)=>{confirms.push(m);return answer;}},fetch:async(url:string,init?:{method?:string})=>{calls.push({url,method:init?.method});
  if(init?.method==='DELETE')return {status:deleteStatus,ok:deleteStatus<300};
  return {ok:true,json:async()=>({items,eligible:3,nextCursor:null,checkedAt:'2026-11-06'})};}});
 await (elements.get('thumbnail-scan') as any).onclick();
 const results=elements.get('thumbnail-results')!,buttons=()=>results.querySelectorAll('button').filter(b=>Object.hasOwn(b.dataset,'deleteVideo'));
 assert.equal(buttons().length,3);assert.ok(buttons().every(b=>!b.disabled));
 answer=false;await buttons()[1]!.onclick();assert.equal(calls.filter(c=>c.method==='DELETE').length,0,'cancelled confirm sends nothing');
 assert.match(confirms[0]!,/10001/);assert.match(confirms[0]!,/no undo/i);
 answer=true;deleteStatus=500;await buttons()[1]!.onclick();
 assert.match(elements.get('thumbnail-status')!.textContent,/could not be deleted/i);assert.equal(buttons().length,3,'failed delete keeps the card');
 deleteStatus=204;await buttons()[1]!.onclick();
 assert.deepEqual(calls.filter(c=>c.method==='DELETE').map(c=>c.url),['/api/videos/10001','/api/videos/10001']);
 assert.equal(buttons().length,2);const text=(e:Element):string=>e.textContent+' '+e.children.map(text).join(' ');
 const gone=results.querySelectorAll('article').find(a=>a.dataset.post==='10001')!;assert.match(text(gone),/Deleted/);assert.equal(gone.querySelectorAll('video').length,0,'deleted card stops offering playback');
 assert.match(elements.get('thumbnail-status')!.textContent,/deleted/i);assert.ok(buttons().every(b=>!b.disabled),'controls unlock after deletion');
});
