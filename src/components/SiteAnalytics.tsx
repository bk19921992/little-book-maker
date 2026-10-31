import { Analytics, type BeforeSendEvent } from '@vercel/analytics/react';
import { publicAnalyticsEvent } from '../lib/analyticsPrivacy';
// The installed hook survives SPA navigation. Check CURRENT location as well
// as event URL. Deny referrers we cannot safely retain; this undercounts.
function beforeSend(event: BeforeSendEvent): BeforeSendEvent | null {
  return publicAnalyticsEvent(event,window.location.href,document.referrer);
}
const SiteAnalytics = () => <Analytics mode="production" beforeSend={beforeSend} />;
export default SiteAnalytics;
