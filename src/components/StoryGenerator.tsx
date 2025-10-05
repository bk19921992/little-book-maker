import React from 'react';
import { useAppState } from '../state';
import { SetupForm } from './SetupForm';
import { PreviewGenerate } from './PreviewGenerate';
import { PageEditor } from './PageEditor';
import { ExportPanel } from './ExportPanel';
import heroImage from '../assets/storybook-hero.jpg';

export const StoryGenerator: React.FC = () => {
  const {
    state,
    updateConfig,
    setStep,
    canProceedToNext,
  } = useAppState();

  const { currentStep, config } = state;

  const handleNext = () => {
    switch (currentStep) {
      case 'setup':
        setStep('preview');
        break;
      case 'preview':
        setStep('edit');
        break;
      case 'edit':
        setStep('export');
        break;
    }
  };

  const handleBack = () => {
    switch (currentStep) {
      case 'preview':
        setStep('setup');
        break;
      case 'edit':
        setStep('preview');
        break;
      case 'export':
        setStep('edit');
        break;
    }
  };

  return (
    <div className="min-h-screen bg-gradient-soft">
      {/* Hero Section - Only show on setup */}
      {currentStep === 'setup' && (
        <div className="relative overflow-hidden bg-gradient-story">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-12 sm:py-16 text-center">
            <div className="mb-6 sm:mb-8">
              <img
                src={heroImage}
                alt="Magical storybook coming to life"
                className="w-full max-w-lg sm:max-w-xl lg:max-w-2xl mx-auto rounded-2xl shadow-[var(--shadow-story)] animate-gentle-bounce"
              />
            </div>
            <h1 className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-display font-bold text-white mb-3 sm:mb-4">
              Create Magical Stories
            </h1>
            <p className="text-lg sm:text-xl text-white/90 mb-6 sm:mb-8 max-w-2xl mx-auto px-4">
              Generate personalized children's storybooks with beautiful illustrations, 
              ready for reading or professional printing
            </p>
          </div>
          {/* Decorative gradient overlay */}
          <div className="absolute inset-0 bg-gradient-to-b from-transparent to-background/20" />
        </div>
      )}

      {/* Header */}
      <header className="border-b bg-background/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 sm:py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 sm:gap-3">
              <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-gradient-warm flex items-center justify-center">
                <span className="text-white font-bold text-base sm:text-lg">S</span>
              </div>
              <h1 className="text-lg sm:text-xl font-display font-bold">Storybook Generator</h1>
            </div>
            
            {/* Step indicator */}
            <div className="flex items-center gap-1 sm:gap-2">
              {['Setup', 'Preview', 'Edit', 'Export'].map((step, index) => {
                const stepNames = ['setup', 'preview', 'edit', 'export'];
                const isActive = stepNames[index] === currentStep;
                const isComplete = stepNames.indexOf(currentStep) > index;
                
                return (
                  <div
                    key={step}
                    className={`
                      px-2 sm:px-3 py-1 rounded-full text-xs sm:text-sm font-medium transition-all
                      ${isActive 
                        ? 'bg-primary text-primary-foreground' 
                        : isComplete 
                        ? 'bg-story-nature text-white' 
                        : 'bg-muted text-muted-foreground'
                      }
                    `}
                  >
                    <span className="hidden sm:inline">{step}</span>
                    <span className="sm:hidden">{step.charAt(0)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="py-6 sm:py-8">
        {currentStep === 'setup' && (
          <SetupForm
            config={config}
            onConfigChange={updateConfig}
            onNext={handleNext}
            canProceed={canProceedToNext()}
          />
        )}
        
        {currentStep === 'preview' && (
          <PreviewGenerate
            config={config}
            onConfigChange={updateConfig}
            onNext={handleNext}
            onBack={handleBack}
          />
        )}
        
        {currentStep === 'edit' && (
          <PageEditor
            config={config}
            onConfigChange={updateConfig}
            onNext={handleNext}
            onBack={handleBack}
          />
        )}

        {currentStep === 'export' && (
          <ExportPanel
            config={config}
            onConfigChange={updateConfig}
            onBack={handleBack}
          />
        )}
      </main>

      {/* Footer */}
      <footer className="border-t bg-background/50 py-6 sm:py-8 mt-12 sm:mt-16">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 text-center text-muted-foreground">
          <p className="text-sm sm:text-base">Create magical stories that bring joy to children's reading time</p>
        </div>
      </footer>
    </div>
  );
};