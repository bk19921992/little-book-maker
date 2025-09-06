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
        setStep('export');
        break;
      case 'export':
        setStep('print');
        break;
    }
  };

  const handleBack = () => {
    switch (currentStep) {
      case 'preview':
        setStep('setup');
        break;
      case 'export':
        setStep('preview');
        break;
      case 'print':
        setStep('export');
        break;
    }
  };

  return (
    <div className="min-h-screen bg-gradient-soft">
      {/* Hero Section - Only show on setup */}
      {currentStep === 'setup' && (
        <div className="relative overflow-hidden bg-gradient-story">
          <div className="max-w-6xl mx-auto px-6 py-16 text-center">
            <div className="mb-8">
              <img
                src={heroImage}
                alt="Magical storybook coming to life"
                className="w-full max-w-2xl mx-auto rounded-2xl shadow-[var(--shadow-story)] animate-gentle-bounce"
              />
            </div>
            <h1 className="text-5xl md:text-6xl font-display font-bold text-white mb-4">
              Create Magical Stories
            </h1>
            <p className="text-xl text-white/90 mb-8 max-w-2xl mx-auto">
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
        <div className="max-w-6xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-gradient-warm flex items-center justify-center">
                <span className="text-white font-bold text-lg">S</span>
              </div>
              <h1 className="text-xl font-display font-bold">Storybook Generator</h1>
            </div>
            
            {/* Step indicator */}
            <div className="flex items-center gap-2">
              {['Setup', 'Preview', 'Export'].map((step, index) => {
                const stepNames = ['setup', 'preview', 'export'];
                const isActive = stepNames[index] === currentStep;
                const isComplete = stepNames.indexOf(currentStep) > index;
                
                return (
                  <div
                    key={step}
                    className={`
                      px-3 py-1 rounded-full text-sm font-medium transition-all
                      ${isActive 
                        ? 'bg-primary text-primary-foreground' 
                        : isComplete 
                        ? 'bg-story-nature text-white' 
                        : 'bg-muted text-muted-foreground'
                      }
                    `}
                  >
                    {step}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="py-8">
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
        
        {currentStep === 'export' && (
          <PageEditor
            config={config}
            onConfigChange={updateConfig}
            onNext={handleNext}
            onBack={handleBack}
          />
        )}
      </main>

      {/* Footer */}
      <footer className="border-t bg-background/50 py-8 mt-16">
        <div className="max-w-6xl mx-auto px-6 text-center text-muted-foreground">
          <p>Create magical stories that bring joy to children's reading time</p>
        </div>
      </footer>
    </div>
  );
};