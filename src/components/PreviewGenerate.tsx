import React, { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, BookOpen, Image, Sparkles, CheckCircle, AlertCircle } from 'lucide-react';
import { StoryConfig, StoryPage, StoryOutline, StyleBible } from '../types';
import { api } from '../api';
import { validateStoryConfig } from '../lib/validation';
import { toast } from 'sonner';
import { applyJobItems, runImageJob } from '../lib/imageJob';
import { imageConfig } from '../lib/imageRequest';
import { saveCheckpoint, clearCheckpoint, loadCheckpoint, type GenerationCheckpoint } from '../lib/generationCheckpoint';

interface PreviewGenerateProps {
  config: StoryConfig;
  userId: string;
  onConfigChange: (updates: Partial<StoryConfig>) => void;
  onNext: () => void;
  onBack: () => void;
  resume?: GenerationCheckpoint | null;
  onResumeHandled?: () => void;
}

type GenerationStep = 'idle' | 'planning' | 'writing' | 'images' | 'complete';

export const PreviewGenerate: React.FC<PreviewGenerateProps> = ({
  config,
  userId,
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
  const [startUncertain, setStartUncertain] = useState(false);
  const [pendingJob, setPendingJob] = useState<GenerationCheckpoint | null>(resume || null);

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

  const generateStory = async () => {
    let uncertainStart = false;
    try {
      const existing = loadCheckpoint(userId);
      if (existing) {
        setPendingJob(existing);
        setError('An illustration job is already saved. Press Resume illustrations instead.');
        return;
      }
      // Validate config first
      const validationErrors = validateStoryConfig(config);
      if (validationErrors.length > 0) {
        const errorMessages = validationErrors.map(e => e.message).join(', ');
        setError(`Please fix these issues: ${errorMessages}`);
        toast.error('Please complete the setup form');
        return;
      }

      setError(null);
      setStartTime(Date.now());
      setCurrentStep('planning');
      setIsGenerating(true);
      updateProgress(5);

      // Step 1: Plan the story
      toast.info('Planning your story...');
      const planResponse = await api.planStory(config);
      
      onConfigChange({
        styleBible: planResponse.styleBible,
        outline: planResponse.outline,
      });

      updateProgress(25);
      setCurrentStep('writing');

      // Step 2: Write the story (optimized for speed)
      toast.info(`Writing ${config.lengthPages} pages...`);
      
      // Update progress incrementally during writing
      const writeResponse = await api.writeStory(config, planResponse.outline);
      
      onConfigChange({
        pages: writeResponse.pages,
      });

      updateProgress(70);
      setCurrentStep('images');

      // Step 3: Generate images (AI-powered illustrations)
      toast.info('Creating AI illustrations...');
      // Build a quick lookup for outline data
      const outlineByPage = new Map(planResponse.outline.pages.map((p) => [p.page, p]));
      const imagePrompts = writeResponse.pages
        .filter((p) => p && p.page !== undefined)
        .map((p) => {
          const outline = outlineByPage.get(p.page) || {} as Partial<StoryOutline['pages'][number]>;
          return {
            page: p.page,
            prompt: outline.imagePrompt || outline.visualBrief || 'storybook scene',
            text: p.text,
            visualBrief: outline.visualBrief,
          };
        });

      const book: StoryConfig = { ...config, styleBible: planResponse.styleBible, outline: planResponse.outline, pages: writeResponse.pages };
      const requestId = crypto.randomUUID();
      if (!saveCheckpoint(userId, requestId, book, imagePrompts)) {
        throw new Error('Local storage is unavailable. Illustrations cannot safely start.');
      }
      setPendingJob({ v: 1, userId, requestId, config: book, prompts: imagePrompts, savedAt: Date.now() });
      let jobId: string;
      try {
        ({ jobId } = await api.startImageJob(requestId, config.pageSize, imagePrompts, imageConfig(book)));
      } catch (startError) {
        uncertainStart = true;
        setStartUncertain(true);
        throw startError;
      }
      saveCheckpoint(userId, requestId, book, imagePrompts, jobId);
      await illustrate(jobId, book, requestId, imagePrompts);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to generate story';
      setError(uncertainStart ? 'Could not confirm the start. Press Resume illustrations to safely reconnect to this book.' : errorMessage);
      toast.error(uncertainStart ? 'Illustration start is uncertain. Please use Resume illustrations.' : errorMessage);
      setCurrentStep('idle');
      setProgress(0);
      setEstimatedTimeRemaining('');
    }
    setIsGenerating(false);
  };

  const illustrate = async (jobId: string, book: StoryConfig, requestId: string, prompts: GenerationCheckpoint['prompts']) => {
    const pages = book.pages || [];
    let finished = 0;
    setPendingJob({ v: 1, userId, jobId, requestId, config: book, prompts, savedAt: Date.now() });
    setCurrentStep('images');
    setProgress(70);
    setEstimatedTimeRemaining('Illustrations in progress');
    try {
      const items = await runImageJob(api, jobId, { onItem: () => {
        finished += 1;
        setProgress(70 + Math.round((finished / pages.length) * 29));
        setEstimatedTimeRemaining(`${finished} of ${pages.length} illustrations finished`);
      } });
      const result = applyJobItems(pages, items);
      if (items.length !== pages.length || items.some(item => item.status !== 'done' && item.status !== 'failed')) {
        throw new Error('Illustration job ended without a final result for every page.');
      }
      if (result.failedPages.length) toast.warning(`Could not create illustrations for pages ${result.failedPages.join(", ")}. You can retry them from the editor.`);
      onConfigChange({ ...book, pages: result.pages });
      clearCheckpoint(userId);
      setPendingJob(null);
      setStartUncertain(false);
      updateProgress(100);
      setCurrentStep('complete');
      toast.success('Your story is ready!');
    } catch (err) {
      console.error('Illustration job interrupted', err);
      setError('We lost contact while drawing your pictures. Your progress is saved. Press Resume illustrations to carry on.');
      setCurrentStep('idle');
    }
  };

  const resumeIllustrations = async () => {
    const pending = pendingJob || loadCheckpoint(userId);
    if (!pending || pending.userId !== userId) return;
    setPendingJob(pending);
    setError(null);
    setIsGenerating(true);
    try {
      const { jobId } = await api.startImageJob(pending.requestId, pending.config.pageSize, pending.prompts, imageConfig(pending.config));
      saveCheckpoint(userId, pending.requestId, pending.config, pending.prompts, jobId);
      await illustrate(jobId, pending.config, pending.requestId, pending.prompts);
    } catch (err) {
      console.error('Could not resume illustration job', err);
      setError('Could not reconnect to your illustrations. Please try Resume illustrations again.');
    }
    setIsGenerating(false);
  };

  useEffect(() => {
    if (!resume) return;
    setPendingJob(resume);
    onResumeHandled?.();
  }, [resume, onResumeHandled]);

  const getStepStatus = (step: GenerationStep) => {
    const stepOrder: GenerationStep[] = ['planning', 'writing', 'images', 'complete'];
    const currentIndex = stepOrder.indexOf(currentStep);
    const stepIndex = stepOrder.indexOf(step);

    if (stepIndex < currentIndex) return 'complete';
    if (stepIndex === currentIndex) return 'current';
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
                  <span className="text-sm text-muted-foreground">{config.pageSize}</span>
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
              <div className="flex justify-between text-sm">
                <span>Progress</span>
                <div className="text-right">
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
                <div key={page.page} className="border rounded-xl p-6 space-y-4 bg-gradient-to-br from-background to-muted/30 shadow-sm">
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

      {/* Action Buttons */}
      <div className="flex justify-between">
        <Button variant="outline" onClick={onBack}>
          Back to Setup
        </Button>
        
        <div className="flex gap-3">
          {(pendingJob || startUncertain) && !isGenerating && (
            <Button onClick={resumeIllustrations} size="lg" disabled={!pendingJob}>Resume illustrations</Button>
          )}
          {currentStep === 'idle' && !pendingJob && !startUncertain && (
            <Button
              onClick={generateStory}
              size="lg"
              className="px-8 py-3 text-lg font-medium animate-gentle-bounce"
              disabled={isGenerating}
            >
              <Sparkles className="w-5 h-5 mr-2" />
              Generate Story
            </Button>
          )}
          
          {canProceed && (
            <Button
              onClick={onNext}
              size="lg"
              className="px-8 py-3 text-lg font-medium"
            >
              Edit & Export
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};
