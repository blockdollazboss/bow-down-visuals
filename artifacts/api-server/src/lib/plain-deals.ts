/* ─── Plain-Words Deals (Stack-200 upgrade #164) — pure deal machine ──────
   The Contracts surface at base is an ANALYZER: paste a deal, get an AI
   review. There is no way to WRITE a deal with another creator, sign it,
   or have its terms take effect. This module is that missing half:

   A plain-words deal is a collab agreement written the way people talk:
   what each side DOES and what each side GETS, in words both sides
   actually understand — no legalese wall. Both sides sign in-app (typed
   signature recorded against the exact words). The moment both have
   signed, the deal's split terms are FROZEN and become the splits on
   the work through the EXISTING rails (see routes/plain-deals.ts):
   a co-release for a release/product, the sale-splits setting for a
   store/shop product. This module builds NO second splits machine —
   split validation itself is the co-releases machine's (validateSplit),
   imported, not copied.

   Hard rules (mirroring the co-releases consent discipline):
   1. The author drafts and signs their own words at draft. The partner
      signs the SAME words or declines them. Nothing is agreed while
      any side is unsigned.
   2. ANY change to the words or the split (author, pre-signature only)
      un-signs the partner: nobody is ever bound by words they didn't
      sign. The author re-signs by making the change.
   3. At full signature the split freezes into `agreedShares` and the
      full agreement text freezes into `signedText`. Neither can be
      mutated afterwards — a different deal is a new deal.
   4. After signing, a side may record a withdrawal (they're stepping
      back going forward). Withdrawal never rewrites the agreed split
      or the signed text: what was signed stays signed, exactly like
      the co-release rule that past splits do not rewrite.
   5. The platform fee is never part of a deal split: the rails take
      their fee first and the split divides the creator amount, same
      as co-releases and sale-splits. */

import { validateSplit, CoReleaseError } from "./co-releases";

/* Deals throw the shared CoReleaseError shape ({ code, message }) so the
   routes render deal and co-release errors identically. */
export { CoReleaseError as PlainDealError };

export const PLAIN_DEAL_ITEM_KINDS = ["release", "product", "store_product", "shop_product", "general"] as const;
export type PlainDealItemKind = (typeof PLAIN_DEAL_ITEM_KINDS)[number];

export const PLAIN_DEAL_ROLES = ["author", "partner"] as const;
export type PlainDealRole = (typeof PLAIN_DEAL_ROLES)[number];

export const PLAIN_DEAL_SIDE_STATUSES = ["pending", "signed", "declined", "withdrawn"] as const;
export type PlainDealSideStatus = (typeof PLAIN_DEAL_SIDE_STATUSES)[number];

/** Which existing rail a signed deal's split was wired into, if any. */
export type PlainDealSplitAttach =
  | { rail: "co_release"; refId: string; at: string | Date }
  | { rail: "sale_splits"; refId: string; at: string | Date }
  | null;

export interface PlainDealSide {
  profileId: string;
  userId: string;
  role: PlainDealRole;
  /** What this side does — plain words, written by the author, signed
   *  by both sides as part of the agreement text. */
  doesText: string;
  /** What this side gets — plain words. */
  getsText: string;
  /** This side's share of the split (creator-entered %, sums to 100
   *  across both sides — validated by the co-releases machine). */
  sharePct: number;
  status: PlainDealSideStatus;
  /** The typed in-app signature (the signer's name as they typed it)
   *  and when they signed. Null while unsigned. */
  signedName: string | null;
  signedAt: string | Date | null;
}

export interface PlainDeal {
  id: string;
  /** What the collab is, in plain words ("Our song 'Midnight Run'"). */
  title: string;
  itemKind: PlainDealItemKind;
  itemId: string | null;
  itemTitle: string;
  sides: [PlainDealSide, PlainDealSide];
  /** Frozen at full signature; null until then; never changes after. */
  agreedShares: Array<{ profileId: string; userId: string; sharePct: number }> | null;
  /** The full agreement text exactly as signed; null until then. */
  signedText: string | null;
  signedAt: string | Date | null;
  /** Set by the route layer when the frozen split is written into an
   *  existing rail. Null = the split is on record in this deal only. */
  splitAttach: PlainDealSplitAttach;
}

export type PlainDealState =
  | "awaiting_signature" // partner hasn't signed yet; nothing agreed
  | "signed" // both signed; terms frozen; split live (attached or on record)
  | "signed_one_withdrawn" // signed, then one side stepped back (terms stand)
  | "declined" // partner declined before signing; never agreed
  | "cancelled"; // author withdrew before signature; never agreed

export const PLAIN_WORDS_LIMITS = {
  titleMax: 120,
  sideTextMax: 600,
  sideTextMin: 3,
} as const;

function cleanText(value: string, field: string, max: number): string {
  const v = (value ?? "").trim();
  if (v.length < PLAIN_WORDS_LIMITS.sideTextMin) {
    throw new CoReleaseError("words_missing", `Say ${field} in plain words — a few words is enough, but it can't be blank.`);
  }
  if (v.length > max) {
    throw new CoReleaseError("words_too_long", `${field} is too long — keep it to ${max} characters of plain words.`);
  }
  return v;
}

export function dealWasSigned(deal: PlainDeal): boolean {
  return deal.agreedShares !== null && deal.signedAt !== null && deal.signedText !== null;
}

export function derivePlainDealState(deal: PlainDeal): PlainDealState {
  if (dealWasSigned(deal)) {
    return deal.sides.some((s) => s.status === "withdrawn") ? "signed_one_withdrawn" : "signed";
  }
  if (deal.sides.some((s) => s.status === "declined")) return "declined";
  if (deal.sides.some((s) => s.status === "withdrawn")) return "cancelled";
  return "awaiting_signature";
}

export function dealSideFor(deal: PlainDeal, profileId: string): PlainDealSide | null {
  return deal.sides.find((s) => s.profileId === profileId) ?? null;
}
export function dealSideForUser(deal: PlainDeal, userId: string): PlainDealSide | null {
  return deal.sides.find((s) => s.userId === userId) ?? null;
}

/** Render the whole agreement in plain words — the exact text both
 *  sides sign. Deliberately free of legalese: names, does/gets, the
 *  split, and the three house facts (fee outside the split, locked
 *  once signed, either side can step back going forward). */
export function renderPlainDealText(
  deal: Pick<PlainDeal, "title" | "itemKind" | "itemTitle" | "sides">,
  names: { authorName: string; partnerName: string },
): string {
  const [a, b] = deal.sides;
  const work =
    deal.itemKind === "general"
      ? `The work: ${deal.title}.`
      : `The work: ${deal.title} — ${deal.itemTitle}.`;
  return [
    `A plain-words deal between ${names.authorName} and ${names.partnerName}.`,
    work,
    ``,
    `${names.authorName} does: ${a.doesText}`,
    `${names.authorName} gets: ${a.getsText}`,
    ``,
    `${names.partnerName} does: ${b.doesText}`,
    `${names.partnerName} gets: ${b.getsText}`,
    ``,
    `When money comes in from this work, after the site's fee comes off the top, what's left is split like this: ${names.authorName} ${a.sharePct}% / ${names.partnerName} ${b.sharePct}%.`,
    `Once both of us sign, these words and this split are locked — changing them means making a new deal together.`,
    `Either of us can step back later. Stepping back doesn't change this split for money already earned under it.`,
  ].join("\n");
}

/** Draft a deal. The author writes all four plain-words fields and
 *  signs at draft (they wrote it, they stand behind it); the partner
 *  starts pending — the deal binds nobody until they sign too. */
export function initialPlainDeal(
  id: string,
  input: {
    title: string;
    itemKind: PlainDealItemKind;
    itemId: string | null;
    itemTitle: string;
    author: { profileId: string; userId: string; doesText: string; getsText: string; sharePct: number; signedName: string };
    partner: { profileId: string; userId: string; doesText: string; getsText: string; sharePct: number };
  },
  now: Date = new Date(),
): PlainDeal {
  if (input.author.profileId === input.partner.profileId || input.author.userId === input.partner.userId) {
    throw new CoReleaseError("same_creator", "A deal needs two different creators.");
  }
  const title = cleanText(input.title, "what this deal is about", PLAIN_WORDS_LIMITS.titleMax);
  /* The split is validated by the EXISTING co-releases machine — the
     same sum/precision/range rules every split on the site obeys. */
  validateSplit([{ sharePct: input.author.sharePct }, { sharePct: input.partner.sharePct }]);
  const signedName = (input.author.signedName ?? "").trim();
  if (!signedName) {
    throw new CoReleaseError("signature_missing", "Type your name to sign your side of the deal.");
  }
  return {
    id,
    title,
    itemKind: input.itemKind,
    itemId: input.itemId,
    itemTitle: input.itemTitle,
    sides: [
      {
        profileId: input.author.profileId,
        userId: input.author.userId,
        role: "author",
        doesText: cleanText(input.author.doesText, "what you do", PLAIN_WORDS_LIMITS.sideTextMax),
        getsText: cleanText(input.author.getsText, "what you get", PLAIN_WORDS_LIMITS.sideTextMax),
        sharePct: input.author.sharePct,
        status: "signed",
        signedName,
        signedAt: now,
      },
      {
        profileId: input.partner.profileId,
        userId: input.partner.userId,
        role: "partner",
        doesText: cleanText(input.partner.doesText, "what they do", PLAIN_WORDS_LIMITS.sideTextMax),
        getsText: cleanText(input.partner.getsText, "what they get", PLAIN_WORDS_LIMITS.sideTextMax),
        sharePct: input.partner.sharePct,
        status: "pending",
        signedName: null,
        signedAt: null,
      },
    ],
    agreedShares: null,
    signedText: null,
    signedAt: null,
    splitAttach: null,
  };
}

export type PlainDealAction = "sign" | "decline" | "withdraw";

/** Apply one side's action. Pure; only the acting side changes —
 *  except the sign that completes the pair, which freezes the agreed
 *  split AND the signed text in the same step. */
export function applyPlainDealAction(
  deal: PlainDeal,
  actorProfileId: string,
  action: PlainDealAction,
  opts: { signedName?: string; authorName: string; partnerName: string },
  now: Date = new Date(),
): PlainDeal {
  const side = dealSideFor(deal, actorProfileId);
  if (!side) {
    throw new CoReleaseError("not_a_party", "Only the two creators on this deal can do that.");
  }
  const next: PlainDeal = {
    ...deal,
    sides: deal.sides.map((s) => ({ ...s })) as [PlainDealSide, PlainDealSide],
    agreedShares: deal.agreedShares ? deal.agreedShares.map((s) => ({ ...s })) : null,
  };
  const mine = dealSideFor(next, actorProfileId)!;

  if (action === "sign") {
    if (dealWasSigned(deal)) {
      throw new CoReleaseError("already_signed", "This deal is already signed by both sides — its words and split are locked.");
    }
    if (mine.status !== "pending") {
      throw new CoReleaseError("not_pending", "This deal isn't waiting on your signature.");
    }
    if (deal.sides.some((s) => s.profileId !== actorProfileId && (s.status === "declined" || s.status === "withdrawn"))) {
      throw new CoReleaseError("deal_ended", "This deal ended before it was signed — start a new one instead.");
    }
    const signedName = (opts.signedName ?? "").trim();
    if (!signedName) {
      throw new CoReleaseError("signature_missing", "Type your name to sign the deal.");
    }
    mine.status = "signed";
    mine.signedName = signedName;
    mine.signedAt = now;
    if (next.sides.every((s) => s.status === "signed")) {
      next.agreedShares = next.sides.map((s) => ({ profileId: s.profileId, userId: s.userId, sharePct: s.sharePct }));
      next.signedAt = now;
      next.signedText = renderPlainDealText(next, { authorName: opts.authorName, partnerName: opts.partnerName });
    }
    return next;
  }

  if (action === "decline") {
    if (dealWasSigned(deal)) {
      throw new CoReleaseError("already_signed", "This deal is already signed — stepping back is done with withdraw, and the signed split still stands.");
    }
    if (mine.status !== "pending") {
      throw new CoReleaseError("not_pending", "This deal isn't waiting on your signature.");
    }
    mine.status = "declined";
    return next;
  }

  /* withdraw — a side that signed can step back. Before full signature
     it cancels the deal; after, it is recorded on their side only and
     the frozen terms stand (rule 4). A pending side has nothing to
     withdraw — declining is their move. */
  if (mine.status !== "signed") {
    throw new CoReleaseError("not_signed", "Only a creator who signed this deal can withdraw from it.");
  }
  mine.status = "withdrawn";
  return next;
}

/** Rewrite the words/split — author only, before full signature only.
 *  Changing the deal un-signs the partner (rule 2): they must sign the
 *  NEW words. The author re-signs in the same step — making the change
 *  is their signature on it — so the author side needs a fresh typed
 *  signature too. */
export function amendPlainDeal(
  deal: PlainDeal,
  actorProfileId: string,
  input: {
    title: string;
    author: { doesText: string; getsText: string; sharePct: number; signedName: string };
    partner: { doesText: string; getsText: string; sharePct: number };
  },
  now: Date = new Date(),
): PlainDeal {
  if (dealWasSigned(deal)) {
    throw new CoReleaseError("deal_locked", "This deal is signed and locked — a different deal means a new deal.");
  }
  const actor = dealSideFor(deal, actorProfileId);
  if (!actor) {
    throw new CoReleaseError("not_a_party", "Only the two creators on this deal can do that.");
  }
  if (actor.role !== "author") {
    throw new CoReleaseError("not_author", "Only the creator who wrote this deal can change it before it is signed.");
  }
  if (derivePlainDealState(deal) !== "awaiting_signature") {
    throw new CoReleaseError("deal_ended", "This deal ended before it was signed — start a new one instead.");
  }
  validateSplit([{ sharePct: input.author.sharePct }, { sharePct: input.partner.sharePct }]);
  const signedName = (input.author.signedName ?? "").trim();
  if (!signedName) {
    throw new CoReleaseError("signature_missing", "Type your name to sign the changed deal.");
  }
  const [a, b] = deal.sides;
  return {
    ...deal,
    title: cleanText(input.title, "what this deal is about", PLAIN_WORDS_LIMITS.titleMax),
    sides: [
      {
        ...a,
        doesText: cleanText(input.author.doesText, "what you do", PLAIN_WORDS_LIMITS.sideTextMax),
        getsText: cleanText(input.author.getsText, "what you get", PLAIN_WORDS_LIMITS.sideTextMax),
        sharePct: input.author.sharePct,
        status: "signed",
        signedName,
        signedAt: now,
      },
      {
        ...b,
        doesText: cleanText(input.partner.doesText, "what they do", PLAIN_WORDS_LIMITS.sideTextMax),
        getsText: cleanText(input.partner.getsText, "what they get", PLAIN_WORDS_LIMITS.sideTextMax),
        sharePct: input.partner.sharePct,
        status: "pending",
        signedName: null,
        signedAt: null,
      },
    ],
    agreedShares: null,
    signedText: null,
    signedAt: null,
    splitAttach: null,
  };
}

/** Postgres "undefined table" (42P01) for the plain_deals table, which
 *  exists only once the provisional migration lands. Mirrors
 *  isMissingCoReleaseTable. */
export function isMissingPlainDealTable(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: string; message?: string; cause?: { code?: string; message?: string } };
  if (e.code === "42P01") return true;
  const msg = `${e.message ?? ""} ${e.cause?.message ?? ""}`;
  return /plain_deal/.test(msg) && /(does not exist|undefined table|no such table)/i.test(msg);
}

export const PLAIN_DEAL_NOT_READY = {
  error: "plain_deal_not_ready",
  message:
    "Plain-words deals are almost ready — the final setup step hasn't landed yet, so nothing was saved and no split was attached. Your collaborator hasn't been notified.",
} as const;

export const PLAIN_DEAL_COPY = {
  feeOutsideSplit:
    "The split divides what the two creators earn together. The site's fee comes off the top first and is never part of the split.",
  lockedAtSignature:
    "Once both sides sign, the words and the split are locked. Changing them means making a new deal.",
  attachCoRelease:
    "Because this deal names a release or product, signing wires its split straight into that work's co-release — nobody re-types the numbers.",
  attachSaleSplits:
    "Because this deal names a store product, signing writes its split straight onto that product's co-seller split — nobody re-types the numbers.",
  attachRecordOnly:
    "This deal doesn't name a specific release or product yet, so its split is the agreement on record. Attach it to a release or product any time and the numbers wire themselves in.",
} as const;
