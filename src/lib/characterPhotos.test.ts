import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { photoProblem, MAX_PHOTO_BYTES, CHARACTER_PHOTOS_BUCKET } from './characterPhotos.ts';

describe('photoProblem', () => {
  it('accepts jpeg, png and webp under the size cap', () => {
    assert.equal(photoProblem({ type: 'image/jpeg', size: 1000 }), null);
    assert.equal(photoProblem({ type: 'image/png', size: 1000 }), null);
    assert.equal(photoProblem({ type: 'image/webp', size: 1000 }), null);
  });

  it('rejects other types', () => {
    assert.match(photoProblem({ type: 'image/gif', size: 1000 })!, /JPEG, PNG or WebP/);
    assert.match(photoProblem({ type: 'application/pdf', size: 1000 })!, /JPEG, PNG or WebP/);
    assert.match(photoProblem({ type: 'image/heic', size: 1000 })!, /JPEG, PNG or WebP/);
  });

  it('rejects oversized files', () => {
    assert.match(photoProblem({ type: 'image/jpeg', size: MAX_PHOTO_BYTES + 1 })!, /10 MB/);
    assert.equal(photoProblem({ type: 'image/jpeg', size: MAX_PHOTO_BYTES }), null);
  });
});

describe('bucket', () => {
  it('uses the private character-photos bucket', () => {
    assert.equal(CHARACTER_PHOTOS_BUCKET, 'character-photos');
  });
});
