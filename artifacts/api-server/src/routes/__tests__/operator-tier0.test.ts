/**
 * Cloud Operator Phase 2, Lane B — the Tier 0 read tools against the
 * REAL registry, REAL executor and REAL chat glue; only the model
 * client, the session resolver, the db and the four RAILS are faked
 * (the rails' own behavior is pinned by their own suites — here the
 * pins are about what the operator does with them):
 *
 *  - every number in a reply comes from the rail's return — the
 *    fixtures use figures the knowledge base does NOT vouch for, so
 *    a model-shaped answer could never produce them
 *  - each rail is called with the CALLER's id only (member-scoped)
 *  - a failed rail surfaces as the executor's honest failure
 *    (audited `failed`) — never a zero, never an invented figure
 *  - a partially failed earnings picture says so and reports only
 *    the sources that loaded (the earnings route's own discipline)
 *  - empty-but-real states say so plainly (no earnings yet, quests
 *    off, a quiet palace, an unmarched season)
 *  - the audit row lands for every run, and the kill switch refuses
 *    the new tools like Lane A's
 *  - over HTTP, the plain questions route: the model's marker for
 *    each tool makes the reply the executor's rail answer
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

const MEMBER = "00000000-0000-4000-8000-0000000000a2";
const OTHER = "00000000-0000-4000-8000-0000000000a9";

type Src<T> = { fail?: boolean; value: T };

const state = vi.hoisted(() => {
  process.env.CHAT_CREDIT_COST = "0";
  return {
    reply: "All good, fin-friend. 🦈",
    balance: 1234,
    railCalls: [] as Array<{ rail: string; userId: string }>,
    earnings: {
      store: { value: { status: "ok", totalCents: 4550, count: 2, breakdown: { profileStoreCents: 4550, profileStoreOrders: 2, shopSalesCents: 0, shopSales: 0 } } } as Src<any>,
      memb: { value: { status: "ok", totalCents: 2000, count: 1 } } as Src<any>,
      deals: { value: { status: "ok", totalCents: 0, count: 0 } } as Src<any>,
      tip: { value: { status: "ok", streamTipsVb: 300, streamTipCount: 2, tipJarPendingCents: 500, tipJarPendingCount: 1, tipJarStatus: "pending_payment" } } as Src<any>,
    },
    questsEnabled: true,
    questsFail: false,
    questsStatus: {
      date: "2026-10-20",
      quests: [
        { key: "daily-ship-it", name: "Ship It", baseKey: "export-video", target: 2, rewardVb: 10, marks: 5, progress: 1, completed: false, claimed: false },
        { key: "daily-marathon-cut", name: "Marathon Cut", baseKey: "export-video", target: 2, rewardVb: 10, marks: 5, progress: 2, completed: true, claimed: false },
        { key: "daily-third", name: "Third Verse", baseKey: "create-song", target: 1, rewardVb: 10, marks: 5, progress: 1, completed: true, claimed: true },
      ],
      marksTotal: 15,
      pool: { capVb: 300, spentVb: 60, remainingVb: 240 },
    } as any,
    palace: null as null | { presenceSnapshot: () => any },
    presence: {
      total: 3,
      rooms: [
        { id: "world:kings-hall", name: "The King's Hall", count: 2, members: ["Ana", "Bo"] },
        { id: "world:music-hall", name: "Music Hall", count: 1, members: ["Cy"] },
      ],
    } as any,
    standingsFail: false,
    standings: [
      { place: 1, userId: "u-ana", displayName: "Ana", slug: "ana", points: 120, stars: 4, title: "Shot Caller" },
      { place: 2, userId: "u-bo", displayName: "Bo", slug: "bo", points: 95, stars: 3, title: "Gangster" },
      { place: 3, userId: "u-cy", displayName: "Cy", slug: "cy", points: 60, stars: 3, title: "Gangster" },
      { place: 4, userId: "u-di", displayName: "Di", slug: "di", points: 55, stars: 2, title: "Hustler" },
      { place: 5, userId: "u-ed", displayName: "Ed", slug: "ed", points: 50, stars: 2, title: "Hustler" },
      { place: 6, userId: "u-fi", displayName: "Fi", slug: "fi", points: 44, stars: 2, title: "Hustler" },
      // the OTHER id, inlined: vi.hoisted runs before module consts initialize
      { place: 7, userId: "00000000-0000-4000-8000-0000000000a9", displayName: "You F.", slug: "youf", points: 41, stars: 2, title: "Hustler" },
    ] as any[],
  };
});

const h = vi.hoisted(() => ({ fake: null as any }));

vi.mock("../../lib/ai-clients", () => ({
  getOpenAI: () => ({
    chat: {
      completions: {
        create: async () => ({ choices: [{ message: { content: state.reply } }] }),
      },
    },
  }),
  getTextModel: () => "test-model",
}));

vi.mock("../../lib/optional-auth", () => ({
  resolveOptionalSession: async (req: any) => {
    const user = req.headers["x-test-user"];
    if (user) {
      req.userId = String(user);
      req.userEmail = req.headers["x-test-email"] ? String(req.headers["x-test-email"]) : undefined;
    }
  },
}));

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    const user = req.headers["x-test-user"];
    if (!user) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    req.userId = String(user);
    req.userEmail = req.headers["x-test-email"] ? String(req.headers["x-test-email"]) : undefined;
    next();
  },
}));

vi.mock("../../lib/credits", () => {
  class OutOfCreditsError extends Error { readonly code = "OUT_OF_CREDITS"; }
  class LedgerWriteError extends Error { readonly code = "LEDGER_WRITE"; }
  return {
    OutOfCreditsError,
    LedgerWriteError,
    getCreditBalance: async (_userId: string) => state.balance,
    chargeCredits: async () => state.balance,
    refundCredits: async () => state.balance,
    buildChargeIdempotencyKey: () => "test-key",
    voidChargeIdempotencyKey: async () => true,
  };
});

/* The earnings rail: the four per-source readers, state-driven. */
vi.mock("../earnings", () => {
  const reader = (name: string, pick: () => Src<any>) => async (userId: string) => {
    state.railCalls.push({ rail: name, userId });
    const src = pick();
    if (src.fail) throw new Error(`${name} rail exploded`);
    return src.value;
  };
  return {
    storeSales: reader("storeSales", () => state.earnings.store),
    memberships: reader("memberships", () => state.earnings.memb),
    brandDeals: reader("brandDeals", () => state.earnings.deals),
    tips: reader("tips", () => state.earnings.tip),
    default: {},
  };
});

/* The palace mount: a stub palace whose snapshot is state-driven. */
vi.mock("../world", () => ({
  getActiveWorldPalace: () => state.palace,
}));

/* The quest rail: status read + the on/off switch. */
vi.mock("../../lib/daily-quests", () => ({
  dbDailyQuestStore: { __fake: true },
  getDailyQuestsStatus: async (_store: any, _pool: any, userId: string) => {
    state.railCalls.push({ rail: "questsStatus", userId });
    if (state.questsFail) throw new Error("quest rail exploded");
    return state.questsStatus;
  },
}));
vi.mock("../../lib/quest-pool", () => ({ dbQuestPoolStore: { __fake: true } }));
vi.mock("../../lib/retention", () => ({
  getQuestsEnabled: async (userId: string) => {
    state.railCalls.push({ rail: "questsEnabled", userId });
    return state.questsEnabled;
  },
}));

/* The court rail: season identity + the live standings read. */
vi.mock("../../lib/world-court-season", () => ({
  dbCourtSeasonStore: { __fake: true },
  seasonForDate: (_now: Date) => ({
    seasonKey: "2026-10",
    ordinal: 1,
    name: "Season I",
    subtitle: "of the First Bells",
    startsAt: new Date("2026-10-01T00:00:00Z"),
    endsAt: new Date("2026-11-01T00:00:00Z"),
  }),
  currentSeasonStandings: async () => {
    if (state.standingsFail) throw new Error("court rail exploded");
    return state.standings;
  },
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const { createFakeDb } = await import("./_reach-fake-db");
  const fake = createFakeDb({
    operatorActions: actual.operatorActionsTable,
    operatorPendingActions: actual.operatorPendingActionsTable,
  });
  h.fake = fake;
  return { ...actual, db: fake.db };
});

import chatRouter from "../chat";
import { executeAction } from "../../lib/operator-executor";

let server: any;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api", chatRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function resetEarnings() {
  state.earnings.store = { value: { status: "ok", totalCents: 4550, count: 2, breakdown: { profileStoreCents: 4550, profileStoreOrders: 2, shopSalesCents: 0, shopSales: 0 } } };
  state.earnings.memb = { value: { status: "ok", totalCents: 2000, count: 1 } };
  state.earnings.deals = { value: { status: "ok", totalCents: 0, count: 0 } };
  state.earnings.tip = { value: { status: "ok", streamTipsVb: 300, streamTipCount: 2, tipJarPendingCents: 500, tipJarPendingCount: 1, tipJarStatus: "pending_payment" } };
}

beforeEach(() => {
  h.fake.clear();
  state.reply = "All good, fin-friend. 🦈";
  state.railCalls = [];
  resetEarnings();
  state.questsEnabled = true;
  state.questsFail = false;
  state.palace = { presenceSnapshot: () => state.presence };
  state.standingsFail = false;
  state.standings = [
    { place: 1, userId: "u-ana", displayName: "Ana", slug: "ana", points: 120, stars: 4, title: "Shot Caller" },
    { place: 2, userId: "u-bo", displayName: "Bo", slug: "bo", points: 95, stars: 3, title: "Gangster" },
    { place: 3, userId: "u-cy", displayName: "Cy", slug: "cy", points: 60, stars: 3, title: "Gangster" },
    { place: 4, userId: "u-di", displayName: "Di", slug: "di", points: 55, stars: 2, title: "Hustler" },
    { place: 5, userId: "u-ed", displayName: "Ed", slug: "ed", points: 50, stars: 2, title: "Hustler" },
    { place: 6, userId: "u-fi", displayName: "Fi", slug: "fi", points: 44, stars: 2, title: "Hustler" },
    { place: 7, userId: OTHER, displayName: "You F.", slug: "youf", points: 41, stars: 2, title: "Hustler" },
  ];
  delete process.env["OPERATOR_HANDS_ENABLED"];
});

function auditRows(): any[] {
  return h.fake.store("operatorActions").rows;
}
function lastAudit(): any {
  return auditRows()[auditRows().length - 1];
}

describe("earnings.summary — the member's own picture, from the rail", () => {
  it("composes the reply from the four readers' numbers, dollars and VB in their own units", async () => {
    const out = await executeAction({ userId: MEMBER, toolId: "earnings.summary", channel: "chat_text" });
    expect(out.status).toBe("done");
    expect(out.replyText).toContain("You've earned $65.50 so far");
    expect(out.replyText).toContain("$45.50 from store sales");
    expect(out.replyText).toContain("$20 from memberships");
    expect(out.replyText).not.toContain("from brand deals"); // zero sources are not padded in
    expect(out.replyText).toContain("300 Visual Bucs in credited stream tips");
    expect(out.replyText).toContain("$5 in tip-jar pledges is still pending payment — not counted above");
    expect(lastAudit()).toMatchObject({ userId: MEMBER, toolId: "earnings.summary", tier: 0, result: "done", priceCharged: null });
  });

  it("reads ONLY the caller's own earnings — every rail call carries the caller's id", async () => {
    await executeAction({ userId: MEMBER, toolId: "earnings.summary", channel: "chat_text" });
    await executeAction({ userId: OTHER, toolId: "earnings.summary", channel: "chat_text" });
    const earningsCalls = state.railCalls.filter((c) => ["storeSales", "memberships", "brandDeals", "tips"].includes(c.rail));
    expect(earningsCalls).toHaveLength(8);
    expect(earningsCalls.slice(0, 4).every((c) => c.userId === MEMBER)).toBe(true);
    expect(earningsCalls.slice(4).every((c) => c.userId === OTHER)).toBe(true);
  });

  it("an all-zero picture is an honest empty state, never a dressed-up zero claim", async () => {
    state.earnings.store = { value: { status: "ok", totalCents: 0, count: 0 } };
    state.earnings.memb = { value: { status: "ok", totalCents: 0, count: 0 } };
    state.earnings.tip = { value: { status: "ok", streamTipsVb: 0, streamTipCount: 0, tipJarPendingCents: 0, tipJarPendingCount: 0, tipJarStatus: "pending_payment" } };
    const out = await executeAction({ userId: MEMBER, toolId: "earnings.summary", channel: "chat_text" });
    expect(out.status).toBe("done");
    expect(out.replyText).toContain("Nothing on the books yet");
  });

  it("a failed source is a stated partial picture — its money is never folded in as zero", async () => {
    state.earnings.memb = { fail: true, value: undefined as any };
    const out = await executeAction({ userId: MEMBER, toolId: "earnings.summary", channel: "chat_text" });
    expect(out.status).toBe("done");
    expect(out.replyText).toContain("$45.50 so far");
    expect(out.replyText).toContain("wouldn't load just now");
    expect(out.replyText).toContain("treat that as a floor");
  });

  it("when EVERY source fails, the run fails honestly — audited failed, no figure spoken", async () => {
    state.earnings.store = { fail: true, value: undefined as any };
    state.earnings.memb = { fail: true, value: undefined as any };
    state.earnings.deals = { fail: true, value: undefined as any };
    state.earnings.tip = { fail: true, value: undefined as any };
    const out = await executeAction({ userId: MEMBER, toolId: "earnings.summary", channel: "chat_text" });
    expect(out.status).toBe("failed");
    expect(out.replyText).not.toContain("$");
    expect(lastAudit().result).toBe("failed");
    expect(lastAudit().resultReason).toContain("every source failed");
  });
});

describe("quests.status — today's trio through the quest rail", () => {
  it("speaks the trio's real progress, marks and the pool's remainder", async () => {
    const out = await executeAction({ userId: MEMBER, toolId: "quests.status", channel: "chat_text" });
    expect(out.status).toBe("done");
    expect(out.replyText).toContain("Ship It: 1 of 2 done");
    expect(out.replyText).toContain("Marathon Cut: finished — ready to claim (10 Visual Bucs)");
    expect(out.replyText).toContain("Third Verse: claimed");
    expect(out.replyText).toContain("banked 15 marks");
    expect(out.replyText).toContain("240 of 300 Visual Bucs left");
    expect(lastAudit()).toMatchObject({ toolId: "quests.status", result: "done" });
    expect(state.railCalls.filter((c) => c.rail === "questsStatus").every((c) => c.userId === MEMBER)).toBe(true);
  });

  it("quests switched off in the member's settings says exactly that", async () => {
    state.questsEnabled = false;
    const out = await executeAction({ userId: MEMBER, toolId: "quests.status", channel: "chat_text" });
    expect(out.status).toBe("done");
    expect(out.replyText).toContain("switched off in your settings");
  });

  it("a quest rail failure is an honest failed run, never a zero-progress claim", async () => {
    state.questsFail = true;
    const out = await executeAction({ userId: MEMBER, toolId: "quests.status", channel: "chat_text" });
    expect(out.status).toBe("failed");
    expect(out.replyText).not.toContain("of 2 done");
    expect(lastAudit().result).toBe("failed");
  });
});

describe("world.presence — the palace snapshot, spoken plainly", () => {
  it("names who's around, per room, from the snapshot", async () => {
    const out = await executeAction({ userId: MEMBER, toolId: "world.presence", channel: "chat_text" });
    expect(out.status).toBe("done");
    expect(out.replyText).toContain("3 people are in the palace right now");
    expect(out.replyText).toContain("The King's Hall has 2 (Ana, Bo)");
    expect(out.replyText).toContain("Music Hall has 1 (Cy)");
    expect(lastAudit()).toMatchObject({ toolId: "world.presence", result: "done", target: "The palace" });
  });

  it("an unmounted palace reads as a quiet palace (the directory's honest-zero convention)", async () => {
    state.palace = null;
    const out = await executeAction({ userId: MEMBER, toolId: "world.presence", channel: "chat_text" });
    expect(out.status).toBe("done");
    expect(out.replyText).toContain("The palace is quiet right now");
  });

  it("an empty snapshot says the palace is quiet — no invented crowd", async () => {
    state.palace = { presenceSnapshot: () => ({ total: 0, rooms: [] }) };
    const out = await executeAction({ userId: MEMBER, toolId: "world.presence", channel: "chat_text" });
    expect(out.status).toBe("done");
    expect(out.replyText).toContain("quiet right now");
    expect(out.replyText).not.toContain("people are");
  });
});

describe("world.standings — the court's live ladder", () => {
  it("speaks the top five with the rail's own marks", async () => {
    const out = await executeAction({ userId: MEMBER, toolId: "world.standings", channel: "chat_text" });
    expect(out.status).toBe("done");
    expect(out.replyText).toContain("Season I");
    expect(out.replyText).toContain("1. Ana — 120 marks");
    expect(out.replyText).toContain("2. Bo — 95 marks");
    expect(out.replyText).toContain("5. Ed — 50 marks");
    expect(out.replyText).not.toContain("6. Fi"); // below the spoken five, and not the caller
  });

  it("the caller's own placement rides along when they're below the five", async () => {
    const out = await executeAction({ userId: OTHER, toolId: "world.standings", channel: "chat_text" });
    expect(out.status).toBe("done");
    expect(out.replyText).toContain("You're #7 with 41 marks");
  });

  it("an unmarched season is an honest wide-open court", async () => {
    state.standings = [];
    const out = await executeAction({ userId: MEMBER, toolId: "world.standings", channel: "chat_text" });
    expect(out.status).toBe("done");
    expect(out.replyText).toContain("nobody has carved a mark yet");
  });

  it("a court rail failure is an honest failed run", async () => {
    state.standingsFail = true;
    const out = await executeAction({ userId: MEMBER, toolId: "world.standings", channel: "chat_text" });
    expect(out.status).toBe("failed");
    expect(lastAudit().result).toBe("failed");
  });
});

describe("the kill switch covers the new tools (Lane A law)", () => {
  it("OPERATOR_HANDS_ENABLED=0 refuses a Tier 0 read and audits the refusal", async () => {
    process.env["OPERATOR_HANDS_ENABLED"] = "0";
    const out = await executeAction({ userId: MEMBER, toolId: "quests.status", channel: "chat_text" });
    expect(out.status).toBe("refused");
    expect(out.reason).toBe("hands_disabled");
    expect(lastAudit().resultReason).toBe("hands_disabled");
    expect(state.railCalls).toHaveLength(0); // no rail was touched
  });
});

describe("over HTTP — the plain questions route to the tools", () => {
  async function postChat(message: string, who?: string) {
    const res = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(who ? { "x-test-user": who } : {}),
      },
      body: JSON.stringify({ message }),
    });
    return { status: res.status, json: (await res.json().catch(() => ({}))) as any };
  }

  it("'what did I earn?' with the earnings marker → the rail's answer, audited", async () => {
    state.reply = "Let me look.\n[[DO:earnings.summary]]";
    const { status, json } = await postChat("What did I earn?", MEMBER);
    expect(status).toBe(200);
    expect(json.reply).toContain("You've earned $65.50 so far");
    expect(json.action).toMatchObject({ toolId: "earnings.summary", status: "done" });
    expect(auditRows()).toHaveLength(1);
  });

  it("'where are my quests at?' with the quests marker → the trio's answer", async () => {
    state.reply = "Checking.\n[[DO:quests.status]]";
    const { json } = await postChat("Where are my quests at?", MEMBER);
    expect(json.reply).toContain("Today's trio");
    expect(json.action).toMatchObject({ toolId: "quests.status", status: "done" });
  });

  it("'who's in the hall?' with the presence marker → the snapshot's answer", async () => {
    state.reply = "Looking in.\n[[DO:world.presence]]";
    const { json } = await postChat("Who's in the hall right now?", MEMBER);
    expect(json.reply).toContain("3 people are in the palace right now");
    expect(json.action).toMatchObject({ toolId: "world.presence", status: "done" });
  });

  it("'who's winning the season?' with the standings marker → the ladder's answer", async () => {
    state.reply = "To the wall.\n[[DO:world.standings]]";
    const { json } = await postChat("Who's winning the Court Season?", MEMBER);
    expect(json.reply).toContain("1. Ana — 120 marks");
    expect(json.action).toMatchObject({ toolId: "world.standings", status: "done" });
  });

  it("the same markers as a guest execute NOTHING — sign-in line, no audit", async () => {
    state.reply = "Let me look.\n[[DO:earnings.summary]]";
    const { json } = await postChat("What did I earn?");
    expect(json.reply).toContain("signed-in members");
    expect(json.action).toMatchObject({ status: "refused", reason: "needs_sign_in" });
    expect(auditRows()).toHaveLength(0);
    expect(state.railCalls).toHaveLength(0);
  });
});
