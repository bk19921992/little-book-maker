// Activity-page copy and per-page text-zone requirements, kept pure so the
// honesty rules are unit-testable (23 Nov 2026 review).

// Back-matter activity pages. The favourite-toy page must never claim the
// toy "appears on every page" - a toy with a story role (left at home,
// lost mid-book) is NOT on every page, and a false claim on the printed
// page is the worst kind of QA find (D4-4).
export function activityPrompts(childName: string, favouriteToy: string): { heading: string; prompt: string }[] {
  const toyShort = favouriteToy.split(',')[0].trim();
  return ([
    toyShort ? { heading: 'Can you find it?', prompt: `${toyShort} pops up again and again through this book. Can you spot ${toyShort} each time?` } : null,
    { heading: 'Count out loud', prompt: 'Point at the picture. How many can you count? Count out loud together.' },
    { heading: 'Talk about the story', prompt: `What was ${childName}'s best bit? What do you think happens next?` },
    { heading: 'Tell it back', prompt: `Can you tell ${childName}'s adventure in your own words?` },
  ].filter((a): a is { heading: string; prompt: string } => !!a));
}

// A print page with artwork AND text must declare its text zone: silently
// defaulting to bottom put a verse panel over a face the night this rule
// was written (D4-8). Text-only pages are exempt - no art to cover.
export function missingTextZone(text: string | undefined, textZone: unknown, imagePlaced: boolean): boolean {
  return imagePlaced && !!text?.trim() && !(typeof textZone === 'string' && textZone.trim());
}
