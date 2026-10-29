/**
 * Priority DM landed → creator device-push wiring (push families #7).
 *
 * The authoritative moment is sendPriorityDm's "sent" outcome: the
 * charge landed, the row landed, the message is in the creator's
 * priority lane. A duplicate purchase returns BEFORE that exit, so
 * the ping is exactly-once per paid message by construction.
 * Refused/blocked/refunded outcomes never ping. The port is optional
 * (unit fakes omit it) and a throwing notifier can never fail a send
 * the fan already paid for.
 */
import { describe, expect, it } from "vitest";
import {
  buildPriorityDmSentEvent,
  sendPriorityDm,
  type PriorityDmDeps,
  type PriorityDmRow,
} from "../priority-dms";

const FAN = "11111111-1111-4111-8111-111111111111";
const CREATOR = "22222222-2222-4222-8222-222222222222";
const T0 = new Date("2026-10-26T12:00:00.000Z");

function makeWorld(convStatus: string | null = "inbox") {
  const rows: PriorityDmRow[] = [];
  const chargedKeys = new Set<string>();
  let seq = 0;
  const conv = convStatus === null ? null : { id: "conv-1", status: convStatus };
  const store: PriorityDmDeps["store"] = {
    getSettings: async () => ({ creatorUserId: CREATOR, optedIn: true, minPriceVb: 500, replyWindowHours: 48 }),
    findByIdempotencyKey: async (key) => rows.find((r) => r.idempotencyKey === key) ?? null,
    insertPriorityDm: async (input) => {
      if (rows.some((r) => r.idempotencyKey === input.idempotencyKey)) throw new Error("unique_violation");
      const row: PriorityDmRow = { ...input, id: `row-${++seq}`, repliedAt: null, settledAt: null, createdAt: T0 };
      rows.push(row);
      return row;
    },
    transitionFromHeld: async (id, to, patch) => {
      const row = rows.find((r) => r.id === id);
      if (!row || row.status !== "held") return false;
      row.status = to;
      Object.assign(row, patch);
      return true;
    },
    setDelivery: async (id, conversationId, messageId) => {
      const row = rows.find((r) => r.id === id);
      if (row) {
        row.conversationId = conversationId;
        row.messageId = messageId;
      }
    },
    listHeld: async () => rows.filter((r) => r.status === "held"),
    findConversationBetween: async () => conv,
    getOrCreateInboxConversation: async () => conv ?? { id: "conv-1", status: "inbox" },
    insertMessage: async () => ({ id: `msg-${++seq}` }),
    getConversationById: async () => conv,
    creatorReplyAt: async () => null,
  };
  const credits: PriorityDmDeps["credits"] = {
    charge: async (_userId, _amountVb, key) => {
      chargedKeys.add(key);
    },
    refund: async () => {},
    payout: async () => {},
  };
  return { store, credits, rows };
}

type SentEvent = Parameters<NonNullable<PriorityDmDeps["notifyEvent"]>>[0];

function depsWithNotify(world: ReturnType<typeof makeWorld>, notify?: (e: SentEvent) => Promise<unknown>): PriorityDmDeps {
  return {
    store: world.store,
    credits: world.credits,
    platformEnabled: true,
    now: () => T0,
    ...(notify ? { notifyEvent: notify } : {}),
  };
}

describe("buildPriorityDmSentEvent", () => {
  it("addresses the creator, messages category, states the amount and the earn condition", () => {
    const ev = buildPriorityDmSentEvent({ creatorUserId: CREATOR, amountVb: 100, body: "love your last video" });
    expect(ev).toMatchObject({ userId: CREATOR, category: "messages", kind: "priority_dm", link: "/messages" });
    expect(ev.body).toContain("100 VB");
    expect(ev.body).toContain("love your last video");
  });
});

describe("sendPriorityDm push wiring", () => {
  it("a landed send pings the creator exactly once", async () => {
    const world = makeWorld();
    const events: SentEvent[] = [];
    const out = await sendPriorityDm(depsWithNotify(world, async (e) => {
      events.push(e);
    }), { senderUserId: FAN, creatorUserId: CREATOR, body: "please review my song", clientKey: "tap-0001-abcd" });
    expect(out.kind).toBe("sent");
    expect(events).toHaveLength(1);
    expect(events[0]!.userId).toBe(CREATOR);
  });

  it("a duplicate purchase (same intent key) never re-pings", async () => {
    const world = makeWorld();
    const events: SentEvent[] = [];
    const deps = depsWithNotify(world, async (e) => {
      events.push(e);
    });
    const input = { senderUserId: FAN, creatorUserId: CREATOR, body: "please review my song", clientKey: "tap-0001-abcd" };
    await sendPriorityDm(deps, input);
    const again = await sendPriorityDm(deps, input);
    expect(again.kind).toBe("duplicate");
    expect(events).toHaveLength(1);
  });

  it("a blocked fan is refused and never pings", async () => {
    const world = makeWorld("blocked");
    const events: SentEvent[] = [];
    const out = await sendPriorityDm(depsWithNotify(world, async (e) => {
      events.push(e);
    }), { senderUserId: FAN, creatorUserId: CREATOR, body: "hi", clientKey: "tap-0002-abcd" });
    expect(out.kind).toBe("blocked");
    expect(events).toHaveLength(0);
  });

  it("a throwing notifier cannot fail a paid send; an absent port stays silent", async () => {
    const world = makeWorld();
    const out = await sendPriorityDm(depsWithNotify(world, async () => {
      throw new Error("push down");
    }), { senderUserId: FAN, creatorUserId: CREATOR, body: "hi", clientKey: "tap-0003-abcd" });
    expect(out.kind).toBe("sent");

    const world2 = makeWorld();
    const out2 = await sendPriorityDm(depsWithNotify(world2), {
      senderUserId: FAN,
      creatorUserId: CREATOR,
      body: "hi",
      clientKey: "tap-0004-abcd",
    });
    expect(out2.kind).toBe("sent");
  });
});
