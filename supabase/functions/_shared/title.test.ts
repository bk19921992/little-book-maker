import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildTitlePrompt, splitTitleAndThe, validateTitle } from './title.ts';

const STORY = 'Amelia hugs Blue Bear tight.\nMax the dog wags by the door.\nThe blue house glows at bedtime.';

describe('validateTitle', () => {
  it('accepts the fixed form with a concrete thing from the story', () => {
    assert.deepEqual(validateTitle('Amelia and the Blue Bear', 'Amelia', STORY), { ok: true, reasons: [] });
  });
  it('rejects banned template words', () => {
    for (const t of ['Amelia and the Magical Bear', 'Amelia and the Adventure', 'Amelia and the Journey', "Amelia's Amazing Story"]) {
      assert.equal(validateTitle(t, 'Amelia', STORY).ok, false, t);
    }
  });
  it('rejects titles outside the fixed form', () => {
    assert.equal(validateTitle('Blue Bear Bedtime', 'Amelia', STORY).ok, false);
    assert.equal(validateTitle('Amelia', 'Amelia', STORY).ok, false, 'one word');
  });
  it('rejects invented proper names', () => {
    const v = validateTitle('Amelia and the Red Dragon', 'Amelia', STORY);
    assert.equal(v.ok, false);
    assert.ok(v.reasons.some((r) => r.includes('Dragon')));
  });
  it('accepts a thing mentioned lower-case in the story', () => {
    assert.equal(validateTitle('Amelia and the Blue House', 'Amelia', STORY).ok, true);
  });
  it('requires the child name when known', () => {
    assert.equal(validateTitle('Wendy and the Blue Bear', 'Amelia', STORY + ' Wendy waves once.', 'x').ok, false);
  });
  it('word count bound', () => {
    assert.equal(validateTitle('Amelia and the Blue Bear', 'Amelia', STORY).ok, true, '5 words');
    assert.equal(validateTitle('Amelia and the Blue House Door', 'Amelia', STORY).ok, true, '6 words tolerated when every title-cased word is in the story');
    assert.equal(validateTitle('Amelia and the Blue House Door Tonight', 'Amelia', STORY).ok, false, '7 words');
  });
});

describe('splitTitleAndThe', () => {
  it('splits before "and the"', () => {
    assert.deepEqual(splitTitleAndThe('Amelia and the Blue Bear'), ['Amelia', 'and the Blue Bear']);
  });
  it('keeps a two-word child name together', () => {
    assert.deepEqual(splitTitleAndThe('Little Bo and the Moon', ), ['Little Bo', 'and the Moon']);
  });
  it('returns null for other shapes', () => {
    assert.equal(splitTitleAndThe("Amelia's Story"), null);
    assert.equal(splitTitleAndThe(''), null);
  });
  it('ignores case of the boundary words', () => {
    assert.deepEqual(splitTitleAndThe('Amelia And The Bear'), ['Amelia', 'and the Bear']);
  });
});

describe('buildTitlePrompt', () => {
  it('names the child, the form and the banned words', () => {
    const p = buildTitlePrompt({ childName: 'Amelia', storyType: 'Bedtime', openingText: STORY });
    assert.match(p, /Amelia and the/);
    assert.match(p, /Never use: magical, adventure, story, journey, special, amazing/);
    assert.match(p, /2 to 5 words/);
  });
});

describe('validateTitle: the wider real-title family (D4-11)', () => {
  const NURSERY = "Today is a nursery day.\nWilliam packs his blue truck.\nAt the big blue door, friends are waving.\nOne busy day. One brave boy.";
  it('accepts "<Child> and <Companion>\'s <Thing>" real titles', () => {
    assert.deepEqual(validateTitle("William and Ivy's Big Nursery Day", 'William', NURSERY + "\nIvy wags her tail."), { ok: true, reasons: [] });
  });
  it('still rejects formless and template titles', () => {
    assert.equal(validateTitle('Blue Bear Bedtime', 'Amelia', STORY).ok, false);
    assert.equal(validateTitle("William's Amazing Story", 'William', NURSERY).ok, false);
  });
  it('allows the longer family titles up to 8 words', () => {
    assert.equal(validateTitle("William and Ivy's Big Nursery Day", 'William', NURSERY + "\nIvy wags her tail.").ok, true);
    assert.equal(validateTitle('A very long title indeed with far too many words in it', 'Amelia', STORY).ok, false);
  });
});
