// Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clampCoverStyle, COVER_COLOR_CONTRAST_MIN, COVER_TYPEFACES, coverContrast, DEFAULT_COVER_STYLE } from './coverStyle.ts';

test('absent coverStyle yields the classic defaults, untouched', () => {
  const { spec, clamps } = clampCoverStyle(undefined);
  assert.deepEqual(spec, DEFAULT_COVER_STYLE);
  assert.deepEqual(clamps, []);
});

test('a fully valid art-direction spec passes through (colours normalised)', () => {
  const { spec, clamps } = clampCoverStyle({
    typeface: 'bouncy',
    treatment: 'bounce',
    titleColor: '#282c42',
    accentColor: '#c24b5a',
    subtitleColor: '#4e6e9e',
  });
  assert.equal(spec.typeface, 'bouncy');
  assert.equal(spec.treatment, 'bounce');
  assert.equal(spec.titleColor, '#282C42');
  assert.equal(spec.accentColor, '#C24B5A');
  assert.equal(spec.subtitleColor, '#4E6E9E');
  assert.deepEqual(clamps, []);
});

test('unvetted typeface and treatment snap to defaults with recorded clamps', () => {
  const { spec, clamps } = clampCoverStyle({ typeface: 'papyrus', treatment: 'spiral' });
  assert.equal(spec.typeface, 'classic');
  assert.equal(spec.treatment, 'straight');
  assert.equal(clamps.length, 2);
});

test('malformed and low-contrast colours snap to ink', () => {
  const { spec, clamps } = clampCoverStyle({
    titleColor: 'red',            // not #RRGGBB
    accentColor: '#FCBAA3',       // pastel: fails the plate contrast gate
    subtitleColor: '#2B2622',     // fine
  });
  assert.equal(spec.titleColor, DEFAULT_COVER_STYLE.titleColor);
  assert.equal(spec.accentColor, DEFAULT_COVER_STYLE.accentColor);
  assert.equal(spec.subtitleColor, '#2B2622');
  assert.equal(clamps.length, 2);
  assert.ok(coverContrast('#FCBAA3', '#FFF9F0') < COVER_COLOR_CONTRAST_MIN, 'fixture really fails the gate');
});

test('non-object coverStyle is ignored with a recorded clamp', () => {
  const { spec, clamps } = clampCoverStyle('bouncy');
  assert.deepEqual(spec, DEFAULT_COVER_STYLE);
  assert.equal(clamps.length, 1);
});

test('every vetted typeface serves OFL static TTFs from the fontsource CDN', () => {
  for (const [key, urls] of Object.entries(COVER_TYPEFACES)) {
    for (const url of Object.values(urls)) {
      assert.match(url, /^https:\/\/cdn\.jsdelivr\.net\/fontsource\/fonts\//, `${key}: ${url}`);
      assert.ok(url.endsWith('-normal.ttf'), `${key} static weight file: ${url}`);
    }
  }
});
