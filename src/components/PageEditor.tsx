import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { 
  Edit3, 
  Image, 
  Lock, 
  Unlock, 
  RefreshCw, 
  CheckCircle, 
  AlertTriangle,
  BookOpen,
  Download
} from 'lucide-react';
import { StoryConfig, StoryPage } from '../types';
import { countWords, getWordCountStatus, wordCountTargets } from '../lib/validation';
import { toast } from 'sonner';

interface PageEditorProps {
  config: StoryConfig;
  onConfigChange: (updates: Partial<StoryConfig>) => void;
  onNext: () => void;
  onBack: () => void;
}

export const PageEditor: React.FC<PageEditorProps> = ({
  config,
  onConfigChange,
  onNext,
  onBack,
}) => {
  const [selectedPage, setSelectedPage] = useState(1);
  const [isRegeneratingImage, setIsRegeneratingImage] = useState(false);

  const pages = config.pages || [];
  const currentPage = pages.find(p => p.page === selectedPage);
  const targets = wordCountTargets[config.readingLevel];

  const updatePageText = (pageNumber: number, text: string) => {
    const updatedPages = pages.map(page =>
      page.page === pageNumber ? { ...page, text } : page
    );
    onConfigChange({ pages: updatedPages });
  };

  const toggleImageLock = (pageNumber: number) => {
    const updatedPages = pages.map(page =>
      page.page === pageNumber 
        ? { ...page, imageLocked: !page.imageLocked } 
        : page
    );
    onConfigChange({ pages: updatedPages });
  };

  const regenerateImage = async (pageNumber: number) => {
    if (!config.outline) return;
    
    setIsRegeneratingImage(true);
    try {
      // Find the image prompt for this page
      const outlinePage = config.outline.pages.find(p => p.page === pageNumber);
      if (!outlinePage) throw new Error('Page outline not found');

      // In a real implementation, this would call the API
      // For now, we'll just show a success message
      toast.success(`Image regenerated for page ${pageNumber}`);
      
    } catch (error) {
      toast.error('Failed to regenerate image');
    } finally {
      setIsRegeneratingImage(false);
    }
  };

  const getPageStatus = (page: StoryPage) => {
    const wordCount = countWords(page.text);
    const wordStatus = getWordCountStatus(wordCount, config.readingLevel);
    const hasImage = !!page.imageUrl || page.imageLocked;
    
    return {
      text: wordStatus.status === 'good' ? 'complete' : 'warning',
      image: hasImage ? 'complete' : 'warning',
      overall: wordStatus.status === 'good' && hasImage ? 'complete' : 'warning',
    };
  };

  const canExport = pages.every(page => {
    const status = getPageStatus(page);
    return status.overall === 'complete';
  });

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-8 animate-fade-in">
      <div className="text-center space-y-4">
        <h1 className="text-4xl font-display font-bold text-gradient">
          Edit Your Story
        </h1>
        <p className="text-lg text-muted-foreground">
          Fine-tune your story and make it perfect
        </p>
      </div>

      <div className="grid lg:grid-cols-4 gap-8">
        {/* Page List */}
        <div className="lg:col-span-1">
          <Card className="story-card sticky top-24">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BookOpen className="w-5 h-5 text-primary" />
                Pages
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {pages.map((page) => {
                const status = getPageStatus(page);
                const wordCount = countWords(page.text);
                
                return (
                  <button
                    key={page.page}
                    onClick={() => setSelectedPage(page.page)}
                    className={`
                      w-full p-3 rounded-lg text-left transition-all
                      ${selectedPage === page.page 
                        ? 'bg-primary text-primary-foreground' 
                        : 'bg-muted hover:bg-muted/80'
                      }
                    `}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium">Page {page.page}</span>
                      <div className="flex gap-1">
                        {status.text === 'complete' ? (
                          <CheckCircle className="w-4 h-4 text-story-nature" />
                        ) : (
                          <AlertTriangle className="w-4 h-4 text-destructive" />
                        )}
                        {status.image === 'complete' ? (
                          <CheckCircle className="w-4 h-4 text-story-nature" />
                        ) : (
                          <AlertTriangle className="w-4 h-4 text-destructive" />
                        )}
                      </div>
                    </div>
                    <div className="text-xs opacity-70 mt-1">
                      {wordCount} words • {page.imageUrl ? 'Image ready' : page.imageLocked ? 'No image' : 'Image needed'}
                    </div>
                  </button>
                );
              })}
            </CardContent>
          </Card>
        </div>

        {/* Page Editor */}
        <div className="lg:col-span-3">
          {currentPage ? (
            <div className="space-y-6">
              {/* Text Editor */}
              <Card className="story-card">
                <CardHeader>
                  <CardTitle className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Edit3 className="w-5 h-5 text-primary" />
                      Page {currentPage.page} Text
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">
                        {countWords(currentPage.text)} / {targets.min}-{targets.max} words
                      </Badge>
                      <Badge 
                        variant={getWordCountStatus(countWords(currentPage.text), config.readingLevel).status === 'good' ? 'default' : 'destructive'}
                      >
                        {getWordCountStatus(countWords(currentPage.text), config.readingLevel).status}
                      </Badge>
                    </div>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <Textarea
                    value={currentPage.text}
                    onChange={(e) => updatePageText(currentPage.page, e.target.value)}
                    placeholder="Write your story text here..."
                    className="min-h-[200px] text-base leading-relaxed"
                  />
                  
                  <div className="flex justify-between text-sm text-muted-foreground">
                    <span>Target: {targets.min}-{targets.max} words for {config.readingLevel}</span>
                    <span 
                      className={getWordCountStatus(countWords(currentPage.text), config.readingLevel).color}
                    >
                      Current: {countWords(currentPage.text)} words
                    </span>
                  </div>
                </CardContent>
              </Card>

              {/* Image Editor */}
              <Card className="story-card">
                <CardHeader>
                  <CardTitle className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Image className="w-5 h-5 text-primary" />
                      Page {currentPage.page} Illustration
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="flex items-center space-x-2">
                        <Switch
                          id={`lock-${currentPage.page}`}
                          checked={currentPage.imageLocked || false}
                          onCheckedChange={() => toggleImageLock(currentPage.page)}
                        />
                        <Label htmlFor={`lock-${currentPage.page}`} className="flex items-center gap-1">
                          {currentPage.imageLocked ? <Lock className="w-4 h-4" /> : <Unlock className="w-4 h-4" />}
                          Lock {currentPage.imageLocked ? 'without' : 'with'} image
                        </Label>
                      </div>
                      
                      {!currentPage.imageLocked && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => regenerateImage(currentPage.page)}
                          disabled={isRegeneratingImage}
                        >
                          <RefreshCw className={`w-4 h-4 mr-2 ${isRegeneratingImage ? 'animate-spin' : ''}`} />
                          Regenerate
                        </Button>
                      )}
                    </div>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {currentPage.imageLocked ? (
                    <div className="text-center p-8 border-2 border-dashed border-muted rounded-lg">
                      <Lock className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                      <p className="text-muted-foreground">This page will not have an illustration</p>
                    </div>
                  ) : currentPage.imageUrl ? (
                    <div className="rounded-lg overflow-hidden">
                      <img
                        src={currentPage.imageUrl}
                        alt={`Illustration for page ${currentPage.page}`}
                        className="w-full h-auto"
                      />
                    </div>
                  ) : (
                    <div className="text-center p-8 border-2 border-dashed border-muted rounded-lg">
                      <Image className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                      <p className="text-muted-foreground">Image will be generated</p>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => regenerateImage(currentPage.page)}
                        disabled={isRegeneratingImage}
                        className="mt-2"
                      >
                        Generate Image
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Validation Alerts */}
              {!canExport && (
                <Alert>
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>
                    Some pages need attention before you can export your story. 
                    Check word counts and ensure all pages have images or are locked without them.
                  </AlertDescription>
                </Alert>
              )}
            </div>
          ) : (
            <Card className="story-card">
              <CardContent className="text-center p-8">
                <p className="text-muted-foreground">Select a page to edit</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex justify-between">
        <Button variant="outline" onClick={onBack}>
          Back to Preview
        </Button>
        
        <Button
          onClick={onNext}
          disabled={!canExport}
          size="lg"
          className="px-8 py-3 text-lg font-medium"
        >
          <Download className="w-5 h-5 mr-2" />
          Export Story
        </Button>
      </div>
    </div>
  );
};