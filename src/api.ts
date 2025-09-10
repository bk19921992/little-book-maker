import { StoryConfig, StoryOutline, StoryPage, PlanResponse, WriteResponse, ImageGenerateResponse, ExportResponse, PrintOrderResponse, PageSizePreset } from './types';
import { supabase } from '@/integrations/supabase/client';

// API client for communicating with Supabase edge functions
class APIClient {
  private async invokeFunction<T>(functionName: string, body: any, headers: Record<string, string> = {}): Promise<T> {
    try {
      console.log(`Calling ${functionName} with:`, body)
      const { data, error } = await supabase.functions.invoke(functionName, {
        body,
        headers,
      });

      console.log(`${functionName} response:`, { data, error })

      if (error) {
        console.error(`Error calling ${functionName}:`, error);
        throw new Error(error.message || `Failed to call ${functionName}`);
      }

      return data as T;
    } catch (error) {
      console.error(`Error invoking function ${functionName}:`, error);
      if (error instanceof Error) {
        throw error;
      }
      throw new Error(`Failed to invoke ${functionName}`);
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
    prompts: { page: number; prompt: string; seed?: number }[]
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