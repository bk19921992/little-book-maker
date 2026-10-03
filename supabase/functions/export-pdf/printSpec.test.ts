// Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BLEED_MM, dpiCheck, effectiveDpi, MM_TO_PT, printBoxes } from './printSpec.ts';
import { pagePoints } from './testFont.ts';

test('print boxes: TrimBox is the finished A5 size inside a 3 mm bleed', () => {
  const [w, h] = pagePoints('A5 portrait', true);
  const { trim, bleed } = printBoxes(w, h);
  assert.equal(Math.round(trim.width / MM_TO_PT), 148);
  assert.equal(Math.round(trim.height / MM_TO_PT), 210);
  assert.equal(Math.round(trim.x / MM_TO_PT), BLEED_MM);
  assert.deepEqual([bleed.width, bleed.height], [w, h]);
});

test('effective dpi of the images the pipeline makes, as placed full-bleed', () => {
  // gpt-image-1 sizes vs the print page (with bleed), cover-cropped.
  const cases: [Parameters<typeof pagePoints>[0], number, number][] = [
    ['A5 portrait', 1024, 1536],
    ['A4 portrait', 1024, 1536],
    ['210×210 mm square', 1024, 1024],
    ['A4 landscape', 1536, 1024],
  ];
  const results = Object.fromEntries(cases.map(([size, iw, ih]) => {
    const [w, h] = pagePoints(size, true);
    const scale = Math.max(w / iw, h / ih);
    return [size, effectiveDpi({ width: iw, height: ih }, { width: iw * scale, height: ih * scale })];
  }));
  // Measured facts the QA reports: none reach 300 dpi; A5 is acceptable,
  // the A4 sizes and the square (120 dpi) fall below the 150 dpi floor.
  assert.deepEqual(results, { 'A5 portrait': 169, 'A4 portrait': 120, '210×210 mm square': 120, 'A4 landscape': 120 });
});

test('dpi checks: pass at 300, warn from 150, fail below', () => {
  assert.equal(dpiCheck('p1', 300).severity, 'pass');
  assert.equal(dpiCheck('p1', 169).severity, 'warn');
  assert.equal(dpiCheck('p1', 120).severity, 'fail');
});
