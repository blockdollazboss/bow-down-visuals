/**
 * Stack-24 Lane 7 — operator hands safety audit pins.
 *
 * The five payments-critical invariants of the Thy Cheat Code executor
 * (lib/operator-executor.ts), audited from code for the payments E2E
 * Phase A flag ("confirm code default before operator E2E") and pinned
 * here where the earlier suites (operator-executor.test.ts,
 * operator-tier3.test.ts) did not already cover them:
 *
 *  1. KILL SWITCH DEFAULT — OPERATOR_HANDS_ENABLED absent (the exact
 *     state of the production service today) leaves the hands ON.
 *     Only "0" / "false" / "off" (any case, padded) still them. This
 *     default is deliberate (Phase 2 shipped live), and it is pinned
 *     DIRECTLY so it can never drift silently.
 *  2. CROSS-TOOL CONFIRMATIONS — a confirmation created for tool A
 *     must not authorize tool B (either direction), and a fabricated
 *     pending id authorizes nothing. (Same-member replay, expiry,
 *     cancel, arg-swap and cross-member misuse are pinned in
 *     operator-executor.test.ts.)
 *  3. DAILY CAP BOUNDARIES — the cap counts only TODAY's (UTC) DONE
 *     rows with priceCharged > 0 for THIS member: the 20th action
 *     runs, yesterday's rows don't count, zero-priced done rows
 *     (the video-submission audit shape) don't count, failed/refused
 *     rows don't count, another member's rows don't count.
 *  4. PRICE INTEGRITY AT THE EXECUTOR — price-shaped fields smuggled
 *     into proposal args move neither the quote, nor the pending
 *     row, nor the charged/audited figures: the registry price is
 *     the only price that exists. (The rail-side tripwire — every
 *     registry price IS the rail's own constant — is pinned in
 *     operator-tier3.test.ts.)
 *
 * Fake registry (two charged tools at different prices) + the shared
 * fake db, same technique as operator-executor.test.ts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const MEMBER = "00000000-0000-4000-8000-0000000000a7";
const OTHER = "00000000-0000-4000-8000-0000000000a8";

const state = vi.hoisted(() => ({
  runsA: 0,
  runsB: 0,
}));

const h = vi.hoisted(() => ({ fake: null as any }));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const { createFakeDb } = await import("../../routes/__tests__/_reach-fake-db");
  const fake = createFakeDb({
    operatorActions: actual.operatorActionsTable,
    operatorPendingActions: actual.operatorPendingActionsTable,
  });
  h.fake = fake;
  return { ...actual, db: fake.db };
});

vi.mock("../operator-tools", () => {
  const tools: Record<string, any> = {
    "test.charged.a": {
      id: "test.charged.a",
      tier: 3,
      name: "Make the A thing",
      blurb: "charged a",
      priceVb: 400,
      handler: async () => {
        state.runsA += 1;
        return { summary: "Made the A thing", priceCharged: 400, replyText: "A done." };
      },
    },
    "test.charged.b": {
      id: "test.charged.b",
      tier: 3,
      name: "Make the B thing",
      blurb: "charged b",
      priceVb: 100,
      handler: async () => {
        state.runsB += 1;
        return { summary: "Made the B thing", priceCharged: 100, replyText: "B done." };
      },
    },
  };
  return { OPERATOR_TOOLS: Object.values(tools), getTool: (id: string) => tools[id] };
});

import {
  executeAction,
  proposeAction,
  operatorHandsEnabled,
  OPERATOR_DAILY_CHARGED_CAP,
} from "../operator-executor";

function auditRows(): any[] {
  return h.fake.store("operatorActions").rows;
}
function pendingRows(): any[] {
  return h.fake.store("operatorPendingActions").rows;
}
function lastAudit(): any {
  return auditRows()[auditRows().length - 1];
}

async function propose(toolId: string, args: Record<string, unknown> = {}) {
  const p = await proposeAction({ userId: MEMBER, toolId, args, channel: "chat_text" });
  expect(p.status).toBe("proposed");
  if (p.status !== "proposed") throw new Error("unreachable");
  return p;
}

function seedChargedRows(n: number, overrides: Record<string, unknown> = {}) {
  for (let i = 0; i < n; i++) {
    h.fake.seed("operatorActions", [
      {
        userId: MEMBER,
        tier: 3,
        toolId: "test.charged.a",
        summary: "earlier charged action",
        channel: "chat_text",
        priceQuoted: 400,
        priceCharged: 400,
        result: "done",
        createdAt: new Date(),
        ...overrides,
      },
    ]);
  }
}

beforeEach(() => {
  h.fake.clear();
  state.runsA = 0;
  state.runsB = 0;
  delete process.env["OPERATOR_HANDS_ENABLED"];
});

afterEach(() => {
  delete process.env["OPERATOR_HANDS_ENABLED"];
});

/* ── 1. The kill switch: default, and the exact off-values ─────────── */

describe("kill switch — OPERATOR_HANDS_ENABLED default and values", () => {
  it("the DEFAULT (env var absent — production's state today) is hands ON", () => {
    delete process.env["OPERATOR_HANDS_ENABLED"];
    expect(operatorHandsEnabled()).toBe(true);
  });

  it("only 0 / false / off still the hands — any case, padded", () => {
    for (const v of ["0", "false", "off", "OFF", "False", "  off  ", " 0 "]) {
      process.env["OPERATOR_HANDS_ENABLED"] = v;
      expect(operatorHandsEnabled(), `value ${JSON.stringify(v)}`).toBe(false);
    }
  });

  it("any other value — 1, true, on, yes, a typo — leaves the hands ON", () => {
    for (const v of ["1", "true", "on", "yes", "enabled", "disabled", "o", ""]) {
      process.env["OPERATOR_HANDS_ENABLED"] = v;
      expect(operatorHandsEnabled(), `value ${JSON.stringify(v)}`).toBe(true);
    }
  });

  it("with the var ABSENT, a confirmed charged action actually runs (the production posture)", async () => {
    delete process.env["OPERATOR_HANDS_ENABLED"];
    const p = await propose("test.charged.a");
    const out = await executeAction({
      userId: MEMBER, toolId: "test.charged.a", channel: "chat_text", pendingId: p.pendingId,
    });
    expect(out.status).toBe("done");
    expect(state.runsA).toBe(1);
  });

  it("OPERATOR_HANDS_ENABLED=false refuses execution and proposal alike", async () => {
    process.env["OPERATOR_HANDS_ENABLED"] = "false";
    const out = await executeAction({ userId: MEMBER, toolId: "test.charged.a", channel: "chat_text" });
    expect(out.status).toBe("refused");
    expect(out.reason).toBe("hands_disabled");
    const p = await proposeAction({ userId: MEMBER, toolId: "test.charged.a", channel: "chat_text" });
    expect(p).toEqual({ status: "refused", reason: "hands_disabled" });
    expect(state.runsA).toBe(0);
    expect(pendingRows()).toHaveLength(0);
  });
});

/* ── 2. A confirmation authorizes exactly its own action ───────────── */

describe("confirmation binding — one yes, one action, that action only", () => {
  it("tool A's confirmation cannot run tool B — and is NOT consumed by the attempt", async () => {
    const pA = await propose("test.charged.a");
    const out = await executeAction({
      userId: MEMBER, toolId: "test.charged.b", channel: "chat_text", pendingId: pA.pendingId,
    });
    expect(out.status).toBe("refused");
    expect(out.reason).toBe("no_confirmation");
    expect(state.runsB).toBe(0);
    expect(state.runsA).toBe(0);
    expect(lastAudit()).toMatchObject({ toolId: "test.charged.b", result: "refused", resultReason: "no_confirmation" });
    /* The A confirmation survives the misuse attempt untouched… */
    expect(pendingRows().find((r: any) => r.id === pA.pendingId)?.status).toBe("pending");
    /* …and still runs A, exactly once. */
    const ok = await executeAction({
      userId: MEMBER, toolId: "test.charged.a", channel: "chat_text", pendingId: pA.pendingId,
    });
    expect(ok.status).toBe("done");
    expect(state.runsA).toBe(1);
  });

  it("tool B's confirmation cannot run tool A either (the binding is symmetric)", async () => {
    const pB = await propose("test.charged.b");
    const out = await executeAction({
      userId: MEMBER, toolId: "test.charged.a", channel: "chat_text", pendingId: pB.pendingId,
    });
    expect(out.status).toBe("refused");
    expect(out.reason).toBe("no_confirmation");
    expect(state.runsA).toBe(0);
    expect(state.runsB).toBe(0);
    expect(pendingRows().find((r: any) => r.id === pB.pendingId)?.status).toBe("pending");
  });

  it("a fabricated pending id (no row on file) authorizes nothing", async () => {
    const out = await executeAction({
      userId: MEMBER,
      toolId: "test.charged.a",
      channel: "chat_text",
      pendingId: "00000000-0000-4000-8000-0000000000ff",
    });
    expect(out.status).toBe("refused");
    expect(out.reason).toBe("no_confirmation");
    expect(state.runsA).toBe(0);
    expect(lastAudit().resultReason).toBe("no_confirmation");
  });
});

/* ── 3. Daily cap — what counts, and the exact boundary ─────────────── */

describe("daily charged cap — counting rules and the boundary", () => {
  it("the (cap)th action still runs: at cap-1 done rows, a confirmed action executes", async () => {
    seedChargedRows(OPERATOR_DAILY_CHARGED_CAP - 1);
    const p = await propose("test.charged.a");
    const out = await executeAction({
      userId: MEMBER, toolId: "test.charged.a", channel: "chat_text", pendingId: p.pendingId,
    });
    expect(out.status).toBe("done");
    expect(state.runsA).toBe(1);
  });

  it("at exactly cap done rows the next action refuses BEFORE the rail (mirror of the boundary)", async () => {
    seedChargedRows(OPERATOR_DAILY_CHARGED_CAP);
    const p = await propose("test.charged.a");
    const out = await executeAction({
      userId: MEMBER, toolId: "test.charged.a", channel: "chat_text", pendingId: p.pendingId,
    });
    expect(out.status).toBe("refused");
    expect(out.reason).toBe("daily_cap");
    expect(state.runsA).toBe(0);
  });

  it("yesterday's charged actions do not count toward today's cap", async () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    seedChargedRows(OPERATOR_DAILY_CHARGED_CAP, { createdAt: yesterday });
    const p = await propose("test.charged.a");
    const out = await executeAction({
      userId: MEMBER, toolId: "test.charged.a", channel: "chat_text", pendingId: p.pendingId,
    });
    expect(out.status).toBe("done");
    expect(state.runsA).toBe(1);
  });

  it("done rows that charged 0 (the video-submission audit shape) do not consume cap", async () => {
    seedChargedRows(OPERATOR_DAILY_CHARGED_CAP, { toolId: "generate.video", priceQuoted: 400, priceCharged: 0 });
    const p = await propose("test.charged.a");
    const out = await executeAction({
      userId: MEMBER, toolId: "test.charged.a", channel: "chat_text", pendingId: p.pendingId,
    });
    expect(out.status).toBe("done");
    expect(state.runsA).toBe(1);
  });

  it("failed and refused rows do not consume cap, even at a charged price", async () => {
    seedChargedRows(OPERATOR_DAILY_CHARGED_CAP, { result: "failed" });
    seedChargedRows(OPERATOR_DAILY_CHARGED_CAP, { result: "refused" });
    const p = await propose("test.charged.a");
    const out = await executeAction({
      userId: MEMBER, toolId: "test.charged.a", channel: "chat_text", pendingId: p.pendingId,
    });
    expect(out.status).toBe("done");
    expect(state.runsA).toBe(1);
  });

  it("another member's charged actions never count toward my cap", async () => {
    seedChargedRows(OPERATOR_DAILY_CHARGED_CAP, { userId: OTHER });
    const p = await propose("test.charged.a");
    const out = await executeAction({
      userId: MEMBER, toolId: "test.charged.a", channel: "chat_text", pendingId: p.pendingId,
    });
    expect(out.status).toBe("done");
    expect(state.runsA).toBe(1);
  });
});

/* ── 4. Price integrity at the executor layer ───────────────────────── */

describe("price integrity — smuggled price fields move nothing", () => {
  it("price-shaped fields in the proposal args change neither quote, pending row, nor charge", async () => {
    const smuggled = { priceVb: 1, price: 1, cost: 1, amount: 1 };
    const p = await propose("test.charged.a", smuggled);
    /* The quote is the registry price — the args' figures don't exist. */
    expect(p.priceQuoted).toBe(400);
    const row = pendingRows().find((r: any) => r.id === p.pendingId);
    expect(row.priceQuoted).toBe(400);

    const out = await executeAction({
      userId: MEMBER, toolId: "test.charged.a", args: smuggled, channel: "chat_text", pendingId: p.pendingId,
    });
    expect(out.status).toBe("done");
    expect(out.priceQuoted).toBe(400);
    expect(out.priceCharged).toBe(400);
    expect(lastAudit()).toMatchObject({ result: "done", priceQuoted: 400, priceCharged: 400 });
  });

  it("the executor's entry points have no price parameter to abuse — a done row always shows registry figures", async () => {
    const p = await propose("test.charged.b");
    expect(p.priceQuoted).toBe(100);
    const out = await executeAction({
      userId: MEMBER, toolId: "test.charged.b", channel: "chat_text", pendingId: p.pendingId,
    });
    expect(out.status).toBe("done");
    expect(lastAudit()).toMatchObject({ toolId: "test.charged.b", priceQuoted: 100, priceCharged: 100 });
  });
});
