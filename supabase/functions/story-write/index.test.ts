// Actual handler + real pure helpers. Every external call is intercepted.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import path from 'node:path'
import * as draftHelpers from './bookDraft.ts'
import * as castHelpers from './castText.ts'
import * as textHelpers from '../_shared/textContract.ts'
import * as sceneHelpers from '../_shared/sceneLedger.ts'

const config={children:[],characters:['a friendly dog'],personal:{},storyType:'Adventure',setting:'Garden',lengthPages:6,readingLevel:'Toddler 2–3',narrationStyle:'Gentle prose',palette:['blue'],imageStyle:'Watercolour',pageSize:'A5 portrait'}
const good='The child held the blue teddy.\nThe dog sat nearby.\nThey smiled at the sun.\nThen they went home together.'
const outline={pages:Array.from({length:6},(_,i)=>({page:i+1,wordCount:24,visualBrief:'Child with blue teddy and dog.'})),sceneLedger:{locations:{garden:'Garden'},outfits:{child:'blue coat',dog:'natural brown coat'},scenes:Array.from({length:6},(_,i)=>({page:i+1,locationId:'garden',time:'day',characters:['child','dog'],outfits:{child:'child',dog:'dog'},props:{blueTeddy:'child'},transition:''}))}}
async function run({short=false,invalid=false,named=false,longLine=false}={}){
 const calls:Array<{messages:Array<{content:string}>;response_format?:unknown}>=[]
 const external:typeof fetch=async (_url,opts)=>{
  const body=JSON.parse(String(opts?.body));calls.push(body)
  const content=body.response_format ? JSON.stringify({pages:invalid?[]:outline.pages.map(p=>({page:p.page,text:short?'A tiny draft.':longLine?good.replace(/\n/g,' '):good}))}) : good
  return new Response(JSON.stringify({choices:[{message:{content}}]}))
 }
 let handler:(req:Request)=>Promise<Response>=()=>{throw Error('handler missing')}
 const ctx={...draftHelpers,...castHelpers,...textHelpers,...sceneHelpers,Request,Response,JSON,Map,console:{log(){},warn(){},error(){}},fetch:external,Deno:{env:{get:(key:string)=>key==='OPENAI_API_KEY'?'synthetic-key':undefined}},serve:(fn:typeof handler)=>{handler=fn},AuthError:class extends Error{},requireUser:async()=>({id:'synthetic-user'}),unauthorisedResponse:()=>new Response('unauthorized',{status:401}),getCorsHeaders:()=>({}),serviceClient:()=>({}),claimBook:async()=>true,bookPaymentRequired:()=>new Response('payment',{status:402}),validateStoryConfig:()=>null}
 const source=fs.readFileSync(path.join(import.meta.dirname,'index.ts'),'utf8').replace(/^import[^\n]+\n/gm,'')
 vm.runInNewContext(ts.transpile(source,{target:ts.ScriptTarget.ES2022}),ctx)
 const response=await handler(new Request('https://test.invalid',{method:'POST',body:JSON.stringify({config:named?{...config,children:['Aoife'],personal:{pets:'Pepper the cat',favouriteToy:'Bun-bun'}}:config,outline,storyId:'synthetic-story'})}))
 return {response,calls,body:await response.json()}
}
test('actual handler: six-page generic book gets exactly one joint first draft and no invented fallback names',async()=>{
 const r=await run();assert.equal(r.response.status,200);assert.equal(r.calls.length,1);assert.equal(r.body.pages.length,6)
 assert.match(r.calls[0].messages[0].content,/protagonist is unnamed/)
 assert.match(r.calls[0].messages[1].content,/Child with blue teddy and dog/)
 assert.doesNotMatch(JSON.stringify(r.body),/Amelia|Sophie|Maya|Charlie/)
})
test('actual handler: every word-count repair receives canonical cast AND whole-book neighbour draft',async()=>{
 const r=await run({short:true});assert.equal(r.response.status,200);assert.equal(r.calls.length,7)
 for(const call of r.calls.slice(1)){
 const content=call.messages.map(m=>m.content).join('\n');assert.match(content,/WHOLE-BOOK CAST LOCK/);assert.match(content,/WHOLE-BOOK DRAFT/);assert.match(content,/protagonist is unnamed/);assert.match(content,/blueTeddy/);assert.doesNotMatch(content,/Keep UK English and all proper nouns/)
 }
})
test('actual handler: supplied names/descriptions survive every repair and generic rule does not override them',async()=>{
 const r=await run({short:true,named:true});assert.equal(r.response.status,200)
 for(const call of r.calls){const content=call.messages.map(m=>m.content).join('\n');for(const name of ['Aoife','Pepper the cat','Bun-bun'])assert.ok(content.includes(name));assert.doesNotMatch(content,/protagonist is unnamed/)}
})
test('actual handler: incomplete whole-book response fails before any page retries or successful pages',async()=>{
 const r=await run({invalid:true});assert.equal(r.response.status,500);assert.equal(r.calls.length,1);assert.equal(r.body.pages,undefined)
})

test('actual handler: line-shape repair also receives canonical cast and whole-book draft',async()=>{
 const r=await run({longLine:true});assert.equal(r.response.status,200);assert.equal(r.calls.length,7)
 for(const call of r.calls.slice(1)){const content=call.messages.map(m=>m.content).join('\n');assert.match(content,/WHOLE-BOOK CAST LOCK/);assert.match(content,/WHOLE-BOOK DRAFT/);assert.match(content,/Rewrite this children/);assert.doesNotMatch(content,/all proper nouns/)}
})
