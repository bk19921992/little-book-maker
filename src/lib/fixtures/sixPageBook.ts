// Synthetic local-only fixture. No account, provider, billing or network calls.
import type { StoryConfig } from '../../types.ts';
import type { ImageJobItem } from '../imageJob.ts';
export const fixtureImage = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+yXioAAAAASUVORK5CYII=';
export const sixPageBook: StoryConfig = {
  children: ['Sample'], storyId: 'local-fixture-six-pages', storyType: 'Adventure',
  palette: ['#73a89a'], characters: ['Bird'], setting: 'Garden', educationalFocus: 'kindness',
  readingLevel: 'Early 4–5', lengthPages: 6, narrationStyle: 'Simple prose', personal: {},
  contentSafety: true, imageStyle: 'Crayon', formatMode: 'manual', pageSize: 'A5 portrait', pageLayout: 'split',
  pages: Array.from({ length: 6 }, (_, i) => ({ page: i + 1, text: `Sample story page ${i + 1}.` })),
};
export const sixPageItems: ImageJobItem[] = [...sixPageBook.pages!.map((page) => ({
  key: `page:${page.page}`, page: page.page,
})), { key: 'cover', page: null }].map((item) => ({
  ...item, status: 'done', attempts: 1, url: fixtureImage,
  review: { pass: true, issues: [], skipped: true },
}));
