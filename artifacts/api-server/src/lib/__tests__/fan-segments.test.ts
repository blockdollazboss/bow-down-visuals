/**
 * Fan segments — rule semantics over the merged fan graph.
 *
 * Pins:
 *   - every predicate, alone and combined (AND);
 *   - normalization strictness (a malformed rule is refused, never
 *     approximated);
 *   - the three presets, evaluated on a fixture universe;
 *   - the conservative-merge inheritance: segments evaluate MERGED
 *     records, so an unbridged email-buyer and account-follower are
 *     two fans in segment math exactly as in the graph;
 *   - count/preview correctness (preview order: spend, then VB,
 *     then recency);
 *   - mailable-audience resolution: only ACTIVE subscriber rows of
 *     the given list, one per fan, with honest not-mailable reasons
 *     (no email / not subscribed / unsubscribed — suppression is
 *     absolute).
 */
import { describe, expect, it } from "vitest";
import { buildFanGraph, type FanGraphSources, type FanRecord } from "../fan-graph";
import {
  EMPTY_FAN_RULES,
  FAN_SEGMENT_PRESETS,
  evaluateFanSegment,
  fanMatchesRules,
  fanSegmentPreset,
  normalizeFanSegmentRules,
  previewFanSegment,
  resolveSegmentAudience,
  type FanSegmentRules,
} from "../fan-segments";

const T = (iso: string) => new Date(iso);
const NOW = T("2026-03-10T00:00:00Z");

function fan(partial: Partial<FanRecord>): FanRecord {
  return {
    id: "u:x",
    userId: "x",
    emails: [],
    email: null,
    displayName: null,
    profileSlug: null,
    avatarUrl: null,
    follows: false,
    followingSince: null,
    subscribed: false,
    unsubscribed: false,
    member: null,
    spentUsdCents: 0,
    spentVb: 0,
    purchaseCount: 0,
    lastActivityAt: null,
    sources: [],
    ...partial,
  };
}

const rules = (partial: Partial<FanSegmentRules>): FanSegmentRules => ({
  ...EMPTY_FAN_RULES,
  sourcesAny: [],
  ...partial,
});

describe("fanMatchesRules — predicates", () => {
  it("empty rules match everyone (no opinion anywhere)", () => {
    expect(fanMatchesRules(fan({}), rules({}))).toBe(true);
    expect(fanMatchesRules(fan({ follows: true, purchaseCount: 3 }), rules({}))).toBe(true);
  });

  it("follows / subscribed / buyer tri-states", () => {
    const follower = fan({ follows: true });
    const stranger = fan({ follows: false });
    expect(fanMatchesRules(follower, rules({ follows: "yes" }))).toBe(true);
    expect(fanMatchesRules(stranger, rules({ follows: "yes" }))).toBe(false);
    expect(fanMatchesRules(stranger, rules({ follows: "no" }))).toBe(true);
    expect(fanMatchesRules(fan({ subscribed: true }), rules({ subscribed: "yes" }))).toBe(true);
    // An unsubscribed fan is NOT subscribed (phase 1's contract).
    expect(fanMatchesRules(fan({ subscribed: false, unsubscribed: true }), rules({ subscribed: "yes" }))).toBe(false);
    expect(fanMatchesRules(fan({ purchaseCount: 2 }), rules({ buyer: "yes" }))).toBe(true);
    expect(fanMatchesRules(fan({ purchaseCount: 0 }), rules({ buyer: "yes" }))).toBe(false);
    expect(fanMatchesRules(fan({ purchaseCount: 0 }), rules({ buyer: "no" }))).toBe(true);
  });

  it("member states: none / member / active", () => {
    const active = fan({ member: { tierName: "Gold", status: "active", joinedAt: "2026-01-01T00:00:00.000Z" } });
    const canceled = fan({ member: { tierName: "Gold", status: "canceled", joinedAt: "2026-01-01T00:00:00.000Z" } });
    const none = fan({ member: null });
    expect(fanMatchesRules(none, rules({ member: "none" }))).toBe(true);
    expect(fanMatchesRules(active, rules({ member: "none" }))).toBe(false);
    expect(fanMatchesRules(canceled, rules({ member: "member" }))).toBe(true);
    expect(fanMatchesRules(none, rules({ member: "member" }))).toBe(false);
    expect(fanMatchesRules(active, rules({ member: "active" }))).toBe(true);
    expect(fanMatchesRules(canceled, rules({ member: "active" }))).toBe(false);
  });

  it("spend / purchase floors are inclusive", () => {
    const f = fan({ spentUsdCents: 500, spentVb: 250, purchaseCount: 2 });
    expect(fanMatchesRules(f, rules({ minSpentUsdCents: 500 }))).toBe(true);
    expect(fanMatchesRules(f, rules({ minSpentUsdCents: 501 }))).toBe(false);
    expect(fanMatchesRules(f, rules({ minSpentVb: 250 }))).toBe(true);
    expect(fanMatchesRules(f, rules({ minSpentVb: 251 }))).toBe(false);
    expect(fanMatchesRules(f, rules({ minPurchases: 2 }))).toBe(true);
    expect(fanMatchesRules(f, rules({ minPurchases: 3 }))).toBe(false);
  });

  it("hasEmail, sourcesAny (OR inside), activeWithinDays", () => {
    const f = fan({
      emails: ["a@x.io"],
      email: "a@x.io",
      sources: ["follow", "store"],
      lastActivityAt: "2026-03-05T00:00:00.000Z",
    });
    expect(fanMatchesRules(f, rules({ hasEmail: true }), NOW)).toBe(true);
    expect(fanMatchesRules(fan({}), rules({ hasEmail: true }), NOW)).toBe(false);
    expect(fanMatchesRules(f, rules({ sourcesAny: ["tips", "store"] }), NOW)).toBe(true);
    expect(fanMatchesRules(f, rules({ sourcesAny: ["tips"] }), NOW)).toBe(false);
    expect(fanMatchesRules(f, rules({ activeWithinDays: 7 }), NOW)).toBe(true);
    expect(fanMatchesRules(f, rules({ activeWithinDays: 4 }), NOW)).toBe(false);
    expect(fanMatchesRules(fan({ lastActivityAt: null }), rules({ activeWithinDays: 7 }), NOW)).toBe(false);
  });

  it("predicates combine as AND", () => {
    const buyerFollower = fan({ follows: true, purchaseCount: 1, spentUsdCents: 900 });
    const buyerStranger = fan({ follows: false, purchaseCount: 1, spentUsdCents: 900 });
    const brokeFollower = fan({ follows: true, purchaseCount: 0, spentUsdCents: 0 });
    const r = rules({ buyer: "yes", follows: "no", minSpentUsdCents: 100 });
    expect(fanMatchesRules(buyerFollower, r)).toBe(false);
    expect(fanMatchesRules(buyerStranger, r)).toBe(true);
    expect(fanMatchesRules(brokeFollower, r)).toBe(false);
  });
});

describe("normalizeFanSegmentRules", () => {
  it("defaults an absent/empty rule set to no-opinion", () => {
    expect(normalizeFanSegmentRules(undefined)).toEqual(EMPTY_FAN_RULES);
    expect(normalizeFanSegmentRules({})).toEqual(EMPTY_FAN_RULES);
  });

  it("floors numeric inputs and dedupes sources", () => {
    const r = normalizeFanSegmentRules({ minSpentUsdCents: 199.9, sourcesAny: ["store", "store", "tips"] });
    expect(r?.minSpentUsdCents).toBe(199);
    expect(r?.sourcesAny).toEqual(["store", "tips"]);
  });

  it("refuses malformed rules outright", () => {
    expect(normalizeFanSegmentRules("buyers")).toBeNull();
    expect(normalizeFanSegmentRules({ follows: "sometimes" })).toBeNull();
    expect(normalizeFanSegmentRules({ member: "vip" })).toBeNull();
    expect(normalizeFanSegmentRules({ minSpentUsdCents: -5 })).toBeNull();
    expect(normalizeFanSegmentRules({ minSpentUsdCents: "500" })).toBeNull();
    expect(normalizeFanSegmentRules({ hasEmail: "yes" })).toBeNull();
    expect(normalizeFanSegmentRules({ sourcesAny: ["carrier_pigeon"] })).toBeNull();
    expect(normalizeFanSegmentRules({ activeWithinDays: 99999 })).toBeNull();
  });

  it("round-trips every preset through normalization unchanged", () => {
    for (const p of FAN_SEGMENT_PRESETS) {
      expect(normalizeFanSegmentRules(JSON.parse(JSON.stringify(p.rules)))).toEqual(p.rules);
    }
  });
});

/* ── Fixture universe through the REAL merge ─────────────────────── */

function sources(partial: Partial<FanGraphSources>): FanGraphSources {
  return {
    subscribers: [], members: [], follows: [], storeOrders: [], digitalSales: [],
    shopSales: [], liveSales: [], tips: [], profileCards: new Map(), ...partial,
  };
}

function universe(): FanRecord[] {
  return buildFanGraph(
    sources({
      follows: [
        { followerUserId: "u-ada", createdAt: T("2026-01-05T00:00:00Z") },
        { followerUserId: "u-fay", createdAt: T("2026-02-01T00:00:00Z") },
      ],
      storeOrders: [{ buyerUserId: "u-ada", amountCents: 2500, createdAt: T("2026-03-01T00:00:00Z") }],
      digitalSales: [{ buyerUserId: "u-cy", amountCents: 900, createdAt: T("2026-03-03T00:00:00Z") }],
      shopSales: [{ buyerEmail: "bea@example.com", amountCents: 4000, createdAt: T("2026-03-04T00:00:00Z") }],
      liveSales: [{ buyerUserId: "u-dee", amountCents: 1500, createdAt: T("2026-03-05T00:00:00Z") }],
      tips: [{ fromUserId: "u-ada", amountVb: 500, createdAt: T("2026-03-06T00:00:00Z") }],
      subscribers: [
        { email: "bea@example.com", name: "Bea", subscribedAt: T("2026-01-10T00:00:00Z"), unsubscribedAt: null },
        { email: "cy@x.io", name: null, subscribedAt: T("2026-01-11T00:00:00Z"), unsubscribedAt: null },
        { email: "dee@mail.com", name: "Dee", subscribedAt: T("2026-01-12T00:00:00Z"), unsubscribedAt: null },
      ],
      members: [
        {
          // Bridge: u-dee <-> dee@mail.com
          fanLabel: "dee@mail.com", fanUserId: "u-dee", tierName: "Silver", status: "active",
          priceCents: 800, hasPaidCheckout: false,
          joinedAt: T("2026-01-16T00:00:00Z"), updatedAt: T("2026-01-16T00:00:00Z"),
        },
      ],
    }),
  ).fans;
}

describe("presets over the merged graph", () => {
  const fans = universe();
  const ids = (rs: FanSegmentRules) => evaluateFanSegment(fans, rs, NOW).map((f) => f.id).sort();

  it("buyers-not-followers: Bea (shop), Cy-account (digital), Dee (live) — not Ada (follows)", () => {
    const preset = fanSegmentPreset("buyers-not-followers")!;
    expect(ids(preset.rules)).toEqual(["e:bea@example.com", "u:u-cy", "u:u-dee"]);
  });

  it("top-spenders: everyone with real USD spend, nobody at $0", () => {
    const preset = fanSegmentPreset("top-spenders")!;
    expect(ids(preset.rules)).toEqual(["e:bea@example.com", "u:u-ada", "u:u-cy", "u:u-dee"]);
  });

  it("subscribed-not-buyers: Bea bought, so only Cy-email qualifies; Dee is bridged to a buyer record", () => {
    const preset = fanSegmentPreset("subscribed-not-buyers")!;
    // Dee's subscriber row merged into u:u-dee via the club bridge —
    // and that record bought, so it is (correctly) not in this segment.
    expect(ids(preset.rules)).toEqual(["e:cy@x.io"]);
  });

  it("conservative merge inheritance: the unbridged Cy pair stays TWO segment members", () => {
    // Cy exists as e:cy@x.io (subscriber, no spend) and u:u-cy
    // (buyer, no follow, no subscription). A segment counting
    // buyers must count the account record; a segment counting
    // subscribers must count the email record; neither leaks into
    // the other's facts.
    expect(ids(rules({ buyer: "yes" }))).toContain("u:u-cy");
    expect(ids(rules({ buyer: "yes" }))).not.toContain("e:cy@x.io");
    expect(ids(rules({ subscribed: "yes" }))).toContain("e:cy@x.io");
    expect(ids(rules({ subscribed: "yes" }))).not.toContain("u:u-cy");
    // And the intersection (subscribed buyers) must NOT invent a merged Cy.
    expect(ids(rules({ subscribed: "yes", buyer: "yes" }))).not.toContain("u:u-cy");
    expect(ids(rules({ subscribed: "yes", buyer: "yes" }))).not.toContain("e:cy@x.io");
  });
});

describe("previewFanSegment — count + preview", () => {
  const fans = universe();

  it("count is full membership; preview is capped and spend-ordered", () => {
    const { count, preview } = previewFanSegment(fans, rules({}), { limit: 2 });
    expect(count).toBe(fans.length);
    expect(preview).toHaveLength(2);
    expect(preview[0]!.id).toBe("e:bea@example.com"); // $40 — top spender
    expect(preview[1]!.id).toBe("u:u-ada"); // $25 + 500 VB
  });

  it("a segment matching nobody previews honestly empty", () => {
    const { count, preview } = previewFanSegment(fans, rules({ minSpentUsdCents: 999_999 }));
    expect(count).toBe(0);
    expect(preview).toEqual([]);
  });
});

describe("resolveSegmentAudience — the desk-side question", () => {
  const sub = (id: string, email: string, unsubscribedAt: Date | null = null) => ({ id, email, unsubscribedAt });
  const members = [
    fan({ id: "e:bea@example.com", emails: ["bea@example.com"], email: "bea@example.com" }),
    fan({ id: "u:u-dee", emails: ["dee@mail.com"], email: "dee@mail.com" }),
    fan({ id: "u:u-ada", emails: [], email: null }),
    fan({ id: "e:gone@x.io", emails: ["gone@x.io"], email: "gone@x.io" }),
    fan({ id: "e:stranger@x.io", emails: ["stranger@x.io"], email: "stranger@x.io" }),
  ];

  it("returns only ACTIVE rows of the given list, one per fan", () => {
    const { audience, matchedFans, notMailable } = resolveSegmentAudience(members, [
      sub("s-bea", "Bea@Example.com"), // case-insensitive match
      sub("s-dee", "dee@mail.com"),
      sub("s-gone", "gone@x.io", T("2026-02-01T00:00:00Z")), // unsubscribed
    ]);
    expect(matchedFans).toBe(5);
    expect(audience.map((a) => a.id).sort()).toEqual(["s-bea", "s-dee"]);
    expect(notMailable).toEqual({ noEmail: 1, notSubscribed: 1, unsubscribed: 1 });
  });

  it("suppression is absolute: an unsubscribed row is never returned, even as the only match", () => {
    const { audience, notMailable } = resolveSegmentAudience(
      [fan({ emails: ["gone@x.io"] })],
      [sub("s-gone", "gone@x.io", T("2026-02-01T00:00:00Z"))],
    );
    expect(audience).toEqual([]);
    expect(notMailable.unsubscribed).toBe(1);
  });

  it("a fan with two subscribed addresses on the list is emailed once, deterministically", () => {
    const f = fan({ emails: ["b@x.io", "a@x.io"] });
    const { audience } = resolveSegmentAudience([f], [sub("s-b", "b@x.io"), sub("s-a", "a@x.io")]);
    expect(audience).toHaveLength(1);
    expect(audience[0]!.id).toBe("s-a"); // lowest address wins
  });

  it("rows from ANOTHER list are simply not in the input — a buyer-only fan is notSubscribed, never emailed", () => {
    // The resolver only ever sees the target list's rows (the caller
    // loads them scoped by list id after an ownership check). Bea's
    // subscription on list B cannot make her mailable on list A.
    const { audience, notMailable } = resolveSegmentAudience(
      [fan({ emails: ["bea@example.com"] })],
      [],
    );
    expect(audience).toEqual([]);
    expect(notMailable.notSubscribed).toBe(1);
  });
});
