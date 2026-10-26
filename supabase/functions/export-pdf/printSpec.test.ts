// Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BLEED_MM, containFit, dpiCheck, effectiveDpi, MM_TO_PT, printBoxes } from './printSpec.ts';
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

test('contain-fit: the whole picture survives, centred, cropping nothing', () => {
  // Landscape art (1536x1024, ratio 1.5) into a wide, short A4-landscape
  // split-page region (ratio ~1.86): height-bound, paper margins at the sides.
  const region = { width: 841.89, height: 452.4 };
  const image = { width: 1536, height: 1024 };
  const fit = containFit(region, image);
  assert.equal(fit.height, region.height);
  assert.ok(fit.width < region.width);
  assert.ok(Math.abs(fit.width / fit.height - image.width / image.height) < 1e-9, 'uniform scale, no distortion');
  assert.ok(fit.x > 0 && Math.abs(fit.x * 2 + fit.width - region.width) < 1e-6, 'centred horizontally');
  assert.equal(fit.y, 0);

  // The old cover-crop (Math.max) lost ~19% of the picture height here;
  // contain-fit loses none.
  const cropScale = Math.max(region.width / image.width, region.height / image.height);
  const croppedHeight = region.height / cropScale;
  assert.ok(croppedHeight < image.height * 0.82);
});

test('contain-fit: width-bound when the region is taller than the art', () => {
  // Landscape art into an A5-portrait split region (ratio ~0.93).
  const region = { width: 419.53, height: 340 };
  const image = { width: 1536, height: 1024 };
  const fit = containFit(region, image);
  assert.equal(fit.width, region.width);
  assert.ok(fit.height < region.height);
  assert.equal(fit.x, 0);
  assert.ok(fit.y > 0 && Math.abs(fit.y * 2 + fit.height - region.height) < 1e-6, 'centred vertically');
});

test('contain-fit: exact-ratio art fills the region with no margins', () => {
  const fit = containFit({ width: 300, height: 200 }, { width: 1536, height: 1024 });
  assert.deepEqual(fit, { x: 0, y: 0, width: 300, height: 200 });
});

test('contain-fit: small art scales UP to fill its bound, never crops', () => {
  const fit = containFit({ width: 800, height: 600 }, { width: 400, height: 300 });
  assert.deepEqual(fit, { x: 0, y: 0, width: 800, height: 600 });
});
