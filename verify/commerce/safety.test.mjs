import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const source=(p)=>ts.transpile(fs.readFileSync(p,'utf8').replace(/^import .*;\n/gm,''),{target:ts.ScriptTarget.ES2022});
const cors=()=>({});
const jsonReq=(body)=>new Request('https://example.invalid',{method:'POST',body:JSON.stringify(body)});
const quiet={log(){},error(){}};

test('print atomic reservation permits one provider call for concurrent requests; retry blocked', async()=>{
 let handler, reserved=false, submitted=false, calls=0;
 const chain=(table)=>{
  const q={select(){return q},eq(){return q},in(){return q},maybeSingle(){return Promise.resolve({data:{title:'Dummy',print_pdf_path:'x/print.pdf'}})},
   then(resolve){resolve({data:table==='entitlements'?[{payment_intent_id:'dummy-payment'}]:reserved?[{payment_intent_id:'dummy-payment',status:submitted?'submitted':'pending',provider_order_id:'dummy-order'}]:[],error:null})},
   async insert(){if(reserved)return {error:{code:'23505'}};reserved=true;return {error:null}},
   update(row){submitted=row.status==='submitted';return {eq:async()=>({error:null})}}};return q;
 };
 const db={from:chain,storage:{from:()=>({download:async()=>({data:new Blob(['dummy'])}),upload:async()=>({}),createSignedUrl:async()=>({data:{signedUrl:'https://example.invalid/dummy.pdf'}})})}};
 const ctx={Request,Response,Blob,AbortSignal,console:quiet,serve:fn=>handler=fn,AuthError:class extends Error{},requireUser:async()=>({id:'dummy-user'}),serviceClient:()=>db,unauthorisedResponse:()=>new Response('',{status:401}),getCorsHeaders:cors,BOOKS_BUCKET:'dummy',
  paddedPageCount:()=>24,peechoOrderBody:()=>({dummy:true}),validateAddress:()=>({address:{dummy:true}}),TRIM_CM:{'A5 portrait':{width:14.8,height:21}},
  PDFDocument:{load:async()=>({getPage:()=>({getSize:()=>({width:(14.8+.6)*28.34645669,height:(21+.6)*28.34645669})}),getPageCount:()=>24,save:async()=>new Uint8Array([1])})},
  Deno:{env:{get:k=>({PRINT_ENABLED:'true',PEECHO_OFFERING_ID_A5:'1',PEECHO_API_KEY:'dummy-secret'})[k]}},
  fetch:async()=>{calls++;await new Promise(r=>setTimeout(r,10));return new Response('{"id":"dummy-order"}')}};
 vm.runInNewContext(source('supabase/functions/create-print-order/index.ts'),ctx);
 const body={storyId:'dummy-story',address:{}};
 const res=await Promise.all([handler(jsonReq(body)),handler(jsonReq(body))]);
 assert.equal(calls,1);assert.ok(res.some(r=>r.status===200));assert.ok(res.some(r=>r.status===409));
 const retry=await handler(jsonReq(body));assert.equal(retry.status,200);assert.equal(calls,1);
 submitted=false;const uncertain=await handler(jsonReq(body));assert.equal(uncertain.status,409);assert.equal(calls,1);
});

test('paid intent default-off gate stops Stripe, free and owned exports still pass',async()=>{
 for(const scenario of ['paid','first-free','owned']){
 let handler,stripeCalls=0,reads=0;
 const service={from:()=>{const q={select:()=>q,eq:()=>q,limit:async()=>({data:scenario==='owned'?[{id:'dummy'}]:scenario==='paid'&&++reads>1?[{id:'other'}]:[]})};return q}};
 const ctx={Request,Response,console:quiet,serve:fn=>handler=fn,AuthError:class extends Error{},requireUser:async()=>({id:'dummy'}),serviceClient:()=>service,unauthorisedResponse:()=>new Response('',{status:401}),getCorsHeaders:cors,CURRENCY:'gbp',isPricedItem:()=>true,priceFor:()=>299,Deno:{env:{get:()=>undefined}},Stripe:class{constructor(){stripeCalls++}}};
 vm.runInNewContext(source('supabase/functions/billing-intent/index.ts'),ctx);
 const res=await handler(jsonReq({item:'export',storyId:'dummy'}));
 assert.equal(res.status,scenario==='paid'?403:200);assert.equal(stripeCalls,0);
 }
});

test('print failures preserve reservation and never retry an uncertain provider outcome', async()=>{
 for(const mode of ['insert','download','timeout','provider500','invalidJson','invalidId','record']) {
  let handler,reserved=false,calls=0,updates=0;
  const chain=table=>{const q={select:()=>q,eq:()=>q,in:()=>q,
   maybeSingle:async()=>({data:{title:'Dummy',print_pdf_path:'x/print.pdf'}}),
   then(resolve){resolve({data:table==='entitlements'?[{payment_intent_id:'dummy-payment'}]:reserved?[{payment_intent_id:'dummy-payment',status:'pending'}]:[],error:null})},
   async insert(){if(mode==='insert')return {error:{code:'XX000'}};if(reserved)return {error:{code:'23505'}};reserved=true;return {error:null}},
   update(){updates++;return {eq:async()=>({error:mode==='record'?{code:'XX000'}:null})}}};return q};
  const db={from:chain,storage:{from:()=>({download:async()=>mode==='download'?{error:Error('dummy-secret')}:{data:new Blob(['dummy'])},upload:async()=>({}),createSignedUrl:async()=>({data:{signedUrl:'https://example.invalid/dummy.pdf'}})})}};
  // A short fake deadline proves the code passes its timeout signal into fetch.
  const FastDeadline={timeout(ms){assert.equal(ms,20000);return AbortSignal.timeout(5)}};
  const ctx={Request,Response,Blob,AbortSignal:FastDeadline,console:quiet,serve:fn=>handler=fn,AuthError:class extends Error{},requireUser:async()=>({id:'dummy-user'}),serviceClient:()=>db,unauthorisedResponse:()=>new Response('',{status:401}),getCorsHeaders:cors,BOOKS_BUCKET:'dummy',
   paddedPageCount:()=>24,peechoOrderBody:()=>({dummy:true}),validateAddress:()=>({address:{dummy:true}}),TRIM_CM:{'A5 portrait':{width:14.8,height:21}},
   PDFDocument:{load:async()=>({getPage:()=>({getSize:()=>({width:15.4*28.34645669,height:21.6*28.34645669})}),getPageCount:()=>24,save:async()=>new Uint8Array([1])})},
   Deno:{env:{get:k=>({PRINT_ENABLED:'true',PEECHO_OFFERING_ID_A5:'1',PEECHO_API_KEY:'dummy-secret'})[k]}},
   fetch:async(url,opts)=>{calls++;assert.ok(opts.signal);if(mode==='timeout')return new Promise((resolve,reject)=>{const keep=setTimeout(resolve,100);opts.signal.addEventListener('abort',()=>{clearTimeout(keep);reject(opts.signal.reason)},{once:true})});
    if(mode==='provider500')return new Response('dummy-secret',{status:500});
    if(mode==='invalidJson')return new Response('not-json');
    return new Response(JSON.stringify({id:mode==='invalidId'?{raw:'dummy-secret'}:'dummy-order'}));}};
  vm.runInNewContext(source('supabase/functions/create-print-order/index.ts'),ctx);
  const req=()=>jsonReq({storyId:'dummy-story',address:{}});
  const first=await handler(req());assert.ok(first.status>=400,mode);assert.ok(!(await first.text()).includes('dummy-secret'),mode);
  if(mode==='insert'){assert.equal(calls,0);assert.equal(reserved,false);continue}
  assert.equal(reserved,true);const before=calls;
  const retry=await handler(req());assert.equal(retry.status,409,mode);assert.equal(calls,before,mode);
  assert.equal(calls,mode==='download'?0:1,mode);
 }
});

test('billing errors are generic with no raw DB error in responses or logs',async()=>{
 let handler;const logs=[];
 const ctx={Request,Response,console:{error:(...args)=>logs.push(args)},serve:fn=>handler=fn,AuthError:class extends Error{},requireUser:async()=>({id:'dummy'}),serviceClient:()=>{throw Error('dummy-private-db-error')},unauthorisedResponse:()=>new Response('',{status:401}),getCorsHeaders:cors,CURRENCY:'gbp',isPricedItem:()=>true,priceFor:()=>299,Deno:{env:{get:()=>undefined}},Stripe:class{}};
 vm.runInNewContext(source('supabase/functions/billing-intent/index.ts'),ctx);
 const res=await handler(jsonReq({item:'export',storyId:'dummy'}));assert.equal(res.status,500);
 assert.deepEqual(await res.json(),{success:false,error:'Payment setup is unavailable. Please try again later.'});
 assert.ok(!JSON.stringify(logs).includes('dummy-private-db-error'));
});
