// Core types for the storybook generator

export type ReadingLevel = 'Toddler 2–3' | 'Early 4–5' | 'Primary 6–8';

export type PageSizePreset = 'A5 portrait' | 'A4 portrait' | '210×210 mm square' | 'A4 landscape';

// How each story page arranges its illustration and text
export type PageLayout = 'split' | 'overlay';

// Who picks the book format: 'auto' = AI decides per story, 'manual' = user picks
export type FormatMode = 'auto' | 'manual';

export interface StoryConfig {
  children: string[];               // may be empty
  coverImageUrl?: string;             // dedicated cover illustration, when generated
  referenceImageUrl?: string;         // character sheet every illustration is drawn from
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

export interface WordCountTargets {
  'Toddler 2–3': { min: 5; max: 25 };
  'Early 4–5': { min: 20; max: 50 };
  'Primary 6–8': { min: 40; max: 90 };
}

// API Response types
// Format suggestion returned by the planner when formatMode is 'auto'
export interface PlanFormatSuggestion {
  pageSize?: string;
  pageLayout?: string;
  reason?: string;
}

export interface PlanResponse {
  outline: StoryOutline;
  styleBible: StyleBible;
  format?: PlanFormatSuggestion | null;
}

export interface WriteResponse {
  pages: StoryPage[];
}

export interface ImageGenerateResponse {
  images: { page: number; url: string }[];
  cover?: { url: string };
  reference?: { url: string };        // character sheet, returned by mode 'reference'
  errors?: { page: number; error: string }[];
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
