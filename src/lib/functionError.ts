// Read the friendly error message returned by an edge function (401/402/422/
// 429 validation/moderation responses) so the UI can show it to the user.
// The 422 export-gate refusal carries its plain explanation in body.error.
export const extractFunctionError = async (error: unknown): Promise<string> => {
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
