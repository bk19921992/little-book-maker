import { rootAuthDestination } from './authCallback.ts';
export const ANALYTICS_ORIGIN = 'https://little-book-maker.vercel.app';
type Event={type:string;url:string};
const publicRoot=(raw:string):boolean=>{try{const u=new URL(raw);return u.origin===ANALYTICS_ORIGIN&&u.pathname==='/'&&!rootAuthDestination(u.pathname,u.search,u.hash)}catch{return false}};
// Vercel appends document.referrer AFTER beforeSend. The supported safe
// fallback is to DROP events with external/malformed referrers, not pretend
// returning a stripped object can redact them. This deliberately undercounts
// external entrances and is not a complete traffic report.
export function publicAnalyticsEvent(event:Event,currentUrl:string,referrer:string):{type:'pageview';url:string}|null{
  if(event.type!=='pageview'||!publicRoot(event.url)||!publicRoot(currentUrl))return null;
  if(referrer){try{const u=new URL(referrer);if(u.origin!==ANALYTICS_ORIGIN||u.search||u.hash||u.pathname!=='/')return null;}catch{return null}}
  return {type:'pageview',url:`${ANALYTICS_ORIGIN}/`};
}
