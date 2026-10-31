// Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BAND_CAP, coverLineMeasure, coverSubtitle, coverTitle, COVER_TITLE_MAX, fitCoverSubtext, fitCoverTitle, fitSingleLine, fitTitle, isAccentChar, layoutBand, layoutCoverTitle, SAFE, sanitiseCoverTitle, SUBTEXT_READABLE_MIN, TEXT_MEASURE, TITLE_READABLE_MIN, typesetVerse, wrapTitle } from './typeset.ts';
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

test('the last line never enters the bottom safe area', () => {
  // The band's guaranteed bottom pad is padY + 60% of the short-side safe
  // inset; with a typical descent the last line's ink ends at/above the safe
  // area, clear of the folio. Band sizing is unchanged, so line capacity is
  // untouched.
  const cases: [string, ReturnType<typeof pagePoints>][] = [
    [SIX_LINES, pagePoints('A5 portrait', true)],
    ['Two short\nlines here', pagePoints('A5 portrait', true)],
    [SIX_LINES, pagePoints('A4 landscape', true)],
    [SIX_LINES, pagePoints('210×210 mm square', true)],
  ];
  for (const [text, [w, h]] of cases) {
    const band = layoutBand(text, font, w, h, true);
    const want = band.padY + Math.min(w, h) * SAFE * 0.6;
    assert.ok(Math.abs(band.bottomPad - want) < 1e-9, `${w}x${h}: bottomPad ${band.bottomPad} = ${want}`);
    assert.ok(band.bottomPad + band.blockHeight <= band.bandHeight, 'block stays inside the band');
  }
});

test('coverSubtitle drops a leading indefinite article and keeps minor words lowercase', () => {
  // The observed defect: "A " + sentenceCase produced "A trip to the seaside",
  // and naive title-casing then gave the ungrammatical "A Trip To The Seaside".
  assert.equal(coverSubtitle('a trip to the seaside'), 'Trip to the Seaside');
  assert.equal(coverSubtitle('an afternoon at the park'), 'Afternoon at the Park');
  assert.equal(coverSubtitle('Trip to the seaside'), 'Trip to the Seaside');
  assert.equal(coverSubtitle('Woodland adventure'), 'Woodland Adventure');
  assert.equal(coverSubtitle('Bedtime'), 'Bedtime');
});

test('coverSubtitle handles empty input', () => {
  assert.equal(coverSubtitle(''), '');
  assert.equal(coverSubtitle(undefined), '');
  assert.equal(coverSubtitle('   '), '');
});

const stubFont = { widthOfTextAtSize: (t: string, size: number) => t.length * size * 0.5 };

test('coverTitle uses an explicit vetted title when the config carries one', () => {
  assert.equal(coverTitle({ title: 'Alex & Pip', children: ['Alex'] }), 'Alex & Pip');
  assert.equal(coverTitle({ title: '  ', children: ['Alex'] }), "Alex's Story");
});

test('coverTitle never prints supporting characters: presets and free text stay off the cover', () => {
  // The schema allows presets ('Dog', 'Dragon') and free text ('Grandma's old
  // teddy'); neither may become a printed title (review issue: no new
  // free-text exposure on covers).
  assert.equal(coverTitle({ children: ['Mia'] }), "Mia's Story");
  assert.equal(coverTitle({ children: ['Mia', 'Tom'] }), "Mia & Tom's Story");
  assert.equal(coverTitle({ children: [] }), 'Magical Story');
});

test('fitTitle shrinks a lone oversized word until it fits the measure', () => {
  const fifty = 'X'.repeat(50);
  const { size, lines } = fitTitle(fifty, stubFont, 200, 40, 20);
  assert.equal(lines.length, 1);
  assert.ok(stubFont.widthOfTextAtSize(lines[0], size) <= 200, `widest line fits at size ${size}`);
});

test('fitTitle fits the schema-maximum title (4 children x 50 chars) within the measure', () => {
  // Validation caps children at 4 names of 50 chars (validation.ts), so this
  // is the longest title a book can actually carry.
  const title = `${Array.from({ length: 4 }, (_, i) => `Childname${'x'.repeat(40)}${i}`).join(' & ')}'s Story`;
  const { size, lines } = fitTitle(title, stubFont, 500, 40, 20);
  assert.ok(lines.length <= 2, 'at most two lines');
  for (const line of lines) assert.ok(stubFont.widthOfTextAtSize(line, size) <= 500, `line fits: ${line.slice(0, 30)}...`);
});

test('wrapTitle keeps a fitting title on one line', () => {
  assert.deepEqual(wrapTitle('Alex & Pip', stubFont, 40, 1000), ['Alex & Pip']);
});

test('wrapTitle splits an over-measure title into two fitting lines', () => {
  const lines = wrapTitle('Alexandra & Christopher & Elizabeth', stubFont, 40, 500);
  assert.equal(lines.length, 2);
  for (const line of lines) assert.ok(stubFont.widthOfTextAtSize(line, 40) <= 500, `line fits: ${line}`);
});

test('wrapTitle returns a lone oversized word untouched rather than mangling it', () => {
  assert.deepEqual(wrapTitle('Supercalifragilistic', stubFont, 40, 100), ['Supercalifragilistic']);
});

test('sanitiseCoverTitle strips control characters and folds whitespace', () => {
  const r = sanitiseCoverTitle('Mia\n&\tMax\u0007');
  assert.equal(r.text, 'Mia & Max');
  assert.equal(r.changed, true);
  assert.equal(sanitiseCoverTitle('Mia & Max').changed, false);
});

test('sanitiseCoverTitle caps over-length input at the renderer bound', () => {
  const r = sanitiseCoverTitle('A'.repeat(200));
  assert.equal(r.text.length, COVER_TITLE_MAX);
  assert.equal(r.changed, true);
});

test('coverTitle sanitises an explicit title before typesetting', () => {
  assert.equal(coverTitle({ title: 'Mia\n& Max' }), 'Mia & Max');
});

test('fitTitle flags the schema-maximum title when it lands below the readable threshold', () => {
  // 4 x 50-char names at the A4-landscape print measure: fits, but small -
  // fitting must not be reported as a clean pass.
  const title = `${Array.from({ length: 4 }, (_, i) => `Childname${'x'.repeat(40)}${i}`).join(' & ')}'s Story`;
  const [w] = pagePoints('A4 landscape', true);
  const fitted = fitTitle(title, font, w * 0.78, Math.round(w * 0.085), Math.round(w * 0.05));
  for (const line of fitted.lines) assert.ok(font.widthOfTextAtSize(line, fitted.size) <= w * 0.78, 'line fits the measure');
  assert.equal(fitted.belowReadable, fitted.size < TITLE_READABLE_MIN);
});

test('fitSingleLine shrinks the longest subtitle (100 chars) into the measure, or reports it', () => {
  const sub = 'A very long story type description that a family might write to describe their adventure book!!!!!!!'; // exactly 100 chars
  assert.equal(sub.length, 100);
  const [wl] = pagePoints('A4 landscape', true);
  const wide = fitSingleLine(sub, font, wl * 0.78, 12);
  assert.ok(wide.fits, `A4 landscape fits at ${wide.size}pt`);
  assert.ok(font.widthOfTextAtSize(sub, wide.size) <= wl * 0.78, 'within the measure');
  // On the narrowest format the same subtitle cannot fit even at the floor:
  // the fit must say so, never clip silently.
  const [wp] = pagePoints('A5 portrait', true);
  const narrow = fitSingleLine(sub, font, wp * 0.78, 12);
  assert.ok(!narrow.fits || narrow.size < SUBTEXT_READABLE_MIN, `A5 portrait reported: fits=${narrow.fits} size=${narrow.size}`);
});

test('fitSingleLine fits a typical dedication, and the 200-char maximum is explicitly reported', () => {
  const [w] = pagePoints('A4 landscape', true);
  const typical = fitSingleLine('For someone very special, with all our love.', font, w * 0.78, 10);
  assert.ok(typical.fits, `typical dedication fits at ${typical.size}pt`);
  // The schema-maximum dedication (200 chars) cannot sit on one line at a
  // readable size: the fit must say so (or land below the readable
  // threshold), never clip silently.
  const maxed = fitSingleLine('D'.repeat(200), font, w * 0.78, 10);
  assert.ok(!maxed.fits || maxed.size < SUBTEXT_READABLE_MIN, `reported: fits=${maxed.fits} size=${maxed.size}`);
});

test('readable thresholds stay ordered and sane', () => {
  assert.ok(TITLE_READABLE_MIN > SUBTEXT_READABLE_MIN);
  assert.ok(SUBTEXT_READABLE_MIN > 8);
});

test('isAccentChar marks the ampersand and the final word only', () => {
  const lines = ['Mia & Max'];
  assert.deepEqual([...lines[0]].map((_, i) => isAccentChar(lines, 0, i)),
    [false, false, false, false, true, false, true, true, true]);
  const wrapped = ['Mia & Max &', 'Pip'];
  assert.ok(isAccentChar(wrapped, 0, 4), 'first ampersand');
  assert.ok(isAccentChar(wrapped, 0, 10), 'every ampersand is accented');
  assert.ok(isAccentChar(wrapped, 1, 0) && isAccentChar(wrapped, 1, 2), 'final word on the last line');
});

test('layoutCoverTitle bounce keeps every letter inside the measure with bounded tilt', () => {
  const lines = ['Mia & Max'];
  const size = 60, maxWidth = 500;
  const layout = layoutCoverTitle(lines, font, size, 'bounce', maxWidth / 2, 200, size * 1.15);
  assert.equal(layout.placements.length, lines[0].length);
  for (const p of layout.placements) {
    assert.ok(p.x >= 0 - 1 && p.x + font.widthOfTextAtSize(p.ch, size) <= maxWidth + 1, `letter ${p.ch} inside the measure`);
    assert.ok(Math.abs(p.rotateDeg) <= 3.5 + 1e-9, 'tilt bounded');
  }
});

test('layoutCoverTitle arc lifts the edges and tilts tangentially', () => {
  const lines = ['Mia & Max'];
  const size = 60;
  const layout = layoutCoverTitle(lines, font, size, 'arc', 400, 200, size * 1.15);
  const ys = layout.placements.map((p) => p.y);
  const mid = Math.floor(ys.length / 2);
  assert.ok(ys[0] > ys[mid], 'left edge higher than middle');
  assert.ok(ys[ys.length - 1] > ys[mid], 'right edge higher than middle');
  assert.ok(layout.placements[0].rotateDeg > 0, 'left letters tilt one way');
  assert.ok(layout.placements[ys.length - 1].rotateDeg < 0, 'right letters tilt the other');
});

test('layoutCoverTitle straight keeps a flat baseline and zero rotation', () => {
  const layout = layoutCoverTitle(['Mia'], font, 60, 'straight', 400, 200, 69);
  assert.ok(layout.placements.every((p) => p.y === 200 && p.rotateDeg === 0));
});


test('coverLineMeasure equals the width layoutCoverTitle will actually draw', () => {
  for (const line of ['Mia & Pip', 'A very long title line with several words']) {
    for (const size of [18, 34, 52]) {
      for (const treatment of ['straight', 'bounce', 'arc'] as const) {
        const layout = layoutCoverTitle([line], font, size, treatment, 0, 0, size * 1.15);
        assert.ok(Math.abs(layout.lineWidths[0] - coverLineMeasure(line, font, size)) < 1e-6,
          `${treatment} ${size}pt "${line}": drawn ${layout.lineWidths[0]} vs measured ${coverLineMeasure(line, font, size)}`);
      }
    }
  }
});

test('fitCoverTitle: an 80-character title draws inside the measure in every treatment, and stays readable', () => {
  const title = 'The Extra Long Adventures of a Brave Little Child and Their Faithful Doggy Tales';
  assert.equal(title.length, COVER_TITLE_MAX); // the sanitiser's cap: the worst real input
  const maxWidth = pagePoints('210×210 mm square', false)[0] * TEXT_MEASURE;
  const startSize = Math.round(pagePoints('210×210 mm square', false)[0] * 0.085);
  const floorSize = Math.round(pagePoints('210×210 mm square', false)[0] * 0.05);
  const fitted = fitCoverTitle(title, font, maxWidth, startSize, floorSize);
  for (const treatment of ['straight', 'bounce', 'arc'] as const) {
    const layout = layoutCoverTitle(fitted.lines, font, fitted.size, treatment, 0, 0, fitted.size * 1.15);
    layout.lineWidths.forEach((w, i) =>
      assert.ok(w <= maxWidth + 1e-6, `${treatment} line ${i} draws ${w}pt over the ${maxWidth}pt measure`));
  }
  assert.ok(!fitted.belowReadable, `80-char title fitted at ${fitted.size}pt, below readable ${TITLE_READABLE_MIN}pt`);
  // The old whole-string metric would have under-measured this by the tracking.
  const naive = fitted.lines.map((l) => font.widthOfTextAtSize(l, fitted.size));
  const drawn = fitted.lines.map((l) => coverLineMeasure(l, font, fitted.size));
  drawn.forEach((d, i) => assert.ok(d > naive[i], 'tracking makes drawn width larger than the naive measure'));
});

test('fitCoverSubtext never truncates: an over-long dedication WRAPS to two lines at the floor, every word kept', () => {
  const long = 'For a very special child, with all our love on your birthday - may every one of your adventures be warm and bright';
  const fit = fitCoverSubtext(long, font, 300, 14, 10, 2);
  assert.equal(fit.fits, true);
  assert.equal(fit.size, 10, 'never shrinks below the readable floor');
  assert.equal(fit.lines.length, 2, 'wrapped, not truncated');
  assert.equal(fit.lines.join(' '), long, 'every family word preserved, in order');
  for (const l of fit.lines) assert.ok(font.widthOfTextAtSize(l, fit.size) <= 300, `line fits: "${l}"`);
});

test('fitCoverSubtext reports unfit (no silent drop) when even wrapping cannot hold the text', () => {
  const huge = 'word '.repeat(120).trim(); // far beyond two lines at any readable size
  const fit = fitCoverSubtext(huge, font, 300, 14, 10, 2);
  assert.equal(fit.fits, false, 'the caller must block with a clear reason');
  assert.equal(fit.lines.join(' '), huge, 'the reported text is intact - nothing dropped');
});

test('fitCoverSubtext keeps a fitting line untouched at full size', () => {
  const fit = fitCoverSubtext('A trip to the seaside story', font, 400, 14, 12);
  assert.deepEqual(fit, { lines: ['A trip to the seaside story'], size: 14, fits: true });
});
