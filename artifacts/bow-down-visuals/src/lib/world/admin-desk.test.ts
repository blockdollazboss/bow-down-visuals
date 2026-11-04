import { describe, expect, it } from "vitest";
import {
  ADMIN_NOT_AUTHORIZED_MESSAGE,
  ADMIN_STATUS_PATH,
  DMCA_STATUSES,
  PLAN_TIERS,
  REPORT_STATUSES,
  bowConfigReady,
  buildContentRemovalPatch,
  buildGrantBody,
  buildJudgeByPicks,
  buildJudgeByVotes,
  buildLifecycleBody,
  buildPitchFixDuplicate,
  buildPitchFixModeration,
  buildPlanBody,
  buildReadPatch,
  buildReversalResolve,
  buildSplitsBody,
  buildStatusPatch,
  emailReady,
  grantAmountReady,
  grantOpenReady,
  isNotAuthorized,
  isoToLocalInput,
  localInputToIso,
  openReports,
  parseAdminStatus,
  parseBowChallenge,
  parseContactMessages,
  parseContentAnswer,
  parseContentReports,
  parseDmcaReports,
  parseJewelryOrders,
  parseNfcOrders,
  parsePitchFixQueue,
  parseRemovedContent,
  parseSpotlightInquiries,
  parseUserLookup,
  pitchFixPending,
  pitchFixStatusesFor,
  remixPayReady,
  reversalResolveReady,
  unreadMessages,
} from "./admin-desk";

/* ─── Admin desk seam (stack1500 world parity wave #5, census
   item 46) ────────────────────────────────────────────────────────
   The in-World admin benches ride the website /admin rails. These
   tests pin the seam: the gate is the server's own /admin/status
   answer parsed strictly (a broken answer is a failed read, never
   a guessed yes), the 403 is the gate's refusal, every list parser
   fails closed on a broken row instead of painting over it, and
   the body builders carry the rails' exact wire shapes — the
   lifecycle's null-clears / absent-leaves-alone split, the remix
   splits' camelCase rows, the grant body's user-wins precedence. */

describe("the gate", () => {
  it("the status path and the refusal sentence are the rail's own", () => {
    expect(ADMIN_STATUS_PATH).toBe("/api/admin/status");
    expect(ADMIN_NOT_AUTHORIZED_MESSAGE).toBe("Not authorized.");
  });

  it("parseAdminStatus reads only a boolean isAdmin", () => {
    expect(parseAdminStatus({ isAdmin: true })).toBe(true);
    expect(parseAdminStatus({ isAdmin: false })).toBe(false);
    expect(parseAdminStatus({})).toBeNull();
    expect(parseAdminStatus({ isAdmin: 1 })).toBeNull();
    expect(parseAdminStatus({ isAdmin: "true" })).toBeNull();
    expect(parseAdminStatus(null)).toBeNull();
    expect(parseAdminStatus([])).toBeNull();
    expect(parseAdminStatus("yes")).toBeNull();
  });

  it("only a 403 is the gate's refusal", () => {
    expect(isNotAuthorized(403)).toBe(true);
    expect(isNotAuthorized(401)).toBe(false);
    expect(isNotAuthorized(200)).toBe(false);
    expect(isNotAuthorized(500)).toBe(false);
  });
});

describe("content reports + dmca", () => {
  const report = {
    id: "r1",
    reporterUserId: "u1",
    targetType: "post",
    targetId: "p1",
    targetOwnerUserId: null,
    targetSummary: "a post",
    reason: "spam",
    note: null,
    status: "new",
    createdAt: "2026-11-01T00:00:00.000Z",
  };

  it("parses the queue and counts the open end", () => {
    const rows = parseContentReports({
      reports: [report, { ...report, id: "r2", status: "reviewing" }, { ...report, id: "r3", status: "actioned" }],
    });
    expect(rows).toHaveLength(3);
    expect(openReports(rows!)).toBe(2);
    expect(REPORT_STATUSES).toEqual(["new", "reviewing", "actioned", "dismissed"]);
    expect(buildStatusPatch("reviewing")).toEqual({ status: "reviewing" });
  });

  it("a broken row fails the whole read, never a painted-over list", () => {
    expect(parseContentReports({ reports: [{ status: "new" }] })).toBeNull();
    expect(parseContentReports({})).toBeNull();
    expect(parseContentReports(null)).toBeNull();
  });

  it("dmca rows need string URL lists", () => {
    const good = {
      id: "d1",
      reporterName: "A",
      reporterEmail: "a@example.com",
      reporterOrg: null,
      infringingUrls: ["https://example.com/x"],
      originalUrls: [],
      description: "mine",
      status: "new",
      createdAt: null,
    };
    expect(parseDmcaReports({ reports: [good] })?.[0]?.infringingUrls).toEqual(["https://example.com/x"]);
    expect(parseDmcaReports({ reports: [{ ...good, infringingUrls: [42] }] })).toBeNull();
    expect(DMCA_STATUSES).toEqual(["new", "reviewing", "actioned", "dismissed"]);
  });
});

describe("content removal", () => {
  it("a restore is exactly { removed: false } — no reason rides along", () => {
    expect(buildContentRemovalPatch({ removed: false, reason: "spam", note: "x" })).toEqual({ removed: false });
  });

  it("a removal carries the reason and a trimmed note only when present", () => {
    expect(buildContentRemovalPatch({ removed: true, reason: "spam", note: "  bad  " })).toEqual({
      removed: true,
      reason: "spam",
      note: "bad",
    });
    expect(buildContentRemovalPatch({ removed: true, reason: "spam", note: "   " })).toEqual({
      removed: true,
      reason: "spam",
    });
  });

  it("content answers parse strictly by kind", () => {
    const content = {
      id: "c1",
      kind: "post",
      postKind: "video",
      body: "hello",
      author: null,
      createdAt: null,
      removed: false,
      removedAt: null,
      removedByEmail: null,
      removalReason: null,
      removalNote: null,
    };
    expect(parseContentAnswer({ content })?.id).toBe("c1");
    expect(parseContentAnswer({ content: { ...content, kind: "page" } })).toBeNull();
    expect(parseRemovedContent({ content: [content] })).toHaveLength(1);
    expect(parseRemovedContent({ content: [{ id: "x" }] })).toBeNull();
  });
});

describe("pitch & fix", () => {
  const row = {
    id: "s1",
    kind: "pitch",
    source: "site",
    submitterName: "Sam",
    title: "T",
    body: "B",
    why: null,
    category: null,
    page: null,
    severity: null,
    rating: null,
    status: "reviewing",
    moderationStatus: "pending",
    upvoteCount: 3,
    rewardStatus: "none",
    rewardAmount: null,
    rewardQueuedAt: null,
    rewardPaidAt: null,
    duplicateOfId: null,
    createdAt: "2026-11-01T00:00:00.000Z",
  };
  const pool = { weekStart: "2026-11-02", capVb: 1000, spentVb: 100, remainingVb: 900, queuedIds: [] };

  it("parses queue + pool together, and fails without either", () => {
    const queue = parsePitchFixQueue({ submissions: [row], rewardPool: pool });
    expect(queue?.submissions).toHaveLength(1);
    expect(queue?.rewardPool.remainingVb).toBe(900);
    expect(parsePitchFixQueue({ submissions: [row] })).toBeNull();
    expect(parsePitchFixQueue({ submissions: [{ ...row, moderationStatus: "maybe" }], rewardPool: pool })).toBeNull();
  });

  it("the ladders are per-kind and feedback has none", () => {
    expect(pitchFixStatusesFor("pitch")).toContain("shipped");
    expect(pitchFixStatusesFor("fix")).toContain("fixed");
    expect(pitchFixStatusesFor("feedback")).toEqual([]);
    expect(pitchFixPending([row as never])).toBe(1);
  });

  it("each PATCH body carries exactly one verb", () => {
    expect(buildPitchFixModeration("approved")).toEqual({ moderation: "approved" });
    expect(buildPitchFixDuplicate("s0")).toEqual({ duplicate_of: "s0" });
  });
});

describe("payment reversals", () => {
  it("a dismissal needs its note; a completion may ride blank", () => {
    expect(reversalResolveReady("dismiss", "")).toBe(false);
    expect(reversalResolveReady("dismiss", "  ")).toBe(false);
    expect(reversalResolveReady("dismiss", "no money moved")).toBe(true);
    expect(reversalResolveReady("complete", "")).toBe(true);
    expect(reversalResolveReady("refund", "x")).toBe(false);
  });

  it("the resolve body trims the note", () => {
    expect(buildReversalResolve("dismiss", "  settled by hand  ")).toEqual({
      decision: "dismiss",
      note: "settled by hand",
    });
  });
});

describe("challenges — lifecycle + judging bodies", () => {
  it("a null date CLEARS it; an absent date leaves it alone", () => {
    const body = buildLifecycleBody({ status: "live", startsAtIso: null, endsAtIso: "2026-12-01T00:00:00.000Z" });
    expect(body.status).toBe("live");
    expect(body.starts_at).toBeNull();
    expect(body.ends_at).toBe("2026-12-01T00:00:00.000Z");
    expect(body.judging_ends_at).toBeUndefined();
    expect(buildLifecycleBody({}).status).toBeUndefined();
  });

  it("judge-by-votes clamps a wild places count back to 3", () => {
    expect(buildJudgeByVotes(5)).toEqual({ places: 5 });
    expect(buildJudgeByVotes(99)).toEqual({ places: 3 });
    expect(buildJudgeByVotes(0)).toEqual({ places: 3 });
  });

  it("judge-by-picks sends places ascending, skipping blanks", () => {
    expect(buildJudgeByPicks({ 2: "v2", 1: "v1", 3: "" })).toEqual({
      winners: [
        { place: 1, video_id: "v1" },
        { place: 2, video_id: "v2" },
      ],
    });
  });

  it("datetime-local values round-trip", () => {
    expect(localInputToIso("")).toBeNull();
    expect(localInputToIso("not-a-date")).toBeNull();
    const iso = localInputToIso("2026-11-03T10:30");
    expect(iso).toMatch(/Z$/);
    expect(isoToLocalInput(iso)).toBe("2026-11-03T10:30");
    expect(isoToLocalInput(null)).toBe("");
  });
});

describe("grants + remix money rules", () => {
  it("a round opens only on a YYYY-MM key and a whole positive pool", () => {
    expect(grantOpenReady("2026-11", "500")).toBe(true);
    expect(grantOpenReady("2026-13", "500")).toBe(false);
    expect(grantOpenReady("Nov 2026", "500")).toBe(false);
    expect(grantOpenReady("2026-11", "0")).toBe(false);
    expect(grantOpenReady("2026-11", "1.5")).toBe(false);
  });

  it("remix split payments need a YYYY-MM period and a whole non-negative total", () => {
    expect(remixPayReady("2026-11", "0")).toBe(true);
    expect(remixPayReady("2026-11", "-5")).toBe(false);
    expect(remixPayReady("11-2026", "10")).toBe(false);
  });

  it("the splits wire shape is camelCase rows with a blank payee id as null", () => {
    expect(buildSplitsBody([{ role: "winner", payeeName: "  A  ", payeeUserId: " ", sharePct: "60" }])).toEqual([
      { role: "winner", payeeName: "A", payeeUserId: null, sharePct: 60 },
    ]);
  });
});

describe("users, grants of Bucs, plans", () => {
  it("a lookup miss is an honest null user, not a failed read", () => {
    expect(parseUserLookup({ user: null })).toEqual({ user: null });
    expect(parseUserLookup({})).toBeNull();
    expect(parseUserLookup({ user: { email: "e@example.com" } })).toBeNull();
    const found = parseUserLookup({
      user: { id: "u1", email: "e@example.com", displayName: null, credits: 25, plan: "pro", banned: false, createdAt: null },
    });
    expect(found?.user?.credits).toBe(25);
  });

  it("the grant amount rides the rail's own bounds", () => {
    expect(grantAmountReady("0")).toBe(false);
    expect(grantAmountReady("1")).toBe(true);
    expect(grantAmountReady("100000")).toBe(true);
    expect(grantAmountReady("100001")).toBe(false);
    expect(grantAmountReady("2.5")).toBe(false);
  });

  it("a looked-up user wins over an email; the email trims", () => {
    expect(buildGrantBody({ amount: 500, userId: "u1", email: "e@example.com" })).toEqual({ amount: 500, userId: "u1" });
    expect(buildGrantBody({ amount: 500, email: "  e@example.com " })).toEqual({ amount: 500, email: "e@example.com" });
    expect(buildGrantBody({ amount: 500 })).toEqual({ amount: 500 });
    expect(buildPlanBody({ tier: 6, userId: "u1", email: "e@example.com" })).toEqual({ tier: 6, userId: "u1" });
    expect(PLAN_TIERS).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("emailReady is a plain shape check", () => {
    expect(emailReady("e@example.com")).toBe(true);
    expect(emailReady("nope")).toBe(false);
    expect(emailReady("a@b")).toBe(false);
  });
});

describe("bow challenge", () => {
  it("parses the state and refuses a broken one", () => {
    const state = parseBowChallenge({
      rewardCredits: 500,
      enabled: true,
      targetOverride: null,
      updatedAt: null,
      race: null,
      history: [],
    });
    expect(state?.rewardCredits).toBe(500);
    expect(state?.race).toBeNull();
    expect(parseBowChallenge({ rewardCredits: 500, history: [] })).toBeNull();
  });

  it("the config gate rides the rail's bounds", () => {
    expect(bowConfigReady("500", "")).toBe(true);
    expect(bowConfigReady("0", "")).toBe(false);
    expect(bowConfigReady("10001", "")).toBe(false);
    expect(bowConfigReady("500", "999")).toBe(false);
    expect(bowConfigReady("500", "1000")).toBe(true);
    expect(bowConfigReady("500", "5000")).toBe(true);
    expect(bowConfigReady("500", "5001")).toBe(false);
  });
});

describe("spotlight + contact inboxes", () => {
  it("parses both queues and counts unread mail", () => {
    expect(
      parseSpotlightInquiries({
        inquiries: [{ id: "i1", name: "N", email: "e@example.com", videoUrl: null, targetUrl: null, status: "new", createdAt: null }],
      }),
    ).toHaveLength(1);
    const messages = parseContactMessages({
      messages: [
        { id: "m1", name: "N", email: "e@example.com", message: "hi", read: false, createdAt: null },
        { id: "m2", name: "N", email: "e@example.com", message: "yo", read: true, createdAt: null },
      ],
    });
    expect(unreadMessages(messages!)).toBe(1);
    expect(buildReadPatch(true)).toEqual({ read: true });
    expect(parseContactMessages({ messages: [{ name: "x" }] })).toBeNull();
  });
});

describe("store orders (NFC + jewelry)", () => {
  const shipping = { street: "1 Main", city: "C", state: "S", zip: "12345", country: "US" };

  it("NFC rows map snake_case into the shared row shape", () => {
    const rows = parseNfcOrders({
      ok: true,
      orders: [
        {
          id: "o1",
          card_style: "gold",
          quantity: 2,
          full_name: "Pat",
          email: "p@example.com",
          phone: "",
          shipping_address: shipping,
          status: "paid",
          unit_price_cents: 500,
          total_cents: 1000,
          created_at: "2026-11-01T00:00:00.000Z",
          nfc_profiles: { slug: "pat" },
        },
      ],
    });
    expect(rows?.[0]).toMatchObject({ itemLabel: "gold", detail: "/pat", totalCents: 1000, quantity: 2 });
  });

  it("a broken shipping address fails the read", () => {
    expect(
      parseNfcOrders({
        ok: true,
        orders: [{ id: "o1", created_at: "2026-11-01T00:00:00.000Z", shipping_address: { street: "1 Main" } }],
      }),
    ).toBeNull();
  });

  it("jewelry rows carry product · finish and the engraving", () => {
    const rows = parseJewelryOrders({
      ok: true,
      orders: [
        {
          id: "j1",
          product_key: "chain",
          finish: "gold",
          size_option: "18in",
          engraving: "KING",
          design_notes: "",
          quantity: 1,
          full_name: "Pat",
          email: "p@example.com",
          phone: "",
          shipping_address: shipping,
          status: "new",
          unit_price_cents: 100,
          total_cents: 100,
          created_at: "2026-11-01T00:00:00.000Z",
        },
      ],
    });
    expect(rows?.[0]).toMatchObject({ itemLabel: "chain · gold", detail: "Engraving: KING" });
  });
});
