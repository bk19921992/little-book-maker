import type { StoryConfig, ReadingLevel, ValidationError, PageSizePreset } from '../types';
import { contractViolations, lineBudget, packLines, wordRange } from '../../supabase/functions/_shared/textContract.ts';

// Word count targets by reading level and page size: the same text contract
// story-write enforces, so an edited page fits the printed text band.
export const wordCountTargets = (readingLevel: ReadingLevel, pageSize?: PageSizePreset) =>
  wordRange(readingLevel, pageSize);

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
  pageNumber: number,
  pageSize?: PageSizePreset
): { isValid: boolean; message?: string; wordCount: number } => {
  const wordCount = countWords(text);
  const targets = wordCountTargets(readingLevel, pageSize);
  
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
  readingLevel: ReadingLevel,
  pageSize?: PageSizePreset
): { status: 'low' | 'good' | 'high'; color: string } => {
  const targets = wordCountTargets(readingLevel, pageSize);
  
  if (wordCount < targets.min) {
    return { status: 'low', color: 'text-destructive' };
  }
  
  if (wordCount > targets.max) {
    return { status: 'high', color: 'text-destructive' };
  }
  
  return { status: 'good', color: 'text-story-nature' };
};

// Whole-page text status for the editor: word count plus the line contract
// (line count, words and characters per line). 'high' means the page will not
// fit the printed text band as written.
export const getPageTextStatus = (
  text: string,
  readingLevel: ReadingLevel,
  pageSize?: PageSizePreset
): { status: 'low' | 'good' | 'high'; color: string; issues: string[] } => {
  const wordStatus = getWordCountStatus(countWords(text), readingLevel, pageSize);
  const issues = contractViolations(text, readingLevel, pageSize);
  if (wordStatus.status === 'good' && issues.length) {
    return { status: 'high', color: 'text-destructive', issues };
  }
  return { ...wordStatus, issues };
};

// Validate that all pages are ready for export
export const validatePagesForExport = (
  pages: { text: string; imageUrl?: string; imageLocked?: boolean }[],
  readingLevel: ReadingLevel,
  pageSize?: PageSizePreset
): ValidationError[] => {
  const errors: ValidationError[] = [];

  pages.forEach((page, index) => {
    const pageNumber = index + 1;
    
    // Check text content
    const textValidation = validatePageContent(page.text, readingLevel, pageNumber, pageSize);
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
// What the editor should tell the customer about a page that will not fit
// the printed text band, and whether "Fit lines" (re-breaking the lines,
// no rewording) would fix it. Null when the page fits.
export const pageFitAdvice = (
  text: string,
  readingLevel: ReadingLevel,
  pageSize?: PageSizePreset
): { message: string; canFitLines: boolean } | null => {
  if (!contractViolations(text, readingLevel, pageSize).length) return null;
  const words = countWords(text);
  const { max } = wordRange(readingLevel, pageSize);
  if (words > max) {
    return {
      message: `This page has ${words} words, but its printed text area holds ${max}. Please shorten it by ${words - max} word${words - max === 1 ? '' : 's'}.`,
      canFitLines: false,
    };
  }
  const fixable = contractViolations(packLines(text), readingLevel, pageSize).length === 0;
  return {
    message: fixable
      ? `Some lines are too long for the printed page (up to ${lineBudget(readingLevel, pageSize)} short lines fit). Fit lines re-breaks them without changing your words.`
      : 'A few very long words make this page too wide for the printed text area. Please use shorter words or fewer of them.',
    canFitLines: fixable,
  };
};
