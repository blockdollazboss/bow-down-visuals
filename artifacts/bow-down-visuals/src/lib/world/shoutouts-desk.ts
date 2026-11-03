/* ─── Shoutouts desk seam (stack1500 world parity wave #4b, census
   item 27 — the shoutouts marketplace, buy-side) ──────────────────
   The fan half of pages/shoutouts.tsx, native at the marketplace
   square on the page's own rails (routes/generate/shoutouts.ts):

     GET  /api/shoutouts/creators            (public) → { creators:
           [{ id, displayName, priceDollars, turnaroundDays,
              guidelines }], paymentsLive: false }
     POST /api/shoutouts/requests            (public) → 201
           { request, paymentsLive } — a FREE request is delivered
           to the creator the moment it lands; a priced one waits
           in pending_payment for the checkout below.
     POST /api/shoutouts/requests/:id/checkout (public) { uiMode? }
           → embedded: { checkoutUrl: null, clientSecret,
              uiMode: "embedded", sessionId }
             hosted:   { checkoutUrl }
     POST /api/shoutouts/requests/:id/checkout/verify (public)
           { sessionId } → { status, paid } — the guarded flip;
           the Stripe webhook settles the same flip if the fan
           never returns.
     GET  /api/shoutouts/settings            (auth) → { settings|null }
     PUT  /api/shoutouts/settings            (auth, free) — the
           member's own selling setup, named in this item's scope.

   MONEY LAW (owner, 2026-10-26 + the wave-1 live-shopping shape):
   payment stays in-World — the desk asks the checkout rail for the
   EMBEDDED presentation first and mounts the shared
   EmbeddedSessionCheckout right in the desk; the hosted page opens
   in a NEW TAB only as the fallback, at the money moment, on the
   walker's click. Everything before and after the money moment —
   browsing, the request, the confirmation — stays in-World, and a
   purchase counts only when the rail's verify says paid.

   THE FEE: the buyer pays exactly the creator's listed price. The
   platform's FLAT 5% (SHOUTOUT_PLATFORM_FEE_PCT in the route, the
   owner ruling of 2026-10-27) comes out of the creator's side —
   never added on top for the fan. No Visual Bucs move on the
   buy-side at all: the family's one VB rail (the creator-side AI
   message helper, 100 VB) is a sell-side drafting aid and is NOT
   part of this buy-side desk.

   HONESTY: the creators list still carries its v1 `paymentsLive:
   false` flag even though the checkout rail is live — the desk
   never reads payment truth from that flag. Truth comes from the
   request answer (paymentsLive = the request is priced) and from
   the checkout/verify answers themselves. Creators whose rows
   drift off the rail's shape are dropped, never dressed up. */

export const SHOUTOUTS_CREATORS_PATH = "/api/shoutouts/creators";
export const SHOUTOUTS_SETTINGS_PATH = "/api/shoutouts/settings";
export const SHOUTOUTS_REQUESTS_PATH = "/api/shoutouts/requests";

/** The route's platform fee — flat 5%, out of the creator's side. */
export const SHOUTOUT_PLATFORM_FEE_PCT = 5;

export function shoutoutCheckoutPath(requestId: string): string {
  return `${SHOUTOUTS_REQUESTS_PATH}/${encodeURIComponent(requestId)}/checkout`;
}

export function shoutoutVerifyPath(requestId: string): string {
  return `${shoutoutCheckoutPath(requestId)}/verify`;
}

/** The pending-checkout marker (the live-shopping desk's pattern):
 *  a hosted checkout opened in a new tab leaves its request +
 *  session ids here so verify-on-return can find them. */
export const SHOUTOUT_PENDING_KEY = "bdv-world-shoutout-pending";

export interface ShoutoutPending {
  requestId: string;
  sessionId: string;
}

export function parseShoutoutPending(raw: string | null): ShoutoutPending | null {
  if (!raw) return null;
  try {
    const d = JSON.parse(raw) as Record<string, unknown>;
    const requestId = typeof d["requestId"] === "string" ? d["requestId"] : "";
    const sessionId = typeof d["sessionId"] === "string" ? d["sessionId"] : "";
    return requestId && sessionId ? { requestId, sessionId } : null;
  } catch {
    return null;
  }
}

/* ─── Shapes ─────────────────────────────────────────────────────── */

export interface ShoutoutCreator {
  /** The settings id — the public creator identifier, never a UUID of the user. */
  id: string;
  displayName: string;
  priceDollars: number;
  turnaroundDays: number;
  guidelines: string;
}

export interface ShoutoutSettings {
  id: string;
  displayName: string;
  priceDollars: number;
  priceCents: number;
  turnaroundDays: number;
  guidelines: string;
  accepting: boolean;
}

export interface ShoutoutRequestMade {
  id: string;
  status: string;
  priceCents: number;
  priceDollars: number;
  /** The request answer's own word: true exactly when priced. */
  paymentsLive: boolean;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/* ─── Guards — the rails' exact shapes; drift is dropped/failure ── */

export function shoutoutCreatorsOfResponse(data: unknown): ShoutoutCreator[] | null {
  if (!isRecord(data) || !Array.isArray(data["creators"])) return null;
  const out: ShoutoutCreator[] = [];
  for (const raw of data["creators"]) {
    if (!isRecord(raw)) continue;
    const id = str(raw["id"]);
    const displayName = str(raw["displayName"]);
    const priceDollars = num(raw["priceDollars"]);
    const turnaroundDays = num(raw["turnaroundDays"]);
    if (!id || !displayName || priceDollars === null || turnaroundDays === null) continue;
    out.push({
      id,
      displayName,
      priceDollars,
      turnaroundDays,
      guidelines: str(raw["guidelines"]),
    });
  }
  return out;
}

export function shoutoutSettingsOfResponse(data: unknown): ShoutoutSettings | null | undefined {
  if (!isRecord(data) || !("settings" in data)) return undefined;
  const s = data["settings"];
  if (s === null) return null;
  if (!isRecord(s)) return undefined;
  const id = str(s["id"]);
  const displayName = str(s["displayName"]);
  const priceDollars = num(s["priceDollars"]);
  const priceCents = num(s["priceCents"]);
  const turnaroundDays = num(s["turnaroundDays"]);
  if (!id || !displayName || priceDollars === null || priceCents === null || turnaroundDays === null) {
    return undefined;
  }
  return {
    id,
    displayName,
    priceDollars,
    priceCents,
    turnaroundDays,
    guidelines: str(s["guidelines"]),
    accepting: s["accepting"] === true,
  };
}

export function shoutoutRequestOfResponse(data: unknown): ShoutoutRequestMade | null {
  if (!isRecord(data) || !isRecord(data["request"])) return null;
  const r = data["request"];
  const id = str(r["id"]);
  const priceCents = num(r["priceCents"]);
  const priceDollars = num(r["priceDollars"]);
  if (!id || priceCents === null || priceDollars === null) return null;
  return {
    id,
    status: str(r["status"]) || "pending_payment",
    priceCents,
    priceDollars,
    paymentsLive: data["paymentsLive"] === true,
  };
}

/* ─── Checkout outcome — the rail's branches, on its own shape ──── */

/** The embedded branch: a clientSecret mounts the shared
 *  EmbeddedSessionCheckout in the desk. */
export function shoutoutEmbeddedSecret(data: unknown): string | null {
  if (!isRecord(data)) return null;
  return typeof data["clientSecret"] === "string" && data["clientSecret"] ? data["clientSecret"] : null;
}

/** The hosted fallback: the new-tab money moment. */
export function shoutoutHostedUrl(data: unknown): string | null {
  if (!isRecord(data)) return null;
  return typeof data["checkoutUrl"] === "string" && data["checkoutUrl"] ? data["checkoutUrl"] : null;
}

export function shoutoutSessionId(data: unknown): string | null {
  if (!isRecord(data)) return null;
  return typeof data["sessionId"] === "string" && data["sessionId"] ? data["sessionId"] : null;
}

/** A verify answer counts as paid only when the server says so —
 *  a pending verify is never dressed up as a booking (the webhook
 *  may still settle it later). */
export function shoutoutVerifyConfirmed(data: unknown): boolean {
  return isRecord(data) && data["paid"] === true;
}

/* ─── Payload builders + draft readiness (the route schemas) ────── */

export interface ShoutoutRequestDraft {
  fanName: string;
  fanEmail: string;
  occasion: string;
  message: string;
}

export function buildShoutoutRequestPayload(creatorId: string, draft: ShoutoutRequestDraft) {
  const fanEmail = draft.fanEmail.trim();
  return {
    creatorId,
    fanName: draft.fanName.trim(),
    fanEmail: fanEmail ? fanEmail : undefined,
    occasion: draft.occasion.trim(),
    message: draft.message.trim(),
  };
}

/** The request schema's own bounds (routes/generate/shoutouts.ts):
 *  name 1–80, occasion 1–120, message 1–1000, email optional but
 *  valid when given. The rail re-checks every one; a refusal is
 *  shown word-for-word. */
export function shoutoutRequestDraftReady(draft: ShoutoutRequestDraft): boolean {
  const name = draft.fanName.trim();
  const occasion = draft.occasion.trim();
  const message = draft.message.trim();
  const email = draft.fanEmail.trim();
  if (!name || name.length > 80) return false;
  if (!occasion || occasion.length > 120) return false;
  if (!message || message.length > 1000) return false;
  if (email && (email.length > 160 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) return false;
  return true;
}

export interface ShoutoutSettingsDraft {
  displayName: string;
  priceDollars: string;
  turnaroundDays: string;
  guidelines: string;
  accepting: boolean;
}

export function buildShoutoutSettingsPayload(draft: ShoutoutSettingsDraft) {
  return {
    displayName: draft.displayName.trim(),
    priceDollars: Number(draft.priceDollars),
    turnaroundDays: Math.trunc(Number(draft.turnaroundDays)),
    guidelines: draft.guidelines.trim(),
    accepting: draft.accepting,
  };
}

/** The settings schema's bounds: name 1–60, price 0–999.99,
 *  turnaround a whole 1–90 days, guidelines ≤1000. */
export function shoutoutSettingsDraftReady(draft: ShoutoutSettingsDraft): boolean {
  const name = draft.displayName.trim();
  const price = Number(draft.priceDollars);
  const days = Number(draft.turnaroundDays);
  if (!name || name.length > 60) return false;
  if (!Number.isFinite(price) || price < 0 || price > 999.99) return false;
  if (!Number.isInteger(days) || days < 1 || days > 90) return false;
  if (draft.guidelines.trim().length > 1000) return false;
  return true;
}

export function shoutoutSettingsDraftOf(settings: ShoutoutSettings | null): ShoutoutSettingsDraft {
  return {
    displayName: settings?.displayName ?? "",
    priceDollars: settings ? String(settings.priceDollars) : "",
    turnaroundDays: settings ? String(settings.turnaroundDays) : "3",
    guidelines: settings?.guidelines ?? "",
    accepting: settings?.accepting ?? true,
  };
}

/** The checkout ask: embedded first when the page can mount it —
 *  the same uiMode the 2D page sends. */
export function buildShoutoutCheckoutPayload(embedded: boolean) {
  return embedded ? { uiMode: "embedded" as const } : {};
}

export function buildShoutoutVerifyPayload(sessionId: string) {
  return { sessionId };
}

export const SHOUTOUTS_PROMOTION =
  "Shoutouts marketplace in the hall marketplace square: the 2D page's own rails in-World — browse the creators accepting requests (public rail), send a request (free requests reach the creator at once), pay a priced request embedded-first with the new-tab fallback at the money moment only and verify-on-return, plus the member's own selling settings (the flat 5% platform fee comes out of the creator's side)";
