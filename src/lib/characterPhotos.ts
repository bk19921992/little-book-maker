import type { SupabaseClient } from '@supabase/supabase-js';

// Character photos (supabase/migrations/20261120233000_character_photos.sql).
// Locked privacy rules: photos live in the PRIVATE `character-photos` bucket
// under {user}/, are read and written only by their owner, are used only as
// illustration references for their own books, and are never public. Every
// photo can be deleted, which removes both the row and the object.

export const CHARACTER_PHOTOS_BUCKET = 'character-photos';

export interface CharacterPhoto {
  id: string;
  storagePath: string;
  label: string;
  createdAt: string;
}

export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
const ACCEPTED_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export function photoProblem(file: { type: string; size: number }): string | null {
  if (!ACCEPTED_TYPES[file.type]) return 'Photos must be a JPEG, PNG or WebP image.';
  if (file.size > MAX_PHOTO_BYTES) return 'That photo is over 10 MB. Choose a smaller copy.';
  return null;
}

export async function listCharacterPhotos(supabase: SupabaseClient): Promise<CharacterPhoto[]> {
  const { data, error } = await supabase
    .from('character_photos')
    .select('id, storage_path, label, created_at')
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    id: row.id as string,
    storagePath: row.storage_path as string,
    label: (row.label as string) ?? '',
    createdAt: row.created_at as string,
  }));
}

export async function uploadCharacterPhoto(
  supabase: SupabaseClient,
  userId: string,
  file: File,
  label: string,
): Promise<CharacterPhoto> {
  const problem = photoProblem(file);
  if (problem) throw new Error(problem);
  const id = crypto.randomUUID();
  const ext = ACCEPTED_TYPES[file.type];
  const storagePath = `${userId}/${id}.${ext}`;
  const { error: uploadError } = await supabase.storage
    .from(CHARACTER_PHOTOS_BUCKET)
    .upload(storagePath, file, { contentType: file.type, upsert: false });
  if (uploadError) throw new Error(uploadError.message);
  const { error: rowError } = await supabase
    .from('character_photos')
    .insert({ id, user_id: userId, storage_path: storagePath, label });
  if (rowError) {
    await supabase.storage.from(CHARACTER_PHOTOS_BUCKET).remove([storagePath]);
    throw new Error(rowError.message);
  }
  return { id, storagePath, label, createdAt: new Date().toISOString() };
}

export async function deleteCharacterPhoto(supabase: SupabaseClient, photo: CharacterPhoto): Promise<void> {
  const { error: rowError } = await supabase.from('character_photos').delete().eq('id', photo.id);
  if (rowError) throw new Error(rowError.message);
  const { error: storageError } = await supabase.storage
    .from(CHARACTER_PHOTOS_BUCKET)
    .remove([photo.storagePath]);
  if (storageError) throw new Error(storageError.message);
}

// Private bucket: previews and generation references use short-lived signed
// URLs, never public ones.
export async function signedPhotoUrl(supabase: SupabaseClient, storagePath: string, expiresIn = 3600): Promise<string> {
  const { data, error } = await supabase.storage
    .from(CHARACTER_PHOTOS_BUCKET)
    .createSignedUrl(storagePath, expiresIn);
  if (error || !data?.signedUrl) throw new Error(error?.message ?? 'Could not sign the photo URL.');
  return data.signedUrl;
}
