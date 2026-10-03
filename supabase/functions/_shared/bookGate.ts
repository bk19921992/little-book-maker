import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

export async function claimBook(service: SupabaseClient, userId: string, storyId: unknown): Promise<boolean> {
  if (typeof storyId !== 'string' || !storyId || storyId.length > 100) {
    throw new Error('Missing story id.');
  }
  const { data, error } = await service.rpc('claim_book', { p_user_id: userId, p_story_id: storyId });
  if (error) throw error;
  return data === true;
}

export function bookPaymentRequired(corsHeaders: Record<string, string>): Response {
  return new Response(JSON.stringify({ error: 'Payment required to create another book.' }), {
    status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
