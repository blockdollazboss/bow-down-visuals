/**
 * Fan-segment send — the handoff contract.
 *
 * Pins, with injected deps (no database):
 *   - recipients handed to the desk dispatch = the segment's
 *     membership AT SEND TIME (the graph is re-loaded; a fan who
 *     joined after any preview is in, a fan who left is out);
 *   - the handoff goes through the desk's dispatch entry point
 *     (deps.dispatch — in production dispatchCampaignToAudience)
 *     with a campaign created on the caller's own list; this module
 *     itself sends no mail (there is no mail function to call);
 *   - unsubscribed / not-subscribed / email-less segment fans are
 *     counted as not-mailable and are NEVER in the audience;
 *   - a list the caller doesn't own is refused before anything is
 *     created or dispatched;
 *   - scoping: fans are loaded for the CALLER only — the loader is
 *     invoked with the caller's id and there is no other creator
 *     parameter anywhere in the call.
 */
import { describe, expect, it, vi } from "vitest";
import type { FanRecord } from "../fan-graph";
import { EMPTY_FAN_RULES, type FanSegmentRules } from "../fan-segments";
import { sendFanSegmentEmail, type FanSegmentSendDeps } from "../fan-segment-send";

const T = (iso: string) => new Date(iso);

function fan(partial: Partial<FanRecord>): FanRecord {
  return {
    id: "u:x", userId: "x", emails: [], email: null, displayName: null,
    profileSlug: null, avatarUrl: null, follows: false, followingSince: null,
    subscribed: false, unsubscribed: false, member: null, spentUsdCents: 0,
    spentVb: 0, purchaseCount: 0, lastActivityAt: null, sources: [],
    ...partial,
  };
}

const BUYERS: FanSegmentRules = { ...EMPTY_FAN_RULES, sourcesAny: [], buyer: "yes" };

function makeDeps(overrides: Partial<FanSegmentSendDeps> = {}) {
  const calls = { loadFans: [] as string[], dispatch: [] as Array<{ id: string; audience: Array<{ id: string; email: string }> }>, created: [] as Array<{ listId: string; subject: string; body: string }> };
  const deps: FanSegmentSendDeps = {
    loadFans: async (creator) => {
      calls.loadFans.push(creator);
      return [
        fan({ id: "e:bea@x.io", emails: ["bea@x.io"], email: "bea@x.io", purchaseCount: 1, spentUsdCents: 4000 }),
        fan({ id: "u:dee", userId: "dee", emails: ["dee@x.io"], email: "dee@x.io", purchaseCount: 2, spentUsdCents: 1500 }),
        fan({ id: "u:ada", userId: "ada", emails: [], email: null, purchaseCount: 1, spentUsdCents: 2500 }),
        fan({ id: "e:gone@x.io", emails: ["gone@x.io"], email: "gone@x.io", purchaseCount: 1, spentUsdCents: 100 }),
        fan({ id: "e:fay@x.io", emails: ["fay@x.io"], email: "fay@x.io", purchaseCount: 0, follows: true }),
      ];
    },
    loadOwnedList: async (creator, listId) =>
      creator === "creator-1" && listId === "list-1" ? ({ id: "list-1", userId: "creator-1" } as never) : null,
    loadSubscribers: async () =>
      [
        { id: "s-bea", listId: "list-1", email: "bea@x.io", unsubscribedAt: null },
        { id: "s-dee", listId: "list-1", email: "dee@x.io", unsubscribedAt: null },
        { id: "s-gone", listId: "list-1", email: "gone@x.io", unsubscribedAt: T("2026-02-01T00:00:00Z") },
      ] as never,
    createCampaign: async (input) => {
      calls.created.push(input);
      return { id: "camp-1", ...input, status: "draft", kind: "fan_segment" } as never;
    },
    dispatch: async (id, audience) => {
      calls.dispatch.push({ id, audience });
      return { ok: true, audience: audience.length, sent: audience.length, failed: 0 };
    },
    loadCampaign: async () => ({ id: "camp-1", status: "sent", kind: "fan_segment" }) as never,
    ...overrides,
  };
  return { deps, calls };
}

describe("sendFanSegmentEmail", () => {
  it("hands the desk exactly the segment's mailable membership", async () => {
    const { deps, calls } = makeDeps();
    const result = await sendFanSegmentEmail(
      { creatorUserId: "creator-1", listId: "list-1", rules: BUYERS, subject: "Hi", body: "Hello fans" },
      deps,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Campaign created on the caller's list, then dispatched once.
    expect(calls.created).toEqual([{ listId: "list-1", subject: "Hi", body: "Hello fans" }]);
    expect(calls.dispatch).toHaveLength(1);
    expect(calls.dispatch[0]!.id).toBe("camp-1");
    // Audience = Bea + Dee only: Ada (no email) and Gone
    // (unsubscribed) are segment members but not mailable; Fay
    // never bought, so she is not a member at all.
    expect(calls.dispatch[0]!.audience.map((a) => a.id).sort()).toEqual(["s-bea", "s-dee"]);
    expect(result.segment.matchedFans).toBe(4);
    expect(result.segment.notMailable).toEqual({ noEmail: 1, notSubscribed: 0, unsubscribed: 1 });
    expect(result.campaign.status).toBe("sent");
  });

  it("membership is computed at send time, not from any earlier preview", async () => {
    // The graph loader returns a DIFFERENT universe on the send-time
    // call: a brand-new buyer appears, and the send must include her.
    let call = 0;
    const { deps, calls } = makeDeps({
      loadFans: async () => {
        call++;
        return [
          fan({ id: "e:bea@x.io", emails: ["bea@x.io"], email: "bea@x.io", purchaseCount: 1 }),
          ...(call > 0
            ? [fan({ id: "e:new@x.io", emails: ["new@x.io"], email: "new@x.io", purchaseCount: 1 })]
            : []),
        ];
      },
      loadSubscribers: async () =>
        [
          { id: "s-bea", listId: "list-1", email: "bea@x.io", unsubscribedAt: null },
          { id: "s-new", listId: "list-1", email: "new@x.io", unsubscribedAt: null },
        ] as never,
    });
    const result = await sendFanSegmentEmail(
      { creatorUserId: "creator-1", listId: "list-1", rules: BUYERS, subject: "Hi", body: "B" },
      deps,
    );
    expect(result.ok).toBe(true);
    expect(calls.dispatch[0]!.audience.map((a) => a.id).sort()).toEqual(["s-bea", "s-new"]);
  });

  it("refuses a list the caller doesn't own — nothing created, nothing dispatched", async () => {
    const { deps, calls } = makeDeps();
    const result = await sendFanSegmentEmail(
      { creatorUserId: "creator-2", listId: "list-1", rules: BUYERS, subject: "Hi", body: "B" },
      deps,
    );
    expect(result).toEqual({ ok: false, code: "list_not_found", error: "List not found." });
    expect(calls.created).toEqual([]);
    expect(calls.dispatch).toEqual([]);
  });

  it("loads fans for the caller only (scoping is the loader's argument)", async () => {
    const { deps, calls } = makeDeps();
    await sendFanSegmentEmail(
      { creatorUserId: "creator-1", listId: "list-1", rules: BUYERS, subject: "Hi", body: "B" },
      deps,
    );
    expect(calls.loadFans).toEqual(["creator-1"]);
  });

  it("an all-unmailable segment still creates the campaign and lets the DESK answer (empty audience)", async () => {
    const dispatch = vi.fn(async () => ({ ok: false, reason: "empty_audience", audience: 0, sent: 0, failed: 0 }));
    const { deps } = makeDeps({ dispatch });
    const result = await sendFanSegmentEmail(
      { creatorUserId: "creator-1", listId: "list-1", rules: { ...BUYERS, minSpentUsdCents: 999_999 }, subject: "Hi", body: "B" },
      deps,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(dispatch).toHaveBeenCalledWith("camp-1", []);
    expect(result.dispatch.reason).toBe("empty_audience");
    expect(result.segment.matchedFans).toBe(0);
  });
});
