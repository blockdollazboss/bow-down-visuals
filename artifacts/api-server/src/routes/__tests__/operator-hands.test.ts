/**
 * Cloud Operator Phase 2, Lane A — the hands end to end over HTTP:
 * POST /api/chat with the REAL registry, REAL executor and REAL chat
 * glue; only the model client, the session resolver, the credits
 * balance read and the db are faked.
 *
 * Pins:
 *  - "how many Visual Bucs do I have" with a [[DO:credits.balance]]
 *    marker → the reply IS the live rail's number (1,234 — a figure
 *    the knowledge base does NOT vouch for, proving executor replies
 *    are code-authored and bypass the model-text price guard), and
 *    an audit row lands
 *  - the same marker as a GUEST → the honest sign-in line, and NO
 *    audit row (nothing executed)
 *  - a marker for a tool that does not exist → "I can't do that yet",
 *    never a fake execution
 *  - no marker → the plain Phase 1 path, untouched
 *  - the audit row is readable back through the member readback,
 *    scoped to the caller's own rows
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

const MEMBER = "00000000-0000-4000-8000-0000000000a2";
const OTHER = "00000000-0000-4000-8000-0000000000a9";

const state = vi.hoisted(() => {
  process.env.CHAT_CREDIT_COST = "0";
  return {
    reply: "All good, fin-friend. 🦈",
    balance: 1234,
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

/* Session: header-driven, the content-reports pattern. Sets identity
   the way resolveOptionalSession / requireAuth do in production. */
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
import operatorActionsRouter from "../operator-actions";

let server: any;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api", chatRouter);
  app.use("/api", operatorActionsRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  h.fake.clear();
  state.reply = "All good, fin-friend. 🦈";
  state.balance = 1234;
  delete process.env["OPERATOR_HANDS_ENABLED"];
});

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

describe("POST /api/chat — the balance proof tool, end to end", () => {
  it("a signed-in member gets the LIVE balance, composed by the executor — and it is audited", async () => {
    state.reply = "Let me pull that up.\n[[DO:credits.balance]]";
    const { status, json } = await postChat("How many Visual Bucs do I have?", MEMBER);
    expect(status).toBe(200);
    expect(json.reply).toBe("You have 1,234 Visual Bucs. 🦈");
    expect(json.action).toMatchObject({ toolId: "credits.balance", status: "done" });
    // 1,234 is NOT a knowledge-base figure: had the model-text price
    // guard touched this reply, it would have been replaced wholesale.
    const rows = h.fake.store("operatorActions").rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: MEMBER, toolId: "credits.balance", result: "done", tier: 0 });
  });

  it("the same marker as a guest gets the sign-in line and executes NOTHING", async () => {
    state.reply = "Let me pull that up.\n[[DO:credits.balance]]";
    const { status, json } = await postChat("How many Visual Bucs do I have?");
    expect(status).toBe(200);
    expect(json.reply).toContain("signed-in members");
    expect(json.action).toMatchObject({ status: "refused", reason: "needs_sign_in" });
    expect(h.fake.store("operatorActions").rows).toHaveLength(0);
  });

  it("a marker for a tool that does not exist gets an honest can't-do-yet", async () => {
    state.reply = "On it!\n[[DO:make.song]]";
    const { json } = await postChat("Make me a song right now.", MEMBER);
    expect(json.reply).toContain("I can't do that one yet");
    expect(json.action).toMatchObject({ status: "refused", reason: "unknown_tool" });
    expect(h.fake.store("operatorActions").rows).toHaveLength(0);
  });

  it("no marker → the Phase 1 answer path, untouched", async () => {
    state.reply = "All good, fin-friend. 🦈";
    const { json } = await postChat("What is this site?", MEMBER);
    expect(json.reply).toBe("All good, fin-friend. 🦈");
    expect(json.action).toBeUndefined();
    expect(h.fake.store("operatorActions").rows).toHaveLength(0);
  });

  it("kill switch on: the marker turn refuses honestly and audits the refusal", async () => {
    process.env["OPERATOR_HANDS_ENABLED"] = "0";
    state.reply = "Let me pull that up.\n[[DO:credits.balance]]";
    const { json } = await postChat("How many Visual Bucs do I have?", MEMBER);
    expect(json.reply).toContain("hands are switched off");
    expect(json.action).toMatchObject({ status: "refused", reason: "hands_disabled" });
    const rows = h.fake.store("operatorActions").rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].resultReason).toBe("hands_disabled");
  });
});

describe("GET /api/operator/actions — the member readback", () => {
  it("returns the caller's own rows only", async () => {
    state.reply = "Let me pull that up.\n[[DO:credits.balance]]";
    await postChat("How many Visual Bucs do I have?", MEMBER);
    await postChat("How many Visual Bucs do I have?", OTHER);

    const res = await fetch(`${baseUrl}/api/operator/actions`, {
      headers: { "x-test-user": MEMBER },
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.actions).toHaveLength(1);
    expect(json.actions[0]).toMatchObject({ toolId: "credits.balance", result: "done" });
  });

  it("guests get 401", async () => {
    const res = await fetch(`${baseUrl}/api/operator/actions`);
    expect(res.status).toBe(401);
  });
});
