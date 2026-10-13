// Older email links return to /. Keep their callback data intact when opening the app.
export function rootAuthDestination(pathname: string, search: string, hash: string): string | null {
  if (pathname !== '/') return null;
  const query = new URLSearchParams(search);
  const fragment = new URLSearchParams(hash.replace(/^#/, ''));
  const callback = query.has('code') || query.has('token_hash') || fragment.has('access_token') || fragment.has('error_description');
  return callback ? `/app${search}${hash}` : null;
}
