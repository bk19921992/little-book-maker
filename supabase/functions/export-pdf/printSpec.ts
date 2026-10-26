// Print-production helpers for export-pdf. Pure (no remote imports) so they
// are unit tested (printSpec.test.ts).

export const MM_TO_PT = 2.834645669;
export const BLEED_MM = 3; // print PDFs are the trim size plus 3 mm on every side

// Trim and bleed boxes for a print page: printers read TrimBox for the
// finished size and BleedBox for how far artwork extends past it. (No crop
// marks: print-on-demand services want bleed without marks.)
export function printBoxes(pageWidthPt: number, pageHeightPt: number) {
  const bleed = BLEED_MM * MM_TO_PT;
  return {
    trim: { x: bleed, y: bleed, width: pageWidthPt - 2 * bleed, height: pageHeightPt - 2 * bleed },
    bleed: { x: 0, y: 0, width: pageWidthPt, height: pageHeightPt },
  };
}

// Effective print resolution of a placed image, in pixels per inch, from its
// pixel size and the size it is drawn at (points; 72 pt = 1 inch). A
// cover-cropped image is scaled uniformly, so either axis gives the same
// answer; the lower is used to be safe.
export function effectiveDpi(imagePx: { width: number; height: number }, drawnPt: { width: number; height: number }): number {
  return Math.round(Math.min(imagePx.width / (drawnPt.width / 72), imagePx.height / (drawnPt.height / 72)));
}

export const DPI_RECOMMENDED = 300; // print-shop standard for crisp pictures
export const DPI_MINIMUM = 150; // below this pictures look visibly soft or pixelated in print

export function dpiCheck(where: string, dpi: number): { where: string; severity: 'pass' | 'warn' | 'fail'; check: string } {
  if (dpi >= DPI_RECOMMENDED) return { where, severity: 'pass', check: `illustration ${dpi} dpi in print` };
  if (dpi >= DPI_MINIMUM) return { where, severity: 'warn', check: `illustration ${dpi} dpi in print (${DPI_RECOMMENDED} recommended; acceptable, may look slightly soft)` };
  return { where, severity: 'fail', check: `illustration only ${dpi} dpi in print (minimum ${DPI_MINIMUM}); it will look pixelated` };
}

// Contain-fit: scale artwork so the WHOLE picture fits inside a region,
// centred, cropping nothing. Where the picture's shape differs from the
// region's, the short side leaves paper margins - the illustration reads as
// a framed plate, as in a printed storybook. The old cover-crop filled the
// region and guillotined whatever fell outside it (heads, wings, paws).
// Returns the draw rectangle in points, as offsets from the region's origin.
export function containFit(
  region: { width: number; height: number },
  image: { width: number; height: number },
): { x: number; y: number; width: number; height: number } {
  const scale = Math.min(region.width / image.width, region.height / image.height);
  const width = image.width * scale;
  const height = image.height * scale;
  return { x: (region.width - width) / 2, y: (region.height - height) / 2, width, height };
}

