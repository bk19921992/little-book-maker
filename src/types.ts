// Core types for the storybook generator

export type ReadingLevel = 'Toddler 2–3' | 'Early 4–5' | 'Primary 6–8';

export type PageSizePreset = 'A5 portrait' | 'A4 portrait' | '210×210 mm square';

export interface StoryConfig {
  children: string[];               // may be empty
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
  imageStyle: 'Picture-book' | 'Watercolour' | 'Crayon' | 'Paper cut-out' | 'Cartoon line art' | { other: string };
  pageSize: PageSizePreset;
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
  'Toddler 2–3': { min: 60; max: 80 };
  'Early 4–5': { min: 80; max: 120 };
  'Primary 6–8': { min: 120; max: 150 };
}

// API Response types
export interface PlanResponse {
  outline: StoryOutline;
  styleBible: StyleBible;
}

export interface WriteResponse {
  pages: StoryPage[];
}

export interface ImageGenerateResponse {
  images: { page: number; url: string }[];
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
  raw?: any;
  error?: string;
}