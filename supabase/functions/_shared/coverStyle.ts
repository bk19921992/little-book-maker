// Cover art direction: the bounded vocabulary a per-book "cover style" can
// use. The art-director step (an LLM choosing per story) may only pick from
// these vetted options; the renderer clamps anything else to the classic
// defaults, so a model or API caller can never inject an unlicensed font, an
// unreadable colour or an unknown treatment. Pure and remote-free so the
// node suite can test it (coverStyle.test.ts).

// Open-licence (OFL) pairings, all served from the fontsource CDN like the
// existing Nunito embed. Versions are PINNED (@5.3.0, what @latest resolved
// to on 2026-10-27): a fontsource update must never silently change the
// letterforms, metrics or fitting of an already-designed cover. Each pairing is a display face for the title and a
// text face for the subtitle/dedication chosen to sit well together.
export const COVER_TYPEFACES = {
  classic: {
    display: 'https://cdn.jsdelivr.net/fontsource/fonts/nunito@5.3.0/latin-800-normal.ttf',
    text: 'https://cdn.jsdelivr.net/fontsource/fonts/nunito@5.3.0/latin-600-normal.ttf',
  },
  bouncy: {
    display: 'https://cdn.jsdelivr.net/fontsource/fonts/fredoka@5.3.0/latin-600-normal.ttf',
    text: 'https://cdn.jsdelivr.net/fontsource/fonts/caveat@5.3.0/latin-700-normal.ttf',
  },
  chunky: {
    display: 'https://cdn.jsdelivr.net/fontsource/fonts/baloo-2@5.3.0/latin-700-normal.ttf',
    text: 'https://cdn.jsdelivr.net/fontsource/fonts/patrick-hand@5.3.0/latin-400-normal.ttf',
  },
  handlettered: {
    display: 'https://cdn.jsdelivr.net/fontsource/fonts/caveat@5.3.0/latin-700-normal.ttf',
    text: 'https://cdn.jsdelivr.net/fontsource/fonts/patrick-hand@5.3.0/latin-400-normal.ttf',
  },
} as const;
export type CoverTypeface = keyof typeof COVER_TYPEFACES;

// Lettering treatments the renderer actually implements. 'straight' is the
// classic composed line; 'bounce' gives each letter a small alternating tilt
// and baseline bob; 'arc' lays the line on a gentle upward curve.
export const COVER_TREATMENTS = ['straight', 'bounce', 'arc'] as const;
export type CoverTreatment = (typeof COVER_TREATMENTS)[number];

export interface CoverStyleSpec {
  typeface: CoverTypeface;
  treatment: CoverTreatment;
  titleColor: string;    // #RRGGBB
  accentColor: string;   // ampersand + final word
  subtitleColor: string;
}

export const COVER_INK = '#2B2622';
export const COVER_PAPER = '#FFF9F0';

export const DEFAULT_COVER_STYLE: CoverStyleSpec = {
  typeface: 'classic',
  treatment: 'straight',
  titleColor: COVER_INK,
  accentColor: COVER_INK,
  subtitleColor: COVER_INK,
};

const HEX = /^#[0-9a-fA-F]{6}$/;

export function coverHexToRgb(hex: string): { r: number; g: number; b: number } {
  return {
    r: parseInt(hex.slice(1, 3), 16) / 255,
    g: parseInt(hex.slice(3, 5), 16) / 255,
    b: parseInt(hex.slice(5, 7), 16) / 255,
  };
}

// WCAG contrast ratio, same formula as the export gate.
export function coverContrast(hexA: string, hexB: string): number {
  const lum = (c: { r: number; g: number; b: number }) => {
    const f = (v: number) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  };
  const l1 = lum(coverHexToRgb(hexA));
  const l2 = lum(coverHexToRgb(hexB));
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

// Cover type sits on the cream plate (or the paper band), so every colour
// must clear the same 4.5:1 gate the body-text contrast check uses. A colour
// that cannot is snapped back to ink - harmonising is the art director's
// job, legibility is not negotiable.
export const COVER_COLOR_CONTRAST_MIN = 4.5;

// Validate and clamp untrusted input (LLM output or direct API config) to a
// spec the renderer can always use. Returns the spec plus what changed, so
// the caller can record clamps in QA instead of silently restyling a cover.
export function clampCoverStyle(raw: unknown): { spec: CoverStyleSpec; clamps: string[] } {
  const clamps: string[] = [];
  const spec: CoverStyleSpec = { ...DEFAULT_COVER_STYLE };
  if (!raw || typeof raw !== 'object') {
    if (raw != null) clamps.push('coverStyle was not an object; defaults applied');
    return { spec, clamps };
  }
  const o = raw as Record<string, unknown>;

  if (typeof o.typeface === 'string' && o.typeface in COVER_TYPEFACES) {
    spec.typeface = o.typeface as CoverTypeface;
  } else if (o.typeface != null) {
    clamps.push(`unknown typeface "${String(o.typeface)}" -> classic`);
  }

  if (typeof o.treatment === 'string' && (COVER_TREATMENTS as readonly string[]).includes(o.treatment)) {
    spec.treatment = o.treatment as CoverTreatment;
  } else if (o.treatment != null) {
    clamps.push(`unknown treatment "${String(o.treatment)}" -> straight`);
  }

  for (const key of ['titleColor', 'accentColor', 'subtitleColor'] as const) {
    const v = o[key];
    if (v == null) continue;
    if (typeof v !== 'string' || !HEX.test(v)) {
      clamps.push(`${key} "${String(v)}" is not #RRGGBB -> ink`);
      continue;
    }
    const hex = v.toUpperCase();
    if (coverContrast(hex, COVER_PAPER) < COVER_COLOR_CONTRAST_MIN) {
      clamps.push(`${key} ${hex} fails ${COVER_COLOR_CONTRAST_MIN}:1 on the plate -> ink`);
      continue;
    }
    spec[key] = hex;
  }
  return { spec, clamps };
}

// True for the atomic-claim marker the one-shot art-direction self-test
// writes before its single selector call. Not a style: client summaries must
// treat it as absent; the renderer clamp already falls back to defaults.
export function isArtDirectionTestClaim(raw: unknown): boolean {
  return Boolean(raw && typeof raw === 'object' && (raw as Record<string, unknown>).artDirectionTest === 'pending');
}
