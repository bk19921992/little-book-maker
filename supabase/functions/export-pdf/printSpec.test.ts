// Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BLEED_MM, dpiCheck, effectiveDpi, exportBlockers, MM_TO_PT, printBoxes } from './printSpec.ts';
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

test('export gate: a defective book blocks, dpi stays advisory, warns pass', () => {
  const textFail = { where: 'page 3', severity: 'fail', check: 'text block does not fit the 40% band even at the smallest tier; band clamped, copy should be shortened upstream' };
  const missingArt = { where: 'page 2', severity: 'fail', check: 'illustration MISSING' };
  const noCover = { where: 'cover', severity: 'fail', check: 'no illustration available for the cover' };
  const dpiFail = dpiCheck('page 1', 120);
  assert.equal(dpiFail.severity, 'fail');
  const warn = { where: 'page 1', severity: 'warn', check: 'ragged wrap' };

  assert.deepEqual(exportBlockers([textFail]), [textFail], 'clamped text blocks the export');
  assert.deepEqual(exportBlockers([missingArt]), [missingArt], 'missing illustration blocks');
  assert.deepEqual(exportBlockers([noCover]), [noCover], 'no cover blocks');
  assert.deepEqual(exportBlockers([dpiFail]), [], 'print dpi fail stays advisory for now');
  assert.deepEqual(exportBlockers([warn]), [], 'warns never block');
  assert.deepEqual(exportBlockers([textFail, dpiFail, warn]), [textFail], 'mixed: only the real defect');
  assert.deepEqual(exportBlockers([]), [], 'a clean book exports');
});
