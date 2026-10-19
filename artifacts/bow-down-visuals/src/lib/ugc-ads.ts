/* ─── UGC Product Ads seam (owner order Oct 19, 2026) ──────────────────
   Pure shaping + the thin API client for the Promote-docked UGC ads
   panel, kept out of the component so the honesty rules are
   unit-testable:
   - DTOs are normalized defensively: a row exists only when the server
     sent a complete record (id + product + status for an ad; id +
     product + details + status for a brief). Malformed rows are
     dropped, never dressed up as ads or briefs.
   - Statuses and prices come from the server's vocabulary. The two
     prices the panel shows (video 400 / persona 100) mirror the
     server anchors — clip-pricing's GEN45 flat rate and the
     artist-image sunburst rate — and are displayed BEFORE the member
     commits, never invented client-side.
   - Brief actions are derived from (brief, caller) in one place:
     who may claim / release / deliver / approve / close is the
     server's lifecycle; the panel only renders what this seam allows
     and the server re-checks every action anyway.
   - NO PAYMENT RAIL: briefs carry no money. The payment note below is
     the same plain language the server puts on every brief DTO. */

export const UGC_VIDEO_CREDIT_COST = 400;
export const UGC_PERSONA_CREDIT_COST = 100;

export const UGC_PAYMENT_NOTE =
  "Bow Down Visuals doesn't hold or move money for briefs — payment is arranged between the brand and the creator directly.";

export const UGC_STYLES = [
  { key: "unboxing", label: "Unboxing", blurb: "First reaction, product reveal" },
  { key: "honest-review", label: "Honest review", blurb: "Straight talk, real verdict" },
  { key: "problem-fix", label: "Problem → fix", blurb: "Frustration first, product solves it" },
  { key: "grwm", label: "Get ready with me", blurb: "Product inside the routine" },
] as const;

export type UgcStyleKey = (typeof UGC_STYLES)[number]["key"];

export interface UgcScript {
  hook: string;
  lines: string[];
  cta: string;
}

export interface UgcShopProduct {
  id: string;
  name: string;
  priceCents: number;
  imageUrl: string | null;
}

export interface UgcAd {
  id: string;
  briefId: string | null;
  productSource: string;
  shopProductId: string | null;
  productName: string;
  productBlurb: string | null;
  productPriceCents: number | null;
  productImageUrl: string | null;
  style: string;
  faceImageUrl: string | null;
  faceKind: string;
  script: UgcScript | null;
  captions: string[];
  captionsBurned: boolean;
  brand: { brandName: string | null; logoUrl: string | null; primaryColor: string | null; vibe: string | null } | null;
  videoUrl: string | null;
  status: string;
  creditsCharged: number;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UgcBrief {
  id: string;
  brandUserId: string;
  productName: string;
  productImageUrl: string | null;
  productUrl: string | null;
  details: string;
  style: string;
  deadline: string | null;
  status: string;
  claimedByUserId: string | null;
  deliveredAdId: string | null;
  paymentNote: string;
  createdAt: string;
  updatedAt: string;
}

export interface UgcBriefPage {
  briefs: UgcBrief[];
  limit: number | null;
  hasMore: boolean;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function strOrNull(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

export function normalizeScript(raw: unknown): UgcScript | null {
  if (!isRecord(raw)) return null;
  const hook = str(raw.hook).trim();
  const cta = str(raw.cta).trim();
  const lines = Array.isArray(raw.lines)
    ? raw.lines.filter((l): l is string => typeof l === "string" && l.trim().length > 0).map((l) => l.trim())
    : [];
  if (!hook || !cta || lines.length === 0) return null;
  return { hook, lines, cta };
}

export function normalizeUgcAd(raw: unknown): UgcAd | null {
  if (!isRecord(raw)) return null;
  const id = str(raw.id);
  const productName = str(raw.productName);
  const status = str(raw.status);
  if (!id || !productName || !status) return null;
  const brand = isRecord(raw.brand)
    ? {
        brandName: strOrNull(raw.brand.brandName),
        logoUrl: strOrNull(raw.brand.logoUrl),
        primaryColor: strOrNull(raw.brand.primaryColor),
        vibe: strOrNull(raw.brand.vibe),
      }
    : null;
  return {
    id,
    briefId: strOrNull(raw.briefId),
    productSource: str(raw.productSource) || "upload",
    shopProductId: strOrNull(raw.shopProductId),
    productName,
    productBlurb: strOrNull(raw.productBlurb),
    productPriceCents: typeof raw.productPriceCents === "number" ? raw.productPriceCents : null,
    productImageUrl: strOrNull(raw.productImageUrl),
    style: str(raw.style),
    faceImageUrl: strOrNull(raw.faceImageUrl),
    faceKind: str(raw.faceKind) || "none",
    script: normalizeScript(raw.script),
    captions: Array.isArray(raw.captions)
      ? raw.captions.filter((c): c is string => typeof c === "string")
      : [],
    captionsBurned: raw.captionsBurned === true,
    brand,
    videoUrl: strOrNull(raw.videoUrl),
    status,
    creditsCharged: num(raw.creditsCharged),
    lastError: strOrNull(raw.lastError),
    createdAt: str(raw.createdAt),
    updatedAt: str(raw.updatedAt),
  };
}

export function normalizeUgcAds(payload: unknown): UgcAd[] {
  if (!isRecord(payload) || !Array.isArray(payload.ads)) return [];
  return payload.ads.map(normalizeUgcAd).filter((a): a is UgcAd => a !== null);
}

export function normalizeUgcBrief(raw: unknown): UgcBrief | null {
  if (!isRecord(raw)) return null;
  const id = str(raw.id);
  const productName = str(raw.productName);
  const details = str(raw.details);
  const status = str(raw.status);
  if (!id || !productName || !details || !status) return null;
  return {
    id,
    brandUserId: str(raw.brandUserId),
    productName,
    productImageUrl: strOrNull(raw.productImageUrl),
    productUrl: strOrNull(raw.productUrl),
    details,
    style: str(raw.style),
    deadline: strOrNull(raw.deadline),
    status,
    claimedByUserId: strOrNull(raw.claimedByUserId),
    deliveredAdId: strOrNull(raw.deliveredAdId),
    paymentNote: str(raw.paymentNote) || UGC_PAYMENT_NOTE,
    createdAt: str(raw.createdAt),
    updatedAt: str(raw.updatedAt),
  };
}

export function normalizeUgcBriefs(payload: unknown): UgcBriefPage {
  if (!isRecord(payload) || !Array.isArray(payload.briefs)) {
    return { briefs: [], limit: null, hasMore: false };
  }
  return {
    briefs: payload.briefs.map(normalizeUgcBrief).filter((b): b is UgcBrief => b !== null),
    limit: typeof payload.limit === "number" ? payload.limit : null,
    hasMore: payload.hasMore === true,
  };
}

export function normalizeUgcProducts(payload: unknown): UgcShopProduct[] {
  if (!isRecord(payload) || !Array.isArray(payload.products)) return [];
  return payload.products
    .map((p): UgcShopProduct | null => {
      if (!isRecord(p)) return null;
      const id = str(p.id);
      const name = str(p.name);
      if (!id || !name) return null;
      return { id, name, priceCents: num(p.priceCents), imageUrl: strOrNull(p.imageUrl) };
    })
    .filter((p): p is UgcShopProduct => p !== null);
}

/* ── Labels + lifecycle ─────────────────────────────────────────────── */

export function ugcAdStatusLabel(status: string): string {
  switch (status) {
    case "draft": return "Draft";
    case "generating": return "Generating…";
    case "ready": return "Ready";
    case "failed": return "Failed — refunded";
    default: return status;
  }
}

export function briefStatusLabel(status: string): string {
  switch (status) {
    case "open": return "Open";
    case "claimed": return "Claimed";
    case "delivered": return "Delivered";
    case "approved": return "Approved";
    case "closed": return "Closed";
    default: return status;
  }
}

export type BriefAction = "claim" | "release" | "deliver" | "approve" | "close";

/** The actions the board offers THIS caller on THIS brief — the same
    lifecycle the server enforces; the server re-checks regardless. */
export function briefActionsFor(brief: UgcBrief, userId: string | null): BriefAction[] {
  if (!userId) return [];
  const actions: BriefAction[] = [];
  const isBrand = brief.brandUserId === userId;
  const isClaimer = brief.claimedByUserId === userId;
  if (brief.status === "open" && !isBrand) actions.push("claim");
  if (brief.status === "claimed" && isClaimer) actions.push("release", "deliver");
  if (brief.status === "delivered" && isBrand) actions.push("approve");
  if ((brief.status === "open" || brief.status === "claimed") && isBrand) actions.push("close");
  return actions;
}

export function ugcAdShareText(ad: UgcAd): string {
  const hook = ad.script?.hook ? `${ad.script.hook} ` : "";
  return `${hook}— my UGC ad for ${ad.productName}, made with Bow Down Visuals`;
}

/* ── API client (thin; token passed in like the other hub panels) ───── */

async function api<T>(
  token: string | null,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; data: T }> {
  const res = await fetch(path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = (await res.json().catch(() => ({}))) as T;
  return { status: res.status, data };
}

export async function fetchMyShopProducts(token: string | null): Promise<UgcShopProduct[]> {
  const { status, data } = await api<unknown>(token, "GET", "/api/ugc-ads/products");
  if (status !== 200) throw new Error("Could not load your shop products.");
  return normalizeUgcProducts(data);
}

export async function fetchMyUgcAds(token: string | null): Promise<UgcAd[]> {
  const { status, data } = await api<unknown>(token, "GET", "/api/ugc-ads");
  if (status !== 200) throw new Error("Could not load your UGC ads.");
  return normalizeUgcAds(data);
}

export async function generateUgcScript(
  token: string | null,
  input: { productName: string; productBlurb?: string; style: string; keyPoints?: string },
): Promise<UgcScript> {
  const { status, data } = await api<any>(token, "POST", "/api/ugc-ads/script", input);
  const script = status === 200 ? normalizeScript((data as any)?.script) : null;
  if (!script) throw new Error((data as any)?.error || "The script didn't come through — try again.");
  return script;
}

export async function generateUgcPersona(
  token: string | null,
  description: string,
  idempotencyKey: string,
): Promise<{ personaUrl: string; creditsUsed: number }> {
  const { status, data } = await api<any>(token, "POST", "/api/ugc-ads/persona", { description, idempotencyKey });
  if (status !== 200 || typeof (data as any)?.personaUrl !== "string") {
    throw new Error((data as any)?.error || (data as any)?.message || "The persona didn't come through — try again.");
  }
  return { personaUrl: (data as any).personaUrl, creditsUsed: num((data as any).creditsUsed) };
}

export interface CreateUgcAdInput {
  productSource: "shop" | "upload";
  shopProductId?: string;
  productName?: string;
  productBlurb?: string;
  productPriceCents?: number;
  productImageUrl?: string;
  style: string;
  faceImageUrl?: string | null;
  faceKind?: "persona" | "photo";
  script?: UgcScript | null;
  briefId?: string;
}

export async function createUgcAd(token: string | null, input: CreateUgcAdInput): Promise<UgcAd> {
  const { status, data } = await api<any>(token, "POST", "/api/ugc-ads", input);
  const ad = status === 201 ? normalizeUgcAd((data as any)?.ad) : null;
  if (!ad) throw new Error((data as any)?.error || "Could not start that ad — try again.");
  return ad;
}

export async function generateUgcAdVideo(
  token: string | null,
  adId: string,
): Promise<{ ad: UgcAd; creditsUsed: number; alreadyGenerated: boolean }> {
  const { status, data } = await api<any>(token, "POST", `/api/ugc-ads/${adId}/generate`, {});
  const ad = normalizeUgcAd((data as any)?.ad);
  if (status !== 200 || !ad) {
    throw new Error((data as any)?.error || (data as any)?.message || "Generation failed — any charge was refunded.");
  }
  return { ad, creditsUsed: num((data as any).creditsUsed), alreadyGenerated: (data as any).alreadyGenerated === true };
}

export async function deleteUgcAd(token: string | null, adId: string): Promise<void> {
  const { status, data } = await api<any>(token, "DELETE", `/api/ugc-ads/${adId}`);
  if (status !== 200) throw new Error((data as any)?.error || "Could not delete that ad.");
}

export async function fetchUgcBriefs(
  token: string | null,
  scope: "open" | "posted" | "claimed",
): Promise<UgcBriefPage> {
  const { status, data } = await api<unknown>(token, "GET", `/api/ugc-briefs?scope=${scope}`);
  if (status !== 200) throw new Error("Could not load the briefs board.");
  return normalizeUgcBriefs(data);
}

export async function postUgcBrief(
  token: string | null,
  input: { productName: string; details: string; style: string; deadline?: string; productUrl?: string; productImageUrl?: string },
): Promise<UgcBrief> {
  const { status, data } = await api<any>(token, "POST", "/api/ugc-briefs", input);
  const brief = status === 201 ? normalizeUgcBrief((data as any)?.brief) : null;
  if (!brief) throw new Error((data as any)?.error || "Could not post that brief — try again.");
  return brief;
}

export async function briefAction(
  token: string | null,
  briefId: string,
  action: BriefAction,
  body?: unknown,
): Promise<UgcBrief> {
  const { status, data } = await api<any>(token, "POST", `/api/ugc-briefs/${briefId}/${action}`, body ?? {});
  const brief = status === 200 ? normalizeUgcBrief((data as any)?.brief) : null;
  if (!brief) throw new Error((data as any)?.error || "That didn't land — refresh the board and try again.");
  return brief;
}

export async function fetchUgcAd(token: string | null, adId: string): Promise<UgcAd> {
  const { status, data } = await api<any>(token, "GET", `/api/ugc-ads/${adId}`);
  const ad = status === 200 ? normalizeUgcAd((data as any)?.ad) : null;
  if (!ad) throw new Error("Could not load that ad.");
  return ad;
}

/** Record a share on the shares rail — fired only after a share
    actually completes (the promo-cards pattern). */
export async function recordUgcAdShare(token: string | null, adId: string, channel: string): Promise<void> {
  try {
    await fetch("/api/shares", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ content_type: "video", content_id: adId, channel }),
    });
  } catch {
    /* tracking never blocks sharing */
  }
}
