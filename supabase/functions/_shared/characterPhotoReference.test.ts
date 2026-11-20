import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ownedPhotoPath, photoReferenceDataUrl } from './characterPhotoReference.ts'

const USER = '11111111-1111-1111-1111-111111111111'
const PHOTO_ID = '22222222-2222-2222-2222-222222222222'
const good = { id: PHOTO_ID, storagePath: `${USER}/${PHOTO_ID}.jpg` }

test('ownedPhotoPath accepts an owner-folder photo path', () => {
  assert.equal(ownedPhotoPath(USER, good), good.storagePath)
})

test('ownedPhotoPath rejects other owners, traversal and odd names', () => {
  assert.equal(ownedPhotoPath(USER, { id: PHOTO_ID, storagePath: `33333333-3333-3333-3333-333333333333/${PHOTO_ID}.jpg` }), null)
  assert.equal(ownedPhotoPath(USER, { id: PHOTO_ID, storagePath: `${USER}/../${USER}/${PHOTO_ID}.jpg` }), null)
  assert.equal(ownedPhotoPath(USER, { id: PHOTO_ID, storagePath: `${USER}/${PHOTO_ID}.svg` }), null)
  assert.equal(ownedPhotoPath(USER, { id: PHOTO_ID, storagePath: `${USER}/not-a-uuid.jpg` }), null)
  assert.equal(ownedPhotoPath(USER, undefined), null)
})

test('photoReferenceDataUrl returns null for a bad path without downloading', async () => {
  let called = 0
  const url = await photoReferenceDataUrl(async () => { called++; return null }, USER, { id: PHOTO_ID, storagePath: 'other/x.jpg' })
  assert.equal(url, null)
  assert.equal(called, 0)
})

test('photoReferenceDataUrl returns a data URL for an owned photo', async () => {
  const bytes = new Uint8Array([1, 2, 3])
  const url = await photoReferenceDataUrl(async () => new Blob([bytes]), USER, good)
  assert.ok(url?.startsWith('data:image/jpeg;base64,'))
})
