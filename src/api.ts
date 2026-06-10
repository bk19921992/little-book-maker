import { StoryConfig, StoryOutline, StoryPage, PlanResponse, WriteResponse, ImageGenerateResponse, ExportResponse, PrintOrderResponse, PageSizePreset } from './types';
import { supabase } from '@/integrations/supabase/client';

// API client for communicating with Supabase edge functions
class APIClient {
  private async invokeFunction<
    TResponse,
    TBody extends Record<string, unknown> = Record<string, unknown>
  >(functionName: string, body: TBody, headers: Record<string, string> = {}): Promise<TResponse> {
    try {
      console.log(`Calling ${functionName} with:`, body);
      const { data, error } = await supabase.functions.invoke(functionName, {
        body,
        headers,
      });

      console.log(`${functionName} response:`, { data, error });

      if (error) {
        console.error(`Error calling ${functionName}:`, error);
        const message =
          typeof error === 'object' && error !== null && 'message' in error
            ? String((error as { message?: string }).message)
            : 'Edge Function error';
        // Retry once if the request failed to send (common transient issue)
        if (message.includes('Failed to send a request to the Edge Function')) {
          console.warn(`[${functionName}] Retry after transient send failure...`);
          await new Promise((r) => setTimeout(r, 600));
          const retry = await supabase.functions.invoke(functionName, { body, headers });
          if (retry.error) {
            const retryMessage =
              typeof retry.error === 'object' && retry.error !== null && 'message' in retry.error
                ? String((retry.error as { message?: string }).message)
                : 'Edge Function request failed again';
            throw new Error(`[${functionName}] ${retryMessage}`);
          }
          return retry.data as TResponse;
        }
        throw new Error(`[${functionName}] ${message}`);
      }

      return data as TResponse;
    } catch (caught) {
      console.error(`Error invoking function ${functionName}:`, caught);
      if (caught instanceof Error) {
        // Surface a clearer message including the function name
        throw new Error(`[${functionName}] ${caught.message}`);
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
    prompts: { page: number; prompt: string; text?: string; visualBrief?: string; config?: StoryConfig; seed?: number }[]
  ): Promise<ImageGenerateResponse> {
    return this.invokeFunction<ImageGenerateResponse>('generate-images', {
      pageSize,
      prompts,
    });
  }

  async exportPDF(
    config: StoryConfig,
    pages: StoryPage[],
    includeBleed: boolean = true,
    authToken?: string
  ): Promise<ExportResponse> {
    const headers: Record<string, string> = {};
    if (authToken) {
      headers['X-Billing-Token'] = authToken;
    }
    
    return this.invokeFunction<ExportResponse>('export-pdf', {
      config,
      pages,
      includeBleed,
    }, headers);
  }

  async createPrintOrder(
    provider: 'PEECHO' | 'BOOKVAULT' | 'LULU' | 'GELATO',
    pdfUrl: string,
    pageSize: PageSizePreset,
    authToken?: string
  ): Promise<PrintOrderResponse> {
    const headers: Record<string, string> = {};
    if (authToken) {
      headers['X-Billing-Token'] = authToken;
    }
    
    return this.invokeFunction<PrintOrderResponse>('create-print-order', {
      provider,
      pdfUrl,
      pageSize,
    }, headers);
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
      pageSize: 'A5 portrait',
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