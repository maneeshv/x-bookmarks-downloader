// Verify that Wrangler's emitted client factories execute outside the Worker bundle's closure.
// node --no-warnings scripts/check-reels-bundle.mjs /absolute/path/to/built/index.js
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runInNewContext } from 'node:vm';
import { readFile } from 'node:fs/promises';
import { Store } from '#src/store';
const { FakeD1, FakeKV, FakeR2, makeSigner } = await import(pathToFileURL(resolve('test/fakes.ts')).href);
const bundle = process.argv[2];
if(!bundle) throw Error('Provide the Wrangler dry-run index.js path');
// A data URL keeps ESM interpretation independent of the temp directory package type.
const { handle } = await import('data:text/javascript;base64,'+Buffer.from(await readFile(bundle)).toString('base64'));
const db=new FakeD1(),kv=new FakeKV(),r2=new FakeR2(),signer=await makeSigner('bundle-smoke');
const env={ X_CLIENT_ID:'fixture',X_CLIENT_SECRET:'fixture',TEAM_DOMAIN:'https://bundle-qa.cloudflareaccess.com',POLICY_AUD:'bundle-qa',PUBLIC_ORIGIN:'https://fixture.example',OWNER_EMAIL:'owner@example.test',DB:db.asD1(),KV:kv.asKV(),VIDEOS:r2.asR2() };
await new Store(env.KV,env.DB,env.VIDEOS).upsertBookmark({post_id:'61001',posted_at:null,text:'Synthetic fixture',post_url:'https://x.com/i/status/61001',has_video:1,status:'downloaded',error:null,r2_key:'61001.mp4',bytes:1,duration_ms:1000,preview_url:null,now:'2026-11-06T00:00:00Z'});
const jwt=await signer.sign({aud:[env.POLICY_AUD],iss:env.TEAM_DOMAIN,exp:Date.now()/1000+60,email:env.OWNER_EMAIL});
const response=await handle(new Request(env.PUBLIC_ORIGIN+'/reels',{headers:{'cf-access-jwt-assertion':jwt}}),env,async()=>Response.json({keys:[signer.jwk]}));
assert.equal(response.status,200);
const page=await response.text(), script=page.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(script,'Reels runtime must be emitted');
const prefix=script.slice(0,script.indexOf('(function(items'));
assert.ok(prefix.length>0);
const result=runInNewContext(prefix+`;({ids:REELS_STATE.shuffle(['61001','61002'],'12345678'),url:REELS_URLS.href(REELS_CONTEXT),controller:typeof REELS_CONTROLLER})`,{URLSearchParams,Set,Map,URL,console});
assert.equal(result.ids.length,2);assert.match(result.url,/^\/reels\?/);assert.equal(result.controller,'function');
console.log('Bundled Reels factories execute without Worker closure dependencies');
