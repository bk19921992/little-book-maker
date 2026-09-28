// Cast wording for story-write prompts. Only characters the customer gave
// may appear: an invented default pet is drawn by no illustration, so it
// breaks text/art consistency, and it would put a made-up name in every book.

type CastConfig = {
  children: string[]
  setting: string
  personal?: { pets?: string }
}

const pet = (c: CastConfig) => c.personal?.pets?.trim() || ''

// Lines for the "Story Details" block of the page prompt.
export function castDetailLines(c: CastConfig): string[] {
  const lines = [`- Main human child: ${c.children.length ? c.children.join(' and ') : 'a child protagonist'} (human child)`]
  if (pet(c)) lines.push(`- Pet companion: ${pet(c)} (animal, not human)`)
  return lines
}

export function speciesRule(c: CastConfig): string {
  return pet(c)
    ? `Keep species consistent: the child is human; ${pet(c)} is an animal. Do not depict the child as an animal or the pet as a human.`
    : 'Keep species consistent: the child is human; any animal characters are animals. Do not add a pet the story details do not list.'
}

// "about X [and their pet Y]" for the simplified retry prompt.
export function storySubject(c: CastConfig): string {
  const child = c.children.join(' and ') || 'a child'
  return pet(c) ? `${child} and their pet ${pet(c)}` : child
}

// Last resort when every generation attempt returned nothing: plain,
// name-neutral copy built only from the customer's own details.
export function fallbackPageText(c: CastConfig): string {
  const child = c.children[0] || 'Our little explorer'
  const place = c.setting ? c.setting.toLowerCase() : 'garden'
  return pet(c)
    ? `${child} went to the ${place}.\n${pet(c)} came along too.\nThey looked and listened.\nWhat a happy day!`
    : `${child} went to the ${place}.\nThere was so much to see.\n${child} looked and listened.\nWhat a happy day!`
}
