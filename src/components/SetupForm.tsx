import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Slider } from '@/components/ui/slider';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Plus, X, BookOpen, Palette, Users, MapPin } from 'lucide-react';
import { StoryConfig, ReadingLevel } from '../types';
import { themePresets, storyTypePresets, characterPresets, settingPresets } from '../lib/presets';

interface SetupFormProps {
  config: StoryConfig;
  onConfigChange: (updates: Partial<StoryConfig>) => void;
  onNext: () => void;
  canProceed: boolean;
}

export const SetupForm: React.FC<SetupFormProps> = ({
  config,
  onConfigChange,
  onNext,
  canProceed,
}) => {
  const [showCustomTheme, setShowCustomTheme] = useState(false);
  const [showCustomStoryType, setShowCustomStoryType] = useState(false);
  const [showCustomSetting, setShowCustomSetting] = useState(false);
  const [newChild, setNewChild] = useState('');
  const [newCharacter, setNewCharacter] = useState('');

  const addChild = () => {
    if (newChild.trim()) {
      onConfigChange({ children: [...config.children, newChild.trim()] });
      setNewChild('');
    }
  };

  const removeChild = (index: number) => {
    const newChildren = config.children.filter((_, i) => i !== index);
    onConfigChange({ children: newChildren });
  };

  const addCharacter = () => {
    if (newCharacter.trim()) {
      onConfigChange({ characters: [...config.characters, newCharacter.trim()] });
      setNewCharacter('');
    }
  };

  const removeCharacter = (index: number) => {
    const newCharacters = config.characters.filter((_, i) => i !== index);
    onConfigChange({ characters: newCharacters });
  };

  const selectPreset = (type: 'theme' | 'storyType' | 'character' | 'setting', value: string) => {
    if (type === 'theme') {
      const theme = themePresets.find(t => t.name === value);
      if (theme) {
        onConfigChange({
          themePreset: value,
          themeCustom: null,
          palette: theme.palette,
        });
        setShowCustomTheme(false);
      }
    } else if (type === 'storyType') {
      onConfigChange({ storyType: value });
      setShowCustomStoryType(false);
    } else if (type === 'character') {
      if (!config.characters.includes(value)) {
        onConfigChange({ characters: [...config.characters, value] });
      }
    } else if (type === 'setting') {
      onConfigChange({ setting: value });
      setShowCustomSetting(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6 space-y-6 sm:space-y-8 animate-fade-in">
      <div className="text-center space-y-3 sm:space-y-4">
        <h1 className="text-3xl sm:text-4xl font-display font-bold text-gradient">
          Create Your Story
        </h1>
        <p className="text-base sm:text-lg text-muted-foreground">
          Let's build a magical storybook just for you
        </p>
      </div>

      <div className="grid gap-6 sm:gap-8 lg:grid-cols-2">
        {/* Children Names */}
        <Card className="story-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="w-5 h-5 text-primary" />
              Children's Names
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Add the names of children in your story (optional)
            </p>
            <div className="flex gap-2">
              <Input
                placeholder="Enter a child's name"
                value={newChild}
                onChange={(e) => setNewChild(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && addChild()}
              />
              <Button onClick={addChild} size="sm" variant="secondary">
                <Plus className="w-4 h-4" />
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              {config.children.map((child, index) => (
                <Badge key={index} variant="secondary" className="flex items-center gap-1">
                  {child}
                  <button onClick={() => removeChild(index)}>
                    <X className="w-3 h-3" />
                  </button>
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Story Type */}
        <Card className="story-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BookOpen className="w-5 h-5 text-primary" />
              Story Type
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              {storyTypePresets.map((preset) => (
                <Button
                  key={preset.name}
                  variant={config.storyType === preset.name ? "default" : "outline"}
                  onClick={() => selectPreset('storyType', preset.name)}
                  className="h-auto p-4 text-left flex-col items-start justify-start min-h-[100px] max-w-full whitespace-normal"
                >
                  <span className="font-medium text-sm leading-tight w-full text-left break-words">{preset.name}</span>
                  <span className="text-xs opacity-70 mt-2 leading-relaxed w-full text-left break-words hyphens-auto">
                    {preset.description}
                  </span>
                </Button>
              ))}
            </div>
            <div className="space-y-2">
              <Button
                variant="ghost"
                onClick={() => setShowCustomStoryType(!showCustomStoryType)}
                className="w-full"
              >
                {showCustomStoryType ? 'Use presets' : 'Custom story type'}
              </Button>
              {showCustomStoryType && (
                <Input
                  placeholder="Describe your story type"
                  value={config.storyType}
                  onChange={(e) => onConfigChange({ storyType: e.target.value })}
                />
              )}
            </div>
          </CardContent>
        </Card>

        {/* Theme */}
        <Card className="story-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Palette className="w-5 h-5 text-primary" />
              Color Theme
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3">
              {themePresets.map((preset) => (
                <Button
                  key={preset.name}
                  variant={config.themePreset === preset.name ? "default" : "outline"}
                  onClick={() => selectPreset('theme', preset.name)}
                  className="h-auto p-3 text-left justify-start"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex gap-1">
                      {preset.palette.slice(0, 4).map((color, i) => (
                        <div
                          key={i}
                          className="w-4 h-4 rounded-full border"
                          style={{ backgroundColor: color }}
                        />
                      ))}
                    </div>
                    <div>
                      <div className="font-medium">{preset.name}</div>
                      <div className="text-xs opacity-70">{preset.description}</div>
                    </div>
                  </div>
                </Button>
              ))}
            </div>
            <div className="space-y-2">
              <Button
                variant="ghost"
                onClick={() => setShowCustomTheme(!showCustomTheme)}
                className="w-full"
              >
                {showCustomTheme ? 'Use presets' : 'Custom theme'}
              </Button>
              {showCustomTheme && (
                <Textarea
                  placeholder="Describe your color theme and mood"
                  value={config.themeCustom || ''}
                  onChange={(e) => onConfigChange({ 
                    themeCustom: e.target.value,
                    themePreset: null 
                  })}
                />
              )}
            </div>
          </CardContent>
        </Card>

        {/* Setting */}
        <Card className="story-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MapPin className="w-5 h-5 text-primary" />
              Setting
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              {settingPresets.map((preset) => (
                <Button
                  key={preset.name}
                  variant={config.setting === preset.name ? "default" : "outline"}
                  onClick={() => selectPreset('setting', preset.name)}
                  className="h-auto p-4 text-left flex-col items-start justify-start min-h-[100px] max-w-full whitespace-normal"
                >
                  <span className="font-medium text-sm leading-tight w-full text-left break-words">{preset.name}</span>
                  <span className="text-xs opacity-70 mt-2 leading-relaxed w-full text-left break-words hyphens-auto">
                    {preset.description}
                  </span>
                </Button>
              ))}
            </div>
            <div className="space-y-2">
              <Button
                variant="ghost"
                onClick={() => setShowCustomSetting(!showCustomSetting)}
                className="w-full"
              >
                {showCustomSetting ? 'Use presets' : 'Custom setting'}
              </Button>
              {showCustomSetting && (
                <Input
                  placeholder="Describe your story setting"
                  value={config.setting}
                  onChange={(e) => onConfigChange({ setting: e.target.value })}
                />
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Characters Section */}
      <Card className="story-card">
        <CardHeader>
          <CardTitle>Characters</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {characterPresets.map((preset) => (
              <Button
                key={preset.name}
                variant={config.characters.includes(preset.name) ? "default" : "outline"}
                onClick={() => selectPreset('character', preset.name)}
                className="h-auto p-3 text-left flex-col items-start justify-start min-h-[80px] whitespace-normal"
                size="sm"
              >
                <span className="font-medium text-sm leading-tight break-words w-full text-left">{preset.name}</span>
                <span className="text-xs opacity-70 mt-1 leading-relaxed break-words w-full text-left hyphens-auto">
                  {preset.description}
                </span>
              </Button>
            ))}
          </div>
          <div className="flex gap-2">
            <Input
              placeholder="Add custom character"
              value={newCharacter}
              onChange={(e) => setNewCharacter(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && addCharacter()}
            />
            <Button onClick={addCharacter} size="sm" variant="secondary">
              <Plus className="w-4 h-4" />
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            {config.characters.map((character, index) => (
              <Badge key={index} variant="secondary" className="flex items-center gap-1">
                {character}
                <button onClick={() => removeCharacter(index)}>
                  <X className="w-3 h-3" />
                </button>
              </Badge>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Settings Grid */}
      <div className="grid gap-4 sm:gap-6 lg:grid-cols-2">
        {/* Reading Level & Length */}
        <Card className="story-card">
          <CardHeader>
            <CardTitle>Story Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <Label>Reading Level</Label>
              <Select
                value={config.readingLevel}
                onValueChange={(value: ReadingLevel) => onConfigChange({ readingLevel: value })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Toddler 2–3">Toddler 2–3 years</SelectItem>
                  <SelectItem value="Early 4–5">Early reader 4–5 years</SelectItem>
                  <SelectItem value="Primary 6–8">Primary 6–8 years</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Story Length: {config.lengthPages} pages</Label>
              <Slider
                value={[config.lengthPages]}
                onValueChange={([value]) => onConfigChange({ lengthPages: value })}
                min={6}
                max={20}
                step={1}
                className="w-full"
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>6 pages</span>
                <span>20 pages</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Personal Details */}
        <Card className="story-card">
          <CardHeader>
            <CardTitle>Personal Touches</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Town/City</Label>
                <Input
                  placeholder="Brighton"
                  value={config.personal.town || ''}
                  onChange={(e) => onConfigChange({
                    personal: { ...config.personal, town: e.target.value }
                  })}
                />
              </div>
              <div className="space-y-2">
                <Label>Favourite Toy</Label>
                <Input
                  placeholder="teddy bear"
                  value={config.personal.favouriteToy || ''}
                  onChange={(e) => onConfigChange({
                    personal: { ...config.personal, favouriteToy: e.target.value }
                  })}
                />
              </div>
              <div className="space-y-2">
                <Label>Favourite Colour</Label>
                <Input
                  placeholder="blue"
                  value={config.personal.favouriteColour || ''}
                  onChange={(e) => onConfigChange({
                    personal: { ...config.personal, favouriteColour: e.target.value }
                  })}
                />
              </div>
              <div className="space-y-2">
                <Label>Pets</Label>
                <Input
                  placeholder="cat named Whiskers"
                  value={config.personal.pets || ''}
                  onChange={(e) => onConfigChange({
                    personal: { ...config.personal, pets: e.target.value }
                  })}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Dedication (optional)</Label>
              <Textarea
                placeholder="For my wonderful daughter Emma..."
                value={config.personal.dedication || ''}
                onChange={(e) => onConfigChange({
                  personal: { ...config.personal, dedication: e.target.value }
                })}
              />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Advanced Options */}
      <Card className="story-card">
        <CardHeader>
          <CardTitle>Advanced Options</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Narration Style</Label>
              <Select
                value={config.narrationStyle}
                onValueChange={(value: any) => onConfigChange({ narrationStyle: value })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Simple prose">Simple prose</SelectItem>
                  <SelectItem value="Rhyming couplets">Rhyming couplets</SelectItem>
                  <SelectItem value="Third-person">Third-person</SelectItem>
                  <SelectItem value="First-person">First-person</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Educational Focus</Label>
              <Select
                value={config.educationalFocus}
                onValueChange={(value: any) => onConfigChange({ educationalFocus: value })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  <SelectItem value="counting">Counting</SelectItem>
                  <SelectItem value="letters">Letters</SelectItem>
                  <SelectItem value="kindness">Kindness</SelectItem>
                  <SelectItem value="sharing">Sharing</SelectItem>
                  <SelectItem value="resilience">Resilience</SelectItem>
                  <SelectItem value="bedtime wind-down">Bedtime wind-down</SelectItem>
                  <SelectItem value="healthy habits">Healthy habits</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Image Style</Label>
              <Select
                value={typeof config.imageStyle === 'string' ? config.imageStyle : 'Picture-book'}
                onValueChange={(value: any) => onConfigChange({ imageStyle: value })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Picture-book">Picture-book</SelectItem>
                  <SelectItem value="Watercolour">Watercolour</SelectItem>
                  <SelectItem value="Crayon">Crayon</SelectItem>
                  <SelectItem value="Paper cut-out">Paper cut-out</SelectItem>
                  <SelectItem value="Cartoon line art">Cartoon line art</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Content Safety */}
      <Card className="story-card border-primary/20">
        <CardContent className="p-6">
          <div className="flex items-center space-x-2">
            <Checkbox
              id="contentSafety"
              checked={config.contentSafety}
              onCheckedChange={(checked) => onConfigChange({ contentSafety: !!checked })}
            />
            <Label htmlFor="contentSafety" className="text-sm leading-relaxed">
              I agree that this story will be generated with child-safe content, free from violence, 
              fear, or inappropriate themes. All content will be gentle and age-appropriate.
            </Label>
          </div>
        </CardContent>
      </Card>

      {/* Next Button */}
      <div className="flex justify-center">
        <Button
          onClick={onNext}
          disabled={!canProceed}
          size="lg"
          className="px-8 py-3 text-lg font-medium animate-gentle-bounce"
        >
          Create My Story
        </Button>
      </div>
    </div>
  );
};