import { rootAuthDestination } from './authCallback.ts';
export const ANALYTICS_ORIGIN = 'https://make.thechildrenslibrary.uk';
// Public, content-only routes. Everything else (/app, auth callbacks, unknown
// paths) is treated as private and its events are dropped.
export const PUBLIC_PATHS = ['/', '/sample', '/guides/personalised-christmas-book'] as const;
// The only custom event allowed through the gate: the Christmas guide's CTA
// click, fired on a public page. Everything else custom is dropped.
export const ALLOWED_CUSTOM_EVENTS = ['christmas-guide-cta'] as const;
type Event={type:string;url:string;name?:string};
const publicPage=(raw:string):boolean=>{try{const u=new URL(raw);return u.origin===ANALYTICS_ORIGIN&&(PUBLIC_PATHS as readonly string[]).includes(u.pathname)&&!rootAuthDestination(u.pathname,u.search,u.hash)}catch{return false}};
// Vercel appends document.referrer AFTER beforeSend. The supported safe
// fallback is to DROP events with external/malformed referrers, not pretend
// returning a stripped object can redact them. This deliberately undercounts
// external entrances and is not a complete traffic report.
export function publicAnalyticsEvent(event:Event,currentUrl:string,referrer:string):{type:'pageview';url:string}|{type:'event';url:string;name:string}|null{
  if(!publicPage(event.url)||!publicPage(currentUrl))return null;
  if(referrer){try{const u=new URL(referrer);if(u.origin!==ANALYTICS_ORIGIN||u.search||u.hash||!(PUBLIC_PATHS as readonly string[]).includes(u.pathname))return null;}catch{return null}}
  if(event.type==='pageview')return{type:'pageview',url:ANALYTICS_ORIGIN+new URL(event.url).pathname};
  if(event.type==='event'&&event.name&&(ALLOWED_CUSTOM_EVENTS as readonly string[]).includes(event.name))return{type:'event',url:ANALYTICS_ORIGIN+new URL(event.url).pathname,name:event.name};
  return null;
}
