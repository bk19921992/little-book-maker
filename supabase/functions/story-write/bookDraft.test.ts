import fs from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { canonicalCastContext, generateBookDraft, parseBookDraft } from './bookDraft.ts'

test('generic hero remains unnamed; unnamed toys/pets have one consistent descriptive reference', () => {
 const context=canonicalCastContext({children:[],characters:['a friendly dog'],personal:{}},{scenes:[{characters:['child','dog'],props:{blueTeddy:'child'}}]})
 assert.match(context,/protagonist is unnamed/)
 assert.match(context,/Do not invent a child name/)
 assert.match(context,/blueTeddy/)
 assert.match(context,/a blue teddy cannot become a pink bear or a bunny/)
 assert.doesNotMatch(context,/Amelia|Sophie|Maya|Pippa|Ellie|Oliver|Charlie/)
})
test('user-supplied names and species/toy descriptions preserved verbatim rather than a default cast',()=>{
 const context=canonicalCastContext({children:['Aoife','Jean-Luc'],characters:['Grandad'],personal:{pets:'Pepper the cat',favouriteToy:'Bun-bun the rabbit'}},null)
 for(const value of ['Aoife','Jean-Luc','Grandad','Pepper the cat','Bun-bun the rabbit']) assert.ok(context.includes(value))
 assert.doesNotMatch(context,/protagonist is unnamed/)
})
test('draft parsing fails closed for missing, extra, duplicate, blank, invalid or invented page ids',()=>{
 for(const pages of [[],[{page:1,text:'valid story text'}],[{page:1,text:'valid story text'},{page:1,text:'another good text'}],[{page:1,text:'valid story text'},{page:3,text:'another good text'}],[{page:1,text:'valid story text'},{page:2,text:''}]]) assert.throws(()=>parseBookDraft({pages},[1,2]))
 assert.deepEqual([...parseBookDraft({pages:[{page:2,text:' second page text '},{page:1,text:'first page text'}]},[1,2])],[[2,'second page text'],[1,'first page text']])
})
test('six-page first draft uses one model call with full cast and every scene, never independent per-page identities',async()=>{
 const calls:Record<string,unknown>[]=[]
 const fetcher:typeof fetch=async (_url,opts)=>{calls.push(JSON.parse(String(opts?.body)));return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({pages:Array.from({length:6},(_,i)=>({page:i+1,text:'The child and teddy walked together.'}))})}}]}))}
 const castLock=canonicalCastContext({children:[],characters:[],personal:{}},{scenes:[{page:1,characters:['child'],props:{blueTeddy:'child'}}]})
 const draft=await generateBookDraft({fetcher,key:'synthetic-key',prompts:['scene1','scene2','scene3','scene4','scene5','scene6'],pageNumbers:[1,2,3,4,5,6],castLock})
 assert.equal(calls.length,1);assert.equal(draft.size,6)
 const body=JSON.stringify(calls[0]);for(const scene of ['scene1','scene6','blueTeddy','protagonist is unnamed'])assert.ok(body.includes(scene))
})
test('invalid model JSON and provider error never silently become repeated stock fallback pages or a second paid call',async()=>{
 for(const response of [new Response('provider failure',{status:500}),new Response(JSON.stringify({choices:[{message:{content:'not JSON'}}]}))]){
 let count=0;await assert.rejects(generateBookDraft({fetcher:async()=>{count++;return response},key:'synthetic',prompts:['one'],pageNumbers:[1],castLock:'lock'}));assert.equal(count,1)
 }
})

test('actual raw approved-test fixture: no named child/pet/toy is supplied; stable hero/dog/favorite-toy scene identity reaches one book draft',async()=>{
 const c=JSON.parse(fs.readFileSync(new URL('./rawGeneric.fixture.json',import.meta.url),'utf8'))
 assert.deepEqual(c.children,[]);assert.deepEqual(c.personal,{});assert.deepEqual(c.characters,['Friendly dog'])
 const lock=canonicalCastContext(c,c.outline.sceneLedger)
 assert.match(lock,/protagonist is unnamed/);assert.match(lock,/favorite-toy/);assert.match(lock,/animal-natural-coat/);assert.match(lock,/the favourite toy/)
 let calls=0
 const draft=await generateBookDraft({key:'synthetic',castLock:lock,pageNumbers:c.outline.pages.map((p:{page:number})=>p.page),prompts:c.outline.pages.map((p:unknown)=>JSON.stringify(p)),fetcher:async(_url,opts)=>{calls++;const prompt=String(opts?.body);for(const text of ['favorite-toy','Friendly dog','outside-house','bedroom','polka dots'])assert.ok(prompt.includes(text));return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({pages:c.outline.pages.map((p:{page:number})=>({page:p.page,text:'The child holds the favourite toy. The friendly dog rests nearby.'}))})}}]}))}})
 assert.equal(calls,1);assert.equal(draft.size,6)
 for(const text of draft.values())assert.doesNotMatch(text,/Amelia|Sophie|Maya|Pippa|Ellie|Oliver|Charlie|Pink Bear|Blue Bunny/)
})

test('missing, null or malformed optional cast arrays normalize safely to the unnamed generic contract',()=>{
 for(const config of [{},{children:null,characters:null},{children:'Mia',characters:42},{children:[null,7,''],characters:[{},false]}]){
 const lock=canonicalCastContext(config,null);assert.match(lock,/protagonist is unnamed/);assert.match(lock,/User-supplied child names: \[\]/);assert.match(lock,/User-supplied other characters: \[\]/)
 }
})
