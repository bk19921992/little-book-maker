// Resolve a character's private photo into a data URL the image edits call
// can use as a reference. Server-side only: reads through the service role,
// and only for paths recorded in the requesting user's own config. Photos
// never leave the private bucket except into the generation call for the
// owner's own book (docs/CAPABILITIES.md).

export const CHARACTER_PHOTOS_BUCKET = 'character-photos'

export type CharacterPhotoRef = { id: string; storagePath: string }

// Fail closed: any path outside the owner's folder, any traversal, or an
// unexpected extension means no reference, never a guess.
export function ownedPhotoPath(userId: string, ref: CharacterPhotoRef | undefined): string | null {
  if (!ref || typeof ref.storagePath !== 'string') return null
  const path = ref.storagePath
  if (!path.startsWith(`${userId}/`)) return null
  if (path.includes('..') || path.includes('//')) return null
  if (!/^[0-9a-f-]{36}\.(jpg|png|webp)$/.test(path.slice(userId.length + 1))) return null
  return path
}

const MIME: Record<string, string> = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }

export async function photoReferenceDataUrl(
  download: (path: string) => Promise<Blob | null>,
  userId: string,
  ref: CharacterPhotoRef | undefined,
): Promise<string | null> {
  const path = ownedPhotoPath(userId, ref)
  if (!path) return null
  const blob = await download(path)
  if (!blob) return null
  const ext = path.split('.').pop() as string
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return `data:${MIME[ext]};base64,${btoa(binary)}`
}

// The clause the prompt builder adds when a photo reference is in play: the
// likeness leads, the chosen illustration style still renders it.
export const PHOTO_REFERENCE_CLAUSE =
  'Use the supplied photo as the likeness reference for the named character: keep their face, hair and colouring recognisable, rendered in the chosen illustration style. Do not include any text from the photo.'
