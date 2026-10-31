import type { SequenceReview } from '../supabase/functions/_shared/bookContinuity';
import type { SceneLedger } from '../supabase/functions/_shared/sceneLedger';
// Core types for the storybook generator

export type ReadingLevel = 'Toddler 2–3' | 'Early 4–5' | 'Primary 6–8';

export type PageSizePreset = 'A5 portrait' | 'A4 portrait' | '210×210 mm square' | 'A4 landscape';

// How each story page arranges its illustration and text
export type PageLayout = 'split' | 'overlay';

// Who picks the book format: 'auto' = AI decides per story, 'manual' = user picks
export type FormatMode = 'auto' | 'manual';

// Cover lettering style the art-direction step picked for this book's cover
// (generate-images). Deliberately loose: export-pdf re-validates and clamps
// every field against the bounded vocabulary before rendering, so a stale or
// hand-edited value can never break an export.
export interface CoverStyleChoice {
  typeface?: string;
  treatment?: string;
  titleColor?: string;
  accentColor?: string;
  subtitleColor?: string;
  rationale?: string;
  skipped?: boolean;
}

export interface StoryConfig {
  children: string[];               // may be empty
  coverImageUrl?: string;             // dedicated cover illustration, when generated
  coverImageReview?: 'passed' | 'unreviewed';
  coverStyle?: CoverStyleChoice;      // art-directed cover lettering, when selected
  storyType: string;                // preset or custom
  themePreset?: string | null;      // eg 'Calm pastels'
  themeCustom?: string | null;
  palette: string[];                // hex colours derived from preset or custom
  characters: string[];             // presets plus free text
  setting: string;                  // preset or custom
  educationalFocus?: 'none' | 'counting' | 'letters' | 'kindness' | 'sharing' | 'resilience' | 'bedtime wind-down' | 'healthy habits';
  readingLevel: ReadingLevel;
  lengthPages: number;              // 6 to 20, default 10
  narrationStyle: 'Simple prose' | 'Rhyming couplets' | 'Third-person' | 'First-person';
  personal: {
    town?: string;
    favouriteToy?: string;
    favouriteColour?: string;
    pets?: string;
    dedication?: string;
  };
  contentSafety: boolean;           // must be true to generate
  storyId?: string;                 // per-book id, set when planning starts (billing + future saving)
  imageStyle: 'Picture-book' | 'Watercolour' | 'Crayon' | 'Paper cut-out' | 'Cartoon line art' | { other: string };
  formatMode: FormatMode;         // 'auto' = AI picks shape+layout per story after planning
  pageSize: PageSizePreset;
  pageLayout: PageLayout;        // 'split' = picture above words, 'overlay' = full-page picture with words on top
  formatReason?: string | null;  // why the AI picked this format (auto mode)
  imageSeed?: number | null;

  continuityReview?: SequenceReview;
  scenePlanDraft?: {outline:StoryOutline;styleBible:StyleBible;format?:PlanFormatSuggestion|null;issues:string[]};

  // Generated
  styleBible?: StyleBible;
  outline?: StoryOutline;
  pages?: StoryPage[];
  exports?: {
    webPdfUrl?: string;
    printPdfUrl?: string;
  };
}

export interface StyleBible {
  palette: string[];
  heroDescription: string;  // stable description of main child or stand-in child
  clothing: string;
  moodWords: string[];
  renderingStyle: string;   // links to imageStyle
  compositionNotes: string; // keep safe trim, allow for gutter
}

export interface StoryOutline {
  sceneLedger?: SceneLedger;
  pages: OutlineItem[];
}

export interface OutlineItem {
  page: number;
  wordsTarget: number;
  visualBrief: string;
  imagePrompt: string;      // includes styleBible anchors
}

export interface StoryPage {
  page: number;
  text: string;
  imageUrl?: string;
  imageLocked?: boolean;
  // Set by story-write when the page text still breaks the shared text
  // contract: a draft to fix in the editor before its picture is drawn.
  textNeedsFix?: boolean;
  textContractIssues?: string[];
  imageReview?: 'passed' | 'unreviewed'; // 'unreviewed': QA reviewer was down; re-checked before checkout
}

// UI State Types
export type AppStep = 'setup' | 'preview' | 'edit' | 'export';

export interface AppState {
  currentStep: AppStep;
  config: StoryConfig;
  isGenerating: boolean;
  errors: string[];
}

// Preset data types
export interface ThemePreset {
  name: string;
  description: string;
  palette: string[];
  mood: string[];
}

export interface StoryTypePreset {
  name: string;
  description: string;
  tags: string[];
}

export interface CharacterPreset {
  name: string;
  description: string;
}

export interface SettingPreset {
  name: string;
  description: string;
}

// Validation types
export interface ValidationError {
  field: string;
  message: string;
}

// API Response types
// Format suggestion returned by the planner when formatMode is 'auto'
export interface PlanFormatSuggestion {
  pageSize?: string;
  pageLayout?: string;
  reason?: string;
}

export interface PlanResponse {
  needsSceneRepair?: boolean;
  issues?: string[];
  outline: StoryOutline;
  styleBible: StyleBible;
  format?: PlanFormatSuggestion | null;
}

export interface WriteResponse {
  pages: StoryPage[];
}

export interface ExportResponse {
  webPdfUrl: string;
  printPdfUrl: string;
}

export interface PrintOrderResponse {
  ok: boolean;
  provider: string;
  orderId?: string;
  checkoutUrl?: string;
  raw?: unknown;
  error?: string;
}
