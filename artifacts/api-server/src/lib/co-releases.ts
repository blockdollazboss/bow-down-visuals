/* ─── Co-releases (Stack-100 #3 Wave 3) — pure split-consent machine ───────
   Phase 2 of co-posts (#24). Phase 1 (lib/co-posts.ts) put ONE Feed post
   on two profiles with both-approve consent. A co-release is the money-
   bearing sibling: ONE existing release (distribution_releases) or ONE
   existing store product (store_products) published to BOTH creators'
   profiles at once, with a royalty split BOTH creators consent to
   BEFORE anything publishes.

   Why a new ledger, not the existing splits systems:
   - distribution_royalty_splits is an owner-only versioned ledger:
     payees are names/emails, edits supersede unilaterally, and its
     invite flow never captures the second creator's in-app consent.
   - wave8 split sheets are free-form name/pct JSON with no consent.
   Neither can honestly record "creator B agreed to X% on this item".

   Hard rules this module is the single source for:
   1. Splits are creator-entered percentages for the TWO sides. They
      must sum to exactly 100 (0.01 tolerance, matching the existing
      distribution splits rail) and each side must be > 0 — a 100/0
      "co-release" is not a co-release. NO rate is invented here, and
      the platform fee is NOT part of the split: the existing rail's
      flat 5% fee is taken by that rail first; this split divides only
      the creator amount that remains (see splitCreatorAmount).
   2. BOTH sides approve the split AND the release before publish.
      The initiator's side is accepted at draft (they proposed it);
      the co-author's side starts `pending`, and while any side is
      pending the release is visible on NEITHER profile as a co-release.
   3. At the publish moment the proposed shares are FROZEN into
      `agreedShares` — an immutable snapshot. There is no action that
      mutates agreedShares after publish (amend is pre-publish only),
      so earnings attribution can never be silently renegotiated.
   4. Either side can withdraw THEIR profile's copy going forward
      (same semantics as co-posts): the item leaves their profile, the
      other creator keeps theirs. Withdrawal does NOT rewrite the
      agreed split — amounts already earned keep the agreed split, and
      the agreement snapshot itself survives withdrawal.
   5. Attribution is accounting, never a payout: the site pays nobody
      real money. splitCreatorAmount divides an already-recorded
      creator amount (logged income cents, or a store order's
      creator_amount_cents) between the two sides by the AGREED split,
      with deterministic rounding that sums exactly to the total. */

export const CO_RELEASE_ITEM_KINDS = ["release", "product"] as const;
export type CoReleaseItemKind = (typeof CO_RELEASE_ITEM_KINDS)[number];

export const CO_RELEASE_ROLES = ["author", "co_author"] as const;
export type CoReleaseRole = (typeof CO_RELEASE_ROLES)[number];

export const CO_RELEASE_SIDE_STATUSES = ["pending", "accepted", "declined", "withdrawn"] as const;
export type CoReleaseSideStatus = (typeof CO_RELEASE_SIDE_STATUSES)[number];

/** One side's share: a creator-entered percentage (0–100, ≤2dp). */
export interface CoReleaseShare {
  profileId: string;
  sharePct: number;
}

export interface CoReleaseSide {
  profileId: string;
  userId: string;
  role: CoReleaseRole;
  status: CoReleaseSideStatus;
  /* The CURRENT proposed share for this side. Mutable only while the
     co-release is unpublished (initiator amend, pre-publish). */
  sharePct: number;
  acceptedAt: string | Date | null;
}

export interface CoRelease {
  id: string;
  itemKind: CoReleaseItemKind;
  itemId: string;
  sides: CoReleaseSide[];
  /* Frozen at publish: the shares BOTH sides agreed to. Null until
     published; never changes afterwards (immutability rule). */
  agreedShares: CoReleaseShare[] | null;
  publishedAt: string | Date | null;
}

export type CoReleaseState =
  | "pending" // waiting on the co-author; not on either profile
  | "live" // both approved; on both profiles, split frozen
  | "live_one_side" // was live; one side withdrew their profile copy
  | "declined" // co-author declined pre-live; never published
  | "cancelled"; // a side withdrew pre-live; never published

export class CoReleaseError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

/* ── Split validation ──────────────────────────────────────────────────────
   Server-side truth (routes re-run this; zod alone is not enough —
   the sum rule spans both sides). Tolerance matches the distribution
   splits rail (0.01) so 33.33-style entries behave the same site-wide. */
export const SPLIT_SUM_TOLERANCE = 0.01;

export function validateSplit(shares: Array<{ sharePct: number }>): void {
  if (shares.length !== 2) {
    throw new CoReleaseError("split_sides", "A co-release split has exactly two sides — the two creators.");
  }
  for (const s of shares) {
    if (typeof s.sharePct !== "number" || !Number.isFinite(s.sharePct)) {
      throw new CoReleaseError("split_invalid", "Each side's share must be a number.");
    }
    if (s.sharePct <= 0 || s.sharePct >= 100) {
      throw new CoReleaseError(
        "split_range",
        "Each creator's share must be more than 0% and less than 100% — both creators share in a co-release.",
      );
    }
    /* ≤2 decimal places, like the numeric(5,2) rail it will be stored on. */
    if (Math.abs(s.sharePct * 100 - Math.round(s.sharePct * 100)) > 1e-9) {
      throw new CoReleaseError("split_precision", "Shares can have at most two decimal places.");
    }
  }
  const total = shares.reduce((sum, s) => sum + s.sharePct, 0);
  if (Math.abs(total - 100) > SPLIT_SUM_TOLERANCE) {
    throw new CoReleaseError(
      "split_sum",
      `Royalty shares must total 100% — yours total ${total.toFixed(2)}%.`,
    );
  }
}

/** Draft a co-release: initiator accepted (they propose the split AND
 *  the release), co-author pending BOTH approvals. Nothing is visible
 *  on either profile until the co-author accepts. */
export function initialCoRelease(
  id: string,
  item: { kind: CoReleaseItemKind; id: string },
  author: { profileId: string; userId: string; sharePct: number },
  coAuthor: { profileId: string; userId: string; sharePct: number },
  _now: Date = new Date(),
): CoRelease {
  if (author.profileId === coAuthor.profileId || author.userId === coAuthor.userId) {
    throw new CoReleaseError("same_creator", "A co-release needs two different creators.");
  }
  validateSplit([{ sharePct: author.sharePct }, { sharePct: coAuthor.sharePct }]);
  return {
    id,
    itemKind: item.kind,
    itemId: item.id,
    sides: [
      { profileId: author.profileId, userId: author.userId, role: "author", status: "accepted", sharePct: author.sharePct, acceptedAt: _now },
      { profileId: coAuthor.profileId, userId: coAuthor.userId, role: "co_author", status: "pending", sharePct: coAuthor.sharePct, acceptedAt: null },
    ],
    agreedShares: null,
    publishedAt: null,
  };
}

function hasAccepted(side: CoReleaseSide): boolean {
  return side.acceptedAt !== null && side.acceptedAt !== undefined;
}

export function coReleaseWasPublished(co: CoRelease): boolean {
  return co.agreedShares !== null && co.publishedAt !== null;
}

export function deriveCoReleaseState(co: CoRelease): CoReleaseState {
  if (coReleaseWasPublished(co)) {
    const stillOn = co.sides.filter((s) => s.status === "accepted").length;
    return stillOn >= 2 ? "live" : "live_one_side";
  }
  if (co.sides.some((s) => s.status === "declined")) return "declined";
  if (co.sides.some((s) => s.status === "withdrawn")) return "cancelled";
  return "pending";
}

export function sideFor(co: CoRelease, profileId: string): CoReleaseSide | null {
  return co.sides.find((s) => s.profileId === profileId) ?? null;
}
export function sideForUser(co: CoRelease, userId: string): CoReleaseSide | null {
  return co.sides.find((s) => s.userId === userId) ?? null;
}

/** On ONE creator's profile ⇔ published AND that side still stands.
 *  Pre-publish it is on NEITHER profile — no one-sided publish exists. */
export function isCoReleaseVisibleOnProfile(co: CoRelease, profileId: string): boolean {
  if (!coReleaseWasPublished(co)) return false;
  const side = sideFor(co, profileId);
  return !!side && side.status === "accepted";
}

export type CoReleaseAction = "accept" | "decline" | "withdraw";

/** Apply one side's consent action. Pure; only the acting side changes.
 *  Accepting as the second side PUBLISHES: agreedShares freezes to the
 *  proposed shares at that exact moment. */
export function applyCoReleaseAction(
  co: CoRelease,
  actorProfileId: string,
  action: CoReleaseAction,
  now: Date = new Date(),
): CoRelease {
  const side = sideFor(co, actorProfileId);
  if (!side) {
    throw new CoReleaseError("not_a_co_author", "Only the two creators on this co-release can do that.");
  }
  const next: CoRelease = {
    ...co,
    sides: co.sides.map((s) => ({ ...s })),
    agreedShares: co.agreedShares ? co.agreedShares.map((s) => ({ ...s })) : null,
  };
  const mine = sideFor(next, actorProfileId)!;

  if (action === "accept") {
    if (mine.status !== "pending") {
      throw new CoReleaseError("not_pending", "This co-release isn't waiting on your approval.");
    }
    if (co.sides.some((s) => s.profileId !== actorProfileId && (s.status === "withdrawn" || s.status === "declined"))) {
      throw new CoReleaseError("co_release_ended", "This co-release ended before it went live — start a new one instead.");
    }
    /* Accepting approves BOTH the release and the split as proposed.
       The shares the acceptor sees are the shares that freeze. */
    mine.status = "accepted";
    mine.acceptedAt = now;
    if (next.sides.every(hasAccepted)) {
      next.agreedShares = next.sides.map((s) => ({ profileId: s.profileId, sharePct: s.sharePct }));
      next.publishedAt = now;
    }
    return next;
  }

  if (action === "decline") {
    if (coReleaseWasPublished(co)) {
      throw new CoReleaseError("already_live", "This co-release is already live — withdraw your side instead.");
    }
    if (mine.status !== "pending") {
      throw new CoReleaseError("not_pending", "This co-release isn't waiting on your approval.");
    }
    mine.status = "declined";
    return next;
  }

  /* withdraw — MY side only, only a side that accepted. Pre-live it
     cancels the draft; post-live it removes ONLY my profile's copy.
     It never touches agreedShares: past splits do not rewrite. */
  if (mine.status !== "accepted") {
    throw new CoReleaseError("not_accepted", "Only a creator whose side is live on this co-release can withdraw it.");
  }
  mine.status = "withdrawn";
  return next;
}

/** Renegotiate the PROPOSED split — initiator only, pre-publish only.
 *  The co-author stays pending: a changed split is a new proposal they
 *  must still approve. After publish this is refused outright — the
 *  agreed split is immutable; a different split means a new co-release
 *  for future earnings, exactly like the versioned splits rail. */
export function amendProposedSplit(
  co: CoRelease,
  actorProfileId: string,
  shares: CoReleaseShare[],
): CoRelease {
  if (coReleaseWasPublished(co)) {
    throw new CoReleaseError("split_locked", "The agreed split is locked once the co-release is live — it can't be changed.");
  }
  const actor = sideFor(co, actorProfileId);
  if (!actor) {
    throw new CoReleaseError("not_a_co_author", "Only the two creators on this co-release can do that.");
  }
  if (actor.role !== "author") {
    throw new CoReleaseError("not_initiator", "Only the creator who drafted this co-release can change the proposed split before it goes live.");
  }
  if (deriveCoReleaseState(co) !== "pending") {
    throw new CoReleaseError("co_release_ended", "This co-release ended before it went live — start a new one instead.");
  }
  const byProfile = new Map(shares.map((s) => [s.profileId, s.sharePct]));
  if (byProfile.size !== 2 || co.sides.some((s) => !byProfile.has(s.profileId))) {
    throw new CoReleaseError("split_sides", "The proposed split must cover exactly the two creators on this co-release.");
  }
  validateSplit(co.sides.map((s) => ({ sharePct: byProfile.get(s.profileId)! })));
  return {
    ...co,
    sides: co.sides.map((s) => ({ ...s, sharePct: byProfile.get(s.profileId)! })),
    agreedShares: null,
    publishedAt: null,
  };
}

/* ── Attribution (read-layer accounting — never a payout) ─────────────────
   Divide a creator amount by the AGREED (frozen) split. The amount
   handed in must already be the post-fee creator amount: for store
   orders that's creator_amount_cents (the rail took its flat 5% fee
   first — the fee is never part of this split); for releases it's a
   logged money_entries income amount. Rounding: floor each side,
   then hand the remainder cents to the author side, so the shares
   ALWAYS sum exactly to the total — no cent is created or lost. */
export function splitCreatorAmount(
  co: CoRelease,
  totalCreatorCents: number,
): Array<{ profileId: string; userId: string; role: CoReleaseRole; sharePct: number; amountCents: number }> {
  if (!coReleaseWasPublished(co) || !co.agreedShares) {
    throw new CoReleaseError("not_published", "This co-release hasn't been approved by both creators yet, so there's no agreed split to apply.");
  }
  if (!Number.isInteger(totalCreatorCents) || totalCreatorCents < 0) {
    throw new CoReleaseError("amount_invalid", "The amount to split must be a whole number of cents, 0 or more.");
  }
  const agreed = new Map(co.agreedShares.map((s) => [s.profileId, s.sharePct]));
  const out = co.sides.map((s) => {
    const sharePct = agreed.get(s.profileId)!;
    return {
      profileId: s.profileId,
      userId: s.userId,
      role: s.role,
      sharePct,
      amountCents: Math.floor((totalCreatorCents * sharePct) / 100),
    };
  });
  const remainder = totalCreatorCents - out.reduce((sum, s) => sum + s.amountCents, 0);
  const authorSide = out.find((s) => s.role === "author") ?? out[0]!;
  authorSide.amountCents += remainder;
  return out;
}

/** Apply the agreed split to a list of recorded earnings (each already
 *  a post-fee creator amount). Withdrawal state is irrelevant here by
 *  design: the agreement was consented to at publish, and amounts
 *  earned under it keep its split — history does not rewrite. */
export function attributeEarnings(
  co: CoRelease,
  earnings: Array<{ id: string; amountCents: number }>,
): {
  entries: Array<{ id: string; amountCents: number; shares: ReturnType<typeof splitCreatorAmount> }>;
  totals: ReturnType<typeof splitCreatorAmount>;
  totalCents: number;
} {
  const entries = earnings.map((e) => ({
    id: e.id,
    amountCents: e.amountCents,
    shares: splitCreatorAmount(co, e.amountCents),
  }));
  const totalCents = earnings.reduce((sum, e) => sum + e.amountCents, 0);
  /* Totals are computed from the TOTAL, not by summing per-entry
     remainders — the remainder rule stays deterministic per call. */
  const totals = splitCreatorAmount(co, totalCents);
  return { entries, totals, totalCents };
}

/** Postgres "undefined table" (42P01) for the co-release tables, which
 *  exist only once the held migration lands. Mirrors lib/co-posts. */
export function isMissingCoReleaseTable(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: string; message?: string; cause?: { code?: string; message?: string } };
  if (e.code === "42P01") return true;
  const msg = `${e.message ?? ""} ${e.cause?.message ?? ""}`;
  return /co_release/.test(msg) && /(does not exist|undefined table|no such table)/i.test(msg);
}

export const CO_RELEASE_NOT_READY = {
  error: "co_release_not_ready",
  message:
    "Co-releases are almost ready — the final setup step hasn't landed yet, so nothing was published and no split was agreed. Your collaborator hasn't been notified.",
} as const;

export const CO_RELEASE_CONSENT_COPY = {
  bothApproveSplit:
    "Both creators must approve the royalty split and the release before a co-release goes live on either profile.",
  feeOutsideSplit:
    "The split divides what the creators earn together. The platform's flat 5% fee is taken by the store rail first and is never part of the split.",
  lockedAtPublish:
    "The split you both approve is locked in when the co-release goes live and can't be changed afterwards.",
  withdraw:
    "Either creator can withdraw their own side at any time: the release leaves their profile, the other creator keeps theirs, and splits already agreed for earnings stay as agreed.",
} as const;
