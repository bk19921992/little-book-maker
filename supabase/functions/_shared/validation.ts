// Server-side bounds for story configuration. Returns a friendly error
// message, or null when the config is acceptable.
export function validateStoryConfig(config: Record<string, unknown>): string | null {
  if (!config || typeof config !== 'object') return 'Missing story configuration.';

  const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

  if (!text(config.storyType)) return 'Please choose a story type.';
  if (text(config.storyType).length > 100) return 'Story type is too long (100 characters max).';

  if (!text(config.setting)) return 'Please choose a setting.';
  if (text(config.setting).length > 100) return 'Setting is too long (100 characters max).';

  const children = Array.isArray(config.children) ? config.children : [];
  if (children.length > 4) return 'Please use at most 4 children.';
  for (const name of children) {
    if (text(name).length > 50) return 'Names must be 50 characters or fewer.';
  }

  const characters = Array.isArray(config.characters) ? config.characters : [];
  if (characters.length > 8) return 'Please use at most 8 characters.';
  for (const c of characters) {
    if (text(c).length > 50) return 'Character names must be 50 characters or fewer.';
  }

  if (text(config.themeCustom).length > 100) return 'Theme is too long (100 characters max).';

  const personal = (config.personal ?? {}) as Record<string, unknown>;
  for (const key of ['town', 'favouriteToy', 'favouriteColour', 'pets']) {
    if (text(personal[key]).length > 100) return 'Personal details must be 100 characters or fewer.';
  }
  if (text(personal.dedication).length > 200) return 'Dedication must be 200 characters or fewer.';

  const pages = Number(config.lengthPages);
  if (!Number.isInteger(pages) || pages < 6 || pages > 20) {
    return 'Story length must be between 6 and 20 pages.';
  }

  return null;
}
