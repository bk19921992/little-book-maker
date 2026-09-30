import React, { useEffect, useState } from 'react';
import { loadCheckpoint, type GenerationCheckpoint } from '../lib/generationCheckpoint';
import { LogOut } from 'lucide-react';
import { useAppState } from '../state';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';
import { SetupForm } from './SetupForm';
import { PreviewGenerate } from './PreviewGenerate';
import { PageEditor } from './PageEditor';
import { ExportPanel } from './ExportPanel';
import heroImage from '../assets/storybook-hero.jpg';
import { loadEditorRedo, type PendingEditorRedo } from '../lib/editorRedo';

export const StoryGenerator: React.FC = () => {
  const [resume, setResume] = useState<GenerationCheckpoint | null>(null);
  const [pendingRedo, setPendingRedo] = useState<PendingEditorRedo | null>(null);
  const [loadingRedo, setLoadingRedo] = useState(true);
  const [redoStorageFailed, setRedoStorageFailed] = useState(false);
  const {
    state,
    updateConfig,
    setStep,
    canProceedToNext,
    resetState,
  } = useAppState();
  const { user, signOut } = useAuth();
  const userId = user?.id;

  const { currentStep, config } = state;

  useEffect(() => {
    let mounted = true;
    if (!userId) { setResume(null); setPendingRedo(null); setRedoStorageFailed(false); setLoadingRedo(false); return; }
    setResume(loadCheckpoint(userId));
    setLoadingRedo(true);
    loadEditorRedo().then((redo) => {
      if (mounted) { setRedoStorageFailed(false); setPendingRedo(redo?.userId === userId ? redo : null); }
    }).catch(() => {
      if (mounted) { setPendingRedo(null); setRedoStorageFailed(true); }
    }).finally(() => { if (mounted) setLoadingRedo(false); });
    return () => { mounted = false; };
  }, [userId]);

  const resetStory = () => {
    if (redoStorageFailed) return;
    if (pendingRedo) { updateConfig(pendingRedo.book); setStep('edit'); return; }
    // Do not drop the only ID for an in-flight or lost-response image job.
    const pending = userId ? loadCheckpoint(userId) : null;
    if (pending) {
      setResume(pending);
      setStep('preview');
      return;
    }
    setResume(null);
    resetState();
  };

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
          <div className="flex flex-wrap items-center justify-between gap-3 sm:gap-4">
            <div className="flex items-center gap-2 sm:gap-3">
              <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-gradient-warm flex items-center justify-center">
                <span className="text-white font-bold text-base sm:text-lg">S</span>
              </div>
              <h1 className="text-lg sm:text-xl font-display font-bold">Storybook Generator</h1>
            </div>

            {user && (
              <div className="flex items-center gap-3">
                <div className="text-xs sm:text-sm text-muted-foreground text-right">
                  <div className="font-medium text-foreground">{user.email}</div>
                  <div>Signed in</div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => signOut().catch((err) => console.error('Failed to sign out', err))}
                  className="flex items-center gap-2"
                >
                  <LogOut className="w-4 h-4" />
                  Sign out
                </Button>
              </div>
            )}

            {/* Step indicator */}
            <div className="flex flex-wrap items-center gap-1 sm:gap-2 w-full sm:w-auto">
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
        {currentStep === 'setup' && redoStorageFailed && (
          <div className="max-w-4xl mx-auto px-6">Saved illustration progress is unavailable on this device. Please restore site storage before starting another book.</div>
        )}
        {currentStep === 'setup' && pendingRedo && (
          <div className="max-w-4xl mx-auto px-6"><Button onClick={() => { updateConfig(pendingRedo.book); setStep('edit'); }}>Resume page {pendingRedo.pageNumber} illustration</Button></div>
        )}
        {currentStep === 'setup' && resume?.userId === userId && !pendingRedo && (
          <div className="max-w-4xl mx-auto px-6"><Button onClick={() => setStep('preview')}>Resume illustrations</Button></div>
        )}
        {currentStep === 'setup' && !loadingRedo && !redoStorageFailed && !pendingRedo && !resume && (
          <SetupForm
            config={config}
            onConfigChange={updateConfig}
            onNext={handleNext}
            canProceed={canProceedToNext()}
          />
        )}
        
        {currentStep === 'preview' && userId && !redoStorageFailed && !pendingRedo && (
          <PreviewGenerate
            config={config}
            userId={userId}
            onConfigChange={updateConfig}
            onNext={handleNext}
            onBack={handleBack}
            resume={resume?.userId === userId ? resume : null}
            onResumeHandled={() => setResume(null)}
          />
        )}
        
        {currentStep === 'edit' && userId && !loadingRedo && !redoStorageFailed && (
          <PageEditor
            config={config}
            onConfigChange={updateConfig}
            onNext={handleNext}
            onBack={handleBack}
            userId={userId}
            pendingRedo={pendingRedo}
            onPendingRedoChange={setPendingRedo}
          />
        )}

        {currentStep === 'export' && (
          <ExportPanel
            config={config}
            onConfigChange={updateConfig}
            onReset={resetStory}
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
