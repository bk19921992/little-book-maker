import React, { useEffect, useState } from 'react';
import type { StoryConfig } from '../types';
import { bookFingerprint, continuityReadiness, CONTINUITY_DIMENSIONS, type SequenceReview, type Finding } from '../../supabase/functions/_shared/bookContinuity';
import { Button } from '@/components/ui/button';

const labels = {location:'Location and travel',time:'Time and action order',characters:'Characters and pet positions',clothes:'Clothes and appearance',props:'Toys and other props',textArt:'Words match the picture'};
export function ContinuityReview({config,onConfigChange,onReady}:{config:StoryConfig;onConfigChange:(u:Partial<StoryConfig>)=>void;onReady:(ready:boolean)=>void}) {
  const [fingerprint,setFingerprint]=useState('');
  const [expanded,setExpanded]=useState(false);
  const [selected,setSelected]=useState(0);
  const [draft,setDraft]=useState<SequenceReview | undefined>(config.continuityReview);
  const [message,setMessage]=useState('Whole-book visual review is required.');
  const [reviewer,setReviewer]=useState(config.continuityReview?.reviewer || '');
  const book={...config,pages:config.pages || []};
  useEffect(()=>{let active=true;onReady(false);setFingerprint('');
    Promise.all([bookFingerprint(book),continuityReadiness(book,config.continuityReview)]).then(([fp,r])=>{if(!active)return;setFingerprint(fp);onReady(r.ready);setMessage(r.ready?'Whole-book visual review recorded for this version.':r.blockers[0]);});
    return()=>{active=false};
  },[config]);
  const pages=[{page:0,text:'Cover',imageUrl:config.coverImageUrl},...(config.pages||[])];
  const current=pages[selected] || pages[0];const previous=pages[selected-1];
  const currentDraft=draft?.fingerprint===fingerprint ? draft : undefined;
  const row=currentDraft?.pages.find(p=>p.page===current.page);
  const change=(dimension:Finding['dimension'],patch:Partial<Finding>)=>{
    if(!fingerprint)return;
    const findings=CONTINUITY_DIMENSIONS.map(d=>row?.findings.find(f=>f.dimension===d)||{dimension:d,verdict:'uncertain' as const,note:''}).map(f=>f.dimension===dimension?{...f,...patch}:f);
    setDraft({version:1,fingerprint,method:'whole-book-visual',reviewer,pages:[...(currentDraft?.pages||[]).filter(p=>p.page!==current.page),{page:current.page,findings}]});
    // Editing recorded evidence immediately removes readiness. Saving is explicit.
    if(config.continuityReview)onConfigChange({continuityReview:undefined});
  };
  const save=async()=>{
    const review={...currentDraft,reviewer} as SequenceReview;
    if(!currentDraft){setMessage('Review every page first.');return;}
    const r=await continuityReadiness(book,review);
    setMessage(r.ready?'Whole-book visual review recorded for this version.':r.blockers.join(' '));
    onConfigChange({continuityReview:review});
  };
  return <section className="border rounded-xl p-4 space-y-4" aria-label="Whole-book continuity review">
    <h2 className="text-xl font-bold">Whole-book continuity</h2>
    <p role="status">{message}</p>
    <p className="text-sm text-muted-foreground">Line fit and individual picture checks do not check the story sequence. Compare every page with its neighbours and earlier locations. Failed or uncertain checks block export. This is a human visual review, not an automatic guarantee.</p>
    <Button variant="outline" onClick={()=>setExpanded(!expanded)}>{expanded?'Close sequence review':'Review the full sequence'}</Button>
    {expanded&&<div className="space-y-4">
      <label className="block">Reviewer name<input className="block border rounded p-2 w-full" value={reviewer} onChange={e=>{setReviewer(e.target.value);if(config.continuityReview)onConfigChange({continuityReview:undefined})}} /></label>
      <nav className="flex flex-wrap gap-2" aria-label="Sequence pages">{pages.map((p,i)=><Button key={p.page} size="sm" variant={selected===i?'default':'outline'} onClick={()=>setSelected(i)}>{p.page===0?'Cover':`Page ${p.page}`}</Button>)}</nav>
      <div className="grid gap-4 md:grid-cols-2">{[previous,current].filter(Boolean).map(p=><figure key={p.page} className="space-y-2"><figcaption className="font-bold">{p===current?'Current: ':'Previous: '}{p.page===0?'Cover':`Page ${p.page}`}</figcaption>{p.imageUrl?<img src={p.imageUrl} className="w-full max-h-80 object-contain" alt={p.page===0?'Cover artwork':`Page ${p.page} artwork`}/>:<p>No picture. Check intentional blank against the story.</p>}<p className="whitespace-pre-line">{p.text}</p></figure>)}</div>
      <p>Check this page AND the transition from the previous page. Use earlier page buttons to compare repeated rooms, doors, clothes and toys. Explain what is visible and why each transition makes sense.</p>
      {CONTINUITY_DIMENSIONS.map(d=>{const f=row?.findings.find(f=>f.dimension===d);return <fieldset className="border rounded p-3 space-y-2" key={`${current.page}-${d}`}><legend className="px-1">{labels[d]}</legend><label className="block">Result<select className="block border rounded p-2 w-full" value={f?.verdict||'uncertain'} onChange={e=>change(d,{verdict:e.target.value as Finding['verdict']})}><option value="uncertain">Not checked / uncertain</option><option value="fail">Mismatch found</option><option value="pass">Checked: consistent</option></select></label><label className="block">Visible evidence / transition explanation<textarea className="block border rounded p-2 w-full" value={f?.note||''} onChange={e=>change(d,{note:e.target.value})}/></label></fieldset>})}
      <Button onClick={save} disabled={!fingerprint}>Save whole-book review</Button>
      <p className="text-sm">Any wording, artwork, order or format change makes this review stale. Saving failed or incomplete evidence does not approve the book.</p>
    </div>}
  </section>;
}
