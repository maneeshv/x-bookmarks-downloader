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
  assert.equal(requests,0);assert.equal(typeof elements.get('duplicate-scan')!.onclick,'function');
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
