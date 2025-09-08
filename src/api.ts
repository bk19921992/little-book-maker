import { StoryConfig, StoryOutline, StoryPage, PlanResponse, WriteResponse, ImageGenerateResponse, ExportResponse, PrintOrderResponse, PageSizePreset } from './types';

const API_BASE = '/functions/v1';

// API client for communicating with the backend
class APIClient {
  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `${API_BASE}${endpoint}`;
    
    const response = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
      ...options,
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage = `HTTP ${response.status}`;
      
      try {
        const errorJson = JSON.parse(errorText);
        errorMessage = errorJson.error || errorMessage;
      } catch {
        errorMessage = errorText || errorMessage;
      }
      
      throw new Error(errorMessage);
    }

    const responseText = await response.text();
    
    // Check if response is HTML instead of JSON (indicates Supabase functions not working)
    if (responseText.trim().startsWith('<!doctype html>') || responseText.trim().startsWith('<html')) {
      throw new Error('Supabase connection required. Please click the green Supabase button to connect your project.');
    }

    try {
      return JSON.parse(responseText);
    } catch (error) {
      throw new Error(`Invalid JSON response: ${responseText.substring(0, 100)}...`);
    }
  }

  async planStory(config: StoryConfig): Promise<PlanResponse> {
    return this.request<PlanResponse>('/story-plan', {
      method: 'POST',
      body: JSON.stringify({ config }),
    });
  }

  async writeStory(config: StoryConfig, outline: StoryOutline): Promise<WriteResponse> {
    return this.request<WriteResponse>('/story-write', {
      method: 'POST',
      body: JSON.stringify({ config, outline }),
    });
  }

  async generateImages(
    pageSize: PageSizePreset,
    prompts: { page: number; prompt: string; seed?: number }[]
  ): Promise<ImageGenerateResponse> {
    return this.request<ImageGenerateResponse>('/generate-images', {
      method: 'POST',
      body: JSON.stringify({
        pageSize,
        prompts,
      }),
    });
  }

  async exportPDF(
    config: StoryConfig,
    pages: StoryPage[],
    includeBleed: boolean = true
  ): Promise<ExportResponse> {
    return this.request<ExportResponse>('/export/pdf', {
      method: 'POST',
      body: JSON.stringify({
        config,
        pages,
        includeBleed,
      }),
    });
  }

  async createPrintOrder(
    provider: 'PEECHO' | 'BOOKVAULT' | 'LULU' | 'GELATO',
    pdfUrl: string,
    pageSize: PageSizePreset
  ): Promise<PrintOrderResponse> {
    return this.request<PrintOrderResponse>('/print/order', {
      method: 'POST',
      body: JSON.stringify({
        provider,
        pdfUrl,
        pageSize,
      }),
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