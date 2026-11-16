import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const source=(p)=>ts.transpile(fs.readFileSync(p,'utf8').replace(/^import .*;\n/gm,''),{target:ts.ScriptTarget.ES2022});
const cors=()=>({});
const jsonReq=(body)=>new Request('https://example.invalid',{method:'POST',body:JSON.stringify(body)});
const quiet={log(){},error(){}};

// Shared stubs for the print-order flow (profile v4 contract): the billing
// namespace, payment binding and provider URL fence are exercised by their
// own suites; here they are mocked so these tests isolate ATOMICITY,
// SECRET-ECHO and NO-RETRY guarantees of the reservation flow.
const printEnv = { PRINT_ENABLED: 'true', PEECHO_OFFERING_ID_A5: '1', PEECHO_API_KEY: 'dummy-secret', PEECHO_SECRET_KEY: 'dummy-secret-2', STRIPE_SECRET_KEY: 'sk_test_dummy', BILLING_PROVIDER_ACCOUNT: 'acct_dummy' };
// URL sentinels let the fetch stub route reads (Stripe PI, catalogue,
// quote, details) separately from the two ambiguous-money submissions
// (order create, payment): only the submissions must never repeat.
const ORDER_URL = 'https://printer.test/api/order';
const printGlobals = {
  paymentProblem: () => null,
  stripeBillingConfigFromEnv: (key, account) => (key && account ? { secretKey: key, expectedAccount: account, mode: 'test' } : null),
  stripeBillingProvider: () => ({ verifiedNamespace: async () => ({ accountId: 'acct_dummy', livemode: false }) }),
  resolvePeechoOrderUrl: () => ({ url: ORDER_URL, mode: 'test' }),
  parseOfferingId: (v) => (v ? Number(v) : null),
  parsePeechoOfferingBounds: () => ({ minimumQuantity: 1, minNumberOfPages: 20, maxNumberOfPages: 300 }),
  positiveIntConfig: (v, d) => (v == null ? d : (/^\d+$/.test(v) && +v > 0 ? +v : null)),
  parsePeechoOrderId: (r) => (typeof r?.order_id === 'number' ? r.order_id : null),
  parsePeechoOrderDetails: () => ({ orderId: 42, orderReference: 'x', state: 'PAID', currency: 'GBP', totalWholesaleIncTaxes: '5.00' }),
  parsePeechoQuoteTotalMinor: () => 500,
  priceToMinorUnits: (v) => (v === '5.00' ? 500 : null),
  peechoOfferingListUrl: () => 'https://printer.test/api/offerings',
  peechoQuoteUrl: () => 'https://printer.test/api/quote',
  peechoPaymentUrl: () => 'https://printer.test/api/payment',
  peechoOrderDetailsUrl: () => 'https://printer.test/api/details',
  peechoPaymentBody: () => ({ dummy: true }),
  sha256Hex: async () => 'a'.repeat(64),
};
// A trim-size A5 page stamped with the CURRENT print profile marker.
const printPdfStub = {
  load: async () => ({
    getKeywords: () => 'story-sprout-print-profile:4',
    getPage: () => ({ getSize: () => ({ width: 14.8 * 28.34645669, height: 21 * 28.34645669 }) }),
    getPageCount: () => 24,
    insertPage: () => {},
    save: async () => new Uint8Array([1]),
  }),
};
// Read-only calls (Stripe PI retrieve, catalogue, quote, details) are safe
// to repeat; the handler may legitimately make several per order.
const printReadResponses = (piId) => (url) => {
  const u = String(url);
  if (u.startsWith('https://api.stripe.com/')) return new Response(JSON.stringify({ id: piId, status: 'succeeded', amount: 1299, livemode: false }));
  if (u === 'https://printer.test/api/offerings') return new Response(JSON.stringify({ dummy: true }));
  if (u === 'https://printer.test/api/quote') return new Response(JSON.stringify({ dummy: true }));
  if (u === 'https://printer.test/api/details') return new Response(JSON.stringify({ dummy: true }));
  return null;
};
// update() chains one or two .eq() calls and may be awaited at either
// depth; this chain resolves to the same result at any depth.
const updateChain = (result, onUpdate) => {
  const chain = { eq: () => chain, then: (resolve) => { onUpdate(); resolve(result); } };
  return chain;
};

test('print atomic reservation permits one provider call for concurrent requests; retry blocked', async()=>{
 let handler, reserved=false, submitted=false, submissions=0;
 const chain=(table)=>{
  const q={select(){return q},eq(){return q},in(){return q},maybeSingle(){return Promise.resolve({data:{title:'Dummy',print_pdf_path:'x/print.pdf'}})},
   then(resolve){resolve({data:table==='entitlements'?[{payment_intent_id:'dummy-payment'}]:reserved?[{payment_intent_id:'dummy-payment',status:submitted?'submitted':'pending',provider_order_id:42}]:[],error:null})},
   async insert(){if(reserved)return {error:{code:'23505'}};reserved=true;return {error:null}},
   update(row){return updateChain({error:null},()=>{submitted=submitted||row.status==='submitted'})}};return q;
 };
 const db={from:chain,storage:{from:()=>({download:async()=>({data:new Blob(['dummy'])}),upload:async()=>({}),createSignedUrl:async()=>({data:{signedUrl:'https://example.invalid/dummy.pdf'}})})}};
 const reads=printReadResponses('dummy-payment');
 const ctx={Request,Response,Blob,AbortSignal,console:quiet,serve:fn=>handler=fn,AuthError:class extends Error{},requireUser:async()=>({id:'dummy-user'}),serviceClient:()=>db,unauthorisedResponse:()=>new Response('',{status:401}),getCorsHeaders:cors,BOOKS_BUCKET:'dummy',
  paddedPageCount:()=>24,peechoOrderBody:()=>({dummy:true}),validateAddress:()=>({address:{country:'GB',dummy:true}}),TRIM_CM:{'A5 portrait':{width:14.8,height:21}},
  PDFDocument:printPdfStub,...printGlobals,
  Deno:{env:{get:k=>printEnv[k]}},
  fetch:async(url,opts)=>{assert.ok(opts.signal);const read=reads(url);if(read)return read;
   if(String(url)===ORDER_URL){submissions++;await new Promise(r=>setTimeout(r,10));return new Response(JSON.stringify({order_id:42}));}
   throw new Error('unexpected fetch '+url)}};
 vm.runInNewContext(source('supabase/functions/create-print-order/index.ts'),ctx);
 const body={storyId:'dummy-story',address:{}};
 const res=await Promise.all([handler(jsonReq(body)),handler(jsonReq(body))]);
 // Exactly one provider order submission for concurrent requests.
 assert.equal(submissions,1);assert.ok(res.some(r=>r.status===200));assert.ok(res.some(r=>r.status===409));
 // A retry reconciles the submitted order read-only and reports it placed,
 // never submitting to the provider again.
 const retry=await handler(jsonReq(body));assert.equal(retry.status,200);assert.equal(submissions,1);
 // An ambiguous pending row blocks any further provider submission.
 submitted=false;const uncertain=await handler(jsonReq(body));assert.equal(uncertain.status,409);assert.equal(submissions,1);
});

test('paid intent default-off gate stops Stripe, free and owned exports still pass',async()=>{
 for(const scenario of ['paid','first-free','owned']){
 let handler,stripeCalls=0,reads=0;
 const service={from:()=>{const q={select:()=>q,eq:()=>q,limit:async()=>({data:scenario==='owned'?[{id:'dummy'}]:scenario==='paid'&&++reads>1?[{id:'other'}]:[]})};return q}};
 const ctx={Request,Response,console:quiet,serve:fn=>handler=fn,AuthError:class extends Error{},requireUser:async()=>({id:'dummy'}),serviceClient:()=>service,unauthorisedResponse:()=>new Response('',{status:401}),getCorsHeaders:cors,CURRENCY:'gbp',isPricedItem:()=>true,priceFor:()=>299,paidCreationAllowedForUser:()=>false,Deno:{env:{get:()=>undefined}},Stripe:class{constructor(){stripeCalls++}}};
 vm.runInNewContext(source('supabase/functions/billing-intent/index.ts'),ctx);
 const res=await handler(jsonReq({item:'export',storyId:'dummy'}));
 assert.equal(res.status,scenario==='paid'?403:200);assert.equal(stripeCalls,0);
 }
});

test('print failures preserve reservation and never retry an uncertain provider outcome', async()=>{
 for(const mode of ['insert','download','timeout','provider500','invalidJson','invalidId','record']) {
  let handler,reserved=false,submissions=0;
  const chain=table=>{const q={select:()=>q,eq:()=>q,in:()=>q,
   maybeSingle:async()=>({data:{title:'Dummy',print_pdf_path:'x/print.pdf'}}),
   then(resolve){resolve({data:table==='entitlements'?[{payment_intent_id:'dummy-payment'}]:reserved?[{payment_intent_id:'dummy-payment',status:'pending'}]:[],error:null})},
   async insert(){if(mode==='insert')return {error:{code:'XX000'}};if(reserved)return {error:{code:'23505'}};reserved=true;return {error:null}},
   update(){return updateChain({error:mode==='record'?{code:'XX000'}:null},()=>{})}};return q};
  const db={from:chain,storage:{from:()=>({download:async()=>mode==='download'?{error:Error('dummy-secret')}:{data:new Blob(['dummy'])},upload:async()=>({}),createSignedUrl:async()=>({data:{signedUrl:'https://example.invalid/dummy.pdf'}})})}};
  // Every fetch must carry a timeout signal; the flow uses 10-20s budgets.
  const FastDeadline={timeout(ms){assert.ok([10000,15000,20000].includes(ms),'timeout budget '+ms);return AbortSignal.timeout(5)}};
  const reads=printReadResponses('dummy-payment');
  const ctx={Request,Response,Blob,AbortSignal:FastDeadline,console:quiet,serve:fn=>handler=fn,AuthError:class extends Error{},requireUser:async()=>({id:'dummy-user'}),serviceClient:()=>db,unauthorisedResponse:()=>new Response('',{status:401}),getCorsHeaders:cors,BOOKS_BUCKET:'dummy',
   paddedPageCount:()=>24,peechoOrderBody:()=>({dummy:true}),validateAddress:()=>({address:{country:'GB',dummy:true}}),TRIM_CM:{'A5 portrait':{width:14.8,height:21}},
   PDFDocument:printPdfStub,...printGlobals,
   Deno:{env:{get:k=>printEnv[k]}},
   fetch:async(url,opts)=>{assert.ok(opts.signal);
    if(String(url)===ORDER_URL){submissions++;
     if(mode==='timeout')return new Promise((resolve,reject)=>{const keep=setTimeout(resolve,100);opts.signal.addEventListener('abort',()=>{clearTimeout(keep);reject(opts.signal.reason)},{once:true})});
     if(mode==='provider500')return new Response('dummy-secret',{status:500});
     if(mode==='invalidJson')return new Response('not-json');
     return new Response(JSON.stringify(mode==='invalidId'?{id:{raw:'dummy-secret'}}:{order_id:42}));}
    const read=reads(url);if(read)return read;
    throw new Error('unexpected fetch '+url)}};
  vm.runInNewContext(source('supabase/functions/create-print-order/index.ts'),ctx);
  const req=()=>jsonReq({storyId:'dummy-story',address:{}});
  const first=await handler(req());assert.ok(first.status>=400,mode);assert.ok(!(await first.text()).includes('dummy-secret'),mode);
  if(mode==='insert'){assert.equal(submissions,0);assert.equal(reserved,false);continue}
  assert.equal(reserved,true);
  // Read-only pre-flight (PI verify, catalogue) may run, but the ambiguous
  // provider submission happens at most once and is never retried.
  const retry=await handler(req());assert.equal(retry.status,409,mode);
  assert.equal(submissions,mode==='download'?0:1,mode);
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
