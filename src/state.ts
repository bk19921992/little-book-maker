import { useState, useCallback } from 'react';
import { AppState, StoryConfig, AppStep, ValidationError } from './types';
import { validateStoryConfig } from './lib/validation';

// Initial state for the app
const createInitialConfig = (): StoryConfig => ({
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
  // Every story is child-safe by design (the setup screen says so); since
  // 76d4210 there is no waiver checkbox, so this can no longer start false or
  // "Create My Story" stays disabled for everyone.
  contentSafety: true,
  imageStyle: 'Picture-book',
  formatMode: 'auto',
  pageSize: 'A5 portrait',
  pageLayout: 'split',
  formatReason: null,
  imageSeed: null,
});

export const useAppState = () => {
  const [state, setState] = useState<AppState>({
    currentStep: 'setup',
    config: createInitialConfig(),
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

  const resetState = useCallback(() => {
    setState({
      currentStep: 'setup',
      config: createInitialConfig(),
      isGenerating: false,
      errors: [],
    });
  }, []);

  // Validation helpers
  const validateConfig = useCallback((): ValidationError[] => {
    return validateStoryConfig(state.config);
  }, [state.config]);

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
    resetState,
  };
};
