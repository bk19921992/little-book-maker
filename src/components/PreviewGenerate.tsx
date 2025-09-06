import React, { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, BookOpen, Image, Sparkles, CheckCircle, AlertCircle } from 'lucide-react';
import { StoryConfig, StoryPage, StoryOutline, StyleBible } from '../types';
import { api } from '../api';
import { toast } from 'sonner';

interface PreviewGenerateProps {
  config: StoryConfig;
  onConfigChange: (updates: Partial<StoryConfig>) => void;
  onNext: () => void;
  onBack: () => void;
}

type GenerationStep = 'idle' | 'planning' | 'writing' | 'images' | 'complete';

export const PreviewGenerate: React.FC<PreviewGenerateProps> = ({
  config,
  onConfigChange,
  onNext,
  onBack,
}) => {
  const [currentStep, setCurrentStep] = useState<GenerationStep>('idle');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const generateStory = async () => {
    try {
      setError(null);
      setCurrentStep('planning');
      setProgress(10);

      // Step 1: Plan the story
      toast.info('Planning your story...');
      const planResponse = await api.planStory(config);
      
      onConfigChange({
        styleBible: planResponse.styleBible,
        outline: planResponse.outline,
      });

      setProgress(30);
      setCurrentStep('writing');

      // Step 2: Write the story
      toast.info('Writing your story...');
      const writeResponse = await api.writeStory(config, planResponse.outline);
      
      onConfigChange({
        pages: writeResponse.pages,
      });

      setProgress(60);
      setCurrentStep('images');

      // Step 3: Generate images
      toast.info('Creating beautiful illustrations...');
      const imagePrompts = planResponse.outline.pages.map(page => ({
        page: page.page,
        prompt: page.imagePrompt,
        seed: config.imageSeed || undefined,
      }));

      const imageResponse = await api.generateImages(config.pageSize, imagePrompts);
      
      // Update pages with image URLs
      const pagesWithImages = writeResponse.pages.map(page => {
        const imageData = imageResponse.images.find(img => img.page === page.page);
        return {
          ...page,
          imageUrl: imageData?.url,
        };
      });

      onConfigChange({
        pages: pagesWithImages,
      });

      setProgress(100);
      setCurrentStep('complete');
      toast.success('Your story is ready!');

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to generate story';
      setError(errorMessage);
      toast.error(errorMessage);
      setCurrentStep('idle');
      setProgress(0);
    }
  };

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
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="space-y-1">
              <div className="text-sm font-medium">Children</div>
              <div className="text-sm text-muted-foreground">
                {config.children.length > 0 ? config.children.join(', ') : 'Generic hero'}
              </div>
            </div>
            <div className="space-y-1">
              <div className="text-sm font-medium">Story Type</div>
              <div className="text-sm text-muted-foreground">{config.storyType}</div>
            </div>
            <div className="space-y-1">
              <div className="text-sm font-medium">Setting</div>
              <div className="text-sm text-muted-foreground">{config.setting}</div>
            </div>
            <div className="space-y-1">
              <div className="text-sm font-medium">Length</div>
              <div className="text-sm text-muted-foreground">
                {config.lengthPages} pages • {config.readingLevel}
              </div>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {config.characters.map((character, index) => (
              <Badge key={index} variant="secondary">{character}</Badge>
            ))}
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
                <span>{progress}%</span>
              </div>
              <Progress value={progress} className="h-2" />
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
            <div className="grid gap-4">
              {config.pages.slice(0, 3).map((page, index) => (
                <div key={page.page} className="border rounded-lg p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <Badge variant="outline">Page {page.page}</Badge>
                    <div className="flex items-center gap-2">
                      {page.imageUrl && (
                        <Badge variant="secondary" className="flex items-center gap-1">
                          <Image className="w-3 h-3" />
                          Image ready
                        </Badge>
                      )}
                    </div>
                  </div>
                  <div className="text-sm leading-relaxed">
                    {page.text.substring(0, 200)}
                    {page.text.length > 200 && '...'}
                  </div>
                  {page.imageUrl && (
                    <div className="rounded-lg overflow-hidden">
                      <img
                        src={page.imageUrl}
                        alt={`Illustration for page ${page.page}`}
                        className="w-full h-32 object-cover"
                      />
                    </div>
                  )}
                </div>
              ))}
              {config.pages.length > 3 && (
                <div className="text-center text-muted-foreground">
                  ... and {config.pages.length - 3} more pages
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
          {currentStep === 'idle' && (
            <Button
              onClick={generateStory}
              size="lg"
              className="px-8 py-3 text-lg font-medium animate-gentle-bounce"
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