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
