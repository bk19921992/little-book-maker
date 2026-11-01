// Cache successful Stripe setup and coalesce in-flight calls, but never
// cache unavailable configuration or a rejected loader across retries.
export function publishableKey(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const key = value.trim();
  return /^pk_(test|live)_[A-Za-z0-9]{8,}$/.test(key) ? key : undefined;
}

export function stripeRuntime<T>(resolveKey: () => Promise<unknown>, load: (key: string) => Promise<T | null>) {
  let cached: Promise<T | null> | null = null;
  return () => {
    if (!cached) {
      cached = (async () => {
        const key = publishableKey(await resolveKey());
        return key ? await load(key) : null;
      })().catch(() => null).then((value) => {
        if (value === null) cached = null;
        return value;
      });
    }
    return cached;
  };
}
