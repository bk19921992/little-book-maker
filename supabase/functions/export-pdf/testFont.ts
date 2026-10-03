// Test helper: the export's typeface (Nunito SemiBold) with real metrics,
// loaded the same way export-pdf embeds it (pdf-lib + fontkit, liga off).
// Node-only (npm devDependencies); not imported by the edge function.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { PDFDocument } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import type { MeasuringFont } from './typeset.ts';

export const MM = 2.834645669;

export async function loadNunito(): Promise<MeasuringFont> {
  const require = createRequire(import.meta.url);
  const path = require.resolve('@fontsource/nunito/files/nunito-latin-600-normal.woff');
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  return doc.embedFont(readFileSync(path), { features: { liga: false } });
}

// Print (bleed) and web page sizes in points, as createPDF computes them.
export const PAGES = {
  'A5 portrait': [148, 210],
  'A4 portrait': [210, 297],
  '210×210 mm square': [210, 210],
  'A4 landscape': [297, 210],
} as const;

export function pagePoints(size: keyof typeof PAGES, includeBleed: boolean): [number, number] {
  const [w, h] = PAGES[size];
  const extra = includeBleed ? 6 : 0;
  return [(w + extra) * MM, (h + extra) * MM];
}
