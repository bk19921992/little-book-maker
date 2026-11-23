import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activityPrompts, missingTextZone } from './activityPages.ts';

test('activity copy never claims the toy is on every page', () => {
  const acts = activityPrompts('William', 'a blue truck, from Grandma');
  assert.equal(acts.length, 4);
  assert.equal(acts[0].heading, 'Can you find it?');
  assert.match(acts[0].prompt, /a blue truck pops up again and again/);
  assert.ok(!/every page/.test(acts[0].prompt));
  assert.ok(!/every page/.test(acts.map((a) => a.prompt).join(' ')));
  assert.match(acts[2].prompt, /William's best bit/);
});

test('no toy configured: the find-it page is omitted entirely', () => {
  const acts = activityPrompts('William', '');
  assert.equal(acts.length, 3);
  assert.ok(acts.every((a) => a.heading !== 'Can you find it?'));
});

test('an illustrated page with text but no zone is refused; text-only exempt', () => {
  assert.equal(missingTextZone('Some verse', undefined, true), true);
  assert.equal(missingTextZone('Some verse', '', true), true);
  assert.equal(missingTextZone('Some verse', '  ', true), true);
  assert.equal(missingTextZone('Some verse', 'bottom', true), false);
  assert.equal(missingTextZone('Some verse', undefined, false), false);
  assert.equal(missingTextZone('', undefined, true), false);
});
