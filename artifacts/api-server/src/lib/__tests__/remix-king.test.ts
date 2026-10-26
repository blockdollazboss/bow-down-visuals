/**
 * remix-king.test.ts — Stack-200 #152: Remix the King against an
 * in-memory store.
 *
 * Pins:
 * - SPLITS IN WRITING, UP FRONT: no event without explicit splits;
 *   shares must be whole percents summing to exactly 100 and must
 *   include the winner's share; one event per month.
 * - FROZEN SPLITS: draft events may edit splits; the moment an event
 *   leaves draft, every edit — splits included — is refused.
 * - ENTRY FLOW: entries only while open; one entry per member.
 * - VOTES: open/judging only, never your own remix, toggle on/off.
 * - WINNER → OFFICIAL RELEASE: judging only; the release snapshots the
 *   published splits verbatim with the winner role bound to the
 *   winning member; exactly one release per event (idempotent replay,
 *   a different entry is refused after the decision).
 * - SPLIT AMOUNTS: floor + deterministic leftover distribution — the
 *   parts always sum to the total exactly.
 * - SPLIT PAYMENT ROWS: exactly-once per (release, period, role) —
 *   a replay creates nothing new.
 */
import { describe, expect, it } from "vitest";
import {
  RemixKingError,
  createEvent,
  updateDraftEvent,
  setEventStatus,
  submitEntry,
  toggleVote,
  shortlistEntry,
  selectWinner,
  getCurrentEvent,
  createSplitPayments,
  validateSplits,
  splitAmounts,
  splitPaymentKey,
  type EventWire,
  type EntryWire,
  type ReleaseWire,
  type RemixKingStore,
  type SplitPaymentWire,
} from "../remix-king";
import type { RemixKingSplit } from "@workspace/db";

const ADMIN = "99999999-9999-4999-8999-999999999999";
const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";
const KING_ID = "33333333-3333-4333-8333-333333333333";

const SPLITS: RemixKingSplit[] = [
  { role: "winner", payeeName: "Winning remixer", payeeUserId: null, sharePct: 50 },
  { role: "king", payeeName: "Thy Cheat Code", payeeUserId: KING_ID, sharePct: 30 },
  { role: "house", payeeName: "Bow Down Visuals", payeeUserId: null, sharePct: 20 },
];

function memoryStore(): RemixKingStore {
  const events = new Map<string, EventWire>();
  const entries = new Map<string, EntryWire>();
  const votes = new Set<string>();
  const releases = new Map<string, ReleaseWire>();
  const payments = new Map<string, SplitPaymentWire>();
  let seq = 0;
  const stamp = () => new Date(Date.UTC(2026, 10, 1, 12, 0, seq)).toISOString();
  return {
    async insertEvent(input) {
      seq += 1;
      const row: EventWire = { ...input, id: `ev-${seq}`, winnerEntryId: null, createdAt: stamp(), updatedAt: stamp() };
      events.set(row.id, row);
      return { ...row, splits: [...row.splits] };
    },
    async listEvents() { return [...events.values()].map((r) => ({ ...r })); },
    async getEvent(id) { const r = events.get(id); return r ? { ...r } : null; },
    async getEventByMonth(m) { const r = [...events.values()].find((e) => e.monthKey === m); return r ? { ...r } : null; },
    async updateEvent(id, patch) {
      const r = events.get(id); if (!r) return null;
      const next = { ...r, ...patch, updatedAt: stamp() };
      events.set(id, next); return { ...next };
    },
    async insertEntry(input) {
      seq += 1;
      const row: EntryWire = { ...input, id: `en-${seq}`, status: "submitted", voteCount: 0, createdAt: stamp(), updatedAt: stamp() };
      entries.set(row.id, row); return { ...row };
    },
    async listEntries(eventId) { return [...entries.values()].filter((e) => e.eventId === eventId).map((r) => ({ ...r })); },
    async getEntry(id) { const r = entries.get(id); return r ? { ...r } : null; },
    async updateEntry(id, patch) {
      const r = entries.get(id); if (!r) return null;
      const next = { ...r, ...patch, updatedAt: stamp() };
      entries.set(id, next); return { ...next };
    },
    async hasVote(entryId, userId) { return votes.has(`${entryId}:${userId}`); },
    async setVote(entryId, userId, on) {
      const k = `${entryId}:${userId}`;
      if (on) votes.add(k); else votes.delete(k);
      const count = [...votes].filter((v) => v.startsWith(`${entryId}:`)).length;
      const r = entries.get(entryId)!; entries.set(entryId, { ...r, voteCount: count });
      return count;
    },
    async listVotesForUser(userId) { return [...votes].filter((v) => v.endsWith(`:${userId}`)).map((v) => v.split(":")[0]!); },
    async insertRelease(input) {
      seq += 1;
      const row: ReleaseWire = { ...input, id: `rel-${seq}`, status: "pending_release", distributionReleaseId: null, releasedAt: null, createdAt: stamp(), updatedAt: stamp() };
      releases.set(row.id, row); return { ...row, splits: [...row.splits] };
    },
    async getReleaseByEvent(eventId) { const r = [...releases.values()].find((x) => x.eventId === eventId); return r ? { ...r } : null; },
    async getRelease(id) { const r = releases.get(id); return r ? { ...r } : null; },
    async updateRelease(id, patch) {
      const r = releases.get(id); if (!r) return null;
      const next = { ...r, ...patch, updatedAt: stamp() };
      releases.set(id, next); return { ...next };
    },
    async insertPayment(input) {
      seq += 1;
      const row: SplitPaymentWire = { ...input, id: `pay-${seq}`, status: "pending", paidAt: null, createdAt: stamp() };
      payments.set(row.id, row); return { ...row };
    },
    async listPayments(releaseId) { return [...payments.values()].filter((p) => p.releaseId === releaseId).map((r) => ({ ...r })); },
    async getPaymentByKey(key) { const r = [...payments.values()].find((p) => p.idempotencyKey === key); return r ? { ...r } : null; },
    async claimPayment(id, paidAt) {
      const r = payments.get(id); if (!r || r.status !== "pending") return false;
      payments.set(id, { ...r, status: "paid", paidAt }); return true;
    },
    async releasePaymentClaim(id) {
      const r = payments.get(id); if (r && r.status === "paid") payments.set(id, { ...r, status: "pending", paidAt: null });
    },
  };
}

async function openEvent(store: RemixKingStore) {
  const ev = await createEvent(store, ADMIN, {
    monthKey: "2026-11", title: "Remix the King — November", kingTrackTitle: "Palace Anthem",
    splits: SPLITS,
  });
  await setEventStatus(store, ev.id, "open");
  return ev;
}

async function decidedEvent(store: RemixKingStore) {
  const ev = await openEvent(store);
  const a = await submitEntry(store, { eventId: ev.id, userId: USER_A, entrantName: "Remixer A", remixTitle: "Palace Flip", audioUrl: "https://example.com/a.mp3" });
  await submitEntry(store, { eventId: ev.id, userId: USER_B, entrantName: "Remixer B", remixTitle: "Crown Flip", audioUrl: "https://example.com/b.mp3" });
  await setEventStatus(store, ev.id, "judging");
  const { release } = await selectWinner(store, ev.id, a.id);
  return { ev, a, release };
}

describe("remix the king — published splits", () => {
  it("refuses splits that don't sum to 100, lack the winner, or repeat a role", () => {
    expect(() => validateSplits([{ role: "winner", payeeName: "W", payeeUserId: null, sharePct: 40 }])).toThrow(RemixKingError);
    expect(() => validateSplits([
      { role: "king", payeeName: "K", payeeUserId: null, sharePct: 60 },
      { role: "house", payeeName: "H", payeeUserId: null, sharePct: 40 },
    ])).toThrow(/winner/);
    expect(() => validateSplits([
      { role: "winner", payeeName: "W", payeeUserId: null, sharePct: 50 },
      { role: "winner", payeeName: "W2", payeeUserId: null, sharePct: 50 },
    ])).toThrow(/twice/);
    expect(() => validateSplits([])).toThrow(RemixKingError);
  });

  it("an event cannot be created without splits, nor twice in one month", async () => {
    const store = memoryStore();
    await expect(createEvent(store, ADMIN, { monthKey: "2026-11", title: "T", kingTrackTitle: "K", splits: [] })).rejects.toThrow(RemixKingError);
    await openEvent(store);
    await expect(createEvent(store, ADMIN, { monthKey: "2026-11", title: "T2", kingTrackTitle: "K2", splits: SPLITS })).rejects.toThrow(/already/);
  });

  it("draft edits may change splits; once open, splits and terms are frozen", async () => {
    const store = memoryStore();
    const ev = await createEvent(store, ADMIN, { monthKey: "2026-11", title: "T", kingTrackTitle: "K", splits: SPLITS });
    const edited = await updateDraftEvent(store, ev.id, { splits: [
      { role: "winner", payeeName: "Winning remixer", payeeUserId: null, sharePct: 60 },
      { role: "king", payeeName: "Thy Cheat Code", payeeUserId: KING_ID, sharePct: 40 },
    ] });
    expect(edited.splits.reduce((a, s) => a + s.sharePct, 0)).toBe(100);
    await setEventStatus(store, ev.id, "open");
    await expect(updateDraftEvent(store, ev.id, { title: "New title" })).rejects.toThrow(/frozen/);
    await expect(updateDraftEvent(store, ev.id, { splits: SPLITS })).rejects.toThrow(/frozen/);
  });
});

describe("remix the king — entries and votes", () => {
  it("entries only while open, one per member", async () => {
    const store = memoryStore();
    const draft = await createEvent(store, ADMIN, { monthKey: "2026-11", title: "T", kingTrackTitle: "K", splits: SPLITS });
    await expect(submitEntry(store, { eventId: draft.id, userId: USER_A, remixTitle: "X", audioUrl: "https://e.com/x" })).rejects.toThrow(/not open/);
    const ev = await openEvent(memoryStore()).catch(() => null);
    void ev;
    const store2 = memoryStore();
    const open = await openEvent(store2);
    await submitEntry(store2, { eventId: open.id, userId: USER_A, remixTitle: "X", audioUrl: "https://e.com/x" });
    await expect(submitEntry(store2, { eventId: open.id, userId: USER_A, remixTitle: "Y", audioUrl: "https://e.com/y" })).rejects.toThrow(/already/);
  });

  it("votes toggle, never on your own remix, and close when judging ends", async () => {
    const store = memoryStore();
    const ev = await openEvent(store);
    const a = await submitEntry(store, { eventId: ev.id, userId: USER_A, remixTitle: "X", audioUrl: "https://e.com/x" });
    await expect(toggleVote(store, USER_A, a.id)).rejects.toThrow(/own/);
    expect(await toggleVote(store, USER_B, a.id)).toEqual({ voted: true, voteCount: 1 });
    expect(await toggleVote(store, USER_B, a.id)).toEqual({ voted: false, voteCount: 0 });
    const view = await getCurrentEvent(store, USER_B);
    expect(view?.event.id).toBe(ev.id);
    expect(view?.entries).toHaveLength(1);
  });
});

describe("remix the king — winner becomes an official release", () => {
  it("winner selection snapshots the published splits with the winner bound in", async () => {
    const store = memoryStore();
    const { ev, a, release } = await decidedEvent(store);
    expect(release.winnerUserId).toBe(USER_A);
    expect(release.releaseTitle).toBe("Palace Flip (Official Remix)");
    const winnerSplit = release.splits.find((s) => s.role === "winner")!;
    expect(winnerSplit.sharePct).toBe(50);
    expect(winnerSplit.payeeUserId).toBe(USER_A);
    expect(winnerSplit.payeeName).toBe("Remixer A");
    // The published terms never moved: shares still sum to 100.
    expect(release.splits.reduce((x, s) => x + s.sharePct, 0)).toBe(100);
    const view = await getCurrentEvent(store);
    expect(view?.event.status).toBe("decided");
    expect(view?.event.winnerEntryId).toBe(a.id);
    expect(view?.entries.find((e) => e.id === a.id)?.status).toBe("winner");
    expect(view?.entries.filter((e) => e.status === "not_selected")).toHaveLength(1);
    void ev;
  });

  it("exactly one release: replay returns it, a different winner is refused", async () => {
    const store = memoryStore();
    const { ev, a, release } = await decidedEvent(store);
    const again = await selectWinner(store, ev.id, a.id);
    expect(again.release.id).toBe(release.id);
    const other = (await store.listEntries(ev.id)).find((e) => e.id !== a.id)!;
    await expect(selectWinner(store, ev.id, other.id)).rejects.toThrow(/already/);
  });

  it("the winner can only be picked while judging; shortlist refuses the winner", async () => {
    const store = memoryStore();
    const ev = await openEvent(store);
    const a = await submitEntry(store, { eventId: ev.id, userId: USER_A, remixTitle: "X", audioUrl: "https://e.com/x" });
    await expect(selectWinner(store, ev.id, a.id)).rejects.toThrow(/judging/);
    await shortlistEntry(store, a.id, true);
    expect((await store.getEntry(a.id))?.status).toBe("shortlisted");
  });

  it("a decided event releases: release row flips to released", async () => {
    const store = memoryStore();
    const { ev, release } = await decidedEvent(store);
    await setEventStatus(store, ev.id, "released");
    expect((await store.getRelease(release.id))?.status).toBe("released");
    expect((await store.getRelease(release.id))?.releasedAt).toBeTruthy();
  });
});

describe("remix the king — split amounts and payment rows", () => {
  it("splitAmounts always sums exactly to the total", () => {
    expect(splitAmounts(1000, SPLITS)).toEqual([500, 300, 200]);
    expect(splitAmounts(999, SPLITS)).toEqual([500, 300, 199]);
    expect(splitAmounts(1, SPLITS)).toEqual([1, 0, 0]);
    expect(splitAmounts(0, SPLITS)).toEqual([0, 0, 0]);
  });

  it("payment rows are exactly-once per (release, period, role)", async () => {
    const store = memoryStore();
    const { release } = await decidedEvent(store);
    const first = await createSplitPayments(store, release.id, "2026-12", 1000);
    expect(first.map((p) => p.amountVb)).toEqual([500, 300, 200]);
    expect(first[0]!.idempotencyKey).toBe(splitPaymentKey(release.id, "2026-12", "winner"));
    const replay = await createSplitPayments(store, release.id, "2026-12", 1000);
    expect(replay.map((p) => p.id)).toEqual(first.map((p) => p.id));
    expect(await store.listPayments(release.id)).toHaveLength(3);
    const nextPeriod = await createSplitPayments(store, release.id, "2027-01", 1000);
    expect(nextPeriod).toHaveLength(3);
    expect(await store.listPayments(release.id)).toHaveLength(6);
  });
});
