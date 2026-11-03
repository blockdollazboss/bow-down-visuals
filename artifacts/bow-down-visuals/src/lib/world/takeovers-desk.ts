/**
 * takeovers-desk — the seam behind the Charts board's native
 * Takeovers desk (stack1500 world parity wave #3, census
 * item 33; the census counted the spotlight / loading-screen
 * takeovers ABSENT from the World before this wave).
 *
 * Source of truth: artifacts/api-server/src/routes/
 * spotlight.ts + loading-screen.ts, offers from
 * lib/db/src/schema/{spotlight,loading-screen}.ts.
 *   GET  /api/spotlight/offer → { offer }
 *   POST /api/spotlight/inquire { name (1–200), email
 *     (valid, ≤320), videoUrl (URL, ≤2000), targetUrl?
 *     (URL | "") } → { success: true }
 *   GET  /api/loading-screen/offer → { offer }
 *   POST /api/loading-screen/inquire — same contract.
 *   Offer = { name, priceDollars, durationDays, surfaces[],
 *     specs[] }.
 *
 * WHAT THESE ARE (the routes' own contract): INQUIRIES, not
 * purchases — "Storage only — no emails are sent and no
 * charge is taken." The desk says exactly that: the offer's
 * price is the package's price, the form sends a request,
 * and the confirmation copy never claims a booking or a
 * charge. Both rails are PUBLIC and free (no registry rows —
 * verified null), so guests inquire in full: the form itself
 * carries the name + email.
 *
 * The inquiry builder mirrors the shared schema; the URL
 * checks use the same rule the schema's .url() applies (a
 * parseable absolute URL), the email the schema's shape.
 */
import { getCreditCost } from "../credit-costs";

export const SPOTLIGHT_OFFER_PATH = "/api/spotlight/offer";
export const SPOTLIGHT_INQUIRE_PATH = "/api/spotlight/inquire";
export const LOADING_OFFER_PATH = "/api/loading-screen/offer";
export const LOADING_INQUIRE_PATH = "/api/loading-screen/inquire";

/** Both families are free — no registry rows exist. */
export const TAKEOVERS_FREE =
  getCreditCost(SPOTLIGHT_INQUIRE_PATH) === null && getCreditCost(LOADING_INQUIRE_PATH) === null;

export interface TakeoverOffer {
  name: string;
  priceDollars: number;
  durationDays: number;
  surfaces: string[];
  specs: string[];
}

function obj(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function stringList(v: unknown): string[] {
  return (Array.isArray(v) ? v : []).filter((s): s is string => typeof s === "string");
}

/** The offer guard: a takeover needs its name, price and
 *  duration; surfaces/specs ride as the string lists sent. */
export function takeoverOfferOf(data: unknown): TakeoverOffer | null {
  const wrap = obj(data);
  const o = wrap ? obj(wrap["offer"]) : null;
  if (!o) return null;
  const name = typeof o["name"] === "string" ? o["name"] : "";
  const price = typeof o["priceDollars"] === "number" ? o["priceDollars"] : null;
  const days = typeof o["durationDays"] === "number" ? o["durationDays"] : null;
  if (!name || price === null || days === null) return null;
  return {
    name,
    priceDollars: price,
    durationDays: days,
    surfaces: stringList(o["surfaces"]),
    specs: stringList(o["specs"]),
  };
}

export interface TakeoverInquiryForm {
  name: string;
  email: string;
  videoUrl: string;
  targetUrl: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

/** The shared inquiry schema, mirrored: name + a valid
 *  email + a real video URL required; the target link is
 *  optional but must be a URL when given. */
export function buildTakeoverInquiryPayload(
  form: TakeoverInquiryForm,
): { name: string; email: string; videoUrl: string; targetUrl?: string } | null {
  const name = form.name.trim();
  const email = form.email.trim();
  const videoUrl = form.videoUrl.trim();
  const targetUrl = form.targetUrl.trim();
  if (!name || name.length > 200) return null;
  if (!EMAIL_RE.test(email) || email.length > 320) return null;
  if (!isUrl(videoUrl) || videoUrl.length > 2000) return null;
  if (targetUrl !== "" && (!isUrl(targetUrl) || targetUrl.length > 2000)) return null;
  return { name, email, videoUrl, ...(targetUrl ? { targetUrl } : {}) };
}

export function takeoverInquiryOk(data: unknown): boolean {
  const o = obj(data);
  return o !== null && o["success"] === true;
}
