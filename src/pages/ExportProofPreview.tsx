// DEV-only visual proof for the 14 Nov 2026 client integration patch
// (route is only registered when VITE_SHOW_EXPORT_PROOF=true, mirroring
// the testimonial design preview). Renders the three user-visible
// surfaces the patch changes with the same components the app uses:
//   1. the export screen showing the persisted fixed-form title;
//   2. the server's 422 refusal kept on the page instead of a vanishing
//      toast (message verbatim from the live 14 Nov refusal);
//   3. the back-cover wording a book falls back to after a wording edit
//      voids the stale blurb.
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ExportBlockerNotice } from '@/components/ExportBlockerNotice';
import { displayTitle } from '@/lib/backMatter';
import { fallbackBlurb, blurbSignOff } from '../../supabase/functions/_shared/blurb';
import type { StoryConfig } from '@/types';

const titledBook = {
  title: 'Amelia and the Moon',
  children: ['Amelia'],
  storyType: 'Bedtime',
} as StoryConfig;

const legacyBook = {
  children: ['Amelia'],
  storyType: 'Bedtime',
} as StoryConfig;

// Verbatim from the live 14 Nov 2026 export-pdf refusal (line-fit gate).
const REFUSAL =
  "some pages have more words than fit nicely. Please go back, fix those pages, and try again.";

export default function ExportProofPreview() {
  return (
    <div className="max-w-4xl mx-auto p-6 space-y-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-display font-bold">Export integration proof (dev preview)</h1>
        <p className="text-sm text-muted-foreground">
          Title persistence, refused-export blocker text, and the blurb refresh after an edit.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Story Summary</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4">
          <div>
            <div className="text-sm font-medium">Title (new book, story-write title persisted)</div>
            <div className="text-sm text-muted-foreground">{displayTitle(titledBook)}</div>
          </div>
          <div>
            <div className="text-sm font-medium">Title (older book without one)</div>
            <div className="text-sm text-muted-foreground">{displayTitle(legacyBook)}</div>
          </div>
        </CardContent>
      </Card>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Refused export: the server&rsquo;s words stay on the page</h2>
        <ExportBlockerNotice message={REFUSAL} />
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Back cover after a wording edit voids the stale blurb</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-sm text-muted-foreground">
            The old blurb described words that were edited out, so the client drops it and export
            plates this current template instead:
          </p>
          <p className="text-sm">{fallbackBlurb('Bedtime', 'Cozy bedroom', 'Amelia')}</p>
          <p className="text-sm italic">{blurbSignOff('Bedtime', 'Amelia')}</p>
        </CardContent>
      </Card>
    </div>
  );
}
