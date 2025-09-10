import { ThemePreset, StoryTypePreset, CharacterPreset, SettingPreset } from '../types';

// Theme presets with beautiful color palettes
export const themePresets: ThemePreset[] = [
  {
    name: 'Calm pastels',
    description: 'Soft, soothing colors perfect for bedtime stories',
    palette: ['#FFB5A7', '#F8CD07', '#A8E6CF', '#DDA0DD', '#87CEEB'],
    mood: ['peaceful', 'gentle', 'dreamy', 'cozy'],
  },
  {
    name: 'Adventure bright',
    description: 'Bold, energetic colors for exciting adventures',
    palette: ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FECA57'],
    mood: ['exciting', 'bold', 'energetic', 'fun'],
  },
  {
    name: 'Magical wonder',
    description: 'Mystical purples and golds for fantasy tales',
    palette: ['#6C5CE7', '#A29BFE', '#FD79A8', '#FDCB6E', '#E17055'],
    mood: ['magical', 'mysterious', 'enchanting', 'whimsical'],
  },
  {
    name: 'Nature earth',
    description: 'Warm earth tones inspired by nature',
    palette: ['#6AB04C', '#F0932B', '#EB4D4B', '#E55039', '#F8B500'],
    mood: ['natural', 'grounded', 'warm', 'organic'],
  },
  {
    name: 'Ocean breeze',
    description: 'Cool blues and teals like the seaside',
    palette: ['#0FB9B1', '#3742FA', '#70A1FF', '#7BED9F', '#FF9F43'],
    mood: ['refreshing', 'calm', 'flowing', 'serene'],
  },
];

// Story type presets
export const storyTypePresets: StoryTypePreset[] = [
  {
    name: 'Adventure',
    description: 'Exciting journeys and discoveries',
    tags: ['exploration', 'courage', 'friendship'],
  },
  {
    name: 'Bedtime',
    description: 'Gentle, calming stories for sleep',
    tags: ['peaceful', 'dreamy', 'soothing'],
  },
  {
    name: 'Learning',
    description: 'Educational stories that teach',
    tags: ['educational', 'discovery', 'growth'],
  },
  {
    name: 'Friendship',
    description: 'Stories about making friends',
    tags: ['kindness', 'sharing', 'cooperation'],
  },
  {
    name: 'Fantasy',
    description: 'Magical worlds with dragons',
    tags: ['magical', 'imagination', 'wonder'],
  },
  {
    name: 'Problem solving',
    description: 'Characters overcome challenges',
    tags: ['resilience', 'creativity', 'perseverance'],
  },
];

// Character presets
export const characterPresets: CharacterPreset[] = [
  { name: 'Friendly dog', description: 'A loyal and playful companion' },
  { name: 'Wise owl', description: 'A helpful guide with knowledge to share' },
  { name: 'Brave mouse', description: 'Small but mighty and full of courage' },
  { name: 'Gentle dragon', description: 'A kind dragon who loves to help' },
  { name: 'Curious cat', description: 'Always exploring and discovering new things' },
  { name: 'Happy elephant', description: 'A joyful friend who never forgets' },
  { name: 'Clever rabbit', description: 'Quick-thinking and resourceful' },
  { name: 'Magical unicorn', description: 'A mystical friend with special powers' },
  { name: 'Singing bird', description: 'Brings music and joy wherever it goes' },
  { name: 'Dancing bear', description: 'Loves to move and groove' },
];

// Setting presets
export const settingPresets: SettingPreset[] = [
  { name: 'Enchanted forest', description: 'A magical woodland full of wonder' },
  { name: 'Cozy bedroom', description: 'Warm space perfect for dreams' },
  { name: 'Sunny meadow', description: 'Open fields with flowers' },
  { name: 'Village playground', description: 'Fun place where children play' },
  { name: 'Garden adventure', description: 'Backyard full of discoveries' },
  { name: 'Castle tower', description: 'Fairy tale royal adventures' },
  { name: 'Beach treasure hunt', description: 'Sandy shores with surprises' },
  { name: 'Library corner', description: 'Quiet nook with books' },
  { name: 'Treehouse hideout', description: 'Secret place in the trees' },
  { name: 'Magic shop', description: 'Mysterious store of wonders' },
];

// Helper functions
export const getThemeByName = (name: string): ThemePreset | undefined => {
  return themePresets.find(theme => theme.name === name);
};

export const getStoryTypeByName = (name: string): StoryTypePreset | undefined => {
  return storyTypePresets.find(type => type.name === name);
};

export const getCharacterByName = (name: string): CharacterPreset | undefined => {
  return characterPresets.find(char => char.name === name);
};

export const getSettingByName = (name: string): SettingPreset | undefined => {
  return settingPresets.find(setting => setting.name === name);
};