/* ─── Remix the King (Stack-200 audit #152, TRULY NEW) ───────────────
   A MONTHLY HOUSE EVENT: the King (Thy Cheat Code, the house artist)
   drops a track; members remix it; the WINNING REMIX BECOMES AN
   OFFICIAL RELEASE under splits published IN WRITING UP FRONT.

   Reuse, never rebuild: the event/entry/vote shape follows the
   existing Contests + World Contests + Challenge Engine patterns, the
   release row links into the existing distribution rail
   (distribution_release_id, null until a package is really prepared
   there — never faked), and split payments run on the strict
   credit_usage ledger exactly like Pitch & Fix rewards (see
   lib/remix-king-payments.ts).

   SPLITS LAW: splits are authored by the house at creation, must sum
   to exactly 100, and are FROZEN the moment the event leaves draft —
   entrants see the exact written splits before they enter, and the
   winner's release snapshots them verbatim (winner role bound to the
   winning member). No default split is invented anywhere.

   MONEY: Visual Bucs ONLY, TEST MODE — no cash path exists. One entry
   per member per event; one vote per member per entry; one official
   release per event. */

import {
  db,
  remixKingEventsTable,
  remixKingEntriesTable,
  remixKingVotesTable,
  remixKingReleasesTable,
  remixKingSplitPaymentsTable,
  REMIX_KING_EVENT_STATUSES,
  REMIX_KING_SPLIT_ROLES,
  type RemixKingSplit,
} from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";

export type EventStatus = (typeof REMIX_KING_EVENT_STATUSES)[number];

export interface EventWire {
  id: string;
  monthKey: string;
  title: string;
  kingTrackTitle: string;
  kingTrackAudioUrl: string | null;
  kingTrackStemsUrl: string | null;
  description: string;
  splits: RemixKingSplit[];
  status: EventStatus;
  entriesOpenAt: string | null;
  entriesCloseAt: string | null;
  winnerEntryId: string | null;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
}

export interface EntryWire {
  id: string;
  eventId: string;
  userId: string;
  entrantName: string;
  remixTitle: string;
  audioUrl: string;
  note: string;
  status: string;
  voteCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ReleaseWire {
  id: string;
  eventId: string;
  entryId: string;
  winnerUserId: string;
  winnerName: string;
  releaseTitle: string;
  splits: RemixKingSplit[];
  distributionReleaseId: string | null;
  status: string;
  releasedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SplitPaymentWire {
  id: string;
  releaseId: string;
  payeeUserId: string | null;
  payeeName: string;
  role: string;
  sharePct: number;
  amountVb: number;
  period: string;
  status: "pending" | "paid";
  idempotencyKey: string;
  paidAt: string | null;
  createdAt: string;
}

export class RemixKingError extends Error {
  code: "not_found" | "validation" | "splits_frozen" | "not_open" | "already_entered" | "invalid_transition" | "already_decided" | "not_votable" | "own_entry";
  constructor(code: RemixKingError["code"], message: string) {
    super(message);
    this.code = code;
  }
}

/* ─── Splits validation (the published-in-writing contract) ────────── */

export function validateSplits(splits: RemixKingSplit[]): RemixKingSplit[] {
  if (!Array.isArray(splits) || splits.length === 0) {
    throw new RemixKingError("validation", "Splits must be published in writing before the event can exist — add at least the winning remixer's split.");
  }
  const seen = new Set<string>();
  let sum = 0;
  for (const s of splits) {
    if (!(REMIX_KING_SPLIT_ROLES as readonly string[]).includes(s.role)) {
      throw new RemixKingError("validation", `Unknown split role "${s.role}".`);
    }
    if (seen.has(s.role)) throw new RemixKingError("validation", `Split role "${s.role}" appears twice.`);
    seen.add(s.role);
    if (!s.payeeName?.trim()) throw new RemixKingError("validation", "Every split needs the name it is published under.");
    if (!Number.isInteger(s.sharePct) || s.sharePct < 1 || s.sharePct > 100) {
      throw new RemixKingError("validation", "Every split share must be a whole percent between 1 and 100.");
    }
    sum += s.sharePct;
  }
  if (!seen.has("winner")) {
    throw new RemixKingError("validation", "The published splits must include the winning remixer's share.");
  }
  if (sum !== 100) {
    throw new RemixKingError("validation", `Published splits must add up to exactly 100% — these add up to ${sum}%.`);
  }
  return splits.map((s) => ({ role: s.role, payeeName: s.payeeName.trim().slice(0, 80), payeeUserId: s.payeeUserId ?? null, sharePct: s.sharePct }));
}

/** Deterministic VB split of a whole amount: floor each share, then
 *  hand the leftover Visual Bucs out 1 at a time in published order —
 *  the total always equals the amount, never a Buc invented or lost. */
export function splitAmounts(totalVb: number, splits: RemixKingSplit[]): number[] {
  if (!Number.isInteger(totalVb) || totalVb < 0) throw new RemixKingError("validation", "Split total must be a whole, non-negative number of Visual Bucs.");
  const amounts = splits.map((s) => Math.floor((totalVb * s.sharePct) / 100));
  let left = totalVb - amounts.reduce((a, b) => a + b, 0);
  for (let i = 0; left > 0; i = (i + 1) % amounts.length) { amounts[i]! += 1; left -= 1; }
  return amounts;
}

export const splitPaymentKey = (releaseId: string, period: string, role: string) =>
  `remix-king-split:${releaseId}:${period}:${role}`;
export const splitLedgerKey = (paymentId: string) => `remix-king-split:${paymentId}`;

/* ─── Storage seam (drizzle in production, in-memory in tests) ─────── */

export interface RemixKingStore {
  insertEvent(input: Omit<EventWire, "id" | "createdAt" | "updatedAt" | "winnerEntryId">): Promise<EventWire>;
  listEvents(): Promise<EventWire[]>;
  getEvent(id: string): Promise<EventWire | null>;
  getEventByMonth(monthKey: string): Promise<EventWire | null>;
  updateEvent(id: string, patch: Partial<EventWire>): Promise<EventWire | null>;
  insertEntry(input: Omit<EntryWire, "id" | "createdAt" | "updatedAt" | "voteCount" | "status">): Promise<EntryWire>;
  listEntries(eventId: string): Promise<EntryWire[]>;
  getEntry(id: string): Promise<EntryWire | null>;
  updateEntry(id: string, patch: Partial<EntryWire>): Promise<EntryWire | null>;
  hasVote(entryId: string, userId: string): Promise<boolean>;
  setVote(entryId: string, userId: string, on: boolean): Promise<number>;
  listVotesForUser(userId: string): Promise<string[]>;
  insertRelease(input: Omit<ReleaseWire, "id" | "createdAt" | "updatedAt" | "releasedAt" | "status" | "distributionReleaseId">): Promise<ReleaseWire>;
  getReleaseByEvent(eventId: string): Promise<ReleaseWire | null>;
  getRelease(id: string): Promise<ReleaseWire | null>;
  updateRelease(id: string, patch: Partial<ReleaseWire>): Promise<ReleaseWire | null>;
  insertPayment(input: Omit<SplitPaymentWire, "id" | "createdAt" | "paidAt" | "status">): Promise<SplitPaymentWire>;
  listPayments(releaseId: string): Promise<SplitPaymentWire[]>;
  getPaymentByKey(idempotencyKey: string): Promise<SplitPaymentWire | null>;
  claimPayment(id: string, paidAt: string): Promise<boolean>;
  releasePaymentClaim(id: string): Promise<void>;
}

const ev = (r: typeof remixKingEventsTable.$inferSelect): EventWire => ({
  id: r.id, monthKey: r.monthKey, title: r.title, kingTrackTitle: r.kingTrackTitle,
  kingTrackAudioUrl: r.kingTrackAudioUrl, kingTrackStemsUrl: r.kingTrackStemsUrl,
  description: r.description, splits: (r.splits ?? []) as RemixKingSplit[], status: r.status as EventStatus,
  entriesOpenAt: r.entriesOpenAt?.toISOString() ?? null, entriesCloseAt: r.entriesCloseAt?.toISOString() ?? null,
  winnerEntryId: r.winnerEntryId, createdByUserId: r.createdByUserId,
  createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(),
});
const en = (r: typeof remixKingEntriesTable.$inferSelect): EntryWire => ({
  id: r.id, eventId: r.eventId, userId: r.userId, entrantName: r.entrantName, remixTitle: r.remixTitle,
  audioUrl: r.audioUrl, note: r.note, status: r.status, voteCount: r.voteCount,
  createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(),
});
const rel = (r: typeof remixKingReleasesTable.$inferSelect): ReleaseWire => ({
  id: r.id, eventId: r.eventId, entryId: r.entryId, winnerUserId: r.winnerUserId, winnerName: r.winnerName,
  releaseTitle: r.releaseTitle, splits: (r.splits ?? []) as RemixKingSplit[],
  distributionReleaseId: r.distributionReleaseId, status: r.status,
  releasedAt: r.releasedAt?.toISOString() ?? null, createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(),
});
const pay = (r: typeof remixKingSplitPaymentsTable.$inferSelect): SplitPaymentWire => ({
  id: r.id, releaseId: r.releaseId, payeeUserId: r.payeeUserId, payeeName: r.payeeName, role: r.role,
  sharePct: r.sharePct, amountVb: r.amountVb, period: r.period, status: r.status as "pending" | "paid",
  idempotencyKey: r.idempotencyKey, paidAt: r.paidAt?.toISOString() ?? null, createdAt: r.createdAt.toISOString(),
});

export const drizzleRemixKingStore: RemixKingStore = {
  async insertEvent(input) {
    const rows = await db.insert(remixKingEventsTable).values({
      monthKey: input.monthKey, title: input.title, kingTrackTitle: input.kingTrackTitle,
      kingTrackAudioUrl: input.kingTrackAudioUrl, kingTrackStemsUrl: input.kingTrackStemsUrl,
      description: input.description, splits: input.splits, status: input.status,
      entriesOpenAt: input.entriesOpenAt ? new Date(input.entriesOpenAt) : null,
      entriesCloseAt: input.entriesCloseAt ? new Date(input.entriesCloseAt) : null,
      createdByUserId: input.createdByUserId,
    }).returning();
    return ev(rows[0]!);
  },
  async listEvents() { return (await db.select().from(remixKingEventsTable)).map(ev); },
  async getEvent(id) {
    const rows = await db.select().from(remixKingEventsTable).where(eq(remixKingEventsTable.id, id)).limit(1);
    return rows[0] ? ev(rows[0]) : null;
  },
  async getEventByMonth(monthKey) {
    const rows = await db.select().from(remixKingEventsTable).where(eq(remixKingEventsTable.monthKey, monthKey)).limit(1);
    return rows[0] ? ev(rows[0]) : null;
  },
  async updateEvent(id, patch) {
    const set: Record<string, unknown> = { updatedAt: new Date() };
    for (const k of ["monthKey", "title", "kingTrackTitle", "kingTrackAudioUrl", "kingTrackStemsUrl", "description", "splits", "status", "winnerEntryId"] as const) {
      if (patch[k] !== undefined) set[k] = patch[k];
    }
    if (patch.entriesOpenAt !== undefined) set["entriesOpenAt"] = patch.entriesOpenAt ? new Date(patch.entriesOpenAt) : null;
    if (patch.entriesCloseAt !== undefined) set["entriesCloseAt"] = patch.entriesCloseAt ? new Date(patch.entriesCloseAt) : null;
    const rows = await db.update(remixKingEventsTable).set(set).where(eq(remixKingEventsTable.id, id)).returning();
    return rows[0] ? ev(rows[0]) : null;
  },
  async insertEntry(input) {
    const rows = await db.insert(remixKingEntriesTable).values(input).returning();
    return en(rows[0]!);
  },
  async listEntries(eventId) {
    const rows = await db.select().from(remixKingEntriesTable).where(eq(remixKingEntriesTable.eventId, eventId));
    return rows.map(en);
  },
  async getEntry(id) {
    const rows = await db.select().from(remixKingEntriesTable).where(eq(remixKingEntriesTable.id, id)).limit(1);
    return rows[0] ? en(rows[0]) : null;
  },
  async updateEntry(id, patch) {
    const set: Record<string, unknown> = { updatedAt: new Date() };
    for (const k of ["remixTitle", "audioUrl", "note", "status", "voteCount"] as const) {
      if (patch[k] !== undefined) set[k] = patch[k];
    }
    const rows = await db.update(remixKingEntriesTable).set(set).where(eq(remixKingEntriesTable.id, id)).returning();
    return rows[0] ? en(rows[0]) : null;
  },
  async hasVote(entryId, userId) {
    const rows = await db.select().from(remixKingVotesTable)
      .where(and(eq(remixKingVotesTable.entryId, entryId), eq(remixKingVotesTable.userId, userId))).limit(1);
    return rows.length > 0;
  },
  async setVote(entryId, userId, on) {
    if (on) {
      await db.insert(remixKingVotesTable).values({ entryId, userId }).onConflictDoNothing();
    } else {
      await db.delete(remixKingVotesTable).where(and(eq(remixKingVotesTable.entryId, entryId), eq(remixKingVotesTable.userId, userId)));
    }
    await db.update(remixKingEntriesTable)
      .set({ voteCount: sql`(SELECT count(*) FROM remix_king_votes WHERE entry_id = ${entryId})`, updatedAt: new Date() })
      .where(eq(remixKingEntriesTable.id, entryId));
    const rows = await db.select({ c: remixKingEntriesTable.voteCount }).from(remixKingEntriesTable).where(eq(remixKingEntriesTable.id, entryId)).limit(1);
    return rows[0]?.c ?? 0;
  },
  async listVotesForUser(userId) {
    const rows = await db.select({ e: remixKingVotesTable.entryId }).from(remixKingVotesTable).where(eq(remixKingVotesTable.userId, userId));
    return rows.map((r) => r.e);
  },
  async insertRelease(input) {
    const rows = await db.insert(remixKingReleasesTable).values(input).returning();
    return rel(rows[0]!);
  },
  async getReleaseByEvent(eventId) {
    const rows = await db.select().from(remixKingReleasesTable).where(eq(remixKingReleasesTable.eventId, eventId)).limit(1);
    return rows[0] ? rel(rows[0]) : null;
  },
  async getRelease(id) {
    const rows = await db.select().from(remixKingReleasesTable).where(eq(remixKingReleasesTable.id, id)).limit(1);
    return rows[0] ? rel(rows[0]) : null;
  },
  async updateRelease(id, patch) {
    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (patch.status !== undefined) set["status"] = patch.status;
    if (patch.distributionReleaseId !== undefined) set["distributionReleaseId"] = patch.distributionReleaseId;
    if (patch.releasedAt !== undefined) set["releasedAt"] = patch.releasedAt ? new Date(patch.releasedAt) : null;
    const rows = await db.update(remixKingReleasesTable).set(set).where(eq(remixKingReleasesTable.id, id)).returning();
    return rows[0] ? rel(rows[0]) : null;
  },
  async insertPayment(input) {
    const rows = await db.insert(remixKingSplitPaymentsTable).values(input).returning();
    return pay(rows[0]!);
  },
  async listPayments(releaseId) {
    const rows = await db.select().from(remixKingSplitPaymentsTable).where(eq(remixKingSplitPaymentsTable.releaseId, releaseId));
    return rows.map(pay);
  },
  async getPaymentByKey(idempotencyKey) {
    const rows = await db.select().from(remixKingSplitPaymentsTable).where(eq(remixKingSplitPaymentsTable.idempotencyKey, idempotencyKey)).limit(1);
    return rows[0] ? pay(rows[0]) : null;
  },
  async claimPayment(id, paidAt) {
    const rows = await db.update(remixKingSplitPaymentsTable)
      .set({ status: "paid", paidAt: new Date(paidAt) })
      .where(and(eq(remixKingSplitPaymentsTable.id, id), eq(remixKingSplitPaymentsTable.status, "pending")))
      .returning({ id: remixKingSplitPaymentsTable.id });
    return rows.length > 0;
  },
  async releasePaymentClaim(id) {
    await db.update(remixKingSplitPaymentsTable)
      .set({ status: "pending", paidAt: null })
      .where(and(eq(remixKingSplitPaymentsTable.id, id), eq(remixKingSplitPaymentsTable.status, "paid")));
  },
};

/* ─── Events ───────────────────────────────────────────────────────── */

const MONTH_KEY = /^\d{4}-(0[1-9]|1[0-2])$/;

export async function createEvent(store: RemixKingStore, adminUserId: string, input: {
  monthKey: string; title: string; kingTrackTitle: string;
  kingTrackAudioUrl?: string | null; kingTrackStemsUrl?: string | null;
  description?: string; splits: RemixKingSplit[];
  entriesOpenAt?: string | null; entriesCloseAt?: string | null;
}): Promise<EventWire> {
  if (!MONTH_KEY.test(input.monthKey)) throw new RemixKingError("validation", "Month must look like 2026-11.");
  if (!input.title.trim() || !input.kingTrackTitle.trim()) throw new RemixKingError("validation", "The event needs a title and the King's track title.");
  const splits = validateSplits(input.splits);
  if (await store.getEventByMonth(input.monthKey)) {
    throw new RemixKingError("validation", `There is already a Remix the King event for ${input.monthKey} — one house event per month.`);
  }
  return store.insertEvent({
    monthKey: input.monthKey, title: input.title.trim().slice(0, 120), kingTrackTitle: input.kingTrackTitle.trim().slice(0, 160),
    kingTrackAudioUrl: input.kingTrackAudioUrl ?? null, kingTrackStemsUrl: input.kingTrackStemsUrl ?? null,
    description: (input.description ?? "").trim().slice(0, 2000), splits, status: "draft",
    entriesOpenAt: input.entriesOpenAt ?? null, entriesCloseAt: input.entriesCloseAt ?? null,
    createdByUserId: adminUserId,
  });
}

/** Draft-only edits — INCLUDING splits. Once the event leaves draft the
 *  published splits are frozen forever (the entrants' contract). */
export async function updateDraftEvent(store: RemixKingStore, id: string, patch: {
  title?: string; kingTrackTitle?: string; kingTrackAudioUrl?: string | null; kingTrackStemsUrl?: string | null;
  description?: string; splits?: RemixKingSplit[]; entriesOpenAt?: string | null; entriesCloseAt?: string | null;
}): Promise<EventWire> {
  const event = await store.getEvent(id);
  if (!event) throw new RemixKingError("not_found", "Event not found.");
  if (event.status !== "draft") {
    throw new RemixKingError("splits_frozen", "This event is live — its published splits and terms are frozen and can never be edited.");
  }
  const next: Partial<EventWire> = {};
  if (patch.title !== undefined) next.title = patch.title.trim().slice(0, 120);
  if (patch.kingTrackTitle !== undefined) next.kingTrackTitle = patch.kingTrackTitle.trim().slice(0, 160);
  if (patch.kingTrackAudioUrl !== undefined) next.kingTrackAudioUrl = patch.kingTrackAudioUrl;
  if (patch.kingTrackStemsUrl !== undefined) next.kingTrackStemsUrl = patch.kingTrackStemsUrl;
  if (patch.description !== undefined) next.description = patch.description.trim().slice(0, 2000);
  if (patch.splits !== undefined) next.splits = validateSplits(patch.splits);
  if (patch.entriesOpenAt !== undefined) next.entriesOpenAt = patch.entriesOpenAt;
  if (patch.entriesCloseAt !== undefined) next.entriesCloseAt = patch.entriesCloseAt;
  return (await store.updateEvent(id, next))!;
}

const TRANSITIONS: Record<string, EventStatus[]> = {
  draft: ["open", "cancelled"],
  open: ["judging", "cancelled"],
  judging: ["cancelled"],
  decided: ["released", "cancelled"],
  released: [],
  cancelled: [],
};

export async function setEventStatus(store: RemixKingStore, id: string, status: EventStatus): Promise<EventWire> {
  const event = await store.getEvent(id);
  if (!event) throw new RemixKingError("not_found", "Event not found.");
  if (!(TRANSITIONS[event.status] ?? []).includes(status)) {
    throw new RemixKingError("invalid_transition", `A ${event.status} event cannot move to ${status}.`);
  }
  if (status === "released") {
    const release = await store.getReleaseByEvent(id);
    if (!release) throw new RemixKingError("invalid_transition", "There is no winner release to release yet.");
    await store.updateRelease(release.id, { status: "released", releasedAt: new Date().toISOString() });
  }
  return (await store.updateEvent(id, { status }))!;
}

/* ─── Entries + votes ──────────────────────────────────────────────── */

function cleanName(name: string | undefined): string {
  const n = (name ?? "").trim().slice(0, 40);
  return n || "Creator";
}

export async function submitEntry(store: RemixKingStore, input: {
  eventId: string; userId: string; entrantName?: string; remixTitle: string; audioUrl: string; note?: string;
}): Promise<EntryWire> {
  const event = await store.getEvent(input.eventId);
  if (!event) throw new RemixKingError("not_found", "Event not found.");
  if (event.status !== "open") throw new RemixKingError("not_open", "Entries are not open for this event right now.");
  if (!input.remixTitle.trim() || !input.audioUrl.trim()) throw new RemixKingError("validation", "Your remix needs a title and an audio link.");
  const mine = (await store.listEntries(input.eventId)).find((e) => e.userId === input.userId);
  if (mine) throw new RemixKingError("already_entered", "You already have a remix in this month's event — one entry per member.");
  return store.insertEntry({
    eventId: input.eventId, userId: input.userId, entrantName: cleanName(input.entrantName),
    remixTitle: input.remixTitle.trim().slice(0, 120), audioUrl: input.audioUrl.trim().slice(0, 1000),
    note: (input.note ?? "").trim().slice(0, 500),
  });
}

export async function toggleVote(store: RemixKingStore, userId: string, entryId: string): Promise<{ voted: boolean; voteCount: number }> {
  const entry = await store.getEntry(entryId);
  if (!entry) throw new RemixKingError("not_found", "Remix not found.");
  const event = await store.getEvent(entry.eventId);
  if (!event || (event.status !== "open" && event.status !== "judging")) {
    throw new RemixKingError("not_votable", "Voting is not open for this event right now.");
  }
  if (entry.userId === userId) throw new RemixKingError("own_entry", "You can't vote for your own remix.");
  const has = await store.hasVote(entryId, userId);
  const count = await store.setVote(entryId, userId, !has);
  return { voted: !has, voteCount: count };
}

export async function shortlistEntry(store: RemixKingStore, entryId: string, shortlisted: boolean): Promise<EntryWire> {
  const entry = await store.getEntry(entryId);
  if (!entry) throw new RemixKingError("not_found", "Remix not found.");
  if (entry.status === "winner") throw new RemixKingError("invalid_transition", "The winner's entry can't be un-shortlisted.");
  return (await store.updateEntry(entryId, { status: shortlisted ? "shortlisted" : "submitted" }))!;
}

/* ─── Winner → official release ────────────────────────────────────── */

/** Pick the winner (judging only). Creates the ONE official release for
 *  the event, snapshotting the published splits with the winner role
 *  bound to the winning member. Idempotent: re-calling after a decision
 *  returns the existing release and changes nothing. */
export async function selectWinner(store: RemixKingStore, eventId: string, entryId: string): Promise<{ event: EventWire; release: ReleaseWire }> {
  const event = await store.getEvent(eventId);
  if (!event) throw new RemixKingError("not_found", "Event not found.");
  const existing = await store.getReleaseByEvent(eventId);
  if (existing) {
    if (existing.entryId !== entryId) throw new RemixKingError("already_decided", "This event already has its winning remix.");
    return { event, release: existing };
  }
  if (event.status !== "judging") throw new RemixKingError("invalid_transition", "The winner is picked while the event is judging.");
  const entry = await store.getEntry(entryId);
  if (!entry || entry.eventId !== eventId) throw new RemixKingError("not_found", "That remix isn't in this event.");
  const splits = event.splits.map((s) => s.role === "winner"
    ? { ...s, payeeUserId: entry.userId, payeeName: entry.entrantName }
    : s);
  const release = await store.insertRelease({
    eventId, entryId, winnerUserId: entry.userId, winnerName: entry.entrantName,
    releaseTitle: `${entry.remixTitle} (Official Remix)`, splits,
  });
  const entries = await store.listEntries(eventId);
  for (const e of entries) {
    await store.updateEntry(e.id, { status: e.id === entryId ? "winner" : "not_selected" });
  }
  const updated = (await store.updateEvent(eventId, { status: "decided", winnerEntryId: entryId }))!;
  return { event: updated, release };
}

/* ─── Public view ──────────────────────────────────────────────────── */

export interface PublicEventView {
  event: EventWire;
  entries: EntryWire[];
  release: ReleaseWire | null;
  viewerVotedIds: string[];
  viewerEntry: EntryWire | null;
}

export async function getCurrentEvent(store: RemixKingStore, viewerUserId?: string): Promise<PublicEventView | null> {
  const all = await store.listEvents();
  const live = all
    .filter((e) => e.status !== "draft" && e.status !== "cancelled")
    .sort((a, b) => b.monthKey.localeCompare(a.monthKey))[0];
  if (!live) return null;
  return getEventView(store, live.id, viewerUserId);
}

export async function getEventView(store: RemixKingStore, eventId: string, viewerUserId?: string): Promise<PublicEventView | null> {
  const event = await store.getEvent(eventId);
  if (!event) return null;
  const entries = (await store.listEntries(eventId))
    .sort((a, b) => b.voteCount - a.voteCount || a.createdAt.localeCompare(b.createdAt));
  const release = await store.getReleaseByEvent(eventId);
  return {
    event, entries, release,
    viewerVotedIds: viewerUserId ? await store.listVotesForUser(viewerUserId) : [],
    viewerEntry: viewerUserId ? entries.find((e) => e.userId === viewerUserId) ?? null : null,
  };
}

/* ─── Split payments (creation — exactly-once rows) ────────────────── */

/** Create one period's split payments for a release. Idempotent per
 *  (release, period, role): a replay returns the existing rows and
 *  creates nothing new. Amounts come from splitAmounts — the total
 *  always equals totalVb exactly. */
export async function createSplitPayments(store: RemixKingStore, releaseId: string, period: string, totalVb: number): Promise<SplitPaymentWire[]> {
  const release = await store.getRelease(releaseId);
  if (!release) throw new RemixKingError("not_found", "Release not found.");
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw new RemixKingError("validation", "Period must look like 2026-12.");
  const amounts = splitAmounts(totalVb, release.splits);
  const out: SplitPaymentWire[] = [];
  for (let i = 0; i < release.splits.length; i++) {
    const s = release.splits[i]!;
    const key = splitPaymentKey(releaseId, period, s.role);
    const existing = await store.getPaymentByKey(key);
    if (existing) { out.push(existing); continue; }
    out.push(await store.insertPayment({
      releaseId, payeeUserId: s.payeeUserId, payeeName: s.payeeName, role: s.role,
      sharePct: s.sharePct, amountVb: amounts[i]!, period, idempotencyKey: key,
    }));
  }
  return out;
}
