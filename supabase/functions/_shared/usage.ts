import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export type UsageKind = 'story' | 'image';

// Per-user daily caps, configurable via env vars. Returns a friendly limit
// message when over the cap (caller returns 429), otherwise records the usage.
export async function checkAndRecordUsage(
  service: SupabaseClient,
  userId: string,
  kind: UsageKind,
  units: number,
): Promise<string | null> {
  const storyLimit = parseInt(Deno.env.get('DAILY_STORY_LIMIT') || '10', 10);
  const imageLimit = parseInt(Deno.env.get('DAILY_IMAGE_LIMIT') || '100', 10);
  const limit = kind === 'story' ? storyLimit : imageLimit;

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await service
    .from('generation_usage')
    .select('units')
    .eq('user_id', userId)
    .eq('kind', kind)
    .gte('created_at', since);
  if (error) throw error;

  const used = (data || []).reduce((n: number, r: { units: number }) => n + (r.units || 1), 0);
  if (used + units > limit) {
    return kind === 'story'
      ? `You've reached today's story limit of ${limit}. Please come back tomorrow.`
      : `You've reached today's illustration limit of ${limit}. Please come back tomorrow.`;
  }

  const { error: insertError } = await service
    .from('generation_usage')
    .insert({ user_id: userId, kind, units });
  if (insertError) throw insertError;
  return null;
}

export function tooManyRequestsResponse(corsHeaders: Record<string, string>, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status: 429,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
