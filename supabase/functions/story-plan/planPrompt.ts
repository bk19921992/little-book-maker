// Vocabulary note for story types whose everyday meaning is ambiguous.
// "Going to nursery" means childcare - the place a child goes to during the
// day - not the baby's bedroom at home. Scoped to that exact phrase: other
// "nursery" settings (e.g. a baby's room) are left alone.
export function storyTypeNote(storyType?: string): string {
  return storyType && /going to nursery/i.test(storyType.trim())
    ? `- Note: in this story "nursery" means nursery school / childcare - the place the child goes to during the day, with carers and other children. It does NOT mean the child's bedroom at home.`
    : '';
}
