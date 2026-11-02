/**
 * remix-king-notify.test.ts — notification-completeness census
 * (stack1200): Remix the King's two member moments must TELL.
 *
 * THE GAPS: (1) selectWinner crowned a winner and created the
 * official release in total silence — the winner heard nothing.
 * (2) paySplitPayment landed real Visual Bucs in payees' balances
 * (the release splits) with no tell at all — no bell, no push.
 * Both are money-family events: the split landing is a prize payout
 * (category "money"); the crowning opens that money path, so its
 * copy claims NO landed money — it names the release and says the
 * split pays when the release payments run.
 *
 * Exactly-once rides the rails' own claims: selectWinner returns
 * the existing release on a re-call (no second crown, no second
 * tell); a split's claim flip lands once (a replay pays nothing
 * and tells nothing).
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import {
  createEvent,
  setEventStatus,
  submitEntry,
  selectWinner,
  createSplitPayments,
  __setRemixKingEventNotifier,
  type RemixKingStore,
  type EventWire,
  type EntryWire,
  type ReleaseWire,
  type SplitPaymentWire,
} from "../remix-king";
import { paySplitPayment, processSplitPayments, type SplitPayDeps } from "../remix-king-payments";
import type { RemixKingSplit } from "@workspace/db";
import type { UserEventInput } from "../push-events";

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

function fakeDeps(events: UserEventInput[]) {
  const credits: Record<string, number> = {};
  const deps: SplitPayDeps = {
    async addCredits(userId, amount) { credits[userId] = (credits[userId] ?? 0) + amount; },
    async recordLedger(rec) { void rec; return "recorded"; },
    notify: vi.fn(async (input: UserEventInput) => { events.push(input); }),
  };
  return { deps, credits };
}

async function setup(events: UserEventInput[]) {
  const store = memoryStore();
  const ev = await createEvent(store, ADMIN, { monthKey: "2026-11", title: "T", kingTrackTitle: "K", splits: SPLITS });
  await setEventStatus(store, ev.id, "open");
  const a = await submitEntry(store, { eventId: ev.id, userId: USER_A, entrantName: "Remixer A", remixTitle: "Flip", audioUrl: "https://e.com/a" });
  await setEventStatus(store, ev.id, "judging");
  void events;
  return { store, ev, a };
}

describe("Remix the King — the winner hears the crown", () => {
  afterEach(() => { __setRemixKingEventNotifier(null); });

  it("selectWinner tells the winner once; a re-call is silent", async () => {
    const crownEvents: UserEventInput[] = [];
    __setRemixKingEventNotifier(async (input) => { crownEvents.push(input); });
    const { store, ev, a } = await setup(crownEvents);

    await selectWinner(store, ev.id, a.id);
    expect(crownEvents).toHaveLength(1);
    expect(crownEvents[0]).toMatchObject({
      userId: USER_A,
      category: "money",
      kind: "remix_king_winner",
      link: "/remix",
    });
    /* Truth rule: the crowning moves no money yet — the copy must
       not claim a landed amount. */
    expect(crownEvents[0]!.body).not.toMatch(/landed|just landed/);
    expect(crownEvents[0]!.body).toContain("Flip");

    await selectWinner(store, ev.id, a.id);
    expect(crownEvents).toHaveLength(1);
  });
});

describe("Remix the King — split payees hear the money land", () => {
  it("each paid split tells its payee once, naming the amount; replays and skips stay silent", async () => {
    const crownEvents: UserEventInput[] = [];
    __setRemixKingEventNotifier(async (input) => { crownEvents.push(input); });
    const { store, ev, a } = await setup(crownEvents);
    const { release } = await selectWinner(store, ev.id, a.id);
    const payments = await createSplitPayments(store, release.id, "2026-12", 1000);

    const events: UserEventInput[] = [];
    const { deps } = fakeDeps(events);
    const result = await processSplitPayments(store, deps, release.id);
    expect(result.paidIds).toHaveLength(2);

    const winnerTell = events.filter((e) => e.userId === USER_A);
    const kingTell = events.filter((e) => e.userId === KING_ID);
    expect(winnerTell).toHaveLength(1);
    expect(winnerTell[0]).toMatchObject({ category: "money", kind: "remix_king_split_paid", link: "/remix" });
    expect(winnerTell[0]!.body).toContain("500");
    expect(kingTell).toHaveLength(1);
    expect(kingTell[0]!.body).toContain("300");
    /* The house share has no account: skipped, and no tell invented. */
    expect(events).toHaveLength(2);

    const again = await processSplitPayments(store, deps, release.id);
    expect(again.paidIds).toHaveLength(0);
    expect(events).toHaveLength(2);
    void payments;
  });

  it("a failed split tells nothing — the money never landed", async () => {
    const { store, ev, a } = await setup([]);
    const { release } = await selectWinner(store, ev.id, a.id);
    const payments = await createSplitPayments(store, release.id, "2026-12", 1000);
    const winner = payments.find((p) => p.role === "winner")!;
    const events: UserEventInput[] = [];
    const deps: SplitPayDeps = {
      async addCredits() { /* grant lands */ },
      async recordLedger() { throw new Error("ledger down"); },
      notify: vi.fn(async (input: UserEventInput) => { events.push(input); }),
    };
    expect(await paySplitPayment(store, deps, winner)).toBe("failed_released");
    expect(events).toHaveLength(0);
  });
});
