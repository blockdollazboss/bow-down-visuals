/* ─── Gift cards in the World — the palace's gift-card rails ───────
   Gift cards are stored value for ONE creator's store (Stack-100 #3
   item 26): bought on the gift-card checkout rail (delivery goes to
   the RECIPIENT's email — the buyer is never the end user), issued
   exactly once by the verify rail, checked by code on the public
   balance rail (the code is the capability), and spent as tender
   beside the discount code on the store / shops / storefront
   checkouts. The website's surfaces are the product page (buy +
   tender) and the shop page (tender); the World's are the Creator
   Room store (buy + tender) and the Marketplace stand (tender +
   the balance/mine desk at the square).

   Everything here is the pure half — payload builders in the exact
   shapes the website sends, and tolerant parsers for the rails'
   answers. Money truth only ever comes from those answers: a card
   is issued when VERIFY says so, a balance is what the BALANCE
   rail says, never a local guess. */

import type { RoomStoreItem } from "./money-desks";

/** A catalog item is a gift card when it is a store product whose
 *  own kind says so — the catalog carries the product kind through
 *  (buildStoreCatalog), and the gift-card checkout rail is the only
 *  rail that can sell it: the product checkout refuses it by name
 *  (GIFT_CARD_CHECKOUT), because delivery needs a recipient. */
export function isGiftCardItem(item: RoomStoreItem): boolean {
  return item.kind === "product" && item.productKind === "gift_card";
}

/* ─── The buy form ───────────────────────────────────────────────── */

export interface GiftCardFormState {
  /** The picked amount (cents); null = the seller's first amount. */
  amountCents: number | null;
  recipientEmail: string;
  recipientName: string;
  message: string;
}

export function emptyGiftCardForm(): GiftCardFormState {
  return { amountCents: null, recipientEmail: "", recipientName: "", message: "" };
}

/** The amount a checkout would charge: the pick, or the seller's
 *  first offered amount (the product page's own default). */
export function giftCardFormAmount(
  form: GiftCardFormState,
  denominations: number[] | null,
): number | null {
  if (form.amountCents !== null) return form.amountCents;
  return denominations && denominations.length > 0 ? denominations[0]! : null;
}

/** The form's problem, in the product page's own words where the
 *  page has them — or null when the buy can start. The rail
 *  re-validates everything (recipient email shape, the amount
 *  against the seller's list); this only saves a doomed trip. */
export function giftCardFormProblem(
  form: GiftCardFormState,
  denominations: number[] | null,
): string | null {
  if (!denominations || denominations.length === 0) {
    return "This gift card has no amounts to pick from yet — the seller hasn't set any.";
  }
  const amount = giftCardFormAmount(form, denominations);
  if (amount === null) return "Pick an amount first.";
  if (!denominations.includes(amount)) return "Pick one of the offered amounts.";
  if (!form.recipientEmail.trim()) {
    return "Add the recipient's email — the gift card is delivered there, not to you.";
  }
  return null;
}

/** POST /api/gift-cards/checkout — the product page's exact body:
 *  the amount from the seller's denominations, delivery to the
 *  recipient, optional name/message only when written, and the
 *  embedded ask only when this device can mount the form (the
 *  page's own discipline — otherwise the rail answers the hosted
 *  shape and the caller opens its one marked transfer). */
export function giftCardCheckoutPayload(
  productId: string,
  form: GiftCardFormState,
  denominations: number[] | null,
  embedded: boolean,
): Record<string, unknown> | null {
  const amount = giftCardFormAmount(form, denominations);
  if (amount === null || !form.recipientEmail.trim()) return null;
  return {
    productId,
    amountCents: amount,
    recipientEmail: form.recipientEmail.trim(),
    ...(form.recipientName.trim() ? { recipientName: form.recipientName.trim() } : {}),
    ...(form.message.trim() ? { message: form.message.trim() } : {}),
    ...(embedded ? { uiMode: "embedded" } : {}),
  };
}

/* ─── The rails' answers ─────────────────────────────────────────── */

/** One card as the rails present it (lib/gift-cards presentCard):
 *  identity + truth, never the code — the code exists in plaintext
 *  only in the issuance answer and the recipient's email. */
export interface GiftCardView {
  id: string;
  codeLast4: string;
  status: string;
  initialCents: number;
  balanceCents: number;
  availableCents: number;
  recipientEmail: string;
  storeName: string | null;
  createdAt: string;
}

function numOr(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

export function parseGiftCardView(raw: unknown): GiftCardView | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r["id"] !== "string" || !r["id"]) return null;
  return {
    id: r["id"],
    codeLast4: typeof r["codeLast4"] === "string" ? r["codeLast4"] : "",
    status: typeof r["status"] === "string" ? r["status"] : "",
    initialCents: numOr(r["initialCents"], 0),
    balanceCents: numOr(r["balanceCents"], 0),
    availableCents: numOr(r["availableCents"], numOr(r["balanceCents"], 0)),
    recipientEmail: typeof r["recipientEmail"] === "string" ? r["recipientEmail"] : "",
    storeName: typeof r["storeName"] === "string" ? r["storeName"] : null,
    createdAt: typeof r["createdAt"] === "string" ? r["createdAt"] : "",
  };
}

/** POST /api/gift-cards/verify — the issuance answer. The code is
 *  present exactly once (the fresh issuance); a duplicate verify
 *  answers code: null with the rail's own note saying why. */
export interface GiftCardVerifyResult {
  duplicate: boolean;
  code: string | null;
  codeNote: string;
  card: GiftCardView | null;
}

export function parseGiftCardVerify(payload: unknown): GiftCardVerifyResult | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  if (p["success"] !== true) return null;
  return {
    duplicate: p["duplicate"] === true,
    code: typeof p["code"] === "string" ? p["code"] : null,
    codeNote: typeof p["codeNote"] === "string" ? p["codeNote"] : "",
    card: parseGiftCardView(p["card"]),
  };
}

export type GiftCardVerifyState = "issued" | "pending" | "dead";

/** The three honest outcomes of asking verify about a session —
 *  the Crowns stand's membershipVerifyState discipline, on this
 *  rail's own answers: a success answer means the card issued (or
 *  already had); the rail's "Payment has not been completed." 400
 *  means the money hasn't landed yet, so the stash stays and the
 *  walker can check again; anything else means the session is
 *  closed and nothing will ever issue from it. */
export function giftCardVerifyState(status: number, payload: unknown): GiftCardVerifyState {
  if (status === 200 && parseGiftCardVerify(payload)) return "issued";
  if (
    status === 400 &&
    payload &&
    typeof payload === "object" &&
    (payload as { error?: unknown }).error === "Payment has not been completed."
  ) {
    return "pending";
  }
  return "dead";
}

/** GET /api/gift-cards/balance — the public truth for one code. */
export interface GiftCardBalanceView {
  codeLast4: string;
  status: string;
  balanceCents: number;
  balance: string;
  availableCents: number;
  initialCents: number;
  storeName: string | null;
  storeUrl: string | null;
}

export function parseGiftCardBalance(payload: unknown): GiftCardBalanceView | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  const card = p["card"];
  if (!card || typeof card !== "object") return null;
  const c = card as Record<string, unknown>;
  const store = p["store"];
  const s = store && typeof store === "object" ? (store as Record<string, unknown>) : null;
  return {
    codeLast4: typeof c["codeLast4"] === "string" ? c["codeLast4"] : "",
    status: typeof c["status"] === "string" ? c["status"] : "",
    balanceCents: numOr(c["balanceCents"], 0),
    balance: typeof c["balance"] === "string" ? c["balance"] : "",
    availableCents: numOr(c["availableCents"], numOr(c["balanceCents"], 0)),
    initialCents: numOr(c["initialCents"], 0),
    storeName: s && typeof s["name"] === "string" ? s["name"] : null,
    storeUrl: s && typeof s["url"] === "string" ? s["url"] : null,
  };
}

/** GET /api/gift-cards/mine — the cards I bought and the cards sent
 *  to my account email. Either list may be absent in a malformed
 *  answer; whole-answer garbage parses to null (the desk shows its
 *  failed state, never an invented empty wallet). */
export function parseGiftCardsMine(
  payload: unknown,
): { bought: GiftCardView[]; received: GiftCardView[] } | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  if (!Array.isArray(p["bought"]) && !Array.isArray(p["received"])) return null;
  const list = (v: unknown): GiftCardView[] =>
    Array.isArray(v)
      ? v.map((row) => parseGiftCardView(row)).filter((c): c is GiftCardView => c !== null)
      : [];
  return { bought: list(p["bought"]), received: list(p["received"]) };
}

/** Did this checkout answer say the gift card covered the whole
 *  bill? All three tender rails answer { paid: true,
 *  paidWithGiftCard: true } with NO payment page when the card
 *  covers everything — a stand that only looks for a URL or a
 *  client secret would call that success a failure. */
export function paidWithGiftCard(payload: unknown): boolean {
  if (!payload || typeof payload !== "object") return false;
  const p = payload as Record<string, unknown>;
  return p["paidWithGiftCard"] === true && p["paid"] === true;
}

/** The localStorage key holding a gift purchase's unfinished
 *  session at a room/desk, so returning refreshes ITS issuance
 *  from the server instead of forgetting the card (or pretending
 *  it issued). The market/membership pending keys' discipline. */
export function giftCardPendingKey(scope: string): string {
  return `bdv-gift-card-pending-${scope}`;
}

export interface GiftCardPending {
  sessionId: string;
  productId: string;
  title: string;
}

export function parseGiftCardPending(raw: string | null): GiftCardPending | null {
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as Record<string, unknown>;
    if (typeof p["sessionId"] !== "string" || !p["sessionId"]) return null;
    return {
      sessionId: p["sessionId"],
      productId: typeof p["productId"] === "string" ? p["productId"] : "",
      title: typeof p["title"] === "string" ? p["title"] : "",
    };
  } catch {
    return null;
  }
}
