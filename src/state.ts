import { useState, useCallback } from 'react';
import { AppState, StoryConfig, AppStep, ValidationError } from './types';

// Initial state for the app
const initialConfig: StoryConfig = {
  children: [],
  storyType: '',
  themePreset: null,
  themeCustom: null,
  palette: [],
  characters: [],
  setting: '',
  educationalFocus: 'none',
  readingLevel: 'Early 4–5',
  lengthPages: 10,
  narrationStyle: 'Simple prose',
  personal: {},
  contentSafety: false,
  imageStyle: 'Picture-book',
  pageSize: 'A5 portrait',
  imageSeed: null,
};

export const useAppState = () => {
  const [state, setState] = useState<AppState>({
    currentStep: 'setup',
    config: initialConfig,
    isGenerating: false,
    errors: [],
  });

  const updateConfig = useCallback((updates: Partial<StoryConfig>) => {
    setState(prev => ({
      ...prev,
      config: { ...prev.config, ...updates },
      errors: [], // Clear errors when config changes
    }));
  }, []);

  const setStep = useCallback((step: AppStep) => {
    setState(prev => ({ ...prev, currentStep: step }));
  }, []);

  const setGenerating = useCallback((isGenerating: boolean) => {
    setState(prev => ({ ...prev, isGenerating }));
  }, []);

  const setErrors = useCallback((errors: string[]) => {
    setState(prev => ({ ...prev, errors }));
  }, []);

  const addError = useCallback((error: string) => {
    setState(prev => ({ ...prev, errors: [...prev.errors, error] }));
  }, []);

  const clearErrors = useCallback(() => {
    setState(prev => ({ ...prev, errors: [] }));
  }, []);

  // Validation helpers
  const validateConfig = useCallback((): ValidationError[] => {
    const errors: ValidationError[] = [];
    const { config } = state;

    if (!config.contentSafety) {
      errors.push({ field: 'contentSafety', message: 'Content safety agreement is required' });
    }

    if (!config.storyType.trim()) {
      errors.push({ field: 'storyType', message: 'Please select or enter a story type' });
    }

    if (!config.setting.trim()) {
      errors.push({ field: 'setting', message: 'Please select or enter a setting' });
    }

    if (config.characters.length === 0) {
      errors.push({ field: 'characters', message: 'Please add at least one character' });
    }

    if (config.lengthPages < 6 || config.lengthPages > 20) {
      errors.push({ field: 'lengthPages', message: 'Story length must be between 6 and 20 pages' });
    }

    return errors;
  }, [state]);

  const canProceedToNext = useCallback(() => {
    return validateConfig().length === 0;
  }, [validateConfig]);

  return {
    state,
    updateConfig,
    setStep,
    setGenerating,
    setErrors,
    addError,
    clearErrors,
    validateConfig,
    canProceedToNext,
  };
};