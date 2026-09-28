// Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { StoryConfig, StoryPage } from '../types.ts';
import { imageConfig, pickReferenceImage } from './imageRequest.ts';

const img = (n: number) => `data:image/jpeg;base64,PAGE${n}`;

test('regeneration reference is the earliest other page with an accepted image', () => {
  const pages: StoryPage[] = [
    { page: 3, text: '', imageUrl: img(3) },
    { page: 1, text: '', imageUrl: img(1) },
    { page: 2, text: '', imageUrl: img(2) },
  ];
  assert.equal(pickReferenceImage(pages, 2), img(1));
  assert.equal(pickReferenceImage(pages, 1), img(2));
});

test('regeneration reference skips pages without a data-URL image', () => {
  const pages: StoryPage[] = [
    { page: 1, text: '' },
    { page: 2, text: '', imageUrl: 'https://example.com/stock.jpg' },
    { page: 3, text: '', imageUrl: img(3) },
    { page: 4, text: '', imageUrl: img(4) },
  ];
  assert.equal(pickReferenceImage(pages, 4), img(3));
  assert.equal(pickReferenceImage([{ page: 1, text: '', imageUrl: img(1) }], 1), undefined);
});

test('image config carries no page images or other bulky state', () => {
  const config = {
    children: ['Mia'],
    characters: ['Owl'],
    setting: 'woods',
    palette: ['#fff'],
    imageStyle: 'Crayon',
    storyType: 'Adventure',
    educationalFocus: 'kindness',
    personal: { favouriteToy: 'rabbit', pets: 'cat', favouriteColour: 'blue', town: 'Leeds', dedication: 'For you' },
    pages: [{ page: 1, text: 'x', imageUrl: img(1) }],
    coverImageUrl: img(0),
    outline: { pages: [] },
  } as unknown as StoryConfig;
  const slim = imageConfig(config);
  assert.deepEqual(slim, {
    children: ['Mia'],
    characters: ['Owl'],
    setting: 'woods',
    palette: ['#fff'],
    imageStyle: 'Crayon',
    storyType: 'Adventure',
    educationalFocus: 'kindness',
    personal: { favouriteColour: 'blue', pets: 'cat', favouriteToy: 'rabbit', town: 'Leeds' },
  });
  assert.doesNotMatch(JSON.stringify(slim), /data:image/);
});
