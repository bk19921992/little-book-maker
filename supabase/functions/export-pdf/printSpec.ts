// Print-production helpers for export-pdf. Pure (no remote imports) so they
// are unit tested (printSpec.test.ts).

export const MM_TO_PT = 2.834645669;
export const BLEED_MM = 3; // legacy only: the printer now adds bleed itself

// Peecho file spec (verified 10 Nov 2026, support.peecho.com softcover and
// hardcover guidelines): the PDF page IS the trim size (the printer's
// system generates bleed and cut marks), and all art and text keep a
// minimum 10 mm margin on every side.
export const SAFE_MARGIN_MM = 10;
export const SAFE_MARGIN_PT = SAFE_MARGIN_MM * MM_TO_PT;

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

export function dpiCheck(where: string, dpi: number): { where: string; severity: 'pass' | 'warn' | 'fail'; check: string; kind: 'dpi' } {
  if (dpi >= DPI_RECOMMENDED) return { where, severity: 'pass', check: `illustration ${dpi} dpi in print`, kind: 'dpi' };
  if (dpi >= DPI_MINIMUM) return { where, severity: 'warn', check: `illustration ${dpi} dpi in print (${DPI_RECOMMENDED} recommended; acceptable, may look slightly soft)`, kind: 'dpi' };
  return { where, severity: 'fail', check: `illustration only ${dpi} dpi in print (minimum ${DPI_MINIMUM}); it will look pixelated`, kind: 'dpi' };
}

// Contain-fit: scale artwork so the WHOLE picture fits inside a region,
// centred, cropping nothing. Where the picture's shape differs from the
// region's, the short side leaves paper margins - the illustration reads as
// a framed plate, as in a printed storybook. The old cover-crop filled the
// region and guillotined whatever fell outside it (heads, wings, paws).
// Returns the draw rectangle in points, as offsets from the region's origin.
// Full-bleed is only honest when the art's shape is the page's shape: the
// crop stays within roughly the bleed allowance and only frame-edge
// background can be lost. Beyond the tolerance the cover falls back to an
// uncropped plate with paper margins, so important content is never cut.
export const COVER_FULL_BLEED_TOLERANCE = 0.04;

export function coverFullBleedOk(
  page: { width: number; height: number },
  image: { width: number; height: number },
): boolean {
  const pageRatio = page.width / page.height;
  const artRatio = image.width / image.height;
  return Math.abs(artRatio / pageRatio - 1) <= COVER_FULL_BLEED_TOLERANCE;
}

export function containFit(
  region: { width: number; height: number },
  image: { width: number; height: number },
): { x: number; y: number; width: number; height: number } {
  const scale = Math.min(region.width / image.width, region.height / image.height);
  const width = image.width * scale;
  const height = image.height * scale;
  return { x: (region.width - width) / 2, y: (region.height - height) / 2, width, height };
}

// Fail-closed export gate: which QA findings refuse the export. dpi findings
// are advisory (the 150dpi floor already guards) and omitted: refusing them
// would break older books customers can already buy, which is a product
// decision, not a defect gate. Everything failing here already passes the
// editor's client-side contract, so a blocker means the book reached export
// by an unusual path (older book, direct API call) - exactly what the gate
// exists for.
export function exportBlockers<T extends { severity: string; kind?: string }>(qa: T[]): T[] {
  return qa.filter((q) => q.severity === 'fail' && q.kind !== 'dpi');
}

// Print profile version stamped into every print PDF's keywords. The order
// path refuses PDFs without this exact marker, so books exported before
// the trim-sized/300dpi profile must be regenerated before they can be
// ordered. Bump on any print-profile change.
// v4 is the first compliant profile: safe-margin text bounds (cover, folio,
// back title) were fixed in v8. v3 stamps remain on pre-fix exports, so the
// order path must refuse them and force regeneration.
// v5 enlarges print art (cover and story pages) up to the 150 dpi floor,
// answering the 11 Nov 2026 owner review; v4 books keep the small plates,
// so the order path must refuse them and force regeneration.
export const PRINT_PROFILE_VERSION = 5;
export const PRINT_PROFILE_MARKER = `story-sprout-print-profile:${PRINT_PROFILE_VERSION}`;

// Peecho recommends 300 dpi; 150 dpi is the acceptable floor (dpiCheck
// warns there, fails below). Art is contain-fit inside the safe region and
// capped at its native resolution for the given floor (pixels * 72 / minDpi
// points), so the renderer never upscales past the floor. The default floor
// is 300 - never upscale. Print layout passes DPI_MINIMUM (150): the owner
// review on 11 Nov 2026 asked for larger art ("Size of images too"), and
// enlarging up to the 150-300 dpi band the QA already calls acceptable is
// the implementation choice that answers it. The drawn size is still
// derived from the art's real pixels, so the dpi QA keeps measuring the
// truth.
export const PRINT_DPI = 300;
export function printPlacement(
  region: { width: number; height: number },
  pixels: { width: number; height: number },
  minDpi: number = PRINT_DPI,
): { width: number; height: number } {
  const fit = containFit(region, pixels);
  const native = { width: (pixels.width * 72) / minDpi, height: (pixels.height * 72) / minDpi };
  const scale = Math.min(1, native.width / fit.width, native.height / fit.height);
  return { width: fit.width * scale, height: fit.height * scale };
}

// Print text never dips below the safe margin: baselines are placed so the
// font's descent still ends at or above safeInset. The text face's measured
// bounding-box descent is ~0.35 em; 0.45 leaves real headroom under the
// 10 mm rule instead of rounding onto the boundary.
export const TEXT_DESCENT_RATIO = 0.45;
export function printFolioBaseline(safeInsetPt: number, folioSize: number): number {
  return safeInsetPt + folioSize * TEXT_DESCENT_RATIO;
}
export function coverTextBlockBottom(
  bandBottom: number,
  forPrint: boolean,
  safeInsetPt: number,
  lowestTextSize: number,
): number {
  if (!forPrint) return bandBottom;
  return Math.max(bandBottom, safeInsetPt + lowestTextSize * TEXT_DESCENT_RATIO);
}
