/* ─── The in-world UGC Product Ads station (Stack-100 #56) ──────────
   The Promote Room's missing headline feature, docked where the
   site docks it (Promote, beside promo cards and the Scheduler) and
   riding the website panel's own seam (@/lib/ugc-ads) and rails:

     GET    /api/ugc-ads/products        my shop products (free)
     GET    /api/ugc-ads                 my ads (free)
     POST   /api/ugc-ads/script          Turbo script (free)
     POST   /api/ugc-ads/persona         persona face — 100 VB
     POST   /api/ugc-ads                 create the ad draft (free)
     POST   /api/ugc-ads/:id/generate    film it — 400 VB
     POST   /api/ugc-ads/:id/pin         pin to its product (free)
     DELETE /api/ugc-ads/:id/pin         unpin (free)
     DELETE /api/ugc-ads/:id             delete (free)
     GET    /api/ugc-briefs?scope=…      the briefs board (free)
     POST   /api/ugc-briefs              post a brief (free)
     POST   /api/ugc-briefs/:id/:action  claim/release/deliver/
                                         approve/close (free)

   Prices are the seam's own constants (persona 100 / video 400) —
   the same figures the website panel prints before anything runs.
   The charged calls ride the credit confirmation via
   confirmedFetch overrideCost (the registry carries no ugc entry;
   the override IS the desk pattern for that case). The board's
   honesty law rides along verbatim: the site does not hold or move
   money for briefs (UGC_PAYMENT_NOTE, the seam's own words). */

import {
  normalizeScript,
  type CreateUgcAdInput,
  type UgcScript,
  type UgcStyleKey,
} from "@/lib/ugc-ads";

export type UgcProductSource = "shop" | "upload";
export type UgcFaceMode = "persona" | "photo" | "none";

export interface UgcMakerState {
  productSource: UgcProductSource;
  shopProductId: string;
  productName: string;
  productBlurb: string;
  /** Dollars as typed; converted to cents for the payload. */
  productPrice: string;
  productImageUrl: string;
  style: UgcStyleKey;
  faceMode: UgcFaceMode;
  personaUrl: string;
  facePhotoUrl: string;
  hook: string;
  scriptLines: string;
  cta: string;
  briefId: string | null;
}

/** The script the maker holds, or null until hook + at least one
 *  spoken line + call to action all exist — the panel's own rule. */
export function scriptFromMaker(state: Pick<UgcMakerState, "hook" | "scriptLines" | "cta">): UgcScript | null {
  return normalizeScript({
    hook: state.hook,
    lines: state.scriptLines.split("\n"),
    cta: state.cta,
  });
}

/** The maker's refusal, in words, or null when the ad can be made.
 *  Mirrors the website panel's generateAd gates, in its order. */
export function validateUgcMaker(state: UgcMakerState): string | null {
  if (!scriptFromMaker(state)) return "The ad needs a script — write one below or let Turbo write it.";
  if (state.productSource === "shop" && !state.shopProductId) return "Pick one of your shop products first.";
  if (state.productSource === "upload" && !state.productName.trim()) return "Name the product this ad is for.";
  if (state.faceMode === "persona" && !state.personaUrl) {
    return "Generate the persona first — or switch the face to your own photo / no face.";
  }
  return null;
}

/** The product name the script writer writes about: the picked shop
 *  product's server name, or the typed upload name. */
export function makerProductName(
  state: UgcMakerState,
  products: ReadonlyArray<{ id: string; name: string }>,
): string {
  if (state.productSource === "shop") {
    return products.find((p) => p.id === state.shopProductId)?.name ?? "";
  }
  return state.productName.trim();
}

/** POST /api/ugc-ads body — the panel's createUgcAd input, verbatim
 *  in shape (only the fields the chosen source/face actually set). */
export function buildUgcCreateInput(state: UgcMakerState): CreateUgcAdInput | null {
  const script = scriptFromMaker(state);
  if (!script) return null;
  const price = state.productPrice.trim() ? Math.round(Number(state.productPrice) * 100) : undefined;
  return {
    productSource: state.productSource,
    shopProductId: state.productSource === "shop" ? state.shopProductId : undefined,
    productName: state.productSource === "upload" ? state.productName.trim() : undefined,
    productBlurb: state.productBlurb.trim() || undefined,
    productPriceCents:
      state.productSource === "upload" && price !== undefined && Number.isFinite(price) ? price : undefined,
    productImageUrl:
      state.productSource === "upload" && state.productImageUrl.trim() ? state.productImageUrl.trim() : undefined,
    style: state.style,
    faceImageUrl:
      state.faceMode === "persona"
        ? state.personaUrl
        : state.faceMode === "photo"
          ? state.facePhotoUrl.trim() || null
          : null,
    faceKind: state.faceMode === "persona" ? "persona" : state.faceMode === "photo" ? "photo" : undefined,
    script,
    briefId: state.briefId ?? undefined,
  };
}

/** A fresh persona idempotency key — a refunded attempt's key is
 *  retired, and the retry is a NEW intent (the panel's own rule). */
export function makePersonaKey(nowMs: number, rand: string): string {
  return `persona-${nowMs}-${rand}`;
}

/** The persona description gate: the panel asks for a sentence or
 *  two (10+ chars) before the 100 VB generate is even offered. */
export function personaDescriptionReady(description: string): boolean {
  return description.trim().length >= 10;
}

/* ─── Briefs ──────────────────────────────────────────────────────── */

export interface UgcBriefFormState {
  productName: string;
  details: string;
  style: UgcStyleKey;
  /** A `date` input value ("YYYY-MM-DD") or "". */
  deadline: string;
  productUrl: string;
  productImageUrl: string;
}

export function validateBriefForm(form: UgcBriefFormState): string | null {
  if (!form.productName.trim()) return "The brief needs the product's name.";
  if (form.details.trim().length < 10) return "Say a little more in the brief — what the ad has to hit (10+ characters).";
  return null;
}

/** The panel's deadline rule: the picked day, end of day local, as
 *  an ISO instant — or undefined for no deadline. */
export function briefDeadlineIso(dateValue: string): string | undefined {
  if (!dateValue) return undefined;
  const d = new Date(`${dateValue}T23:59:59`);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

export function buildBriefInput(form: UgcBriefFormState): {
  productName: string;
  details: string;
  style: string;
  deadline?: string;
  productUrl?: string;
  productImageUrl?: string;
} {
  return {
    productName: form.productName.trim(),
    details: form.details.trim(),
    style: form.style,
    deadline: briefDeadlineIso(form.deadline),
    productUrl: form.productUrl.trim() || undefined,
    productImageUrl: form.productImageUrl.trim() || undefined,
  };
}
