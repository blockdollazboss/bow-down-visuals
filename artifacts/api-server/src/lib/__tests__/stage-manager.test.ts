/**
 * stage-manager.test.ts — UPGRADE delta #166: the real-time co-host's
 * decision rules. Pins: the master switch + the creator's mid-stream
 * mute gate EVERYTHING; link drops fire on a chatter's keyword
 * mention (never the owner's own message, never inside cooldown);
 * flags are behavioral (repeat spam, rapid fire, link storm) and
 * cooldown-bound; tips sting once per milestone and pin the
 * supporter's message only when no paid pin is up; viewer milestones
 * sting once each. Peace law: no action type here can punish a
 * person — the union is drop_link / pin / sting / flag, full stop.
 */
import { describe, expect, it } from "vitest";
import {
  evaluateChatMessage,
  evaluateTip,
  evaluateViewerCount,
  freshStageMemory,
  type StageMemory,
} from "../stage-manager";
import { DEFAULT_LIVE_PREFS, type LivePrefsWire } from "../creator-live-prefs";

const OWNER = "99999999-9999-4999-8999-999999999999";
const FAN = "11111111-1111-4111-8111-111111111111";
const FAN2 = "22222222-2222-4222-8222-222222222222";
const FAN3 = "33333333-3333-4333-8333-333333333333";
const STREAM = { id: "stream-1", ownerUserId: OWNER };

function gate(prefs: Partial<LivePrefsWire> = {}, state: { muted?: boolean } = {}) {
  return {
    prefs: {
      ...DEFAULT_LIVE_PREFS,
      stage_manager_link_rules: [
        { keyword: "merch", label: "My merch", url: "https://example.com/merch" },
      ],
      ...prefs,
    },
    state: { muted: state.muted ?? false, pinnedMessageId: null, pinnedUntil: null },
  };
}

function chat(over: Partial<{ id: string; userId: string; body: string }> = {}) {
  return { id: "m1", userId: FAN, body: "hello", kind: "chat" as const, tipAmountVb: null, ...over };
}

describe("gates", () => {
  it("master off or co-host muted by the creator: total silence", () => {
    const mem = freshStageMemory();
    const msg = chat({ body: "where's the merch?" });
    expect(evaluateChatMessage(gate({ stage_manager_enabled: false }), mem, STREAM, msg, 1000)).toEqual([]);
    expect(evaluateChatMessage(gate({}, { muted: true }), mem, STREAM, msg, 1000)).toEqual([]);
    expect(evaluateTip(gate({}, { muted: true }), mem, { messageId: "t1", amountVb: 600, paidPinActive: false }, 1000)).toEqual([]);
    expect(evaluateViewerCount(gate({ stage_manager_enabled: false }), mem, 500, 1000)).toEqual([]);
  });

  it("each action has its own switch", () => {
    const mem = freshStageMemory();
    const msg = chat({ body: "merch?" });
    expect(evaluateChatMessage(gate({ stage_manager_links_enabled: false }), mem, STREAM, msg, 1000)).toEqual([]);
  });
});

describe("link drops", () => {
  it("a chatter's keyword mention drops the creator's link, once per cooldown", () => {
    const mem: StageMemory = freshStageMemory();
    const msg = chat({ body: "yo where can I get the merch" });
    const first = evaluateChatMessage(gate(), mem, STREAM, msg, 10_000);
    expect(first).toEqual([
      { type: "drop_link", rule: { keyword: "merch", label: "My merch", url: "https://example.com/merch" } },
    ]);
    expect(evaluateChatMessage(gate(), mem, STREAM, msg, 20_000)).toEqual([]);
    const later = evaluateChatMessage(gate(), mem, STREAM, msg, 10_000 + 121_000);
    expect(later).toHaveLength(1);
  });

  it("the owner's own mention never triggers a drop", () => {
    const mem = freshStageMemory();
    expect(evaluateChatMessage(gate(), mem, STREAM, chat({ userId: OWNER, body: "merch restock soon" }), 1000)).toEqual([]);
  });

  it("no rules configured: nothing to drop", () => {
    const mem = freshStageMemory();
    const g = gate();
    g.prefs.stage_manager_link_rules = [];
    expect(evaluateChatMessage(g, mem, STREAM, chat({ body: "merch?" }), 1000)).toEqual([]);
  });
});

describe("trouble flags (behavioral, creator-facing, never a punishment)", () => {
  it("the same message three times in 90s flags once, then cools down", () => {
    const mem = freshStageMemory();
    const spam = chat({ body: "BUY FOLLOWERS CHEAP" });
    expect(evaluateChatMessage(gate(), mem, STREAM, spam, 1000)).toEqual([]);
    expect(evaluateChatMessage(gate(), mem, STREAM, spam, 3000)).toEqual([]);
    const third = evaluateChatMessage(gate(), mem, STREAM, spam, 5000);
    expect(third).toEqual([
      { type: "flag", reason: expect.stringContaining("same message"), messageId: "m1" },
    ]);
    expect(evaluateChatMessage(gate(), mem, STREAM, spam, 7000)).toEqual([]);
  });

  it("eight messages inside 15s flags rapid fire", () => {
    const mem = freshStageMemory();
    let flagged: unknown[] = [];
    for (let i = 0; i < 8; i++) {
      flagged = evaluateChatMessage(gate(), mem, STREAM, chat({ id: `m${i}`, body: `unique ${i}` }), 1000 + i * 1500);
    }
    expect(flagged).toEqual([
      { type: "flag", reason: expect.stringContaining("rapid-fire"), messageId: "m7" },
    ]);
  });

  it("a link storm across three viewers flags once", () => {
    const mem = freshStageMemory();
    const fans = [FAN, FAN2, FAN3, FAN];
    let out: unknown[] = [];
    fans.forEach((fan, i) => {
      out = evaluateChatMessage(gate(), mem, STREAM, chat({ id: `l${i}`, userId: fan, body: `check https://spam.example/${i}` }), 1000 + i * 1000);
    });
    expect(out).toEqual([
      { type: "flag", reason: expect.stringContaining("links in quick succession"), messageId: "l3" },
    ]);
  });

  it("ordinary chat never flags", () => {
    const mem = freshStageMemory();
    for (let i = 0; i < 5; i++) {
      expect(
        evaluateChatMessage(gate(), mem, STREAM, chat({ id: `c${i}`, body: `great song part ${i}` }), 1000 + i * 4000),
      ).toEqual([]);
    }
  });
});

describe("tips: stings + supporter pins", () => {
  const T0 = 1_700_000_000_000;
  it("crossing 500 VB cumulative stings once; the tip pins when no paid pin is up", () => {
    const mem = freshStageMemory();
    const first = evaluateTip(gate(), mem, { messageId: "t1", amountVb: 300, paidPinActive: false }, T0);
    expect(first).toEqual([{ type: "pin", messageId: "t1", durationMs: 120_000 }]);
    const second = evaluateTip(gate(), mem, { messageId: "t2", amountVb: 250, paidPinActive: false }, T0 + 1000);
    expect(second).toEqual([{ type: "sting", milestone: "500 VB in tips" }]);
    // Same milestone never stings twice.
    const third = evaluateTip(gate(), mem, { messageId: "t3", amountVb: 10, paidPinActive: false }, T0 + 130_000);
    expect(third.filter((a) => a.type === "sting")).toEqual([]);
  });

  it("a paid pin always outranks the co-host's pin", () => {
    const mem = freshStageMemory();
    const out = evaluateTip(gate(), mem, { messageId: "t1", amountVb: 100, paidPinActive: true }, T0);
    expect(out.filter((a) => a.type === "pin")).toEqual([]);
  });

  it("the pin switch off means no pin, stings still land", () => {
    const mem = freshStageMemory();
    const out = evaluateTip(gate({ stage_manager_pin_enabled: false }), mem, { messageId: "t1", amountVb: 600, paidPinActive: false }, T0);
    expect(out).toEqual([{ type: "sting", milestone: "500 VB in tips" }]);
  });
});

describe("viewer milestones", () => {
  const T0 = 1_700_000_000_000;
  it("crossing 25 stings once; higher crossings sting again after cooldown", () => {
    const mem = freshStageMemory();
    expect(evaluateViewerCount(gate(), mem, 24, T0)).toEqual([]);
    expect(evaluateViewerCount(gate(), mem, 25, T0 + 1000)).toEqual([{ type: "sting", milestone: "25 viewers" }]);
    expect(evaluateViewerCount(gate(), mem, 30, T0 + 2000)).toEqual([]);
    expect(evaluateViewerCount(gate(), mem, 120, T0 + 200_000)).toEqual([{ type: "sting", milestone: "100 viewers" }]);
  });
});
