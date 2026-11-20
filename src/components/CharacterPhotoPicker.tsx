import React, { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ImagePlus, Trash2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { PHOTO_UPLOAD_ENABLED } from '@/lib/pricing';
import {
  CharacterPhoto,
  deleteCharacterPhoto,
  listCharacterPhotos,
  signedPhotoUrl,
  uploadCharacterPhoto,
} from '@/lib/characterPhotos';

type PhotoMap = Record<string, { id: string; storagePath: string }>;

interface Props {
  characters: string[];
  photos: PhotoMap;
  onChange: (photos: PhotoMap) => void;
  userId: string;
}

// Per-character private photo upload. Photos illustrate only this account's
// books, never become public, and can be deleted at any time (row + object).
// Renders nothing while the capability flag is off.
export const CharacterPhotoPicker: React.FC<Props> = ({ characters, photos, onChange, userId }) => {
  const [library, setLibrary] = useState<Record<string, CharacterPhoto>>({});
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({});

  useEffect(() => {
    let cancelled = false;
    void listCharacterPhotos(supabase).then(async (rows) => {
      if (cancelled) return;
      const byId: Record<string, CharacterPhoto> = {};
      const urls: Record<string, string> = {};
      for (const row of rows) byId[row.id] = row;
      for (const ref of Object.values(photos)) {
        const row = byId[ref.id];
        if (row && !urls[row.id]) urls[row.id] = await signedPhotoUrl(supabase, row.storagePath);
      }
      if (!cancelled) { setLibrary(byId); setPreviews(urls); }
    }).catch((e: Error) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!PHOTO_UPLOAD_ENABLED) return null;

  const handleFile = async (character: string, file: File | undefined) => {
    if (!file) return;
    setBusy(character);
    setError(null);
    try {
      const photo = await uploadCharacterPhoto(supabase, userId, file, character);
      const url = await signedPhotoUrl(supabase, photo.storagePath);
      setLibrary((prev) => ({ ...prev, [photo.id]: photo }));
      setPreviews((prev) => ({ ...prev, [photo.id]: url }));
      onChange({ ...photos, [character]: { id: photo.id, storagePath: photo.storagePath } });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The upload failed. Try again.');
    } finally {
      setBusy(null);
      const input = fileInputs.current[character];
      if (input) input.value = '';
    }
  };

  const handleDelete = async (character: string) => {
    const ref = photos[character];
    if (!ref) return;
    setBusy(character);
    setError(null);
    try {
      const row = library[ref.id] ?? { id: ref.id, storagePath: ref.storagePath, label: character, createdAt: '' };
      await deleteCharacterPhoto(supabase, row);
      const next = { ...photos };
      delete next[character];
      onChange(next);
      setPreviews((prev) => { const p = { ...prev }; delete p[ref.id]; return p; });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete the photo. Try again.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-3 rounded-lg border border-dashed p-3">
      <p className="text-xs text-muted-foreground">
        Optional: add a photo of a character (your child, a pet, a family member) and the
        illustrations will take their likeness. Photos are private to your account, are used only
        to illustrate your books, and are never shared or made public. You can delete a photo at
        any time.
      </p>
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      <div className="flex flex-wrap gap-3">
        {characters.map((character) => {
          const ref = photos[character];
          const url = ref ? previews[ref.id] : undefined;
          return (
            <div key={character} className="flex items-center gap-2 rounded-md border px-2 py-1.5">
              {ref && url ? (
                <img src={url} alt={`Photo for ${character}`} className="h-10 w-10 rounded object-cover" />
              ) : (
                <span className="flex h-10 w-10 items-center justify-center rounded bg-muted text-muted-foreground">
                  <ImagePlus className="h-4 w-4" aria-hidden="true" />
                </span>
              )}
              <span className="max-w-[8rem] truncate text-sm">{character}</span>
              {ref ? (
                <Button
                  type="button" size="sm" variant="ghost"
                  aria-label={`Delete photo for ${character}`}
                  disabled={busy === character}
                  onClick={() => void handleDelete(character)}
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </Button>
              ) : (
                <>
                  <input
                    ref={(el) => { fileInputs.current[character] = el; }}
                    type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
                    aria-label={`Upload photo for ${character}`}
                    onChange={(e) => void handleFile(character, e.target.files?.[0])}
                  />
                  <Button
                    type="button" size="sm" variant="outline"
                    disabled={busy === character}
                    onClick={() => fileInputs.current[character]?.click()}
                  >
                    {busy === character ? 'Uploading…' : 'Add photo'}
                  </Button>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
