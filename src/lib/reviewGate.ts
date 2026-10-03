import type { StoryConfig, StoryPage } from '../types';
import { imageConfig, pickReferenceImage, type ImageConfig } from './imageRequest.ts';

// Pre-checkout gate for illustrations the QA reviewer could not check when
// they were made (it was unavailable, so they are marked 'unreviewed'). They
// are re-checked here, before the customer pays, so no unverified art is
// exported:
//  - pass: marked 'passed';
//  - fail: the page loses the picture and must be regenerated (a failed
//    cover is dropped; export then uses page art, as it does for any book
//    without a dedicated cover);
//  - reviewer still unavailable: checkout waits.

export interface ReviewApi {
  reviewImages(items: { url: string; label: string; brief?: string; config?: ImageConfig; reference?: string }[]):
    Promise<{ reviews: { label: string; pass: boolean; issues: string[]; skipped?: boolean }[] }>;
}

export interface GateResult {
  updates: Partial<StoryConfig>; // apply whether or not checkout may proceed
  blockMessage: string | null;
}

const BATCH = 12; // the review-only endpoint checks at most 12 images per call

export async function recheckUnreviewedImages(api: ReviewApi, config: StoryConfig): Promise<GateResult> {
  const pages = config.pages || [];
  const targets = [
    ...pages.filter((p) => p.imageUrl && p.imageReview === 'unreviewed' && !p.imageLocked)
      .map((p) => ({ label: `page:${p.page}`, url: p.imageUrl!, brief: `page ${p.page} illustration`, reference: pickReferenceImage(pages.filter((q) => q.imageReview !== 'unreviewed'), p.page) })),
    ...(config.coverImageUrl && config.coverImageReview === 'unreviewed'
      ? [{ label: 'cover', url: config.coverImageUrl, brief: 'front cover illustration', reference: pickReferenceImage(pages.filter((q) => q.imageReview !== 'unreviewed'), -1) }]
      : []),
  ];
  if (!targets.length) return { updates: {}, blockMessage: missingPicturesMessage(pages) };

  const cfg = imageConfig(config);
  const verdicts = new Map<string, { pass: boolean; issues: string[]; skipped?: boolean }>();
  for (let i = 0; i < targets.length; i += BATCH) {
    const { reviews } = await api.reviewImages(targets.slice(i, i + BATCH).map((t) => ({ ...t, config: cfg })));
    for (const r of reviews) verdicts.set(r.label, r);
  }

  const failedPages: number[] = [];
  let stillUnchecked = false;
  const nextPages: StoryPage[] = pages.map((p) => {
    const v = verdicts.get(`page:${p.page}`);
    if (!v) return p;
    if (!v.pass) { failedPages.push(p.page); return { ...p, imageUrl: undefined, imageReview: undefined }; }
    if (v.skipped) { stillUnchecked = true; return p; }
    return { ...p, imageReview: 'passed' };
  });
  const updates: Partial<StoryConfig> = { pages: nextPages };
  const cover = verdicts.get('cover');
  if (cover) {
    if (!cover.pass) Object.assign(updates, { coverImageUrl: undefined, coverImageReview: undefined });
    else if (cover.skipped) stillUnchecked = true;
    else updates.coverImageReview = 'passed';
  }

  const blockMessage = failedPages.length
    ? `The picture${failedPages.length > 1 ? 's' : ''} on page${failedPages.length > 1 ? 's' : ''} ${failedPages.join(', ')} didn't pass our quality check. Please regenerate ${failedPages.length > 1 ? 'them' : 'it'} in the editor before exporting.`
    : stillUnchecked
      ? "Our picture checker is busy right now, so some illustrations haven't been checked yet. Please try again in a few minutes - you won't be charged until they pass."
      : missingPicturesMessage(nextPages);
  return { updates, blockMessage };
}

// Every page needs a checked picture (or to be locked without one) before
// checkout - the same rule the editor applies before it allows export. It
// also covers a picture removed by a failed re-check on an earlier click.
function missingPicturesMessage(pages: StoryPage[]): string | null {
  const missing = pages.filter((p) => !p.imageUrl && !p.imageLocked).map((p) => p.page);
  if (!missing.length) return null;
  return `Page${missing.length > 1 ? 's' : ''} ${missing.join(', ')} ${missing.length > 1 ? 'have' : 'has'} no picture yet. Please regenerate ${missing.length > 1 ? 'them' : 'it'} in the editor (or lock the page without a picture) before exporting.`;
}
