import React from 'react';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { PageSizePreset, PageLayout } from '../types';

interface PageSizeOption {
  value: PageSizePreset;
  label: string;
  hint: string;
  aspectW: number;
  aspectH: number;
}

// Shapes grounded in standard children's picture-book trim sizes:
// square (~8.5x8.5in) and portrait (~8x10in) are the industry-standard POD sizes,
// landscape is the wide story-time format.
const PAGE_SIZE_OPTIONS: PageSizeOption[] = [
  { value: 'A5 portrait', label: 'A5 portrait', hint: '148 x 210 mm - classic small storybook', aspectW: 148, aspectH: 210 },
  { value: 'A4 portrait', label: 'A4 portrait', hint: '210 x 297 mm - large portrait pages', aspectW: 210, aspectH: 297 },
  { value: '210×210 mm square', label: 'Square', hint: '210 x 210 mm - the most popular picture-book shape', aspectW: 210, aspectH: 210 },
  { value: 'A4 landscape', label: 'A4 landscape', hint: '297 x 210 mm - wide pages for big scenes', aspectW: 297, aspectH: 210 },
];

interface FormatPickerProps {
  pageSize: PageSizePreset;
  pageLayout: PageLayout;
  onConfigChange: (updates: { pageSize?: PageSizePreset; pageLayout?: PageLayout }) => void;
}

// Grey-box wireframe of one page: shows shape and where picture/words sit.
// Pure markup - no images or text are generated for this preview.
const PageWireframe: React.FC<{ option: PageSizeOption; layout: PageLayout }> = ({ option, layout }) => {
  const textLines = (
    <div className="space-y-1 px-2">
      <div className="h-1 rounded bg-muted-foreground/30 w-full" />
      <div className="h-1 rounded bg-muted-foreground/30 w-11/12" />
      <div className="h-1 rounded bg-muted-foreground/30 w-4/5" />
    </div>
  );

  return (
    <div
      className="border-2 border-primary/40 rounded-md bg-background overflow-hidden shadow-sm max-w-full"
      style={{ aspectRatio: `${option.aspectW} / ${option.aspectH}`, width: '9rem' }}
      aria-label="Layout wireframe preview"
    >
      {layout === 'split' ? (
        <div className="w-full h-full flex flex-col">
          <div className="m-1.5 mb-1 flex-[6] rounded bg-muted flex items-center justify-center">
            <span className="text-[10px] text-muted-foreground">Picture</span>
          </div>
          <div className="flex-[4] py-1.5">{textLines}</div>
        </div>
      ) : (
        <div className="relative w-full h-full bg-muted flex items-center justify-center">
          <span className="text-[10px] text-muted-foreground">Full-page picture</span>
          <div className="absolute bottom-0 left-0 right-0 bg-background/80 py-1.5">{textLines}</div>
        </div>
      )}
    </div>
  );
};

export const FormatPicker: React.FC<FormatPickerProps> = ({ pageSize, pageLayout, onConfigChange }) => {
  const selected = PAGE_SIZE_OPTIONS.find((o) => o.value === pageSize) || PAGE_SIZE_OPTIONS[0];

  return (
    <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-6 items-start">
      <div className="space-y-4">
        <div className="space-y-2">
          <Label>Page shape</Label>
          <Select
            value={pageSize}
            onValueChange={(value: any) => onConfigChange({ pageSize: value })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAGE_SIZE_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label} - {o.hint}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>Picture and words layout</Label>
          <RadioGroup
            value={pageLayout}
            onValueChange={(value) => onConfigChange({ pageLayout: value as PageLayout })}
            className="space-y-2"
          >
            <div className="flex items-start space-x-2">
              <RadioGroupItem value="split" id="layout-split" className="mt-1" />
              <Label htmlFor="layout-split" className="text-sm leading-relaxed font-normal">
                <span className="font-medium">Split page</span> - picture above, words below.
                Classic early-reader layout, easiest for young children to follow.
              </Label>
            </div>
            <div className="flex items-start space-x-2">
              <RadioGroupItem value="overlay" id="layout-overlay" className="mt-1" />
              <Label htmlFor="layout-overlay" className="text-sm leading-relaxed font-normal">
                <span className="font-medium">Full-page picture</span> - the illustration fills the
                whole page and the words sit on top, like many modern picture books.
              </Label>
            </div>
          </RadioGroup>
        </div>
      </div>

      <div className="space-y-2">
        <Label className="text-muted-foreground text-xs">Layout preview (no story generated yet)</Label>
        <PageWireframe option={selected} layout={pageLayout} />
      </div>
    </div>
  );
};
