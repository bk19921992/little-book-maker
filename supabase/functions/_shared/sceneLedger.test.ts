import {test} from 'node:test';import assert from 'node:assert/strict';
import {sceneGateEnforced,sceneGateVerdict,sceneLedgerIssues,imageSceneIssues,sceneContext,type SceneLedger} from './sceneLedger.ts';
const fixture=():SceneLedger=>({locations:{home:'blue door and bedroom',school:'yellow door and child coat hooks'},outfits:{day:'red jumper jeans',animal:'natural black coat'},scenes:[{page:1,locationId:'home',time:'morning',characters:['child','dog'],outfits:{child:'day',dog:'animal'},props:{bear:'child'},transition:''},{page:2,locationId:'school',time:'morning',characters:['child'],outfits:{child:'day'},props:{bear:'child'},transition:'They walk to school; dog waits outside at goodbye.'}]});
test('complete explicit sequence is structurally valid, not a visual pass',()=>assert.deepEqual(sceneLedgerIssues(fixture(),2),[]));
test('missing/out-of-order/unknown state fails before generation',()=>{for(const f of [undefined,{}, {...fixture(),scenes:[]},{...fixture(),scenes:fixture().scenes.slice().reverse()}])assert.ok(sceneLedgerIssues(f,2).length);const f=fixture();f.scenes[1].locationId='unknown';assert.ok(sceneLedgerIssues(f,2).length)});
test('location/time/clothing/prop/character changes require transition',()=>{for(const key of ['locationId','time','characters','outfits','props'] as const){const f=fixture();f.scenes[1]={...f.scenes[0],page:2,transition:''};const mutations={locationId:'school',time:'evening',characters:['child'],outfits:{child:'animal',dog:'animal'},props:{bear:'table'}};Object.assign(f.scenes[1],{[key]:mutations[key]});assert.ok(sceneLedgerIssues(f,2).length,key)}});
test('image/writer context contains exact door/clothes/prop/character state',()=>{const c=sceneContext(fixture(),2);assert.match(c,/yellow door/);assert.match(c,/red jumper jeans/);assert.match(c,/dog waits outside/);assert.match(c,/Visible characters ONLY: child/)});
test('missing outfit or blank prop is not silently accepted',()=>{const f=fixture();f.scenes[1].outfits={};f.scenes[1].props={bear:''};assert.ok(sceneLedgerIssues(f,2).length>=2)});

test('scenery-only states allowed and object key order is not a change',()=>{const f=fixture();f.scenes=[{...f.scenes[0],characters:[],outfits:{},props:{}},{...f.scenes[0],page:2,characters:[],outfits:{},props:{}}];assert.deepEqual(sceneLedgerIssues(f,2),[]);const g=fixture();g.scenes[1]={...g.scenes[0],page:2,outfits:{dog:'animal',child:'day'},transition:''};assert.deepEqual(sceneLedgerIssues(g,2),[])});
test('server image start rejects absent, malformed, duplicate or unknown plan pages',()=>{for(const l of [undefined,{}, {scenes:4}])assert.ok(imageSceneIssues(l,[{page:1}]).length);for(const ps of [[{page:3}],[{page:1},{page:1}]])assert.ok(imageSceneIssues(fixture(),ps).length);assert.deepEqual(imageSceneIssues(fixture(),[{page:2}]),[])});
test('scene gate defaults to enforce; permissive only when explicit',()=>{assert.equal(sceneGateEnforced(()=>undefined),true);assert.equal(sceneGateEnforced(()=>'enforce'),true);assert.equal(sceneGateEnforced(()=>'permissive'),false);assert.equal(sceneGateEnforced(()=>'PERMISSIVE'),true);assert.equal(sceneGateEnforced(()=>'off'),true)});
test('gate verdict: invalid present ledger always rejects, missing ledger only relaxed in permissive',()=>{
  const env=(v?:string)=>(k:string)=>v;
  assert.equal(sceneGateVerdict(0,false,env(undefined)),'ok');
  assert.equal(sceneGateVerdict(2,true,env('permissive')),'warn-allow');
  assert.equal(sceneGateVerdict(2,true,env(undefined)),'reject');
  assert.equal(sceneGateVerdict(2,true,env('enforce')),'reject');
  assert.equal(sceneGateVerdict(2,false,env('permissive')),'reject');
  assert.equal(sceneGateVerdict(2,false,env(undefined)),'reject');
});
