// A declared scene plan is not a visual verdict. These checks detect missing
// state and unexplained transitions BEFORE writing/drawing; pixels still need QA.
export type Scene = {
  page:number; locationId:string; time:string; characters:string[];
  outfits:Record<string,string>; props:Record<string,string>; transition:string;
};
export type SceneLedger = {
  locations:Record<string,string>; outfits:Record<string,string>;
  scenes:Scene[];
};
const nonempty=(v:unknown):v is string=>typeof v==='string'&&!!v.trim();
const owns=(o:object,k:PropertyKey)=>Object.prototype.hasOwnProperty.call(o,k);
const sorted=(o:Record<string,unknown>)=>JSON.stringify(Object.keys(o).sort().map(k=>[k,o[k]]));
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
export function sceneLedgerIssues(value:unknown,pageCount:number):string[]{
  if(!record(value)||!record(value.locations)||!record(value.outfits)||!Array.isArray(value.scenes))return ['A structured whole-book scene plan is missing.'];
  const issues:string[]=[]; const {locations,outfits,scenes}=value;
  if(!Object.keys(locations).length||Object.values(locations).some(v=>!nonempty(v)))issues.push('Locations need stable IDs and visible distinguishing features.');
  if(!Object.keys(outfits).length||Object.values(outfits).some(v=>!nonempty(v)))issues.push('Outfits need stable IDs and exact visible descriptions.');
  if(!Number.isInteger(pageCount)||pageCount<1||scenes.length!==pageCount)issues.push('The scene plan must cover every page exactly once.');
  for(let i=0;i<scenes.length;i++){
    const s=scenes[i];const prefix=`Page ${i+1}: `;
    if(!record(s)||s.page!==i+1||!nonempty(s.locationId)||!nonempty(s.time)||!Array.isArray(s.characters)||s.characters.some(c=>!nonempty(c))||new Set(s.characters).size!==s.characters.length||!record(s.outfits)||!record(s.props)||typeof s.transition!=='string') {issues.push(prefix+'scene state is incomplete or out of order.');continue;}
    if(!owns(locations,s.locationId))issues.push(prefix+'location ID is undefined.');
    if(Object.values(s.outfits).some(v=>!nonempty(v)||!owns(outfits,v as string))||s.characters.some(c=>!owns(s.outfits as Record<string,string>,c)))issues.push(prefix+'every visible character needs a defined outfit ID (including a no-clothes animal outfit).');
    const visible = s.characters as string[];
    if(Object.keys(s.outfits).some(c=>!visible.includes(c)))issues.push(prefix+'outfit is assigned to a character absent from the scene.');
    if(Object.values(s.props).some(v=>!nonempty(v)))issues.push(prefix+'prop state must say who holds it or where it is.');
    const p=scenes[i-1];
    if(record(p)&&Array.isArray(p.characters)&&record(p.outfits)&&record(p.props)){
      const changed=s.locationId!==p.locationId||s.time!==p.time||JSON.stringify([...s.characters].sort())!==JSON.stringify([...p.characters].sort())||sorted(s.outfits)!==sorted(p.outfits)||sorted(s.props)!==sorted(p.props);
      if(changed&&!nonempty(s.transition))issues.push(prefix+'state changed without an explicit travel/time/clothes/character/prop transition.');
    }
  }
  return issues;
}
// Staged rollout switch for the scene-contract enforcement: with
// SCENE_GATE_MODE=permissive the functions keep serving pre-scene-contract
// clients (no ledger sent) with the old behaviour while the new frontend
// rolls out; any other value - including unset - is the reviewed enforcing
// behaviour. Function secrets apply to new invocations without a redeploy,
// so enforcement can be switched on after the frontend is live.
export type SceneGateVerdict = 'ok' | 'warn-allow' | 'reject';
// One decision for every scene gate: no issues -> proceed; issues with a
// MISSING ledger (a pre-scene-contract client) -> legacy behaviour only in
// permissive mode; issues with a PRESENT but invalid ledger -> always
// reject, so an invalid plan can never become paid calls in any mode.
export function sceneGateVerdict(issueCount:number,ledgerMissing:boolean,getEnv:(key:string)=>string|undefined):SceneGateVerdict{
  if(!issueCount)return 'ok';
  if(ledgerMissing && !sceneGateEnforced(getEnv))return 'warn-allow';
  return 'reject';
}

export function sceneGateEnforced(getEnv:(key:string)=>string|undefined):boolean{
  return (getEnv('SCENE_GATE_MODE') ?? 'enforce') !== 'permissive';
}

export function sceneContext(ledger:SceneLedger,page:number):string{
  const s=ledger.scenes.find(s=>s.page===page);if(!s)return '';
  return ['SCENE STATE LOCK (keep these exact identities; do not replace nursery with home):',
    `Location ${s.locationId}: ${ledger.locations[s.locationId]}`,
    `Time: ${s.time}. Visible characters ONLY: ${s.characters.join(', ')}.`,
    ...Object.entries(s.outfits).map(([c,id])=>`${c} outfit ${id}: ${ledger.outfits[id]}`),
    `Props and holders/locations: ${JSON.stringify(s.props)}.`,
    `Transition from previous page: ${s.transition || 'Same state; action continues.'}`,
    'Do not invent clothes changes, teleport characters/props or reuse another location.'].join('\n');
}
export const SCENE_PLAN_INSTRUCTIONS=`WHOLE-BOOK CONTINUITY (required before any prose or illustration):
Return sceneLedger with locations: object of stable location IDs -> visibly distinct building/door/interior descriptions; outfits: object of stable outfit IDs -> exact garment/colour descriptions (include animal-natural-coat for pets); scenes: array in page order with {page,locationId,time,characters:[stable character IDs],outfits:{characterId:outfitId},props:{stablePropId:holder-or-location},transition:string}.
Scenery-only pages may have empty characters and outfits. Every animal needs an explicit natural-coat outfit, not human clothing. Use the SAME location ID and visual features on every return. Home and school/nursery must have different doors/interiors. Choose a fixed daytime outfit and reuse it until an explicit change. Pets cannot teleport inside after goodbye outside. Track each recurring toy across carried/put-down/retrieved states. Each state change must have an explicit causal transition, including travel, time, entry/exit, clothing or prop handoff. Keep the plan simple enough for the chosen page count. Ensure every page visualBrief and imagePrompt obey that state. Do not solve mismatched scenes with vague wording.`;

export function imageSceneIssues(ledger:unknown,prompts:unknown):string[]{
 const l=ledger as SceneLedger;
 const issues=sceneLedgerIssues(ledger,Array.isArray(l?.scenes)?l.scenes.length:0);
 if(issues.length)return issues;
 if(!Array.isArray(prompts)||prompts.some(p=>!p||!Number.isInteger(p.page)||!l.scenes.some(s=>s.page===p.page))||new Set(prompts.map(p=>p.page)).size!==prompts.length)issues.push('Image pages must be unique members of the complete scene plan.');
 return issues;
}
