import {ScenePlanRepair} from './ScenePlanRepair';
import {sceneLedgerIssues} from '../../supabase/functions/_shared/sceneLedger';
import React, { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, BookOpen, Image, Sparkles, CheckCircle, AlertCircle } from 'lucide-react';
import { StoryConfig, StoryPage, StoryOutline, StyleBible, PageSizePreset, PageLayout, OutlineItem } from '../types';
import { api } from '../api';
import { pagesNeedingTextFix, validateStoryConfig } from '../lib/validation';
import { toast } from 'sonner';
import { andList, coverFallbackNote, resolveAutoFormat } from '../lib/format';
import { imageConfig } from '../lib/imageRequest';
import { applyJobItems, finishedBookConfig, illustrationTracker, runImageJob } from '../lib/imageJob';
import { CheckoutSheet } from './CheckoutSheet';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { clearCheckpoint, saveCheckpoint, type GenerationCheckpoint } from '../lib/generationCheckpoint';
import { saveBook } from '../lib/savedBooks';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/context/AuthContext';

interface PreviewGenerateProps {
  config: StoryConfig;
  onConfigChange: (updates: Partial<StoryConfig>) => void;
  onNext: () => void;
  onBack: () => void;
  // A book whose illustrations were still being made when the page was
  // reloaded: continue its job instead of starting again.
  resume?: GenerationCheckpoint | null;
  onResumeHandled?: () => void;
}

type GenerationStep = 'idle' | 'planning' | 'writing' | 'images' | 'complete';

export const PreviewGenerate: React.FC<PreviewGenerateProps> = ({
  config,
  onConfigChange,
  onNext,
  onBack,
  resume,
  onResumeHandled,
}) => {
  const [currentStep, setCurrentStep] = useState<GenerationStep>('idle');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [startTime, setStartTime] = useState<number>(0);
  const [estimatedTimeRemaining, setEstimatedTimeRemaining] = useState<string>('');
  const [isGenerating, setIsGenerating] = useState(false);
  // Set while an illustration job is unfinished, so a lost connection can
  // be resumed without starting (or paying for) the book again.
  const { user } = useAuth();
  const [showBookCheckout, setShowBookCheckout] = useState(false);
  const [pendingJob, setPendingJob] = useState<{ jobId: string; book: StoryConfig } | null>(null);
  // Set when the illustration job finished with pictures missing: the way
  // forward is the editor's regenerate, not a "complete" claim.
  const [incompleteMissing, setIncompleteMissing] = useState<string[] | null>(null);

  const updateProgress = (newProgress: number) => {
    setProgress(newProgress);
    // Simple estimation based on typical generation times
    if (newProgress > 0 && newProgress < 100) {
      const estimates = {
        5: '2-3 minutes', // planning
        25: '1-2 minutes', // writing  
        70: '30-60 seconds', // images
        100: 'Complete!'
      };
      const currentEstimate = Object.entries(estimates)
        .reverse()
        .find(([threshold]) => newProgress >= parseInt(threshold));
      
      if (currentEstimate) {
        setEstimatedTimeRemaining(currentEstimate[1]);
      }
    } else {
      setEstimatedTimeRemaining('');
    }
  };

  const generateStory = async (useSavedPlan = false) => {
    try {
      // Validate config first
      const validationErrors = validateStoryConfig(config);
      if (validationErrors.length > 0) {
        const errorMessages = validationErrors.map(e => e.message).join(', ');
        setError(`Please fix these issues: ${errorMessages}`);
        toast.error('Please complete the setup form');
        return;
      }

      setError(null);
      setIncompleteMissing(null);
      setStartTime(Date.now());
      setCurrentStep('planning');
      setIsGenerating(true);
      updateProgress(5);

      // Give this book an id up front - billing, export and (later) saving
      // key off it. Without it checkout cannot run and export refuses.
      const storyId = config.storyId || crypto.randomUUID();
      onConfigChange({ storyId });

      // Step 1: Plan the story
      toast.info('Planning your story...');
      const draft=useSavedPlan ? config.scenePlanDraft : undefined;
      if(useSavedPlan && (!draft || sceneLedgerIssues(draft.outline.sceneLedger,config.lengthPages).length)) throw new Error('Repair the saved scene plan before continuing. No planner call made.');
      const planResponse = draft || await api.planStory(config, storyId);
      if ('needsSceneRepair' in planResponse && planResponse.needsSceneRepair) {
        const next={...config,storyId,scenePlanDraft:{outline:planResponse.outline,styleBible:planResponse.styleBible,format:planResponse.format,issues:planResponse.issues || []}};
        onConfigChange({storyId,scenePlanDraft:next.scenePlanDraft});
        if(user)await saveBook(supabase,user.id,next);
        setError('Scene plan saved for local repair. No writing, illustration or automatic paid retry started.');setIsGenerating(false);setCurrentStep('idle');return;
      }

      // Auto format mode: the planner (or a per-book fallback heuristic) picks
      // the shape and layout for this particular story. Resolve it now and use
      // the resolved values for everything downstream in this run, since the
      // config state update above is async.
      let effectivePageSize = config.pageSize;
      let effectivePageLayout = config.pageLayout;
      const formatUpdates: { pageSize?: PageSizePreset; pageLayout?: PageLayout; formatReason?: string | null } = {};
      if (config.formatMode === 'auto') {
        const resolved = resolveAutoFormat(config, planResponse.format);
        effectivePageSize = resolved.pageSize;
        effectivePageLayout = resolved.pageLayout;
        formatUpdates.pageSize = resolved.pageSize;
        formatUpdates.pageLayout = resolved.pageLayout;
        formatUpdates.formatReason = resolved.reason;
        toast.info(`AI picked ${resolved.pageSize} with ${resolved.pageLayout === 'overlay' ? 'full-page pictures' : 'split pages'} for this story`);
      }

      onConfigChange({
        styleBible: planResponse.styleBible,
        outline: planResponse.outline,
        ...formatUpdates,
      });

      updateProgress(25);
      setCurrentStep('writing');

      // Step 2: Write the story (optimized for speed)
      toast.info(`Writing ${config.lengthPages} pages...`);
      
      // Update progress incrementally during writing
      // Send the resolved format: story-write sizes each page's copy to the
      // text band of the page shape actually being printed. (`config` here is
      // this render's snapshot, before the auto-format update above lands.)
      const writeResponse = await api.writeStory(
        { ...config, pageSize: effectivePageSize, pageLayout: effectivePageLayout },
        planResponse.outline,
        storyId
      );
      
      onConfigChange({
        pages: writeResponse.pages,
      });

      updateProgress(70);
      setCurrentStep('images');

      // Step 3: Illustrations, as a durable server-side job: one image
      // attempt per call, so no request hits the edge time limit, and the
      // job survives dropped connections and page reloads.
      // Build a quick lookup for outline data
      const outlineByPage = new Map<number, OutlineItem>(planResponse.outline.pages.map((p: OutlineItem) => [p.page, p]));
      const imagePrompts = writeResponse.pages
        .filter((p) => p && p.page !== undefined)
        .map((p) => {
          const outline = outlineByPage.get(p.page) || ({} as Partial<OutlineItem>);
          return {
            page: p.page,
            prompt: outline.imagePrompt || outline.visualBrief || 'storybook scene',
            text: p.text,
            visualBrief: outline.visualBrief,
          };
        });

      const book: StoryConfig = {
        ...config,
        ...formatUpdates,
        storyId,
        pageSize: effectivePageSize,
        pageLayout: effectivePageLayout,
        scenePlanDraft: undefined,
        styleBible: planResponse.styleBible,
        outline: planResponse.outline,
        pages: writeResponse.pages,
      };
      // Text that still breaks the text contract is a draft, not a basis for
      // paid illustrations: the customer must fix the wording first, and
      // those edits would change the text the pictures were prompted and
      // reviewed against. Keep the draft, flag the pages and go straight to
      // the editor (the same contract gates export there, and the pictures
      // can be generated once the wording passes). No paid image job starts.
      const textFixPages = pagesNeedingTextFix(writeResponse.pages, config.readingLevel, effectivePageSize);
      if (textFixPages.length) {
        onConfigChange(book);
        if (user) {
          saveBook(supabase, user.id, book).catch((saveError) => console.error('Saving the draft failed', saveError));
        }
        toast.warning(`The wording on page${textFixPages.length > 1 ? 's' : ''} ${textFixPages.join(', ')} needs a quick fix before we draw. Your story is saved - fix the wording in the editor, then generate the pictures there.`);
        setIsGenerating(false);
        // The paid flow stops here; the editor route replaces this screen.
        // If that navigation is ever delayed, nothing left behind may claim
        // work is still coming: no spinner, no countdown.
        setCurrentStep('idle');
        setProgress(0);
        setEstimatedTimeRemaining('');
        onNext();
        return;
      }
      toast.info('Creating AI illustrations...');
      const { jobId } = await api.startImageJob(effectivePageSize, effectivePageLayout, imagePrompts, true, imageConfig(book), storyId, undefined, planResponse.outline.sceneLedger);
      saveCheckpoint(jobId, book);
      await illustrate(jobId, book);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to generate story';
      setError(errorMessage);
      if (errorMessage.includes('Payment required to create another book.')) setShowBookCheckout(true);
      else toast.error(errorMessage);
      setCurrentStep('idle');
      setProgress(0);
      setEstimatedTimeRemaining('');
    }
    setIsGenerating(false);
  };

  // Drive an illustration job to completion and merge its pictures into the
  // book. Used for a fresh book and for resuming one.
  const illustrate = async (jobId: string, book: StoryConfig) => {
    const pages = book.pages || [];
    const total = pages.length + 1; // + cover
    const tracker = illustrationTracker(total);
    setPendingJob({ jobId, book });
    setCurrentStep('images');
    setProgress(70);
    setEstimatedTimeRemaining(`0 of ${total} illustrations finished`);
    try {
      const items = await runImageJob(api, jobId, {
        onItem: (item) => {
          tracker.onItem(item);
          setProgress(70 + Math.round((tracker.finished / total) * 29));
          setEstimatedTimeRemaining(tracker.label());
        },
      });
      const result = applyJobItems(pages, items);
      const failedPageLabels = result.failedPages.map((p) => `page ${p}`);
      const failureNotes: string[] = [];
      if (failedPageLabels.length) {
        failureNotes.push(`The illustration${failedPageLabels.length > 1 ? 's' : ''} for ${andList(failedPageLabels)} didn't pass our quality check - regenerate ${failedPageLabels.length > 1 ? 'them' : 'it'} from the editor.`);
      }
      if (result.coverFailed) {
        // The editor has no cover regeneration; the export's intentional
        // fallback composes the cover from the first illustrated page - so
        // only promise it when a page picture actually exists to reuse.
        failureNotes.push(`The cover didn't pass - ${coverFallbackNote(result.pages.some((p) => p.imageUrl && !p.imageLocked))}.`);
      }
      if (failureNotes.length) toast.warning(failureNotes.join(' '));
      // The run's accepted cover REPLACES the book's lettering style (or
      // clears it when the selector was off/unavailable): an inherited style
      // must never describe new art. Page-only runs keep the existing style.
      const finishedBook: StoryConfig = finishedBookConfig(book, result);
      onConfigChange(finishedBook);
      clearCheckpoint();
      // Keep the finished book on the customer's account (My books).
      if (user) {
        saveBook(supabase, user.id, finishedBook).catch((saveError) => {
          console.error('Saving the book failed', saveError);
          toast.warning("Your book is ready, but we couldn't save it to your account yet. We'll try again as you edit.");
        });
      }
      setPendingJob(null);
      if (result.failedPages.length || result.coverFailed) {
        // Explicit incomplete state: the book is saved and editable, but it
        // is not ready. Progress stays where the pictures actually are - no
        // 100%, no completed step, no success toast - and the way forward is
        // the editor's regenerate (button below), not a false finish line.
        const missing = [
          ...(result.coverFailed ? ['the cover'] : []),
          ...result.failedPages.map((p) => `page ${p}`),
        ];
        setIncompleteMissing(missing);
        // Terminal stopped state: no work is still running, so no step may
        // keep spinning (getStepStatus treats this as stopped below).
        const missingBits: string[] = [];
        if (result.failedPages.length) {
          missingBits.push(`${andList(result.failedPages.map((p) => `page ${p}`))} still need${result.failedPages.length > 1 ? '' : 's'} an illustration - regenerate in the editor`);
        }
        if (result.coverFailed) missingBits.push(coverFallbackNote(result.pages.some((p) => p.imageUrl && !p.imageLocked)));
        setEstimatedTimeRemaining(`Almost there - ${missingBits.join('; ')}.`);
      } else {
        setIncompleteMissing(null);
        updateProgress(100);
        setCurrentStep('complete');
        setEstimatedTimeRemaining('Complete!');
        toast.success('Your story is ready!');
      }
    } catch (err) {
      // The job and its finished pictures are safe on the server; keep the
      // checkpoint so the customer can resume instead of starting again.
      const message = "We lost contact while drawing your pictures. Your progress is saved - press Resume illustrations to carry on.";
      console.error('Illustration job interrupted', err);
      setError(message);
      toast.error(message);
      setCurrentStep('idle');
    }
  };

  const resumeIllustrations = async () => {
    if (!pendingJob) return;
    setError(null);
    setIncompleteMissing(null);
    setIsGenerating(true);
    await illustrate(pendingJob.jobId, pendingJob.book);
    setIsGenerating(false);
  };

  // Resume after a reload: StoryGenerator restored the book's text from the
  // checkpoint; continue the same job.
  useEffect(() => {
    if (!resume) return;
    onResumeHandled?.();
    setStartTime(Date.now());
    setError(null);
    setIncompleteMissing(null);
    setIsGenerating(true);
    toast.info('Picking up your illustrations where they left off...');
    illustrate(resume.jobId, resume.config).finally(() => setIsGenerating(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resume]);

  const getStepStatus = (step: GenerationStep) => {
    const stepOrder: GenerationStep[] = ['planning', 'writing', 'images', 'complete'];
    // A job that ended with missing pictures is stopped, not mid-generation:
    // planning/writing read complete, illustrations read not-yet-done, and
    // nothing spins.
    const stopped = !!incompleteMissing && !isGenerating;
    const currentIndex = stepOrder.indexOf(stopped ? 'images' : currentStep);
    const stepIndex = stepOrder.indexOf(step);

    if (stepIndex < currentIndex) return 'complete';
    if (!stopped && stepIndex === currentIndex) return 'current';
    return 'pending';
  };

  const canProceed = currentStep === 'complete' && config.pages && config.pages.length > 0;

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-8 animate-fade-in">
      <div className="text-center space-y-4">
        <h1 className="text-4xl font-display font-bold text-gradient">
          Generate Your Story
        </h1>
        <p className="text-lg text-muted-foreground">
          Let's bring your story to life with words and pictures
        </p>
      </div>

      {(config.scenePlanDraft || config.outline) && <ScenePlanRepair config={config} onConfigChange={onConfigChange} />}
      {config.scenePlanDraft && <Button disabled={isGenerating || sceneLedgerIssues(config.scenePlanDraft.outline.sceneLedger,config.lengthPages).length>0} onClick={()=>void generateStory(true)}>Continue saved plan: write text and create illustrations</Button>}
      {/* Story Configuration Summary */}
      <Card className="story-card">
        <CardHeader>
          <CardTitle>Story Configuration</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <div className="space-y-4">
              <h4 className="font-semibold text-primary">Basic Details</h4>
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-sm font-medium">Children:</span>
                  <span className="text-sm text-muted-foreground">
                    {config.children.length > 0 ? config.children.join(', ') : 'Generic hero'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm font-medium">Story Type:</span>
                  <span className="text-sm text-muted-foreground">{config.storyType}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm font-medium">Setting:</span>
                  <span className="text-sm text-muted-foreground">{config.setting}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm font-medium">Theme:</span>
                  <span className="text-sm text-muted-foreground">{config.themePreset || config.themeCustom || 'Custom'}</span>
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <h4 className="font-semibold text-primary">Story Settings</h4>
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-sm font-medium">Length:</span>
                  <span className="text-sm text-muted-foreground">{config.lengthPages} pages</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm font-medium">Reading Level:</span>
                  <span className="text-sm text-muted-foreground">{config.readingLevel}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm font-medium">Narration Style:</span>
                  <span className="text-sm text-muted-foreground">{config.narrationStyle}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm font-medium">Educational Focus:</span>
                  <span className="text-sm text-muted-foreground">{config.educationalFocus || 'None'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm font-medium">Image Style:</span>
                  <span className="text-sm text-muted-foreground">
                    {typeof config.imageStyle === 'string' ? config.imageStyle : config.imageStyle?.other || 'Custom'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm font-medium">Page Size:</span>
                  <span className="text-sm text-muted-foreground">
                    {config.pageSize}{config.formatMode === 'auto' && config.formatReason ? ' (AI picked)' : ''}
                  </span>
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <h4 className="font-semibold text-primary">Personal Details</h4>
              <div className="space-y-2">
                {config.personal.town && (
                  <div className="flex justify-between">
                    <span className="text-sm font-medium">Town:</span>
                    <span className="text-sm text-muted-foreground">{config.personal.town}</span>
                  </div>
                )}
                {config.personal.favouriteToy && (
                  <div className="flex justify-between">
                    <span className="text-sm font-medium">Favorite Toy:</span>
                    <span className="text-sm text-muted-foreground">{config.personal.favouriteToy}</span>
                  </div>
                )}
                {config.personal.favouriteColour && (
                  <div className="flex justify-between">
                    <span className="text-sm font-medium">Favorite Color:</span>
                    <span className="text-sm text-muted-foreground">{config.personal.favouriteColour}</span>
                  </div>
                )}
                {config.personal.pets && (
                  <div className="flex justify-between">
                    <span className="text-sm font-medium">Pets:</span>
                    <span className="text-sm text-muted-foreground">{config.personal.pets}</span>
                  </div>
                )}
                {config.personal.dedication && (
                  <div className="flex justify-between">
                    <span className="text-sm font-medium">Dedication:</span>
                    <span className="text-sm text-muted-foreground italic">"{config.personal.dedication}"</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="mt-6 space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="font-semibold text-primary">Characters & Color Palette</h4>
            </div>
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <span className="text-sm font-medium">Characters:</span>
                {config.characters.map((character, index) => (
                  <Badge key={index} variant="secondary">{character}</Badge>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">Color Palette:</span>
                {config.palette.map((color, index) => (
                  <div key={index} className="flex items-center gap-1">
                    <div 
                      className="w-4 h-4 rounded border" 
                      style={{ backgroundColor: color }}
                    />
                    <span className="text-xs text-muted-foreground">{color}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Generation Progress */}
      {currentStep !== 'idle' && (
        <Card className="story-card border-primary/20">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-primary animate-pulse" />
              Generating Your Story
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <div className="flex justify-between gap-4 text-sm">
                <span className="shrink-0">Progress</span>
                <div className="text-right min-w-0 break-words">
                  <span>{progress}%</span>
                  {estimatedTimeRemaining && (
                    <div className="text-xs text-muted-foreground mt-1">
                      {estimatedTimeRemaining}
                    </div>
                  )}
                </div>
              </div>
              <Progress value={progress} className="h-3" />
            </div>

            <div className="grid gap-4">
              {/* Planning Step */}
              <div className="flex items-center gap-3">
                {getStepStatus('planning') === 'complete' ? (
                  <CheckCircle className="w-5 h-5 text-story-nature" />
                ) : getStepStatus('planning') === 'current' ? (
                  <Loader2 className="w-5 h-5 text-primary animate-spin" />
                ) : (
                  <div className="w-5 h-5 rounded-full border-2 border-muted" />
                )}
                <div>
                  <div className="font-medium">Planning Story</div>
                  <div className="text-sm text-muted-foreground">
                    Creating outline and style guide
                  </div>
                </div>
              </div>

              {/* Writing Step */}
              <div className="flex items-center gap-3">
                {getStepStatus('writing') === 'complete' ? (
                  <CheckCircle className="w-5 h-5 text-story-nature" />
                ) : getStepStatus('writing') === 'current' ? (
                  <Loader2 className="w-5 h-5 text-primary animate-spin" />
                ) : (
                  <div className="w-5 h-5 rounded-full border-2 border-muted" />
                )}
                <div>
                  <div className="font-medium">Writing Pages</div>
                  <div className="text-sm text-muted-foreground">
                    Crafting {config.lengthPages} pages of story
                  </div>
                </div>
              </div>

              {/* Images Step */}
              <div className="flex items-center gap-3">
                {getStepStatus('images') === 'complete' ? (
                  <CheckCircle className="w-5 h-5 text-story-nature" />
                ) : getStepStatus('images') === 'current' ? (
                  <Loader2 className="w-5 h-5 text-primary animate-spin" />
                ) : (
                  <div className="w-5 h-5 rounded-full border-2 border-muted" />
                )}
                <div>
                  <div className="font-medium">Creating Illustrations</div>
                  <div className="text-sm text-muted-foreground">
                    Generating beautiful {typeof config.imageStyle === 'string' ? config.imageStyle.toLowerCase() : 'custom'} artwork
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Error Display */}
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Story Preview */}
      {config.pages && config.pages.length > 0 && (
        <Card className="story-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BookOpen className="w-5 h-5 text-primary" />
              Story Preview
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-6">
              {config.pages.slice(0, 3).map((page, index) => (
                <div key={page.page} className="border rounded-xl p-3 sm:p-6 space-y-4 bg-gradient-to-br from-background to-muted/30 shadow-sm">
                  <div className="flex items-center justify-between">
                    <Badge variant="outline" className="text-sm font-medium">Page {page.page}</Badge>
                    <div className="flex items-center gap-2">
                      {page.imageUrl && (
                        <Badge variant="secondary" className="flex items-center gap-1">
                          <Image className="w-3 h-3" />
                          Illustration ready
                        </Badge>
                      )}
                    </div>
                  </div>
                  
                  {page.imageUrl && (
                    <div className="rounded-lg overflow-hidden shadow-md border bg-white">
                      <img
                        src={page.imageUrl}
                        alt={`Illustration for page ${page.page}`}
                        className="w-full h-56 object-contain"
                      />
                    </div>
                  )}
                  
                  <div className="text-sm leading-relaxed text-foreground bg-background/80 p-4 rounded-lg border">
                    <div className="font-medium mb-2 text-primary">Page {page.page} Text:</div>
                    {page.text.substring(0, 300)}
                    {page.text.length > 300 && '...'}
                  </div>
                </div>
              ))}
              {config.pages.length > 3 && (
                <div className="text-center text-muted-foreground bg-muted/50 p-4 rounded-lg">
                  ... and {config.pages.length - 3} more pages ready for editing
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog open={showBookCheckout} onOpenChange={setShowBookCheckout}>
        <DialogContent>
          <DialogHeader><DialogTitle>Create another book</DialogTitle></DialogHeader>
          <CheckoutSheet
            item="export"
            storyId={config.storyId}
            onSuccess={() => { setShowBookCheckout(false); void generateStory(!!config.scenePlanDraft); }}
            onCancel={() => setShowBookCheckout(false)}
          />
        </DialogContent>
      </Dialog>

      {/* Action Buttons */}
      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
        <Button variant="outline" onClick={onBack} className="w-full sm:w-auto">
          Back to Setup
        </Button>
        
        <div className="flex flex-col gap-3 sm:flex-row">
          {currentStep === 'idle' && pendingJob && (
            <Button
              onClick={resumeIllustrations}
              size="lg"
              className="px-4 sm:px-8 py-3 text-base sm:text-lg font-medium w-full sm:w-auto"
              disabled={isGenerating}
            >
              <Image className="w-5 h-5 mr-2" />
              Resume illustrations
            </Button>
          )}

          {currentStep === 'idle' && !pendingJob && !config.scenePlanDraft && (
            <Button
              onClick={()=>void generateStory()}
              size="lg"
              className="px-8 py-3 text-lg font-medium animate-gentle-bounce"
              disabled={isGenerating}
            >
              <Sparkles className="w-5 h-5 mr-2" />
              Generate Story
            </Button>
          )}
          
          {incompleteMissing && !isGenerating && (
            <Button
              onClick={onNext}
              size="lg"
              className="px-4 sm:px-8 py-3 text-base sm:text-lg font-medium w-full sm:w-auto"
            >
              <BookOpen className="w-5 h-5 mr-2" />
              Fix in the editor
            </Button>
          )}

          {canProceed && (
            <Button
              onClick={onNext}
              size="lg"
              className="px-4 sm:px-8 py-3 text-base sm:text-lg font-medium w-full sm:w-auto"
            >
              Edit & Export
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};
