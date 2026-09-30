import type { ImageJobItem, ImageJobStep } from './lib/imageJob';
import type { ImageConfig } from './lib/imageRequest';
import { StoryConfig, StoryOutline, StoryPage, PlanResponse, WriteResponse, ExportResponse, PrintOrderResponse, PageSizePreset } from './types';
import { formatSupabaseConnectionError, supabase, supabaseConfigError } from '@/integrations/supabase/client';

// API client for communicating with Supabase edge functions
class APIClient {
  private async invokeFunction<T>(functionName: string, body: unknown, headers: Record<string, string> = {}, retryOnSendFailure = true): Promise<T> {
    try {
      if (supabaseConfigError) {
        throw new Error(supabaseConfigError);
      }

      if (functionName !== 'generate-images') console.log(`Calling ${functionName} with:`, body)
      const { data, error } = await supabase.functions.invoke(functionName, {
        body,
        headers,
      });

      if (functionName !== 'generate-images') console.log(`${functionName} response:`, { data, error })

      if (error) {
        console.error(`Error calling ${functionName}:`, error);
        const msg = error.message || 'Edge Function error';
        // Retry once if the request failed to send (common transient issue)
        if (retryOnSendFailure && msg.includes('Failed to send a request to the Edge Function')) {
          console.warn(`[${functionName}] Retry after transient send failure...`);
          await new Promise((r) => setTimeout(r, 600));
          const retry = await supabase.functions.invoke(functionName, { body, headers });
          if (retry.error) {
            throw new Error(`[${functionName}] ${retry.error.message || 'Edge Function request failed again'}`);
          }
          return retry.data as T;
        }
        throw new Error(`[${functionName}] ${msg}`);
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

  async startImageJob(requestId: string, pageSize: PageSizePreset, prompts: { page: number; prompt: string; text?: string; visualBrief?: string }[], config: ImageConfig, referenceImage?: string): Promise<{ jobId: string; items: ImageJobItem[] }> {
    return this.invokeFunction('generate-images', { action: 'start', requestId, pageSize, pageLayout: 'split', prompts, includeCover: false, config, referenceImage }, {}, false);
  }

  async stepImageJob(jobId: string): Promise<ImageJobStep> {
    return this.invokeFunction('generate-images', { action: 'step', jobId });
  }

  async imageJobStatus(jobId: string): Promise<{ jobStatus: 'running' | 'done'; items: ImageJobItem[] }> {
    return this.invokeFunction('generate-images', { action: 'status', jobId });
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