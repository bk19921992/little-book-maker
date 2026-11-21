// Vocabulary note for story types whose everyday meaning is ambiguous.
// "Going to nursery" means childcare - the place a child goes to during the
// day - not the baby's bedroom at home. Scoped to that exact phrase: other
// "nursery" settings (e.g. a baby's room) are left alone.
export function storyTypeNote(storyType?: string): string {
  return storyType && /going to nursery/i.test(storyType.trim())
    ? `- Note: in this story "nursery" means nursery school / childcare - the place the child goes to during the day, with carers and other children. It does NOT mean the child's bedroom at home.`
    : '';
}

// Story arc the planner must lay out (21 Nov 2026 test-book review: the
// outline read as a list of scenes - flat opening, no high point, and a
// final page that trailed off instead of resolving).
export const STORY_SHAPE_INSTRUCTIONS = `STORY SHAPE (required): plan a real arc, not a list of scenes:
- Page 1: introduce the child and one clear want, question or plan - the hook.
- Middle pages: the child tries, explores or meets a small obstacle; every page moves the story forward. No filler pages that only describe scenery.
- Penultimate page: the high point - the most exciting or touching moment.
- Final page: a resolution that echoes page 1 - the want is met, reframed or warmly let go - ending settled.
Make each page's visualBrief and imagePrompt serve its beat in this arc.`;
