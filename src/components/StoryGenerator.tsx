import React, { useEffect, useRef, useState } from 'react';
import { BookOpen, LogOut } from 'lucide-react';
import { useAppState } from '../state';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { clearCheckpoint, loadCheckpoint, type GenerationCheckpoint } from '../lib/generationCheckpoint';
import { saveBook } from '../lib/savedBooks';
import { supabase } from '@/integrations/supabase/client';
import { MyBooks } from './MyBooks';
import type { StoryConfig } from '../types';
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
    resetState,
  } = useAppState();
  const { user, signOut } = useAuth();

  const { currentStep, config } = state;

  // A book whose illustrations were still being made when the page closed
  // or reloaded (see lib/generationCheckpoint.ts).
  const [savedBook, setSavedBook] = useState<GenerationCheckpoint | null>(() => loadCheckpoint());
  const [resuming, setResuming] = useState<GenerationCheckpoint | null>(null);
  const resumeSavedBook = () => {
    if (!savedBook) return;
    updateConfig(savedBook.config);
    setResuming(savedBook);
    setSavedBook(null);
    setStep('preview');
  };
  const discardSavedBook = () => {
    clearCheckpoint();
    setSavedBook(null);
  };

  // My books: reopen a saved book in the editor, replacing whatever is open.
  const [myBooksOpen, setMyBooksOpen] = useState(false);
  const openSavedBook = (book: StoryConfig) => {
    updateConfig({ ...book, exports: undefined, coverImageUrl: book.coverImageUrl, coverImageReview: book.coverImageReview });
    setStep('edit');
  };

  // Autosave while editing and exporting (text edits, redone pictures), so
  // the book on the account matches what the customer sees. Debounced; the
  // export step also saves explicitly before checkout.
  const lastSaved = useRef<string>('');
  useEffect(() => {
    if (!user || !config.storyId || !config.pages?.length) return;
    if (currentStep !== 'edit' && currentStep !== 'export') return;
    // Cheap change fingerprint: text plus each picture's length and tail.
    const pic = (url?: string) => (url ? `${url.length}:${url.slice(-24)}` : '');
    const snapshot = JSON.stringify([config.storyId, config.pages.map((p) => [p.page, p.text, pic(p.imageUrl), p.imageLocked]), pic(config.coverImageUrl)]);
    if (snapshot === lastSaved.current) return;
    const timer = setTimeout(() => {
      saveBook(supabase, user.id, config)
        .then(() => { lastSaved.current = snapshot; })
        .catch((error) => console.error('Autosave failed', error));
    }, 1500);
    return () => clearTimeout(timer);
  }, [user, config, currentStep]);

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
      <header className="border-b bg-background/80 backdrop-blur-sm sm:sticky sm:top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 sm:py-4">
          <div className="flex flex-wrap items-center justify-between gap-3 sm:gap-4">
            <div className="flex items-center gap-2 sm:gap-3">
              <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-gradient-warm flex items-center justify-center">
                <span className="text-white font-bold text-base sm:text-lg">S</span>
              </div>
              <h1 className="text-lg sm:text-xl font-display font-bold">Storybook Generator</h1>
            </div>

            {user && (
              <div className="flex items-center gap-2 sm:gap-3 w-full sm:w-auto justify-between sm:justify-start">
                <Button variant="outline" size="sm" onClick={() => setMyBooksOpen(true)} className="flex items-center gap-2">
                  <BookOpen className="w-4 h-4" />
                  My books
                </Button>
                <div className="hidden sm:block text-xs sm:text-sm text-muted-foreground text-right min-w-0">
                  <div className="font-medium text-foreground truncate max-w-[14rem]">{user.email}</div>
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
            <div className="flex items-center gap-1 sm:gap-2 w-full sm:w-auto">
              {['Setup', 'Preview', 'Edit', 'Export'].map((step, index) => {
                const stepNames = ['setup', 'preview', 'edit', 'export'];
                const isActive = stepNames[index] === currentStep;
                const isComplete = stepNames.indexOf(currentStep) > index;
                
                return (
                  <div
                    key={step}
                    className={`
                      flex-1 sm:flex-none text-center px-2 sm:px-3 py-1.5 rounded-full text-xs sm:text-sm font-medium transition-all
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

      {user && (
        <MyBooks open={myBooksOpen} userId={user.id} onOpenChange={setMyBooksOpen} onOpenBook={openSavedBook} />
      )}

      {/* Main Content */}
      <main className="py-6 sm:py-8">
        {currentStep === 'setup' && savedBook && (
          <div className="max-w-4xl mx-auto px-4 sm:px-6 mb-6">
            <Alert>
              <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
                <span>
                  Your book{savedBook.config.children?.length ? ` for ${savedBook.config.children.join(' & ')}` : ''} was still being illustrated. Pick up where it left off?
                </span>
                <span className="flex gap-2">
                  <Button size="sm" onClick={resumeSavedBook}>Resume</Button>
                  <Button size="sm" variant="outline" onClick={discardSavedBook}>Discard</Button>
                </span>
              </AlertDescription>
            </Alert>
          </div>
        )}
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
            resume={resuming}
            onResumeHandled={() => setResuming(null)}
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
            onReset={resetState}
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
