// Back-cover blurb: prompt builder for generation, validation, and a
// deterministic template fallback (v6, 11 Nov 2026 cover-design pass).
// The blurb is composed by an LLM at generation time from the opening half
// of the story only (so there is no ending to spoil), validated here, and
// typeset by export-pdf; when a book has no validated blurb, export falls
// back to the per-story-type template so the back cover is never blank.

export interface BlurbContext {
  childName?: string;
  companions?: string[];
  setting?: string;
  storyType?: string;
  theme?: string;
  openingText: string; // story text of the opening pages only
}

export const BLURB_MIN_WORDS = 30;
export const BLURB_MAX_WORDS = 60;

// Things a back-cover blurb must never say: how the book was made, the
// child's age, or marketing adjectives that break the spell.
const BLURB_BANNED = [/\bpersonali[sz]ed\b/i, /\bAI\b/, /\bgenerated\b/i, /\bGPT\b/i, /\bLLM\b/i, /\d+\s*(?:years?|yrs?)\s+old/i];

export function buildBlurbPrompt(ctx: BlurbContext): string {
  const child = ctx.childName?.trim() || 'the child';
  return [
    "Write the back-cover blurb for a children's picture book.",
    `Child: ${child}. Companions: ${(ctx.companions ?? []).filter(Boolean).join(', ') || 'none listed'}. Setting: ${ctx.setting?.trim() || 'the story world'}.`,
    `Story type: ${ctx.storyType?.trim() || 'story'}. Theme: ${ctx.theme?.trim() || 'gentle'}.`,
    'Story text, opening pages only:',
    ctx.openingText.trim(),
    '',
    'Rules:',
    `- ${35} to ${55} words, 3 or 4 sentences, one paragraph.`,
    '- Third person, present tense.',
    `- Sentence 1 names ${child} and shows what they want or are about to do.`,
    '- Use one or two concrete details from the story text (a named companion, an object, a place). Invent nothing.',
    '- End on a question or unfinished thought about what happens next. Do not reveal an ending or state a lesson.',
    '- Short words, read-aloud rhythm, no rhyme. At most one exclamation mark.',
    '- Do not mention age, "personalised", the reader, or how the book was made.',
    '- British spelling. Output the blurb only.',
  ].join('\n');
}

export interface BlurbValidation {
  ok: boolean;
  reasons: string[];
}

// knownText: the book's own story text, used to reject hallucinated proper
// names (a capitalised mid-sentence token must come from the story itself).
export function validateBlurb(blurb: string, childName: string | undefined, knownText: string): BlurbValidation {
  const reasons: string[] = [];
  const text = (blurb || '').trim();
  const words = text ? text.split(/\s+/).length : 0;
  if (words < BLURB_MIN_WORDS || words > BLURB_MAX_WORDS) {
    reasons.push(`word count ${words} outside ${BLURB_MIN_WORDS}-${BLURB_MAX_WORDS}`);
  }
  for (const banned of BLURB_BANNED) {
    if (banned.test(text)) reasons.push(`banned term ${banned}`);
  }
  const name = (childName || '').trim();
  if (name && !text.includes(name)) reasons.push(`child name "${name}" missing`);
  if (text) {
    const known = new Set((knownText.toLowerCase().match(/[a-z']+/g) ?? []));
    const sentences = text.split(/(?<=[.!?])\s+/);
    for (const sentence of sentences) {
      const tokens = sentence.match(/[A-Za-z][A-Za-z'-]*/g) ?? [];
      tokens.slice(1).forEach((tok) => {
        if (/^[A-Z]/.test(tok) && !known.has(tok.toLowerCase())) {
          reasons.push(`unknown capitalised name "${tok}" not found in the story text`);
        }
      });
    }
  }
  return { ok: reasons.length === 0, reasons };
}

// Deterministic template per story type, used when no validated blurb
// exists. Warm and specific enough to read as written-for-the-book without
// inventing story facts beyond the setting.
export function fallbackBlurb(storyType: string | undefined, setting: string | undefined, childName?: string): string {
  const name = (childName || '').trim();
  const who = name || 'One little reader';
  const place = (setting || '').trim() || 'a familiar little world';
  const t = (storyType || '').trim().toLowerCase();
  switch (t) {
    case 'bedtime':
      return `${who} is getting ready for bed in ${place}, with a faithful friend close by. The light is soft, the night is kind, and one small adventure still waits before sleep. What will happen when the lights go out?`;
    case 'adventure':
      return `${who} sets out from ${place} with a brave friend beside them. The path is new, the day is wide, and something wonderful is waiting to be found. Where will the adventure lead?`;
    case 'learning':
      return `${who} has a big question in ${place}, and a patient friend to help. Step by small step, the answer comes closer. What will they discover together?`;
    case 'friendship':
      return `In ${place}, ${who} finds a friend worth keeping. Sharing is new and saying sorry is hard, but together is better. What will the two of them do next?`;
    case 'fantasy':
      return `${who} finds something magical waiting in ${place}. Spells are surprising, wishes are tricky, and a loyal friend makes it all possible. What magic will happen next?`;
    case 'problem solving':
      return `Something in ${place} needs fixing, and ${who} is ready to try. With a clever friend and a little patience, no knot stays tied for long. How will they work it out?`;
    default:
      return `${who} begins a brand-new story in ${place}, with a good friend close at hand. Every page holds something to smile about. What will happen next?`;
  }
}

// The fixed sign-off typeset separately under the blurb.
export function blurbSignOff(storyType: string | undefined, childName?: string): string {
  const name = (childName || '').trim();
  if (!name) return '';
  const t = (storyType || '').trim().toLowerCase() || 'story';
  return `A ${t} story made especially for ${name}.`;
}
