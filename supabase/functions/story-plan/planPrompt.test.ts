import { test } from 'node:test';
import assert from 'node:assert/strict';
import { storyTypeNote } from './planPrompt.ts';

test('"going to nursery" is disambiguated to childcare, any casing', () => {
  for (const s of ['Going to nursery', 'going to nursery', 'GOING TO NURSERY']) {
    const note = storyTypeNote(s);
    assert.ok(note.includes('nursery school / childcare'), s);
    assert.ok(note.includes('does NOT mean the child'), s);
  }
});

test('other story types and settings are left alone', () => {
  assert.equal(storyTypeNote('Woodland adventure'), '');
  assert.equal(storyTypeNote('A day in the nursery room'), '', 'only the exact going-to-nursery phrase is clarified');
  assert.equal(storyTypeNote(''), '');
  assert.equal(storyTypeNote(undefined), '');
});
