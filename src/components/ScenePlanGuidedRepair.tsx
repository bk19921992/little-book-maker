import React, { useMemo, useState } from 'react';
import type { StoryConfig, StoryOutline } from '../types';
import { sceneLedgerIssues, type SceneLedger } from '../../supabase/functions/_shared/sceneLedger';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';

// Guided, free, local continuity repair for books planned before scene
// ledgers existed. The customer DECLARES what each page already shows; the
// tool invents nothing, calls nothing, and never touches story text or
// artwork. The original plan stays unchanged until a complete, valid ledger
// is explicitly saved. Saving only unlocks FUTURE pictures; it is not a
// visual verdict on existing art.

const slug = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

type Named = { name: string; detail: string };
type PageDraft = { location: string; time: string; visible: string[]; outfits: Record<string, string>; props: { name: string; where: string }[]; transition: string };

export function ScenePlanGuidedRepair({ config, onConfigChange }: { config: StoryConfig; onConfigChange: (u: Partial<StoryConfig>) => void }) {
  const plan = config.scenePlanDraft?.outline || config.outline;
  const pageCount = config.lengthPages;
  const cast = useMemo(() => [...(config.children || []), ...(config.characters || [])].filter(Boolean), [config.children, config.characters]);
  const [locations, setLocations] = useState<Named[]>([{ name: '', detail: '' }]);
  const [outfits, setOutfits] = useState<Named[]>([{ name: '', detail: '' }]);
  const [pages, setPages] = useState<PageDraft[]>(() => Array.from({ length: pageCount }, () => ({ location: '', time: '', visible: [], outfits: {}, props: [], transition: '' })));
  const [issues, setIssues] = useState<string[]>([]);
  if (!plan) return null;

  const setPage = (i: number, patch: Partial<PageDraft>) => setPages(ps => ps.map((p, n) => n === i ? { ...p, ...patch } : p));
  const setNamed = (setter: React.Dispatch<React.SetStateAction<Named[]>>, i: number, patch: Partial<Named>) =>
    setter(list => list.map((x, n) => n === i ? { ...x, ...patch } : x));

  // Two distinct names that reduce to the same id would silently merge into
  // one record - that is data loss, so refuse to save until renamed.
  const collisions = (items: Named[]): { dupes: string[]; merges: string[] } => {
    const byId = new Map<string, string[]>();
    for (const x of items) {
      if (!x.name.trim()) continue;
      const id = slug(x.name);
      byId.set(id, [...(byId.get(id) || []), x.name.trim()]);
    }
    const dupes: string[] = [], merges: string[] = [];
    for (const names of byId.values()) {
      if (names.length < 2) continue;
      if (new Set(names.map(n => n.toLowerCase())).size > 1) merges.push(names.join('" and "'));
      else dupes.push(names[0]);
    }
    return { dupes, merges };
  };
  const placeCollisions = collisions(locations), outfitCollisions = collisions(outfits);
  const collisionIssues = [
    ...placeCollisions.merges.map(n => `Place names "${n}" would merge into one place - rename one so they stay distinct.`),
    ...outfitCollisions.merges.map(n => `Outfit names "${n}" would merge into one outfit - rename one so they stay distinct.`),
    ...placeCollisions.dupes.map(n => `Place "${n}" is added twice - remove the duplicate entry.`),
    ...outfitCollisions.dupes.map(n => `Outfit "${n}" is added twice - remove the duplicate entry.`),
  ];

  const build = (): SceneLedger => {
    const loc: Record<string, string> = {};
    for (const l of locations) if (l.name.trim()) loc[slug(l.name)] = l.detail;
    const out: Record<string, string> = {};
    for (const o of outfits) if (o.name.trim()) out[slug(o.name)] = o.detail;
    return {
      locations: loc,
      outfits: out,
      scenes: pages.map((p, i) => ({
        page: i + 1,
        locationId: slug(p.location),
        time: p.time,
        characters: p.visible,
        outfits: Object.fromEntries(p.visible.map(c => [c, slug(p.outfits[c] || '')])),
        props: Object.fromEntries(p.props.filter(pr => pr.name.trim()).map(pr => [slug(pr.name), pr.where])),
        transition: p.transition,
      })),
    };
  };

  const save = () => {
    const ledger = build();
    const problems = [...collisionIssues, ...sceneLedgerIssues(ledger, pageCount)];
    setIssues(problems);
    if (problems.length) return;
    const outline: StoryOutline = { ...plan, sceneLedger: ledger };
    onConfigChange(config.scenePlanDraft ? { scenePlanDraft: { ...config.scenePlanDraft, outline, issues: [] } } : { outline });
    toast.success('Continuity plan saved. Your words and pictures are unchanged - new pictures can now be made.');
  };

  const briefFor = (n: number) => plan.pages?.find(p => p.page === n)?.visualBrief || '';

  return (
    <div className="space-y-4" aria-label="Guided continuity repair">
      <p>This older book has no continuity plan, so new pictures are paused. Tell us what each page already shows - places, clothes and who is there - and new pictures will follow it. We do not guess, change your words, or touch your existing pictures.</p>

      <section className="space-y-2">
        <h3 className="font-medium">Places in this book</h3>
        <p className="text-sm text-muted-foreground">Name each place and describe what makes it recognisable (door colour, room, outside/inside).</p>
        {locations.map((l, i) => (
          <div key={i} className="grid gap-2 sm:grid-cols-2">
            <Input aria-label={`Place ${i + 1} name`} placeholder="Place name, e.g. Nursery" value={l.name} onChange={e => setNamed(setLocations, i, { name: e.target.value })} />
            <Input aria-label={`Place ${i + 1} description`} placeholder="What it looks like" value={l.detail} onChange={e => setNamed(setLocations, i, { detail: e.target.value })} />
          </div>
        ))}
        <Button variant="outline" size="sm" onClick={() => setLocations(ls => [...ls, { name: '', detail: '' }])}>Add another place</Button>
      </section>

      <section className="space-y-2">
        <h3 className="font-medium">Clothes and coats</h3>
        <p className="text-sm text-muted-foreground">One entry per look, e.g. "Day clothes: yellow raincoat, red boots". Pets need their natural coat, e.g. "Pip's brown fur".</p>
        {outfits.map((o, i) => (
          <div key={i} className="grid gap-2 sm:grid-cols-2">
            <Input aria-label={`Outfit ${i + 1} name`} placeholder="Outfit name, e.g. Day clothes" value={o.name} onChange={e => setNamed(setOutfits, i, { name: e.target.value })} />
            <Input aria-label={`Outfit ${i + 1} description`} placeholder="Exactly what it looks like" value={o.detail} onChange={e => setNamed(setOutfits, i, { detail: e.target.value })} />
          </div>
        ))}
        <Button variant="outline" size="sm" onClick={() => setOutfits(os => [...os, { name: '', detail: '' }])}>Add another outfit</Button>
      </section>

      <section className="space-y-3">
        <h3 className="font-medium">Each page</h3>
        {pages.map((p, i) => (
          <fieldset key={i} className="border rounded p-3 space-y-2">
            <legend className="px-1 font-medium">Page {i + 1}</legend>
            {briefFor(i + 1) && <p className="text-sm text-muted-foreground">Your plan for this page: {briefFor(i + 1)}</p>}
            <label className="block text-sm">Place
              <select aria-label={`Page ${i + 1} place`} className="block border rounded p-2 w-full" value={p.location} onChange={e => setPage(i, { location: e.target.value })}>
                <option value="">Choose a place</option>
                {locations.filter(l => l.name.trim()).map((l, li) => <option key={`${l.name}-${li}`} value={l.name}>{l.name}</option>)}
              </select>
            </label>
            <label className="block text-sm">Time of day
              <Input aria-label={`Page ${i + 1} time`} placeholder="e.g. morning" value={p.time} onChange={e => setPage(i, { time: e.target.value })} />
            </label>
            <div className="text-sm space-y-1">
              <span>Who is on this page?</span>
              {cast.map(c => (
                <label key={c} className="flex items-center gap-2">
                  <input type="checkbox" aria-label={`Page ${i + 1} includes ${c}`} checked={p.visible.includes(c)} onChange={e => setPage(i, { visible: e.target.checked ? [...p.visible, c] : p.visible.filter(x => x !== c) })} />
                  {c}
                </label>
              ))}
            </div>
            {p.visible.map(c => (
              <label key={c} className="block text-sm">{c} wears
                <select aria-label={`Page ${i + 1} ${c} outfit`} className="block border rounded p-2 w-full" value={p.outfits[c] || ''} onChange={e => setPage(i, { outfits: { ...p.outfits, [c]: e.target.value } })}>
                  <option value="">Choose an outfit</option>
                  {outfits.filter(o => o.name.trim()).map((o, oi) => <option key={`${o.name}-${oi}`} value={o.name}>{o.name}</option>)}
                </select>
              </label>
            ))}
            {p.props.map((pr, n) => (
              <div key={n} className="grid gap-2 sm:grid-cols-2">
                <Input aria-label={`Page ${i + 1} prop ${n + 1} name`} placeholder="Thing, e.g. Teddy" value={pr.name} onChange={e => setPage(i, { props: p.props.map((x, m) => m === n ? { ...x, name: e.target.value } : x) })} />
                <Input aria-label={`Page ${i + 1} prop ${n + 1} where`} placeholder="Who holds it / where it is" value={pr.where} onChange={e => setPage(i, { props: p.props.map((x, m) => m === n ? { ...x, where: e.target.value } : x) })} />
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={() => setPage(i, { props: [...p.props, { name: '', where: '' }] })}>Add a toy or prop</Button>
            <label className="block text-sm">What changed since the last page? (travel, time passing, clothes, arrivals)
              <Input aria-label={`Page ${i + 1} transition`} placeholder="Leave empty if nothing changed" value={p.transition} onChange={e => setPage(i, { transition: e.target.value })} />
            </label>
          </fieldset>
        ))}
      </section>

      {issues.length > 0 && (
        <ul className="list-disc pl-5 text-sm text-destructive" aria-label="Continuity plan problems">
          {issues.map((x, n) => <li key={n}>{x}</li>)}
        </ul>
      )}
      <Button onClick={save}>Save continuity plan</Button>
      <p className="text-sm text-muted-foreground">Saving stores your declarations with the book so future pictures stay consistent. It does not re-write the story, change existing pictures, or mark existing pictures as checked.</p>
    </div>
  );
}
