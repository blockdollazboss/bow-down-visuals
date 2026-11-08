/**
 * lib/world/hosting-desk.ts — Stack 300 item 90 (census A5): the
 * Profile Hosting door's World sibling seam.
 *
 * Profile Hosting ($9/mo standalone, included with Creator Elite)
 * sold on /creator-pricing with NO World twin — the one Get Paid
 * card a walker couldn't reach without dropping out of the World.
 * This seam carries the strict payload parsers for the EXISTING
 * rails the desk rides (GET /creator-hosting/plan + /me,
 * POST /creator-hosting/checkout, POST /creator-tiers/portal) —
 * no new API, no new price: hosting is $9/mo, ruled.
 *
 * Parsers follow the house desk idiom (money-desks.ts family):
 * malformed payloads parse to null and the desk shows its honest
 * load-failed state instead of inventing a hosting state.
 */
import type { HostingMeView, HostingPlanView } from "../profile-hosting-state";

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function bool(v: unknown): boolean {
  return v === true;
}

/** GET /api/creator-hosting/plan → { plan } (and /me's embedded plan
 *  DTO) — the same shape the 2D card renders
 *  (lib/profile-hosting-state.ts HostingPlanView). */
export function parseHostingPlan(payload: unknown): HostingPlanView | null {
  const raw = isObj(payload) && isObj(payload["plan"]) ? payload["plan"] : payload;
  if (!isObj(raw)) return null;
  const name = str(raw["name"]);
  const price = num(raw["priceUsdPerMonth"]);
  if (!name || price === null) return null;
  const featuresRaw = Array.isArray(raw["features"]) ? raw["features"] : [];
  const features = featuresRaw
    .filter(isObj)
    /* The view's detailsUrl is a plain string (profile-hosting-state):
       a feature whose link is absent or malformed rides with no link
       (""), exactly as the 2D card's DTO carries it. */
    .map((f) => ({ label: str(f["label"]) ?? "", detailsUrl: str(f["detailsUrl"]) ?? "" }))
    .filter((f) => f.label.length > 0);
  return {
    name,
    tagline: str(raw["tagline"]) ?? "",
    features,
    priceUsdPerMonth: price,
    includedWithTier: str(raw["includedWithTier"]) ?? "elite",
    priceConfigured: bool(raw["priceConfigured"]),
    available: bool(raw["available"]),
  };
}

/** GET /api/creator-hosting/me — the caller's hosting truth. A
 *  payload without a parseable plan or the entitlement boolean is
 *  not a hosting state at all → null (the desk retries honestly). */
export function parseHostingMe(payload: unknown): HostingMeView | null {
  if (!isObj(payload)) return null;
  if (typeof payload["hostingEntitled"] !== "boolean") return null;
  const plan = parseHostingPlan(payload["plan"]);
  if (!plan) return null;
  const sourceRaw = str(payload["hostingSource"]);
  const hostingSource =
    sourceRaw === "hosting" || sourceRaw === "elite" || sourceRaw === "admin" ? sourceRaw : null;
  return {
    hostingEntitled: payload["hostingEntitled"],
    hostingStatus: str(payload["hostingStatus"]),
    hostingSource,
    includedWithElite: bool(payload["includedWithElite"]),
    currentPeriodEnd: str(payload["currentPeriodEnd"]),
    cleanBranding: bool(payload["cleanBranding"]),
    plan,
  };
}

/** POST /api/creator-hosting/checkout — the rail's exact body. The
 *  in-world returnTo is the palace itself: the rail's return_url
 *  carries it, so a finished checkout lands the walker back at
 *  /world (the planCheckoutPayload precedent). */
export function hostingCheckoutPayload(): { returnTo: string } {
  return { returnTo: "/world" };
}

/** POST /api/creator-tiers/portal — same returnTo discipline: the
 *  portal opens in a NEW TAB (the sanctioned money-moment exit) and
 *  its return lands back in the World. */
export function hostingPortalPayload(): { returnTo: string } {
  return { returnTo: "/world" };
}
