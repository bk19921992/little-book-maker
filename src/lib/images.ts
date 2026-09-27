import { StoryConfig } from '../types';

// Only the fields generate-images reads. Sending the full config would also
// send every page's data-URL illustration, making each request megabytes.
export type ImageConfig = Pick<StoryConfig, 'children' | 'characters' | 'setting' | 'palette' | 'imageStyle' | 'storyType' | 'educationalFocus'> & {
  personal: Pick<StoryConfig['personal'], 'favouriteColour' | 'pets' | 'favouriteToy' | 'town'>;
};

export type ImagePromptInput = {
  page: number;
  prompt: string;
  text?: string;
  visualBrief?: string;
  config?: ImageConfig;
  seed?: number;
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

// Run async tasks with at most `limit` in flight. Illustrations are requested
// one per edge-function call so no call gets near the edge timeout, and a
// small pool keeps the whole book quick without tripping image rate limits.
export async function runPool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++];
      await worker(item);
    }
  });
  await Promise.all(lanes);
}
