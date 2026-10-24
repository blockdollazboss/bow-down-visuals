/**
 * One Fan Graph — merge correctness on fixture fans across sources.
 *
 * The fixtures build one small creator universe and pin the merge
 * rule end to end:
 *   - identity = account id where a source carries one, else email;
 *   - the ONLY account↔email bridge is a fan_members row carrying
 *     both (fan_user_id + email-shaped fan_label);
 *   - an email-only fan and an account-only fan with no bridge stay
 *     TWO records, even when a human would guess they are one person;
 *   - spend sums only the rows the loader hands over as counted
 *     (completed / paid / credited) plus paid-checkout memberships
 *     that were not refunded.
 */
import { describe, expect, it } from "vitest";
import {
  buildFanGraph,
  queryFanGraph,
  type FanGraphSources,
} from "../fan-graph";

const T = (iso: string) => new Date(iso);

function sources(partial: Partial<FanGraphSources>): FanGraphSources {
  return {
    subscribers: [],
    members: [],
    follows: [],
    storeOrders: [],
    digitalSales: [],
    shopSales: [],
    liveSales: [],
    tips: [],
    profileCards: new Map(),
    ...partial,
  };
}

/** The shared fixture universe. */
function universe(): FanGraphSources {
  return sources({
    profileCards: new Map([
      ["u-ada", { displayName: "Ada Lovelace", slug: "ada", avatarUrl: "https://x/ada.png" }],
    ]),
    follows: [
      { followerUserId: "u-ada", createdAt: T("2026-01-05T00:00:00Z") },
      { followerUserId: "u-fay", createdAt: T("2026-02-01T00:00:00Z") },
    ],
    storeOrders: [
      { buyerUserId: "u-ada", amountCents: 2500, createdAt: T("2026-03-01T00:00:00Z") },
      { buyerUserId: null, amountCents: 9999, createdAt: T("2026-03-02T00:00:00Z") }, // guest — unattributable
    ],
    digitalSales: [{ buyerUserId: "u-cy", amountCents: 900, createdAt: T("2026-03-03T00:00:00Z") }],
    shopSales: [
      { buyerEmail: " Bea@Example.com ", amountCents: 4000, createdAt: T("2026-03-04T00:00:00Z") },
      { buyerEmail: null, amountCents: 777, createdAt: T("2026-03-04T00:00:00Z") }, // no identity — skipped
    ],
    liveSales: [{ buyerUserId: "u-dee", amountCents: 1500, createdAt: T("2026-03-05T00:00:00Z") }],
    tips: [{ fromUserId: "u-ada", amountVb: 500, createdAt: T("2026-03-06T00:00:00Z") }],
    subscribers: [
      { email: "bea@example.com", name: "Bea", subscribedAt: T("2026-01-10T00:00:00Z"), unsubscribedAt: null },
      { email: "cy@x.io", name: null, subscribedAt: T("2026-01-11T00:00:00Z"), unsubscribedAt: T("2026-02-11T00:00:00Z") },
      { email: "dee@mail.com", name: "Dee", subscribedAt: T("2026-01-12T00:00:00Z"), unsubscribedAt: null },
    ],
    members: [
      {
        fanLabel: "bea@example.com",
        fanUserId: null,
        tierName: "Gold",
        status: "active",
        priceCents: 1200,
        hasPaidCheckout: true,
        joinedAt: T("2026-01-15T00:00:00Z"),
        updatedAt: T("2026-01-15T00:00:00Z"),
      },
      {
        // The bridge: account id AND email label on one row.
        fanLabel: "dee@mail.com",
        fanUserId: "u-dee",
        tierName: "Silver",
        status: "active",
        priceCents: 800,
        hasPaidCheckout: false, // tracking row — never invents spend
        joinedAt: T("2026-01-16T00:00:00Z"),
        updatedAt: T("2026-01-16T00:00:00Z"),
      },
      {
        fanLabel: "Uncle Ray",
        fanUserId: null,
        tierName: "Gold",
        status: "active",
        priceCents: 0,
        hasPaidCheckout: false,
        joinedAt: T("2026-01-17T00:00:00Z"),
        updatedAt: T("2026-01-17T00:00:00Z"),
      },
    ],
  });
}

const byId = (fans: ReturnType<typeof buildFanGraph>["fans"], id: string) =>
  fans.find((f) => f.id === id);

describe("buildFanGraph — identity merge", () => {
  it("merges one account fan across follow + store + tips", () => {
    const { fans } = buildFanGraph(universe());
    const ada = byId(fans, "u:u-ada")!;
    expect(ada).toBeTruthy();
    expect(ada.displayName).toBe("Ada Lovelace");
    expect(ada.profileSlug).toBe("ada");
    expect(ada.follows).toBe(true);
    expect(ada.spentUsdCents).toBe(2500);
    expect(ada.spentVb).toBe(500);
    expect(ada.purchaseCount).toBe(2);
    expect(ada.sources.sort()).toEqual(["follow", "store", "tips"]);
    expect(ada.lastActivityAt).toBe("2026-03-06T00:00:00.000Z");
  });

  it("merges a subscriber + shop buyer + member on the normalized email", () => {
    const { fans } = buildFanGraph(universe());
    const bea = byId(fans, "e:bea@example.com")!;
    expect(bea).toBeTruthy();
    expect(bea.subscribed).toBe(true);
    expect(bea.member).toMatchObject({ tierName: "Gold", status: "active" });
    expect(bea.spentUsdCents).toBe(4000 + 1200); // shop sale + paid membership
    expect(bea.purchaseCount).toBe(2);
    expect(bea.displayName).toBe("Bea");
  });

  it("bridges account and email ONLY through a fan_members row carrying both", () => {
    const { fans } = buildFanGraph(universe());
    const dee = byId(fans, "u:u-dee")!;
    expect(dee).toBeTruthy();
    expect(dee.email).toBe("dee@mail.com");
    expect(dee.subscribed).toBe(true); // via the bridged subscriber row
    expect(dee.member).toMatchObject({ tierName: "Silver" });
    expect(dee.spentUsdCents).toBe(1500); // live sale only — the tracking membership adds nothing
    expect(dee.purchaseCount).toBe(1);
    // No second, email-only Dee record exists.
    expect(byId(fans, "e:dee@mail.com")).toBeUndefined();
  });

  it("keeps an unbridged email fan and account fan as TWO people", () => {
    const { fans } = buildFanGraph(universe());
    const cyMail = byId(fans, "e:cy@x.io")!;
    const cyAcct = byId(fans, "u:u-cy")!;
    expect(cyMail).toBeTruthy();
    expect(cyAcct).toBeTruthy();
    expect(cyMail.subscribed).toBe(false);
    expect(cyMail.unsubscribed).toBe(true);
    expect(cyMail.spentUsdCents).toBe(0);
    expect(cyAcct.spentUsdCents).toBe(900);
    expect(cyAcct.subscribed).toBe(false);
  });

  it("keeps a manual label-only member as its own record", () => {
    const { fans } = buildFanGraph(universe());
    const ray = fans.find((f) => f.displayName === "Uncle Ray")!;
    expect(ray).toBeTruthy();
    expect(ray.id.startsWith("l:")).toBe(true);
    expect(ray.userId).toBeNull();
    expect(ray.member).toMatchObject({ tierName: "Gold", status: "active" });
    expect(ray.spentUsdCents).toBe(0);
  });

  it("skips identity-less sales instead of inventing a fan", () => {
    const { fans, summary } = buildFanGraph(universe());
    // 7 fans: Ada, Bea, Cy-email, Cy-account, Dee, Uncle Ray, Fay
    expect(summary.totalFans).toBe(7);
    expect(fans.some((f) => f.spentUsdCents === 9999 || f.spentUsdCents === 777)).toBe(false);
  });

  it("summary counts followers, subscribers, members, buyers and totals", () => {
    const { summary } = buildFanGraph(universe());
    expect(summary.followers).toBe(2); // Ada + Fay
    expect(summary.subscribers).toBe(2); // Bea + Dee (Cy unsubscribed)
    expect(summary.members).toBe(3); // Bea, Dee, Uncle Ray
    expect(summary.buyers).toBe(4); // Ada, Bea, Cy-account, Dee
    expect(summary.totalSpentUsdCents).toBe(2500 + 5200 + 900 + 1500);
    expect(summary.totalSpentVb).toBe(500);
  });

  it("a refunded paid membership contributes no spend but keeps its history", () => {
    const { fans } = buildFanGraph(
      sources({
        members: [
          {
            fanLabel: "gone@x.io",
            fanUserId: null,
            tierName: "Gold",
            status: "refunded",
            priceCents: 3000,
            hasPaidCheckout: true,
            joinedAt: T("2026-01-01T00:00:00Z"),
            updatedAt: T("2026-02-01T00:00:00Z"),
          },
        ],
      }),
    );
    expect(fans).toHaveLength(1);
    expect(fans[0]!.spentUsdCents).toBe(0);
    expect(fans[0]!.purchaseCount).toBe(0);
    expect(fans[0]!.member).toMatchObject({ status: "refunded" });
  });

  it("a live membership row wins over a dead one for the same fan", () => {
    const { fans } = buildFanGraph(
      sources({
        members: [
          {
            fanLabel: "multi@x.io",
            fanUserId: null,
            tierName: "Old",
            status: "canceled",
            priceCents: 0,
            hasPaidCheckout: false,
            joinedAt: T("2026-03-01T00:00:00Z"),
            updatedAt: T("2026-03-01T00:00:00Z"),
          },
          {
            fanLabel: "multi@x.io",
            fanUserId: null,
            tierName: "New",
            status: "active",
            priceCents: 0,
            hasPaidCheckout: false,
            joinedAt: T("2026-01-01T00:00:00Z"),
            updatedAt: T("2026-01-01T00:00:00Z"),
          },
        ],
      }),
    );
    expect(fans).toHaveLength(1);
    expect(fans[0]!.member).toMatchObject({ tierName: "New", status: "active" });
  });
});

describe("queryFanGraph — search, sort, paginate", () => {
  const { fans } = buildFanGraph(universe());

  it("search matches name, email and slug, case-insensitively", () => {
    expect(queryFanGraph(fans, { search: "ADA" }).total).toBe(1);
    expect(queryFanGraph(fans, { search: "bea@exam" }).total).toBe(1);
    expect(queryFanGraph(fans, { search: "uncle" }).total).toBe(1);
    expect(queryFanGraph(fans, { search: "nobody" }).total).toBe(0);
  });

  it("sorts by spend (USD first, then VB), by recency, and by name", () => {
    const bySpent = queryFanGraph(fans, { sort: "spent", pageSize: 100 }).fans;
    expect(bySpent[0]!.id).toBe("e:bea@example.com"); // 5200
    expect(bySpent[1]!.id).toBe("u:u-ada"); // 2500 + 500 VB
    const byRecent = queryFanGraph(fans, { sort: "recent", pageSize: 100 }).fans;
    expect(byRecent[0]!.id).toBe("u:u-ada"); // tip on 2026-03-06 is newest
    const byName = queryFanGraph(fans, { sort: "name", pageSize: 100 }).fans;
    expect(byName[0]!.displayName).toBe("Ada Lovelace");
  });

  it("paginates and clamps an out-of-range page", () => {
    const p1 = queryFanGraph(fans, { sort: "name", page: 1, pageSize: 3 });
    const p2 = queryFanGraph(fans, { sort: "name", page: 2, pageSize: 3 });
    const p3 = queryFanGraph(fans, { sort: "name", page: 3, pageSize: 3 });
    expect(p1.total).toBe(7);
    expect(p1.fans).toHaveLength(3);
    expect(p2.fans).toHaveLength(3);
    expect(p3.fans).toHaveLength(1);
    const ids = new Set([...p1.fans, ...p2.fans, ...p3.fans].map((f) => f.id));
    expect(ids.size).toBe(7);
    const clamped = queryFanGraph(fans, { page: 99, pageSize: 3 });
    expect(clamped.page).toBe(3);
  });
});
