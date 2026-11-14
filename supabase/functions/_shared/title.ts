// Book title: prompt builder for generation, validation, and the wrap rule
// for typesetting (14 Nov 2026 book-quality review). The title is composed
// by an LLM at generation time in the fixed "{Child} and the {concrete
// thing}" shape, validated here, and stored on the book config; export-pdf
// still sanitises whatever config carries and falls back to its own
// "<names>'s Story" when no validated title exists, so a book always has
// something printable on the cover.

export interface TitleContext {
  childName?: string;
  storyType?: string;
  openingText: string; // story text (opening pages are enough)
}

// Words a generated title must never use: they read as a template, not a
// book ("Magical Story" undoes the cover work).
export const TITLE_BANNED = [/\bmagical\b/i, /\badventure\b/i, /\bstory\b/i, /\bstories\b/i, /\bjourney\b/i, /\bspecial\b/i, /\bamazing\b/i];

export function buildTitlePrompt(ctx: TitleContext): string {
  const child = ctx.childName?.trim() || 'the child';
  return [
    "Write the title for a children's picture book.",
    `Child: ${child}. Story type: ${ctx.storyType?.trim() || 'story'}.`,
    'Story text, opening pages only:',
    ctx.openingText.trim(),
    '',
    'Rules:',
    `- The form is exactly "${child} and the <concrete thing from the story>" - the child, "and the", then one concrete thing the story is built around (a named companion, an object or a place).`,
    '- 2 to 5 words in total.',
    '- The thing must come from the story text. Invent nothing.',
    '- Never use: magical, adventure, story, journey, special, amazing.',
    '- No punctuation except an apostrophe. British spelling. Output the title only.',
  ].join('\n');
}

export interface TitleValidation {
  ok: boolean;
  reasons: string[];
}

// The fixed pattern, anchored: "<Child> and the <thing>". The wrap rule in
// typeset.ts relies on the same boundary, so generation and rendering agree.
export const TITLE_AND_THE = /^(?<before>\S(?:.*?\S)?)\s+and\s+the\s+(?<after>\S(?:.*?\S)?)$/i;

// knownText: the book's own story text, used to reject hallucinated proper
// names (same rule as the blurb validator).
export function validateTitle(title: string, childName: string | undefined, knownText: string): TitleValidation {
  const reasons: string[] = [];
  const text = (title || '').trim().replace(/\s+/g, ' ');
  const words = text ? text.split(/\s+/).length : 0;
  if (words < 2 || words > 6) {
    reasons.push(`word count ${words} outside 2-6`);
  }
  if (text && !TITLE_AND_THE.test(text)) {
    reasons.push('not in the "<Child> and the <thing>" form');
  }
  for (const banned of TITLE_BANNED) {
    if (banned.test(text)) reasons.push(`banned word ${banned}`);
  }
  const name = (childName || '').trim();
  if (name && !text.toLowerCase().includes(name.toLowerCase())) reasons.push(`child name "${name}" missing`);
  if (text) {
    const known = new Set((knownText.toLowerCase().match(/[a-z']+/g) ?? []));
    if (name) name.toLowerCase().split(/\s+/).forEach((w) => known.add(w));
    ['and', 'the'].forEach((w) => known.add(w));
    const tokens = text.match(/[A-Za-z][A-Za-z'-]*/g) ?? [];
    tokens.forEach((tok) => {
      if (/^[A-Z]/.test(tok) && !known.has(tok.toLowerCase())) {
        reasons.push(`unknown capitalised name "${tok}" not found in the story text`);
      }
    });
  }
  return { ok: reasons.length === 0, reasons };
}

// The cover wrap rule: break always before "and the", never mid-phrase.
// Returns the two lines when the title is in the fixed form, else null and
// the caller's normal wrap applies.
export function splitTitleAndThe(title: string): [string, string] | null {
  const m = TITLE_AND_THE.exec((title || '').trim().replace(/\s+/g, ' '));
  if (!m?.groups) return null;
  return [m.groups.before, `and the ${m.groups.after}`];
}
