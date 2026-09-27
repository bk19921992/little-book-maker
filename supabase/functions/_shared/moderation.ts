// Run user free-text through OpenAI's moderation endpoint before anything is
// generated. Returns a friendly rejection message, or null when clean.
export async function moderateFreeText(fields: Record<string, string | undefined>): Promise<string | null> {
  const inputs = Object.values(fields).filter((t): t is string => !!t && t.trim().length > 0);
  if (inputs.length === 0) return null;

  const openaiKey = Deno.env.get('OPENAI_API_KEY');
  if (!openaiKey) {
    throw new Error('OpenAI API key not configured. Add OPENAI_API_KEY to your environment variables.');
  }

  const response = await fetch('https://api.openai.com/v1/moderations', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${openaiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model: 'omni-moderation-latest', input: inputs }),
  });

  if (!response.ok) {
    console.error('Moderation endpoint returned', response.status);
    throw new Error('Could not check story details right now. Please try again.');
  }

  const data = await response.json();
  const flagged = (data?.results || []).some((r: { flagged?: boolean }) => r.flagged);
  if (flagged) {
    return "Some of the story details aren't suitable for a children's book. Please adjust them and try again.";
  }
  return null;
}
