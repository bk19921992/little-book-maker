import type { StoryConfig, StoryPage } from '../types';

// Only the config fields generate-images reads. Sending the full config would
// also send every page's data-URL illustration, making a single-page request
// several megabytes.
export type ImageConfig = Pick<StoryConfig, 'children' | 'characters' | 'setting' | 'palette' | 'imageStyle' | 'storyType' | 'educationalFocus'> & {
  personal: Pick<StoryConfig['personal'], 'favouriteColour' | 'pets' | 'favouriteToy' | 'town'>;
};

export const imageConfig = (config: StoryConfig): ImageConfig => ({
  children: config.children,
  characters: config.characters,
  setting: config.setting,
  palette: config.palette,
  imageStyle: config.imageStyle,
  storyType: config.storyType,
  educationalFocus: config.educationalFocus,
  personal: {
    favouriteColour: config.personal?.favouriteColour,
    pets: config.personal?.pets,
    favouriteToy: config.personal?.favouriteToy,
    town: config.personal?.town,
  },
});

// Reference for regenerating one page: the earliest OTHER page that already
// has an accepted illustration (the page being replaced may be the bad one).
// The earliest page mirrors the whole-book chain, where page order decides
// the reference.
export const pickReferenceImage = (pages: StoryPage[], pageNumber: number): string | undefined =>
  [...pages]
    .filter((p) => p.page !== pageNumber && p.imageUrl?.startsWith('data:image/'))
    .sort((a, b) => a.page - b.page)[0]?.imageUrl;
