import { StoryConfig, ReadingLevel, ValidationError, WordCountTargets } from '../types';

// Word count targets by reading level
export const wordCountTargets: WordCountTargets = {
  'Toddler 2–3': { min: 60, max: 80 },
  'Early 4–5': { min: 80, max: 120 },
  'Primary 6–8': { min: 120, max: 150 },
};

// Validate story configuration
export const validateStoryConfig = (config: StoryConfig): ValidationError[] => {
  const errors: ValidationError[] = [];

  // Required fields
  if (!config.storyType?.trim()) {
    errors.push({ field: 'storyType', message: 'Story type is required' });
  }

  if (!config.setting?.trim()) {
    errors.push({ field: 'setting', message: 'Setting is required' });
  }

  if (config.characters.length === 0) {
    errors.push({ field: 'characters', message: 'At least one character is required' });
  }

  // Content safety must be accepted
  if (!config.contentSafety) {
    errors.push({ field: 'contentSafety', message: 'Content safety agreement is required' });
  }

  // Page length validation
  if (config.lengthPages < 6 || config.lengthPages > 20) {
    errors.push({ field: 'lengthPages', message: 'Story length must be between 6 and 20 pages' });
  }

  // Theme validation - must have either preset or custom
  if (!config.themePreset && !config.themeCustom?.trim()) {
    errors.push({ field: 'theme', message: 'Please select a theme or enter a custom theme' });
  }

  return errors;
};

// Validate individual page content
export const validatePageContent = (
  text: string,
  readingLevel: ReadingLevel,
  pageNumber: number
): { isValid: boolean; message?: string; wordCount: number } => {
  const wordCount = countWords(text);
  const targets = wordCountTargets[readingLevel];
  
  const tolerance = 15; // ±15 words tolerance
  const minWords = targets.min - tolerance;
  const maxWords = targets.max + tolerance;

  if (wordCount < minWords) {
    return {
      isValid: false,
      message: `Page ${pageNumber} has too few words (${wordCount}). Target: ${targets.min}-${targets.max} words.`,
      wordCount,
    };
  }

  if (wordCount > maxWords) {
    return {
      isValid: false,
      message: `Page ${pageNumber} has too many words (${wordCount}). Target: ${targets.min}-${targets.max} words.`,
      wordCount,
    };
  }

  return { isValid: true, wordCount };
};

// Count words in text
export const countWords = (text: string): number => {
  if (!text.trim()) return 0;
  return text.trim().split(/\s+/).length;
};

// Get word count status for display
export const getWordCountStatus = (
  wordCount: number,
  readingLevel: ReadingLevel
): { status: 'low' | 'good' | 'high'; color: string } => {
  const targets = wordCountTargets[readingLevel];
  
  if (wordCount < targets.min) {
    return { status: 'low', color: 'text-destructive' };
  }
  
  if (wordCount > targets.max) {
    return { status: 'high', color: 'text-destructive' };
  }
  
  return { status: 'good', color: 'text-story-nature' };
};

// Validate that all pages are ready for export
export const validatePagesForExport = (
  pages: { text: string; imageUrl?: string; imageLocked?: boolean }[],
  readingLevel: ReadingLevel
): ValidationError[] => {
  const errors: ValidationError[] = [];

  pages.forEach((page, index) => {
    const pageNumber = index + 1;
    
    // Check text content
    const textValidation = validatePageContent(page.text, readingLevel, pageNumber);
    if (!textValidation.isValid) {
      errors.push({ field: `page${pageNumber}Text`, message: textValidation.message! });
    }

    // Check image presence (unless explicitly locked without image)
    if (!page.imageUrl && !page.imageLocked) {
      errors.push({ 
        field: `page${pageNumber}Image`, 
        message: `Page ${pageNumber} needs an image or must be locked without one` 
      });
    }
  });

  return errors;
};

// Helper to format validation errors for display
export const formatValidationErrors = (errors: ValidationError[]): string[] => {
  return errors.map(error => error.message);
};