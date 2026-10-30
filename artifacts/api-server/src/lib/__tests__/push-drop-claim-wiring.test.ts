/**
 * World drop claim landed → claimer bell + device-push wiring
 * (M3 R2, stack1000 lane N1 — the King-gift precedent, lane A4).
 *
 * The authoritative moment is the grant landing inside
 * claimSpectacleDrop, the one claim function behind the World's
 * drop.claim frame (button, gamepad and KeyC all send that one
 * frame; the room's reservation machine is the exactly-once
 * anchor — claimedUserIds + claimsLeft flip synchronously before
 * the payout and roll back on any !ok result). The tell fires
 * only from the path that lands THIS claim's grant: a budget
 * refusal and a failed grant return before it, and a retry that
 * finally lands reaches it exactly once. Category money (every
 * landed-credit precedent: King's gift, stage tips, Pitch & Fix
 * rewards), deep link /world. The rail itself is pinned by
 * world-events-drop-claim.test.ts; the room's reservation
 * exactly-once is pinned by world-room-drop-claim.test.ts — this
 * suite pins the tell.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { sharkDropsTable } from "@workspace/db";
import type { UserEventInput } from "../push-events";

const h = vi.hoisted(() => ({
  weekStart: new Date("2026-10-19T00:00:00.000Z"),
  spentVb: 0,
  grants: [] as Array<{ userId: string; amountVb: number }>,
  grantFails: false,
  inserts: [] as Array<{ table: unknown; values: Record<string, unknown> }>,
  insertFails: false,
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    db: {
      insert: (table: unknown) => ({
        values: (values: Record<string, unknown>) => {
          h.inserts.push({ table, values });
          return h.insertFails
            ? Promise.reject(new Error("ledger down"))
            : Promise.resolve([]);
        },
      }),
    },
  };
});

vi.mock("../stream-drops", () => ({
  STREAM_DROP_WEEKLY_CAP_VB: 1_000,
  combinedDropWeekSpendVb: vi.fn(async () => h.spentVb),
}));

vi.mock("../retention", () => ({
  currentWeekStart: () => h.weekStart,
}));

vi.mock("../supabase-admin", () => ({
  addCreditsAtomic: vi.fn(async (userId: string, amountVb: number) => {
    if (h.grantFails) throw new Error("grant failed");
    h.grants.push({ userId, amountVb });
    return { oldCredits: 0, newCredits: amountVb, created: false };
  }),
}));

import {
  claimSpectacleDrop,
  buildDropClaimEvent,
  __setDropClaimEventNotifier,
} from "../world-events";

function capture() {
  const events: UserEventInput[] = [];
  __setDropClaimEventNotifier(async (input) => {
    events.push(input);
  });
  return events;
}

beforeEach(() => {
  h.spentVb = 0;
  h.grants = [];
  h.grantFails = false;
  h.inserts = [];
  h.insertFails = false;
});

afterEach(() => {
  __setDropClaimEventNotifier(null);
});

describe("buildDropClaimEvent", () => {
  it("addresses the claimer, money category, drop_claim kind, /world link, honest amount", () => {
    const ev = buildDropClaimEvent({ userId: "user-a", amountVb: 250 });
    expect(ev).toMatchObject({
      userId: "user-a",
      category: "money",
      kind: "drop_claim",
      link: "/world",
    });
    expect(ev.body).toContain("250 VB");
    expect(ev.body).toContain("World");
  });
});

describe("drop.claim spectacle push wiring", () => {
  it("a landed claim tells the claimer exactly once", async () => {
    const events = capture();
    await expect(claimSpectacleDrop("user-1", 200, "evt-drop")).resolves.toEqual({ ok: true });
    expect(h.grants).toEqual([{ userId: "user-1", amountVb: 200 }]);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      userId: "user-1",
      category: "money",
      kind: "drop_claim",
      link: "/world",
    });
    expect(events[0]!.body).toContain("200 VB");
  });

  it("a budget refusal tells nobody — no grant, no bell", async () => {
    const events = capture();
    h.spentVb = 900;
    await expect(claimSpectacleDrop("user-1", 200, "evt-drop")).resolves.toEqual({
      ok: false,
      reason: "budget",
    });
    expect(h.grants).toEqual([]);
    expect(events).toEqual([]);
  });

  it("a failed grant tells nobody", async () => {
    const events = capture();
    h.grantFails = true;
    await expect(claimSpectacleDrop("user-1", 200, "evt-drop")).resolves.toEqual({
      ok: false,
      reason: "error",
    });
    expect(events).toEqual([]);
  });

  it("a failed ledger row still bells — the grant is the money truth and it landed", async () => {
    /* The rail suite pins the ordering: a failed shark_drops row
       never un-pays a landed claim. The bell follows the grant,
       not the accounting row, so a landed-but-unledgered claim
       still tells its claimer exactly once. */
    const events = capture();
    h.insertFails = true;
    await expect(claimSpectacleDrop("user-1", 200, "evt-drop")).resolves.toEqual({ ok: true });
    expect(h.grants).toEqual([{ userId: "user-1", amountVb: 200 }]);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ userId: "user-1", kind: "drop_claim" });
  });

  it("a throwing notifier cannot unwind a landed claim", async () => {
    __setDropClaimEventNotifier(async () => {
      throw new Error("push down");
    });
    await expect(claimSpectacleDrop("user-1", 200, "evt-drop")).resolves.toEqual({ ok: true });
    expect(h.grants).toEqual([{ userId: "user-1", amountVb: 200 }]);
    expect(h.inserts[0]!.table).toBe(sharkDropsTable);
  });

  it("each claimer's landed claim tells only that claimer, with their amount", async () => {
    const events = capture();
    await claimSpectacleDrop("user-a", 200, "evt-drop");
    await claimSpectacleDrop("user-b", 350, "evt-drop");
    expect(events.map((e) => e.userId)).toEqual(["user-a", "user-b"]);
    expect(events[0]!.body).toContain("200 VB");
    expect(events[1]!.body).toContain("350 VB");
  });

  it("bells track landed claims 1:1 across a mixed sequence (refusals stay silent)", async () => {
    const events = capture();
    await claimSpectacleDrop("user-1", 200, "evt-drop"); // lands
    h.spentVb = 950;
    await claimSpectacleDrop("user-1", 200, "evt-drop"); // budget refusal
    h.spentVb = 0;
    h.grantFails = true;
    await claimSpectacleDrop("user-1", 200, "evt-drop"); // grant failure
    h.grantFails = false;
    await claimSpectacleDrop("user-1", 200, "evt-drop"); // the retry lands
    expect(h.grants).toHaveLength(2);
    expect(events).toHaveLength(2);
  });
});
