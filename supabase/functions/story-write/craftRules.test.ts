import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CRAFT_RULES } from './craftRules.ts';

test('craft rules cover the failure modes the 21 Nov 2026 test book shipped', () => {
  // Fragments (shipped: "Sun on Pip's sage green jumper.")
  assert.match(CRAFT_RULES, /Every sentence needs a verb/);
  assert.match(CRAFT_RULES, /No fragments/);
  // Passive voice (shipped: "Their favourite toy is held tight.")
  assert.match(CRAFT_RULES, /Active voice/);
  // Description-only pages and flat pacing
  assert.match(CRAFT_RULES, /must move the story/);
  // Repeated sentence openings and name-led lines
  assert.match(CRAFT_RULES, /Vary sentence openings/);
  // Favourite toy mentioned on nearly every page
  assert.match(CRAFT_RULES, /only when it matters to the action/);
  // Told-not-shown feelings
  assert.match(CRAFT_RULES, /at most once/);
  // Anticlimactic final page with no callback to the opening
  assert.match(CRAFT_RULES, /closes the loop/);
});
