/* ─── Publishing splits registry (Stack-100 #3 Wave 3, #22) — pure machine ─
   The songwriter/publishing side of a song: creators register who wrote
   what share of a song. This module is the single source for the rules:

   1. Splits are creator-entered percentages. They must sum to exactly
      100 (0.01 tolerance, matching the distribution splits rail),
      each share > 0 and ≤ 100 with at most two decimal places. A lone
      songwriter at 100% is valid. NEVER invent a rate, fee, or
      default share — there is none here.
   2. This registry RECORDS splits. It does not collect or pay
      royalties: collection is partner-gated (a publishing
      administrator must be connected first). Every surface carries
      PUBLISHING_COPY.collectionNotice verbatim. The site pays nobody
      real money and this is not a payout rail.
   3. A writer linked to an on-platform account can confirm or dispute
      THEIR OWN share. A dispute FLAGS the registration — it never
      rewrites any share. Only the registering creator can revise the
      splits, and a revision resets every linked writer (other than
      the registrant) back to pending and clears the dispute flag:
      new shares need fresh confirmation.
   4. The registering creator's own writer row (when they list
      themselves) starts confirmed — they entered it. Other linked
      writers start pending; writers with no account link are
      'unlinked' and can never confirm or dispute. */

import { pgErrorCode, pgErrorText } from "./pg-errors";

export const PUBLISHING_SONG_KINDS = ["release", "song"] as const;
export type PublishingSongKind = (typeof PUBLISHING_SONG_KINDS)[number];

export const PUBLISHING_WRITER_STATUSES = ["pending", "confirmed", "disputed", "unlinked"] as const;
export type PublishingWriterStatus = (typeof PUBLISHING_WRITER_STATUSES)[number];

/* Collection is NOT connected — this is a state, not a promise. */
export const PUBLISHING_COLLECTION_STATUS = "not_connected" as const;

/* The honest label, pinned by tests on both the API and the client.
   Sentence-identical everywhere it appears. */
export const PUBLISHING_COPY = {
  collectionNotice:
    "Registered — collection activates when publishing administration is connected.",
  registryOnly:
    "This registry records songwriter (publishing) splits for a song. It does not collect or pay royalties — songwriter royalties are collected by a publishing administrator, and none is connected yet.",
  disputeRule:
    "Disputing flags this registration for review. It never changes anyone's share — only the creator who registered the song can revise the splits, and a revision asks every writer to confirm again.",
} as const;

export const PUBLISHING_SPLITS_NOT_READY = {
  error: "publishing_splits_not_ready",
  message:
    "The publishing splits registry isn't switched on yet — your song and its splits are safe to prepare, and registration opens as soon as the registry storage lands.",
  collection_status: PUBLISHING_COLLECTION_STATUS,
  collection_notice: PUBLISHING_COPY.collectionNotice,
} as const;

/** Postgres "undefined table" (42P01) for the registry tables, which
 *  exist only once the held migration lands. Real pg carries the code
 *  on the cause chain; pg-mem (the test DB) carries only the message —
 *  accept either, scoped to OUR tables so an unrelated missing table
 *  is never mistaken for "registry not migrated yet" (co-release
 *  lane's detector pattern). */
export function isMissingPublishingTable(err: unknown): boolean {
  if (pgErrorCode(err) === "42P01") return true;
  const text = pgErrorText(err);
  return /publishing_split_/.test(text) && /(does not exist|undefined table|no such table)/i.test(text);
}

export class PublishingSplitError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

/* ── Domain shapes ─────────────────────────────────────────────────────── */

export interface WriterInput {
  name: string;
  /* On-platform link — either id is enough; the route resolves the pair. */
  userId?: string | null;
  profileId?: string | null;
  sharePct: number;
}

export interface PublishingWriter {
  id: string | null;
  writerName: string;
  writerUserId: string | null;
  writerProfileId: string | null;
  sharePct: number;
  confirmationStatus: PublishingWriterStatus;
  disputeNote: string | null;
  confirmedAt: string | Date | null;
  disputedAt: string | Date | null;
}

export interface PublishingRegistration {
  id: string;
  ownerUserId: string;
  songKind: PublishingSongKind;
  songId: string;
  songTitle: string;
  hasDispute: boolean;
  createdAt: string | Date | null;
  updatedAt: string | Date | null;
  writers: PublishingWriter[];
}

export type PublishingRegistrationState =
  | "disputed" // at least one writer disputes their share — flagged, shares untouched
  | "awaiting_confirmations" // at least one linked writer hasn't answered yet
  | "confirmed" // every writer is linked and has confirmed
  | "registered"; // no one is pending, but some writers are off-platform (unlinked)

/* ── Split validation ────────────────────────────────────────────────────
   Server-side truth (routes re-run this; zod alone is not enough —
   the sum rule spans rows). Tolerance matches the distribution splits
   rail (0.01) so 33.33-style entries behave the same site-wide. */

export const SPLIT_SUM_TOLERANCE = 0.01;
export const MAX_WRITERS_PER_SONG = 20;

export function validateWriterSplits(writers: WriterInput[]): void {
  if (!Array.isArray(writers) || writers.length === 0) {
    throw new PublishingSplitError("no_writers", "Add at least one songwriter.");
  }
  if (writers.length > MAX_WRITERS_PER_SONG) {
    throw new PublishingSplitError(
      "too_many_writers",
      `A song can list at most ${MAX_WRITERS_PER_SONG} songwriters.`,
    );
  }
  const seenUsers = new Set<string>();
  for (const w of writers) {
    if (typeof w.name !== "string" || w.name.trim() === "") {
      throw new PublishingSplitError("writer_name", "Each songwriter needs a name.");
    }
    if (typeof w.sharePct !== "number" || !Number.isFinite(w.sharePct)) {
      throw new PublishingSplitError("split_invalid", "Each songwriter's share must be a number.");
    }
    if (w.sharePct <= 0 || w.sharePct > 100) {
      throw new PublishingSplitError(
        "split_range",
        "Each songwriter's share must be more than 0% and no more than 100%.",
      );
    }
    if (Math.abs(w.sharePct * 100 - Math.round(w.sharePct * 100)) > 1e-9) {
      throw new PublishingSplitError("split_precision", "Shares can have at most two decimal places.");
    }
    if (w.userId) {
      if (seenUsers.has(w.userId)) {
        throw new PublishingSplitError(
          "duplicate_writer",
          "The same account can't be listed twice on one song — combine their shares into one entry.",
        );
      }
      seenUsers.add(w.userId);
    }
  }
  const total = writers.reduce((sum, w) => sum + w.sharePct, 0);
  if (Math.abs(total - 100) > SPLIT_SUM_TOLERANCE) {
    throw new PublishingSplitError(
      "split_sum",
      `Songwriter shares must total 100% — yours total ${total.toFixed(2)}%.`,
    );
  }
}

/* ── Registration construction ─────────────────────────────────────────── */

/** Build the writer rows for a NEW registration (or an owner revision):
 *  the registrant's own linked row starts confirmed (they entered it),
 *  other linked writers start pending, unlinked writers are 'unlinked'. */
export function initialWriters(
  ownerUserId: string,
  inputs: WriterInput[],
  now: Date = new Date(),
): PublishingWriter[] {
  validateWriterSplits(inputs);
  return inputs.map((w) => {
    const linked = !!w.userId;
    const isOwner = linked && w.userId === ownerUserId;
    return {
      id: null,
      writerName: w.name.trim(),
      writerUserId: w.userId ?? null,
      writerProfileId: w.profileId ?? null,
      sharePct: w.sharePct,
      confirmationStatus: !linked ? "unlinked" : isOwner ? "confirmed" : "pending",
      disputeNote: null,
      confirmedAt: isOwner ? now : null,
      disputedAt: null,
    };
  });
}

export function deriveRegistrationState(reg: PublishingRegistration): PublishingRegistrationState {
  if (reg.hasDispute || reg.writers.some((w) => w.confirmationStatus === "disputed")) return "disputed";
  if (reg.writers.some((w) => w.confirmationStatus === "pending")) return "awaiting_confirmations";
  if (reg.writers.length > 0 && reg.writers.every((w) => w.confirmationStatus === "confirmed")) return "confirmed";
  return "registered";
}

export function writerForUser(reg: PublishingRegistration, userId: string): PublishingWriter | null {
  return reg.writers.find((w) => w.writerUserId !== null && w.writerUserId === userId) ?? null;
}

export function isRegistrationParticipant(reg: PublishingRegistration, userId: string): boolean {
  return reg.ownerUserId === userId || writerForUser(reg, userId) !== null;
}

/* ── Confirm / dispute ─────────────────────────────────────────────────── */

export type WriterAction = "confirm" | "dispute";

/** Apply ONE linked writer's action to THEIR OWN row. Pure.
 *  - confirm: from pending or disputed → confirmed (confirming a
 *    disputed share resolves that writer's dispute).
 *  - dispute: from pending or confirmed → disputed, with the flag set
 *    on the registration. The share is copied through untouched —
 *    a dispute NEVER rewrites a split.
 *  The owner confirming/disputing AS A WRITER goes through this same
 *  path (their row is a writer row like any other). */
export function applyWriterAction(
  reg: PublishingRegistration,
  actorUserId: string,
  action: WriterAction,
  opts: { note?: string | null; now?: Date } = {},
): PublishingRegistration {
  const mine = writerForUser(reg, actorUserId);
  if (!mine) {
    throw new PublishingSplitError(
      "not_a_writer",
      "Only a songwriter listed on this song with a linked account can confirm or dispute a share.",
    );
  }
  const now = opts.now ?? new Date();
  const next: PublishingRegistration = {
    ...reg,
    writers: reg.writers.map((w) => ({ ...w })),
  };
  const target = writerForUser(next, actorUserId)!;

  if (action === "confirm") {
    if (target.confirmationStatus !== "pending" && target.confirmationStatus !== "disputed") {
      throw new PublishingSplitError("not_actionable", "This share isn't waiting on your confirmation.");
    }
    target.confirmationStatus = "confirmed";
    target.confirmedAt = now;
    target.disputedAt = null;
    target.disputeNote = null;
  } else {
    if (target.confirmationStatus !== "pending" && target.confirmationStatus !== "confirmed") {
      throw new PublishingSplitError("not_actionable", "This share can't be disputed from its current state.");
    }
    target.confirmationStatus = "disputed";
    target.disputedAt = now;
    target.disputeNote = (opts.note ?? "").trim().slice(0, 500) || null;
    /* confirmedAt is kept: it records that they once confirmed; the
       current state is 'disputed'. The SHARE is deliberately not
       touched — flagging is all a dispute ever does. */
  }
  next.hasDispute = next.writers.some((w) => w.confirmationStatus === "disputed");
  return next;
}

/** Owner revision: replace the writer list wholesale. Re-validates the
 *  sum; every linked writer other than the owner returns to pending
 *  and the dispute flag clears — revised shares need fresh consent. */
export function reviseWriters(
  reg: PublishingRegistration,
  ownerUserId: string,
  inputs: WriterInput[],
  now: Date = new Date(),
): PublishingRegistration {
  if (reg.ownerUserId !== ownerUserId) {
    throw new PublishingSplitError("not_owner", "Only the creator who registered this song can revise its splits.");
  }
  return { ...reg, writers: initialWriters(ownerUserId, inputs, now), hasDispute: false };
}

/* ── Split sheet (export) ──────────────────────────────────────────────── */

/** Deterministic audit reference — stable per registration so a shared
 *  sheet can always be matched back to its record (wave8 pattern). */
export function publishingSheetCode(id: string, at: Date = new Date()): string {
  const ymd = `${at.getFullYear()}${String(at.getMonth() + 1).padStart(2, "0")}${String(at.getDate()).padStart(2, "0")}`;
  return `BDV-PUBSPLIT-${id.replace(/-/g, "").slice(0, 8).toUpperCase()}-${ymd}`;
}

function fmtDate(v: string | Date | null): string {
  if (!v) return "—";
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? "—" : d.toISOString().slice(0, 10);
}

function statusLabel(w: PublishingWriter): string {
  switch (w.confirmationStatus) {
    case "confirmed":
      return "Confirmed";
    case "disputed":
      return "Disputed — flagged for review, share unchanged";
    case "pending":
      return "Awaiting confirmation";
    default:
      return "Not on Bow Down Visuals — recorded by name only";
  }
}

/** The shareable record of a registration: plain text, safe to paste
 *  into an email or save as a file. Names + shares + states only —
 *  never account ids. Always closes with the collection notice:
 *  a split sheet must never read as a collection or payment promise. */
export function buildSplitSheet(reg: PublishingRegistration, at: Date = new Date()): string {
  const state = deriveRegistrationState(reg);
  const lines: string[] = [
    "BOW DOWN VISUALS — SONGWRITER SPLIT SHEET (PUBLISHING)",
    `Sheet: ${publishingSheetCode(reg.id, at)}`,
    `Song: ${reg.songTitle}`,
    `Song reference: ${reg.songKind}:${reg.songId}`,
    `Registered: ${fmtDate(reg.createdAt)}`,
    `Registration state: ${state}`,
    "",
    "Songwriters (publishing shares — must total 100%):",
    ...reg.writers.map(
      (w) => `- ${w.writerName} — ${w.sharePct.toFixed(2)}% — ${statusLabel(w)}`,
    ),
    "",
    ...reg.writers
      .filter((w) => w.confirmationStatus === "disputed" && w.disputeNote)
      .map((w) => `Dispute note from ${w.writerName}: ${w.disputeNote}`),
    ...(reg.writers.some((w) => w.confirmationStatus === "disputed") ? [""] : []),
    PUBLISHING_COPY.registryOnly,
    `Status: ${PUBLISHING_COPY.collectionNotice}`,
  ];
  return lines.join("\n");
}
