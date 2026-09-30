// Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { balancedTwoLines, BAND_CAP, layoutBand, typesetVerse } from './typeset.ts';
import { loadNunito, PAGES, pagePoints } from './testFont.ts';
import { formatLineCapacity, MAX_LINE_CHARS } from '../_shared/textContract.ts';

const font = await loadNunito();

const SIX_LINES = [
  'Mia and Pip ran down the lane,',
  'past the bakery and the old church.',
  'The wind was cold and very strong,',
  'so they held their bright scarves tight.',
  'At the park they found a kite',
  'tangled high in the tallest oak tree.',
].join('\n');

test('hard lines are kept one-to-one when they fit the measure', () => {
  const lines = typesetVerse(SIX_LINES, font, 19, 340);
  assert.equal(lines.length, 6);
  assert.ok(lines.every((l) => !l.indent));
});

test('an overlong line soft-wraps with a hanging indent', () => {
  const lines = typesetVerse('Everyone gathered underneath the enormous chestnut tree, listening carefully', font, 19, 340);
  assert.ok(lines.length >= 2);
  assert.equal(lines[0].indent, false);
  assert.ok(lines.slice(1).every((l) => l.indent));
});

test('A5 portrait print: six typical lines fit the band without stepping down', () => {
  const [w, h] = pagePoints('A5 portrait', true);
  const band = layoutBand(SIX_LINES, font, w, h, true);
  assert.equal(band.bandOverflow, false);
  assert.equal(band.type.tierIndex, band.type.baseIndex);
  assert.equal(band.fontSize, 19);
  assert.ok(band.bandHeight <= h * BAND_CAP);
});

test('the band is clamped at the cap and overflow is flagged, never grown', () => {
  const [w, h] = pagePoints('A5 portrait', true);
  const tooLong = Array.from({ length: 14 }, () => 'a line of story text that fills the page').join('\n');
  const band = layoutBand(tooLong, font, w, h, true);
  assert.equal(band.bandOverflow, true);
  assert.equal(band.bandHeight, h * BAND_CAP);
});

const FIVE_LINES = SIX_LINES.split('\n').slice(0, 5).join('\n');

test('A4 landscape print: five typical lines fit the band (type sized from the short side)', () => {
  const [w, h] = pagePoints('A4 landscape', true);
  const band = layoutBand(FIVE_LINES, font, w, h, true);
  assert.equal(band.bandOverflow, false, `band overflowed at ${band.fontSize}pt`);
  assert.equal(band.textLines.length, 5);
});

test('portrait and square type sizes are unchanged by short-side sizing', () => {
  // Expected sizes measured on the pre-change code (baf4594), print variant.
  const expected: [Parameters<typeof pagePoints>[0], number][] = [
    ['A5 portrait', 19],
    ['A4 portrait', 25],
    ['210×210 mm square', 25],
  ];
  for (const [size, pt] of expected) {
    const [w, h] = pagePoints(size, true);
    assert.equal(layoutBand(FIVE_LINES, font, w, h, true).fontSize, pt, size);
  }
});

// Worst plausible line for width: wide letters (m, w) at the character cap.
function wideLine(seed: number): string {
  const pool = ['Grandma', 'whispered', 'wonderful', 'mammoth', 'meadow', 'window', 'marmalade', 'somewhere', 'Mum', 'owl', 'woke'];
  let s = '';
  for (let i = seed; s.length < MAX_LINE_CHARS; i++) s = s ? `${s} ${pool[i % pool.length]}` : pool[i % pool.length];
  return s.slice(0, MAX_LINE_CHARS).trimEnd();
}

test('the text contract fits every format: capacity lines at the character cap, no wraps, no overflow', () => {
  for (const size of Object.keys(PAGES) as (keyof typeof PAGES)[]) {
    for (const includeBleed of [true, false]) {
      const [w, h] = pagePoints(size, includeBleed);
      const text = Array.from({ length: formatLineCapacity(size) }, (_, i) => wideLine(i)).join('\n');
      const band = layoutBand(text, font, w, h, includeBleed);
      const where = `${size} ${includeBleed ? 'print' : 'web'}`;
      assert.equal(band.bandOverflow, false, `${where} overflowed at ${band.fontSize}pt`);
      assert.equal(band.textLines.length, formatLineCapacity(size), `${where} soft-wrapped`);
      assert.ok(band.fontSize >= 14, `${where} below 14pt`);
    }
  }
});

test('balancedTwoLines splits a long cover title evenly by width', () => {
  const width = (s: string) => s.length;
  assert.deepEqual(balancedTwoLines('The Very Sleepy Dragon of Puddle Lane', width), ['The Very Sleepy', 'Dragon of Puddle Lane']);
  assert.deepEqual(balancedTwoLines('Supercalifragilistic', width), ['Supercalifragilistic']);
});
