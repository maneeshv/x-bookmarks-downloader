import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { renderDuplicates } from '#src/html';
import { posterPixels } from '#test/fixtures/perceptual';
class Element {
 children:Element[]=[];parent:Element|null=null;dataset:Record<string,string>={};className='';textContent='';tag:string;hidden=false;disabled=false;poster='';preload='';type='';src='';
 constructor(tag:string){this.tag=tag;}
 append(...nodes:Element[]){for(const n of nodes)n.parent=this;this.children.push(...nodes);}
 replaceChildren(...nodes:Element[]){this.children=[];this.append(...nodes);}
 remove(){if(this.parent)this.parent.children=this.parent.children.filter(n=>n!==this);}
 setAttribute(){}focus(){}
 querySelectorAll(selector:string):Element[]{return this.children.flatMap(n=>[...((selector==='[data-delete]'?Object.hasOwn(n.dataset,'delete'):selector==='[data-selection]'?Object.hasOwn(n.dataset,'selection'):n.tag===selector)?[n]:[]),...n.querySelectorAll(selector)]);}
 querySelector(selector:string){return this.querySelectorAll(selector)[0];}
 getContext(){return{drawImage(){},getImageData(){return {data:posterPixels(180,160)};}};}
 toDataURL(){return 'data:image/jpeg;base64,fixture';}
}
const text=(e:Element):string=>e.textContent+' '+e.children.map(text).join(' ');
test('real emitted similarity controller produces playable, deletable pairs from bounded image reads and prunes later exact matches',async()=>{
 const elements=new Map<string,Element>(),requests:string[]=[];let closed=0;
 const document={activeElement:null,createElement:(tag:string)=>new Element(tag),createTextNode:(value:string)=>Object.assign(new Element('#text'),{textContent:value}),getElementById:(id:string)=>{if(!elements.has(id))elements.set(id,new Element('div'));return elements.get(id);}};
 const image=readFileSync('test/fixtures/thumbnails/original.png');
 const items=[0,1].map(i=>({row:{post_id:String(91000+i),title:'Example '+i,r2_key:(91000+i)+'.mp4',bytes:i?70:3,duration_ms:i?9000:2000,first_seen_at:'2026-11-06'},poster:{bytes:image.length,md5:String(i).repeat(32)},reason:null}));
 const fetch=async(url:string,init:any)=>{requests.push(url);assert.notEqual(init?.method,'POST');
 if(url.startsWith('/p/')){assert.equal(elements.get('duplicate-scan')!.disabled,true);assert.equal(elements.get('thumbnail-scan')!.disabled,true);return new Response(image,{headers:{'content-type':'image/png'}});}
 if(url==='/api/duplicates/scan')return Response.json({items:items.map(i=>({row:{...i.row,bytes:42},fingerprint:{bytes:42,md5:'a'.repeat(32)},reason:null})),counts:{eligible:2,candidates:2,excluded:{multiVideo:0,error:0,unknownSize:0,invalidKey:0}},nextCursor:null,trailingSizeComplete:true,checkedAt:'2026-11-06'});
 return Response.json({items,eligible:2,nextCursor:null});};
 const script=renderDuplicates().match(/<script>([\s\S]*?)<\/script>/)![1]!;
 new vm.Script(script).runInNewContext({document,fetch,Blob,AbortController,Uint8Array,DataView,URLSearchParams,setTimeout,clearTimeout,createImageBitmap:async()=>({width:180,height:160,close(){closed++;}})});
 assert.equal(requests.length,0);await (elements.get('similar-scan') as any).onclick();
 const results=elements.get('similar-results')!;assert.equal(results.children.length,1);assert.equal(results.querySelectorAll('input').length,0);assert.equal(results.querySelectorAll('button').length,2,'each similar card offers Delete this video');
 for(const video of results.querySelectorAll('video'))assert.match(video.src,/^\/v\/9100[01]\.mp4$/,'pairs play inline');
 assert.match(text(results),/100.0% hash similarity/);assert.match(text(results),/3 B · 0:02/);assert.match(text(results),/70 B · 0:09/);assert.doesNotMatch(text(results),/reclaim|remove this|keep this/i);
 for(const video of results.querySelectorAll('video')){assert.equal(video.preload,'none');assert.match(video.poster,/^data:image\/jpeg/);}
 assert.equal(results.querySelectorAll('a').filter((a:any)=>a.href.startsWith('/watch/')).length,2);
 assert.equal(requests.filter(u=>u.startsWith('/p/')).length,2);assert.equal(requests.some(u=>u.startsWith('/v/')),false);assert.equal(closed,2);assert.match(elements.get('similar-status')!.textContent,/Scan complete/);
 await (elements.get('duplicate-scan') as any).onclick();assert.equal(results.children.length,0,'known exact-video matches must remove existing approximate pairs');
});
