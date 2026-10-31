import React,{useState} from 'react';
import type {StoryConfig,StoryOutline} from '../types';
import {sceneLedgerIssues} from '../../supabase/functions/_shared/sceneLedger';
import {ScenePlanGuidedRepair} from './ScenePlanGuidedRepair';
import {Button} from '@/components/ui/button';
// No provider calls here. This is an internal/advanced local repair tool,
// not an automated visual verdict and not a regeneration action.
export function ScenePlanRepair({config,onConfigChange}:{config:StoryConfig;onConfigChange:(updates:Partial<StoryConfig>)=>void}){
 const [open,setOpen]=useState(false);
 const [raw,setRaw]=useState('');const [issues,setIssues]=useState<string[]>([]);
 const plan=config.scenePlanDraft?.outline || config.outline;
 if(!plan)return null;
 const existing=sceneLedgerIssues(plan.sceneLedger,config.lengthPages);
 const internal = import.meta.env.DEV && import.meta.env.VITE_INTERNAL_SCENE_REPAIR === 'true';
 const begin=()=>{setRaw(JSON.stringify(plan.sceneLedger||{locations:{},outfits:{},scenes:[]},null,2));setIssues(existing);setOpen(true)};
 const apply=()=>{try{const ledger=JSON.parse(raw);const problems=sceneLedgerIssues(ledger,config.lengthPages);setIssues(problems);if(problems.length)return;
 const outline:StoryOutline={...plan,sceneLedger:ledger};
 onConfigChange(config.scenePlanDraft?{scenePlanDraft:{...config.scenePlanDraft,outline,issues:[]}}:{outline});setOpen(false);
 }catch{setIssues(['Enter valid JSON. Existing story text and artwork have not changed.'])}};
 return <section aria-label="Scene plan repair" className="border rounded-xl p-4 space-y-3"><h2 className="text-xl font-bold">Scene plan review</h2>
 <p>{existing.length?`${existing.length} scene-plan checks need attention before new writing or pictures.`:'Scene plan structure checked. This is not a visual continuity pass.'}</p>
 <p className="text-sm">Advanced/internal repair. This is not required to read or export an existing book. No automatic retry or re-plan. Existing text and pictures stay unchanged. This advanced tool edits declared locations, clothes, characters and prop states locally.</p>
 {!internal && existing.length>0 && <ScenePlanGuidedRepair config={config} onConfigChange={onConfigChange} />}
 {internal && <Button variant="outline" onClick={begin}>Repair scene plan locally</Button>}
 {internal&&open&&<div className="space-y-3"><details><summary>Existing page briefs</summary>{plan.pages.map(p=><p key={p.page}>Page {p.page}: {p.visualBrief}</p>)}</details><ul className="list-disc pl-5">{issues.map((i,n)=><li key={n}>{i}</li>)}</ul>
 <p className="text-sm">Use stable location/outfit IDs. Each ordered scene needs page, locationId, time, characters, outfits, props and transition. Empty characters/outfits are allowed for scenery. Explain each state change. Do not describe artwork as repaired just because the plan changed.</p>
 <label className="block">Scene ledger JSON<textarea className="block border rounded p-2 w-full min-h-64 font-mono text-sm" value={raw} onChange={e=>setRaw(e.target.value)} /></label>
 <div className="flex flex-wrap gap-2"><Button onClick={apply}>Save local plan repair</Button><Button variant="outline" onClick={()=>setOpen(false)}>Cancel</Button></div></div>}
 </section>;
}
