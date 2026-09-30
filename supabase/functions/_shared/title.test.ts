import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bookTitle, cleanTitle, defaultTitle, MAX_TITLE_CHARS } from './title.ts';

test('cleanTitle trims, joins lines and drops wrapping quotes', () => {
  assert.equal(cleanTitle('  "Rosie and the\n Moon Boat"  '), 'Rosie and the Moon Boat');
  assert.equal(cleanTitle('“Milo’s Big Day”'), 'Milo’s Big Day');
  assert.equal(cleanTitle(42), '');
  assert.equal(cleanTitle('   '), '');
});

test('cleanTitle caps long titles at a word boundary', () => {
  const long = 'The Extraordinarily Long and Winding Adventure of Pip and the Very Sleepy Dragon';
  const t = cleanTitle(long);
  assert.ok(t.length <= MAX_TITLE_CHARS, t);
  assert.ok(long.startsWith(t));
  assert.ok(!t.endsWith(' '));
});

test('defaultTitle never prints "\'s Story" without names', () => {
  assert.equal(defaultTitle([]), 'A Magical Story');
  assert.equal(defaultTitle(['', '  ']), 'A Magical Story');
  assert.equal(defaultTitle(undefined), 'A Magical Story');
  assert.equal(defaultTitle(['Ava', 'Sam']), "Ava & Sam's Story");
});

test('bookTitle prefers the book title, then the default', () => {
  assert.equal(bookTitle({ title: 'The Lighthouse Cat', children: ['Ava'] }), 'The Lighthouse Cat');
  assert.equal(bookTitle({ title: '  ', children: ['Ava'] }), "Ava's Story");
  assert.equal(bookTitle({ children: [] }), 'A Magical Story');
});
