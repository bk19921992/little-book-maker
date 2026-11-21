// Craft rules for the page-writing prompts, distilled from the 21 Nov 2026
// test-book review: fragments, passive voice, description-only pages,
// repeated sentence openings and an over-used favourite-toy mention all
// shipped in a book that passed every shape check. The typesetting contract
// (textContract.ts) enforces shape; these rules enforce craft.
export const CRAFT_RULES = `CRAFT RULES (a paying family reads this aloud):
- Every sentence needs a verb. No fragments: "Sun on Pip's jumper." is not a sentence - write "The sun warms Pip's jumper."
- Active voice: "Pip holds the toy tight", never "The toy is held tight".
- Every page must move the story: one thing happens, changes or is decided. A page of pure description is a failed page.
- Vary sentence openings. Never start two sentences in a row with the same word, and start at most one sentence per page with the child's name.
- A favourite toy or pet appears in the text only when it matters to the action - a couple of mentions in the whole book, not on every page.
- Show feelings through action, speech or the senses; "X feels Y" at most once in the whole book.
- The final page closes the loop: a goodbye, homecoming or bedtime beat that echoes the opening, ending on one warm, settled line.`;
