import type { ProductSplitDTO, ProductSplitInput } from "@/lib/storefront-api";

/* ── Co-seller splits editor math (Wave 4 #36, FE half) ──────────────────
   The pure half of the splits editor: the server machine lives in the
   API's lib/sale-splits (validateProductSplits) and these helpers mirror
   its contract exactly so the UI never offers a split the server would
   refuse:

   - the list holds every seller INCLUDING the owner, shares sum to
     exactly 100, each share is (0, 100] with at most two decimals,
     at most 20 sellers total, no account twice;
   - the owner's share is DERIVED in the editor (100 − the co-sellers'
     total) — "owner share auto-balances" — so the sum can only break
     by the co-sellers crowding the owner out entirely;
   - a lone owner at 100% is "no split": the payload collapses to null.

   All math runs in hundredths of a percent (integers) so 33.33 + 33.33
   + 33.34 is exactly 10000, never a float ghost. */

export const MAX_SELLERS_PER_PRODUCT = 20;
export const MAX_CO_SELLERS = MAX_SELLERS_PER_PRODUCT - 1;

/** One co-seller row in the editor. The owner is NOT a row — their
    share is derived. `sharePct` is the raw input string so the field
    can hold half-typed values ("33.") without fighting the user. */
export interface SplitCoSellerDraft {
  userId: string;
  name: string | null;
  slug: string | null;
  avatarUrl: string | null;
  sharePct: string;
}

export type SplitsDraftError =
  | "share-not-a-number"
  | "share-range"
  | "share-precision"
  | "duplicate-seller"
  | "self-listed"
  | "too-many-sellers"
  | "owner-crowded-out";

/** Parse a raw share string to hundredths of a percent, or null when
    the text isn't a clean ≤2dp number. "" is null (not a number yet). */
export function shareToHundredths(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return null;
  const hundredths = Math.round(n * 100);
  if (Math.abs(n * 100 - hundredths) > 1e-9) return null;
  return hundredths;
}

/** The co-sellers' combined share in hundredths, counting only rows
    whose share parses — unparseable rows are validation's problem,
    surfaced by validateSplitsDraft, not silently zeroed here. */
export function coSellerTotalHundredths(drafts: SplitCoSellerDraft[]): number {
  return drafts.reduce((sum, d) => sum + (shareToHundredths(d.sharePct) ?? 0), 0);
}

/** The owner's derived share in percent (two-decimal exact). With no
    co-sellers this is 100 — the "no split" state. */
export function ownerSharePct(drafts: SplitCoSellerDraft[]): number {
  return (10000 - coSellerTotalHundredths(drafts)) / 100;
}

export type SplitsDraftValidation =
  | { ok: true }
  | { ok: false; reason: SplitsDraftError };

/** Mirror of the server's validateProductSplits over the editor's
    draft shape (owner derived). An empty draft list is valid — it IS
    the no-split state. */
export function validateSplitsDraft(
  ownerUserId: string,
  drafts: SplitCoSellerDraft[],
): SplitsDraftValidation {
  if (drafts.length > MAX_CO_SELLERS) return { ok: false, reason: "too-many-sellers" };
  const seen = new Set<string>();
  let totalHundredths = 0;
  for (const d of drafts) {
    if (d.userId === ownerUserId) return { ok: false, reason: "self-listed" };
    if (seen.has(d.userId)) return { ok: false, reason: "duplicate-seller" };
    seen.add(d.userId);
    const trimmed = d.sharePct.trim();
    const n = Number(trimmed);
    if (!trimmed || !Number.isFinite(n)) return { ok: false, reason: "share-not-a-number" };
    if (n <= 0 || n > 100) return { ok: false, reason: "share-range" };
    const hundredths = shareToHundredths(d.sharePct);
    if (hundredths === null) return { ok: false, reason: "share-precision" };
    totalHundredths += hundredths;
  }
  /* The owner must hold a share: co-sellers totalling 100%+ leaves
     the owner at zero or below, which the server refuses. */
  if (totalHundredths >= 10000) return { ok: false, reason: "owner-crowded-out" };
  return { ok: true };
}

/** The write payload: owner first with the derived share, then the
    co-sellers — or null when there are no co-sellers (the server's
    collapse-to-off state). Callers must validate first; an invalid
    draft returns null here too rather than a payload the server
    would refuse. */
export function splitsPayload(
  ownerUserId: string,
  drafts: SplitCoSellerDraft[],
): ProductSplitInput[] | null {
  if (drafts.length === 0) return null;
  if (!validateSplitsDraft(ownerUserId, drafts).ok) return null;
  return [
    { userId: ownerUserId, sharePct: ownerSharePct(drafts) },
    ...drafts.map((d) => ({
      userId: d.userId,
      sharePct: (shareToHundredths(d.sharePct) ?? 0) / 100,
    })),
  ];
}

/** Editor drafts from a presented splits list (the owner's own entry
    is dropped — it's derived, never a row). Accepts both presented
    shapes: store products carry name/slug, shop products present the
    bare { userId, sharePct } list. */
export function draftsFromPresented(
  splits:
    | ReadonlyArray<Pick<ProductSplitDTO, "userId" | "sharePct"> & Partial<Pick<ProductSplitDTO, "name" | "slug">>>
    | null
    | undefined,
  ownerUserId: string,
): SplitCoSellerDraft[] {
  if (!splits) return [];
  return splits
    .filter((s) => s.userId !== ownerUserId)
    .map((s) => ({
      userId: s.userId,
      name: s.name ?? null,
      slug: s.slug ?? null,
      avatarUrl: null,
      sharePct: String(s.sharePct),
    }));
}
