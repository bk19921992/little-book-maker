import { StoryConfig, StoryOutline, StoryPage, PlanResponse, WriteResponse, ImageGenerateResponse, ExportResponse, PrintOrderResponse, PageSizePreset, PageLayout } from './types';
import type { ImageConfig, ImagePromptInput } from './lib/images';
import { formatSupabaseConnectionError, supabase, supabaseConfigError } from '@/integrations/supabase/client';


// Read the friendly error message returned by an edge function (401/402/429/
// validation/moderation responses) so the UI can show it to the user.
const extractFunctionError = async (error: unknown): Promise<string> => {
  try {
    const context = (error as { context?: Response }).context;
    if (context && typeof context.json === 'function') {
      const body = await context.json();
      if (body && typeof body.error === 'string' && body.error.trim()) {
        return body.error;
      }
    }
  } catch {
    // fall through to the generic message
  }
  return error instanceof Error ? error.message : 'Edge Function error';
};

// API client for communicating with Supabase edge functions
class APIClient {
  private async invokeFunction<T>(functionName: string, body: unknown): Promise<T> {
    try {
      if (supabaseConfigError) {
        throw new Error(supabaseConfigError);
      }

      const { data, error } = await supabase.functions.invoke(functionName, { body });

      if (error) {
        console.error(`Error calling ${functionName}:`, error);
        const msg = error.message || 'Edge Function error';
        // Retry once if the request failed to send (common transient issue)
        if (msg.includes('Failed to send a request to the Edge Function')) {
          console.warn(`[${functionName}] Retry after transient send failure...`);
          await new Promise((r) => setTimeout(r, 600));
          const retry = await supabase.functions.invoke(functionName, { body });
          if (retry.error) {
            throw new Error(`[${functionName}] ${await extractFunctionError(retry.error)}`);
          }
          return retry.data as T;
        }
        throw new Error(`[${functionName}] ${await extractFunctionError(error)}`);
      }

      return data as T;
    } catch (error) {
      console.error(`Error invoking function ${functionName}:`, error);
      if (error instanceof Error) {
        // Surface a clearer message including the function name
        throw new Error(`[${functionName}] ${formatSupabaseConnectionError(error)}`);
      }
      throw new Error(`[${functionName}] Failed to invoke`);
    }
  }

  async planStory(config: StoryConfig): Promise<PlanResponse> {
    return this.invokeFunction<PlanResponse>('story-plan', { config });
  }

  async writeStory(config: StoryConfig, outline: StoryOutline): Promise<WriteResponse> {
    return this.invokeFunction<WriteResponse>('story-write', { config, outline });
  }

  async generateImages(
    pageSize: PageSizePreset,
    pageLayout: PageLayout,
    prompts: ImagePromptInput[],
    includeCover: boolean = false,
    options: { reference?: { url: string; kind: 'sheet' | 'page' }; config?: ImageConfig } = {}
  ): Promise<ImageGenerateResponse> {
    return this.invokeFunction<ImageGenerateResponse>('generate-images', {
      pageSize,
      pageLayout,
      prompts,
      includeCover,
      config: options.config,
      referenceImage: options.reference?.url,
      referenceKind: options.reference?.kind,
    });
  }

  // Character sheet for the book: every later illustration is drawn from it.
  async generateCharacterSheet(pageSize: PageSizePreset, pageLayout: PageLayout, config: ImageConfig): Promise<ImageGenerateResponse> {
    return this.invokeFunction<ImageGenerateResponse>('generate-images', {
      mode: 'reference',
      pageSize,
      pageLayout,
      config,
    });
  }

  async exportPDF(
    config: StoryConfig,
    pages: StoryPage[],
    storyId: string,
    includeBleed: boolean = true,
    coverImage?: string
  ): Promise<ExportResponse> {
    return this.invokeFunction<ExportResponse>('export-pdf', {
      config,
      pages,
      storyId,
      includeBleed,
      coverImage,
    });
  }

  async createPrintOrder(
    provider: 'PEECHO' | 'BOOKVAULT' | 'LULU' | 'GELATO',
    pdfUrl: string,
    pageSize: PageSizePreset
  ): Promise<PrintOrderResponse> {
    return this.invokeFunction<PrintOrderResponse>('create-print-order', {
      provider,
      pdfUrl,
      pageSize,
    });
  }

  // Mock data for development
  async getMockStory(): Promise<{ config: StoryConfig; outline: StoryOutline; pages: StoryPage[] }> {
    // Return a sample story for testing
    const config: StoryConfig = {
      children: ['Emma', 'Sam'],
      storyType: 'Adventure',
      themePreset: 'Calm pastels',
      themeCustom: null,
      palette: ['#FFB5A7', '#F8CD07', '#A8E6CF', '#DDA0DD'],
      characters: ['Dog', 'Dragon'],
      setting: 'Forest',
      educationalFocus: 'kindness',
      readingLevel: 'Early 4–5',
      lengthPages: 10,
      narrationStyle: 'Simple prose',
      personal: {
        town: 'Brighton',
        favouriteToy: 'teddy bear',
        favouriteColour: 'blue',
        pets: 'cat named Whiskers',
      },
      contentSafety: true,
      imageStyle: 'Picture-book',
      formatMode: 'manual',
      pageSize: 'A5 portrait',
      pageLayout: 'split',
      formatReason: null,
      imageSeed: 12345,
    };

    return new Promise(resolve => {
      setTimeout(() => {
        resolve({
          config,
          outline: { pages: [] },
          pages: [],
        });
      }, 1000);
    });
  }
}

export const api = new APIClient();
