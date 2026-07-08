import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';

const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL ||
  (import.meta.env.VITE_SUPABASE_PROJECT_ID
    ? `https://${import.meta.env.VITE_SUPABASE_PROJECT_ID}.supabase.co`
    : '');

const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || '';

export const supabaseConfigError = !SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY
  ? 'Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in the deployment environment.'
  : null;

export const formatSupabaseConnectionError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error || '');
  if (message.toLowerCase().includes('failed to fetch')) {
    return 'The story backend is not reachable. Check that VITE_SUPABASE_URL points to an active Supabase project and that the Supabase functions are deployed.';
  }
  return message || 'The story backend returned an unexpected error.';
};

// Import the supabase client like this:
// import { supabase } from "@/integrations/supabase/client";

export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    storage: localStorage,
    persistSession: true,
    autoRefreshToken: true,
  }
});