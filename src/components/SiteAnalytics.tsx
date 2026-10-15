import { Analytics, type BeforeSendEvent } from "@vercel/analytics/react";

const PRODUCTION_HOST = "little-book-maker.vercel.app";

// Page views only: production host only, query string and hash removed.
function beforeSend(event: BeforeSendEvent): BeforeSendEvent | null {
  try {
    const url = new URL(event.url);
    if (url.hostname !== PRODUCTION_HOST) return null;
    return { ...event, url: `${url.origin}${url.pathname}` };
  } catch {
    return null;
  }
}

const SiteAnalytics = () => <Analytics mode="production" beforeSend={beforeSend} />;

export default SiteAnalytics;
