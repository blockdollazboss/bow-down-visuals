/**
 * remix-king-payments.test.ts — #152 split rail: claim → grant →
 * strict ledger, exactly once.
 *
 * Pins: a paid split credits once with ledger key
 * remix-king-split:<payment_id>; a replay pays nothing; a payee with
 * no on-platform account is skipped (stays pending, never guessed);
 * a grant/ledger failure claws back, releases the claim, and a later
 * run retries to a single payment.
 */
import { describe, expect, it, vi } from "vitest";
import { createEvent, setEventStatus, submitEntry, selectWinner, createSplitPayments, type RemixKingStore, type EventWire, type EntryWire, type ReleaseWire, type SplitPaymentWire } from "../remix-king";
import { paySplitPayment, processSplitPayments, type SplitPayDeps } from "../remix-king-payments";
import type { RemixKingSplit } from "@workspace/db";

const ADMIN = "99999999-9999-4999-8999-999999999999";
const USER_A = "11111111-1111-4111-8111-111111111111";
const KING_ID = "33333333-3333-4333-8333-333333333333";
const SPLITS: RemixKingSplit[] = [
  { role: "winner", payeeName: "Winning remixer", payeeUserId: null, sharePct: 50 },
  { role: "king", payeeName: "Thy Cheat Code", payeeUserId: KING_ID, sharePct: 30 },
  { role: "house", payeeName: "Bow Down Visuals", payeeUserId: null, sharePct: 20 },
];

function memoryStore(): RemixKingStore {
  const events = new Map<string, EventWire>(); const entries = new Map<string, EntryWire>();
  const releases = new Map<string, ReleaseWire>(); const payments = new Map<string, SplitPaymentWire>();
  const votes = new Set<string>(); let seq = 0;
  const stamp = () => new Date(Date.UTC(2026, 11, 1, 12, 0, seq)).toISOString();
  return {
    async insertEvent(i) { seq += 1; const r: EventWire = { ...i, id: `ev-${seq}`, winnerEntryId: null, createdAt: stamp(), updatedAt: stamp() }; events.set(r.id, r); return { ...r }; },
    async listEvents() { return [...events.values()].map((r) => ({ ...r })); },
    async getEvent(id) { const r = events.get(id); return r ? { ...r } : null; },
    async getEventByMonth(m) { const r = [...events.values()].find((e) => e.monthKey === m); return r ? { ...r } : null; },
    async updateEvent(id, p) { const r = events.get(id)!; const n = { ...r, ...p, updatedAt: stamp() }; events.set(id, n); return { ...n }; },
    async insertEntry(i) { seq += 1; const r: EntryWire = { ...i, id: `en-${seq}`, status: "submitted", voteCount: 0, createdAt: stamp(), updatedAt: stamp() }; entries.set(r.id, r); return { ...r }; },
    async listEntries(eid) { return [...entries.values()].filter((e) => e.eventId === eid).map((r) => ({ ...r })); },
    async getEntry(id) { const r = entries.get(id); return r ? { ...r } : null; },
    async updateEntry(id, p) { const r = entries.get(id)!; const n = { ...r, ...p, updatedAt: stamp() }; entries.set(id, n); return { ...n }; },
    async hasVote(e, u) { return votes.has(`${e}:${u}`); },
    async setVote(e, u, on) { const k = `${e}:${u}`; if (on) votes.add(k); else votes.delete(k); return [...votes].filter((v) => v.startsWith(`${e}:`)).length; },
    async listVotesForUser(u) { return [...votes].filter((v) => v.endsWith(`:${u}`)).map((v) => v.split(":")[0]!); },
    async insertRelease(i) { seq += 1; const r: ReleaseWire = { ...i, id: `rel-${seq}`, status: "pending_release", distributionReleaseId: null, releasedAt: null, createdAt: stamp(), updatedAt: stamp() }; releases.set(r.id, r); return { ...r }; },
    async getReleaseByEvent(eid) { const r = [...releases.values()].find((x) => x.eventId === eid); return r ? { ...r } : null; },
    async getRelease(id) { const r = releases.get(id); return r ? { ...r } : null; },
    async updateRelease(id, p) { const r = releases.get(id)!; const n = { ...r, ...p, updatedAt: stamp() }; releases.set(id, n); return { ...n }; },
    async insertPayment(i) { seq += 1; const r: SplitPaymentWire = { ...i, id: `pay-${seq}`, status: "pending", paidAt: null, createdAt: stamp() }; payments.set(r.id, r); return { ...r }; },
    async listPayments(rid) { return [...payments.values()].filter((p) => p.releaseId === rid).map((r) => ({ ...r })); },
    async getPaymentByKey(k) { const r = [...payments.values()].find((p) => p.idempotencyKey === k); return r ? { ...r } : null; },
    async claimPayment(id, paidAt) { const r = payments.get(id); if (!r || r.status !== "pending") return false; payments.set(id, { ...r, status: "paid", paidAt }); return true; },
    async releasePaymentClaim(id) { const r = payments.get(id); if (r && r.status === "paid") payments.set(id, { ...r, status: "pending", paidAt: null }); },
  };
}

function fakeDeps(failLedgerOnce = false) {
  const credits: Record<string, number> = {};
  const ledger: { userId: string; creditsUsed: number; idempotencyKey: string }[] = [];
  let failed = false;
  const deps: SplitPayDeps = {
    async addCredits(userId, amount) { credits[userId] = (credits[userId] ?? 0) + amount; },
    async recordLedger(rec) {
      if (failLedgerOnce && !failed) { failed = true; throw new Error("ledger down"); }
      if (ledger.some((l) => l.idempotencyKey === rec.idempotencyKey)) return "already-recorded";
      ledger.push(rec); return "recorded";
    },
  };
  return { deps, credits, ledger };
}

async function setup() {
  const store = memoryStore();
  const ev = await createEvent(store, ADMIN, { monthKey: "2026-11", title: "T", kingTrackTitle: "K", splits: SPLITS });
  await setEventStatus(store, ev.id, "open");
  const a = await submitEntry(store, { eventId: ev.id, userId: USER_A, entrantName: "Remixer A", remixTitle: "Flip", audioUrl: "https://e.com/a" });
  await setEventStatus(store, ev.id, "judging");
  const { release } = await selectWinner(store, ev.id, a.id);
  const payments = await createSplitPayments(store, release.id, "2026-12", 1000);
  return { store, release, payments };
}

describe("remix the king — split payments rail", () => {
  it("pays winner + king exactly once; the house share (no account) stays pending, visibly skipped", async () => {
    const { store, release, payments } = await setup();
    const { deps, credits, ledger } = fakeDeps();
    const result = await processSplitPayments(store, deps, release.id);
    expect(result.paidIds).toHaveLength(2);
    expect(result.paidNowVb).toBe(800);
    expect(result.skippedNoPayeeIds).toEqual([payments.find((p) => p.role === "house")!.id]);
    expect(credits[USER_A]).toBe(500);
    expect(credits[KING_ID]).toBe(300);
    expect(ledger.map((l) => l.idempotencyKey).sort()).toEqual(payments.filter((p) => p.role !== "house").map((p) => `remix-king-split:${p.id}`).sort());
    expect(ledger.every((l) => l.creditsUsed < 0)).toBe(true);
    // Replay: nothing pays twice.
    const again = await processSplitPayments(store, deps, release.id);
    expect(again.paidIds).toHaveLength(0);
    expect(credits[USER_A]).toBe(500);
    expect(ledger).toHaveLength(2);
  });

  it("a ledger failure claws back, releases the claim, and a retry pays once", async () => {
    const { store, payments } = await setup();
    const winner = payments.find((p) => p.role === "winner")!;
    const { deps, credits, ledger } = fakeDeps(true);
    expect(await paySplitPayment(store, deps, winner)).toBe("failed_released");
    expect(credits[USER_A] ?? 0).toBe(0);
    const fresh = (await store.listPayments(winner.releaseId)).find((p) => p.id === winner.id)!;
    expect(fresh.status).toBe("pending");
    expect(await paySplitPayment(store, deps, fresh)).toBe("paid");
    expect(credits[USER_A]).toBe(500);
    expect(ledger).toHaveLength(1);
    const viSpy = vi.fn(); void viSpy;
  });
});
