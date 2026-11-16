// One shared text identity contract and one complete draft per book. This
// prevents independent page calls from choosing a different cast each time.
// This is not a proper-name detector or a claim of semantic verification.
type Config = { children?: unknown; characters?: unknown; personal?: { pets?: string; favouriteToy?: string } }
export function canonicalCastContext(config: Config, ledger: unknown): string {
  const children = Array.isArray(config.children) ? config.children.filter((v): v is string => typeof v === 'string' && !!v.trim()) : []
  const characters = Array.isArray(config.characters) ? config.characters.filter((v): v is string => typeof v === 'string' && !!v.trim()) : []
  return `WHOLE-BOOK CAST LOCK (applies to initial writing AND every revision):
User-supplied child names: ${JSON.stringify(children)}.
${children.length ? 'Preserve every supplied name exactly. Do not rename, merge or replace these children.' : 'The protagonist is unnamed. Refer to the protagonist as "the child" or with consistent pronouns. Do not invent a child name. Generic hero is a UI label, not a name.'}
User-supplied other characters: ${JSON.stringify(characters)}.
User-supplied pet description: ${JSON.stringify(config.personal?.pets || '')}.
User-supplied toy description: ${JSON.stringify(config.personal?.favouriteToy || '')}.
User-supplied names/descriptions take precedence over an inconsistent plan. Do not invent a proper name for any unnamed person, animal or toy. Use the SAME descriptive reference for each recurring unnamed companion/prop throughout the book (a blue teddy cannot become a pink bear or a bunny). If the plan contains a toy/pet not supplied by the user, it remains one consistent unnamed story character/prop, not a newly claimed personal detail. Do not invent a colour, species or appearance for a vaguely described toy/pet when the plan/user has not specified it; use the stable neutral description (for example, "the favourite toy") instead. Scene character/prop IDs refer to persistent identities, not fresh characters on each page.
Whole-book scene identity source: ${JSON.stringify(ledger ?? null)}.
Never introduce a new identity while changing word count, rhyme or line breaks. These requirements override illustrative examples elsewhere in the prompt.`
}
export function parseBookDraft(value: unknown, expectedPages: number[]): Map<number, string> {
  const obj = value as { pages?: unknown } | null
  if (!obj || !Array.isArray(obj.pages) || obj.pages.length !== expectedPages.length) throw new Error('The whole-book text draft is incomplete. No pages returned.')
  const result = new Map<number, string>()
  for (const raw of obj.pages) {
    const page = raw as { page?: unknown; text?: unknown }
    if (!page || !Number.isInteger(page.page) || !expectedPages.includes(page.page as number) || result.has(page.page as number) || typeof page.text !== 'string' || page.text.trim().length < 10) throw new Error('The whole-book text draft has invalid or duplicate pages. No pages returned.')
    result.set(page.page as number, page.text.trim())
  }
  return result
}
export async function generateBookDraft(opts: { fetcher: typeof fetch; key: string; prompts: string[]; pageNumbers: number[]; castLock: string }): Promise<Map<number, string>> {
  const response = await opts.fetcher('https://api.openai.com/v1/chat/completions', {
    method: 'POST', headers: { Authorization: `Bearer ${opts.key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'gpt-4.1', response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: `Write one coherent children's book in UK English, with the same cast on every page. ${opts.castLock}` },
        { role: 'user', content: `Write ALL pages together as a single coherent draft. Read the complete plan before writing. Return ONLY JSON {"pages":[{"page":1,"text":"newline-separated story text"},...]}, with exactly these page numbers: ${JSON.stringify(opts.pageNumbers)}. Do not add a cast of invented names.\n\n${opts.prompts.join('\n\nNEXT PAGE REQUIREMENTS:\n')}` }],
      max_completion_tokens: Math.min(12000, opts.pageNumbers.length * 600) })
  })
  if (!response.ok) throw new Error(`Whole-book story text request failed (${response.status}).`)
  const payload = await response.json()
  const content = payload.choices?.[0]?.message?.content
  if (typeof content !== 'string') throw new Error('The whole-book text draft is missing. No pages returned.')
  let parsed: unknown
  try { parsed = JSON.parse(content) } catch { throw new Error('The whole-book text draft was not valid JSON. No pages returned.') }
  return parseBookDraft(parsed, opts.pageNumbers)
}
