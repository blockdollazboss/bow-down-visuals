/**
 * Cloud Operator Phase 2, Lane A — the executor, tested against the
 * real module with a FAKE registry (so charged + Tier-4 tools exist
 * to gate) and the shared fake db (so audit + pending rows are real
 * state, asserted directly).
 *
 * The pins (design law, operator-phase2-scope.md):
 *  - a charged tool NEVER runs without a confirmation on file
 *  - a confirmation is consumed EXACTLY ONCE; a replay refuses
 *  - expired / cancelled / arg-swapped / price-moved confirmations
 *    refuse honestly, each with its own audited reason
 *  - Tier 4 refuses a non-admin AND refuses everyone when
 *    ADMIN_EMAILS is unset (fail-closed), and runs for an admin
 *  - the kill switch refuses every execution, audited
 *  - the daily charged cap refuses beyond OPERATOR_DAILY_CHARGED_CAP
 *  - the audit row is written from the HANDLER'S result: its charged
 *    figure and idempotency key are the rail's, incl. the refund
 *    shape (charged-then-refunded reports priceCharged 0)
 *  - the free balance proof tool returns the rail's number and
 *    audits `done`
 *
 * The REAL registry (one live tool) is proven end-to-end through the
 * chat route in routes/__tests__/operator-hands.test.ts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const MEMBER = "00000000-0000-4000-8000-0000000000a2";
const ADMIN_EMAIL = "king@example.test";

const state = vi.hoisted(() => ({
  balance: 1234,
  chargedPrice: 400,
  handlerMode: "ok" as "ok" | "fail" | "refund",
  chargedRuns: 0,
  adminRuns: 0,
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

/* Fake registry: the executor's gates are what is under test, so the
   tools are test doubles with the real registry's shape. */
vi.mock("../operator-tools", () => {
  const tools: Record<string, any> = {
    "credits.balance": {
      id: "credits.balance",
      tier: 0,
      name: "Check your Visual Bucs balance",
      blurb: "balance",
      priceVb: null,
      handler: async () => ({
        summary: "Checked Visual Bucs balance",
        replyText: `You have ${state.balance.toLocaleString("en-US")} Visual Bucs. 🦈`,
      }),
    },
    "test.charged": {
      id: "test.charged",
      tier: 3,
      name: "Make the test thing",
      blurb: "charged",
      get priceVb() {
        return state.chargedPrice;
      },
      handler: async () => {
        state.chargedRuns += 1;
        if (state.handlerMode === "fail") throw new Error("rail exploded");
        if (state.handlerMode === "refund") {
          return {
            summary: "Made the test thing (rail refunded)",
            priceCharged: 0,
            idempotencyKey: "charge-key-refunded",
            replyText: "The rail failed after charging, so your Visual Bucs were refunded in full.",
          };
        }
        return {
          summary: "Made the test thing",
          priceCharged: state.chargedPrice,
          idempotencyKey: "charge-key-1",
          replyText: "Done — the test thing is made.",
        };
      },
    },
    "test.admin": {
      id: "test.admin",
      tier: 4,
      name: "Remove a person from the hall (test)",
      blurb: "admin",
      priceVb: null,
      handler: async () => {
        state.adminRuns += 1;
        return { summary: "Removed a person from the hall", replyText: "Done." };
      },
    },
  };
  return { OPERATOR_TOOLS: Object.values(tools), getTool: (id: string) => tools[id] };
});

import {
  executeAction,
  proposeAction,
  getLivePending,
  cancelPendingAction,
  OPERATOR_DAILY_CHARGED_CAP,
} from "../operator-executor";

function auditRows(): any[] {
  return h.fake.store("operatorActions").rows;
}
function lastAudit(): any {
  return auditRows()[auditRows().length - 1];
}

beforeEach(() => {
  h.fake.clear();
  state.balance = 1234;
  state.chargedPrice = 400;
  state.handlerMode = "ok";
  state.chargedRuns = 0;
  state.adminRuns = 0;
  delete process.env["OPERATOR_HANDS_ENABLED"];
  delete process.env["ADMIN_EMAILS"];
});

afterEach(() => {
  vi.useRealTimers();
});

describe("free tools run and audit from the rail's result", () => {
  it("balance proof tool returns the rail number and audits done", async () => {
    const out = await executeAction({ userId: MEMBER, toolId: "credits.balance", channel: "chat_text" });
    expect(out.status).toBe("done");
    expect(out.replyText).toContain("1,234 Visual Bucs");
    expect(auditRows()).toHaveLength(1);
    const row = lastAudit();
    expect(row.userId).toBe(MEMBER);
    expect(row.tier).toBe(0);
    expect(row.toolId).toBe("credits.balance");
    expect(row.result).toBe("done");
    expect(row.priceCharged).toBeNull();
    expect(row.channel).toBe("chat_text");
  });

  it("unknown tool refuses WITHOUT an audit row (no action exists)", async () => {
    const out = await executeAction({ userId: MEMBER, toolId: "make.everything", channel: "chat_text" });
    expect(out.status).toBe("refused");
    expect(out.reason).toBe("unknown_tool");
    expect(auditRows()).toHaveLength(0);
  });
});

describe("charged tools: the confirmation protocol", () => {
  it("refuses without a confirmation on file — and audits the refusal", async () => {
    const out = await executeAction({ userId: MEMBER, toolId: "test.charged", channel: "chat_text" });
    expect(out.status).toBe("refused");
    expect(out.reason).toBe("no_confirmation");
    expect(state.chargedRuns).toBe(0);
    expect(lastAudit().result).toBe("refused");
    expect(lastAudit().resultReason).toBe("no_confirmation");
  });

  it("propose → confirm runs the rail; the audit row carries the rail's own figures", async () => {
    const proposal = await proposeAction({ userId: MEMBER, toolId: "test.charged", args: { kind: "video" }, channel: "chat_text" });
    expect(proposal.status).toBe("proposed");
    if (proposal.status !== "proposed") throw new Error("unreachable");
    expect(proposal.priceQuoted).toBe(400);

    const out = await executeAction({
      userId: MEMBER, toolId: "test.charged", args: { kind: "video" }, channel: "chat_text", pendingId: proposal.pendingId,
    });
    expect(out.status).toBe("done");
    expect(state.chargedRuns).toBe(1);
    const row = lastAudit();
    expect(row.result).toBe("done");
    expect(row.priceQuoted).toBe(400);
    expect(row.priceCharged).toBe(400);
    expect(row.idempotencyKey).toBe("charge-key-1");
    // consumed exactly once, stamped
    const pending = h.fake.store("operatorPendingActions").rows[0];
    expect(pending.status).toBe("consumed");
    expect(pending.consumedAt).toBeTruthy();
  });

  it("a replayed confirmation refuses and never re-runs the rail", async () => {
    const proposal = await proposeAction({ userId: MEMBER, toolId: "test.charged", channel: "chat_text" });
    if (proposal.status !== "proposed") throw new Error("unreachable");
    const first = await executeAction({ userId: MEMBER, toolId: "test.charged", channel: "chat_text", pendingId: proposal.pendingId });
    expect(first.status).toBe("done");
    const replay = await executeAction({ userId: MEMBER, toolId: "test.charged", channel: "chat_text", pendingId: proposal.pendingId });
    expect(replay.status).toBe("refused");
    expect(replay.reason).toBe("confirmation_replayed");
    expect(state.chargedRuns).toBe(1);
    expect(lastAudit().resultReason).toBe("confirmation_replayed");
  });

  it("an expired confirmation refuses and is marked expired", async () => {
    const proposal = await proposeAction({ userId: MEMBER, toolId: "test.charged", channel: "chat_text" });
    if (proposal.status !== "proposed") throw new Error("unreachable");
    const row = h.fake.store("operatorPendingActions").rows[0];
    row.expires_at = new Date(Date.now() - 1000);
    row.expiresAt = new Date(Date.now() - 1000);
    const out = await executeAction({ userId: MEMBER, toolId: "test.charged", channel: "chat_text", pendingId: proposal.pendingId });
    expect(out.status).toBe("refused");
    expect(out.reason).toBe("confirmation_expired");
    expect(state.chargedRuns).toBe(0);
    expect(row.status).toBe("expired");
    expect(lastAudit().resultReason).toBe("confirmation_expired");
  });

  it("a cancelled confirmation refuses; cancelling is the member's own act", async () => {
    const proposal = await proposeAction({ userId: MEMBER, toolId: "test.charged", channel: "chat_text" });
    if (proposal.status !== "proposed") throw new Error("unreachable");
    expect(await cancelPendingAction(MEMBER)).toBe(true);
    expect(await getLivePending(MEMBER)).toBeNull();
    const out = await executeAction({ userId: MEMBER, toolId: "test.charged", channel: "chat_text", pendingId: proposal.pendingId });
    expect(out.status).toBe("refused");
    expect(out.reason).toBe("confirmation_cancelled");
    expect(state.chargedRuns).toBe(0);
  });

  it("args swapped after the yes refuse as a mismatch — the confirmed args are what run", async () => {
    const proposal = await proposeAction({ userId: MEMBER, toolId: "test.charged", args: { kind: "video" }, channel: "chat_text" });
    if (proposal.status !== "proposed") throw new Error("unreachable");
    const out = await executeAction({
      userId: MEMBER, toolId: "test.charged", args: { kind: "something-else" }, channel: "chat_text", pendingId: proposal.pendingId,
    });
    expect(out.status).toBe("refused");
    expect(out.reason).toBe("confirmation_mismatch");
    expect(state.chargedRuns).toBe(0);
  });

  it("a price that moved since the quote refuses as a mismatch", async () => {
    const proposal = await proposeAction({ userId: MEMBER, toolId: "test.charged", channel: "chat_text" });
    if (proposal.status !== "proposed") throw new Error("unreachable");
    state.chargedPrice = 500;
    const out = await executeAction({ userId: MEMBER, toolId: "test.charged", channel: "chat_text", pendingId: proposal.pendingId });
    expect(out.status).toBe("refused");
    expect(out.reason).toBe("confirmation_mismatch");
    expect(out.replyText).toContain("500 Visual Bucs");
    expect(state.chargedRuns).toBe(0);
  });

  it("another member cannot spend someone else's confirmation", async () => {
    const proposal = await proposeAction({ userId: MEMBER, toolId: "test.charged", channel: "chat_text" });
    if (proposal.status !== "proposed") throw new Error("unreachable");
    const out = await executeAction({
      userId: "00000000-0000-4000-8000-0000000000ff", toolId: "test.charged", channel: "chat_text", pendingId: proposal.pendingId,
    });
    expect(out.status).toBe("refused");
    expect(state.chargedRuns).toBe(0);
  });

  it("a handler failure audits failed with the rail's error, and refunds report charged 0", async () => {
    const p1 = await proposeAction({ userId: MEMBER, toolId: "test.charged", channel: "chat_text" });
    if (p1.status !== "proposed") throw new Error("unreachable");
    state.handlerMode = "fail";
    const failed = await executeAction({ userId: MEMBER, toolId: "test.charged", channel: "chat_text", pendingId: p1.pendingId });
    expect(failed.status).toBe("failed");
    expect(lastAudit().result).toBe("failed");
    expect(lastAudit().resultReason).toContain("rail exploded");

    const p2 = await proposeAction({ userId: MEMBER, toolId: "test.charged", channel: "chat_text" });
    if (p2.status !== "proposed") throw new Error("unreachable");
    state.handlerMode = "refund";
    const refunded = await executeAction({ userId: MEMBER, toolId: "test.charged", channel: "chat_text", pendingId: p2.pendingId });
    expect(refunded.status).toBe("done");
    expect(refunded.priceCharged).toBe(0);
    expect(lastAudit().priceCharged).toBe(0);
    expect(lastAudit().idempotencyKey).toBe("charge-key-refunded");
  });

  it("a new proposal replaces the member's previous live one", async () => {
    const p1 = await proposeAction({ userId: MEMBER, toolId: "test.charged", channel: "chat_text" });
    const p2 = await proposeAction({ userId: MEMBER, toolId: "test.charged", channel: "chat_text" });
    if (p1.status !== "proposed" || p2.status !== "proposed") throw new Error("unreachable");
    const live = await getLivePending(MEMBER);
    expect(live?.id).toBe(p2.pendingId);
    const rows = h.fake.store("operatorPendingActions").rows;
    expect(rows.find((r: any) => r.id === p1.pendingId)?.status).toBe("cancelled");
  });
});

describe("Tier 4: admin-only, fail-closed", () => {
  it("a non-admin session refuses and audits; nothing runs", async () => {
    process.env["ADMIN_EMAILS"] = ADMIN_EMAIL;
    const out = await executeAction({
      userId: MEMBER, userEmail: "member@example.test", toolId: "test.admin", channel: "admin_command",
    });
    expect(out.status).toBe("refused");
    expect(out.reason).toBe("not_admin");
    expect(out.replyText).toContain("King's call");
    expect(state.adminRuns).toBe(0);
    expect(lastAudit().resultReason).toBe("not_admin");
    expect(lastAudit().adminEmail).toBeNull();
  });

  it("ADMIN_EMAILS unset refuses EVERYONE, even the would-be admin", async () => {
    delete process.env["ADMIN_EMAILS"];
    const out = await executeAction({
      userId: MEMBER, userEmail: ADMIN_EMAIL, toolId: "test.admin", channel: "admin_command",
    });
    expect(out.status).toBe("refused");
    expect(out.reason).toBe("not_admin");
    expect(state.adminRuns).toBe(0);
  });

  it("an admin session runs it, and the audit row carries the admin email", async () => {
    process.env["ADMIN_EMAILS"] = ` ${ADMIN_EMAIL.toUpperCase()} `;
    const out = await executeAction({
      userId: MEMBER, userEmail: ADMIN_EMAIL, toolId: "test.admin", channel: "admin_command",
    });
    expect(out.status).toBe("done");
    expect(state.adminRuns).toBe(1);
    expect(lastAudit().adminEmail).toBe(ADMIN_EMAIL);
    expect(lastAudit().channel).toBe("admin_command");
  });
});

describe("kill switch + daily cap", () => {
  it("OPERATOR_HANDS_ENABLED=0 refuses every execution, audited; proposals refuse too", async () => {
    process.env["OPERATOR_HANDS_ENABLED"] = "0";
    const out = await executeAction({ userId: MEMBER, toolId: "credits.balance", channel: "chat_text" });
    expect(out.status).toBe("refused");
    expect(out.reason).toBe("hands_disabled");
    expect(lastAudit().resultReason).toBe("hands_disabled");
    const proposal = await proposeAction({ userId: MEMBER, toolId: "test.charged", channel: "chat_text" });
    expect(proposal).toEqual({ status: "refused", reason: "hands_disabled" });
    // and back on again
    delete process.env["OPERATOR_HANDS_ENABLED"];
    const ok = await executeAction({ userId: MEMBER, toolId: "credits.balance", channel: "chat_text" });
    expect(ok.status).toBe("done");
  });

  it("beyond the daily charged cap, a confirmed action refuses (and the confirmation is NOT burned)", async () => {
    for (let i = 0; i < OPERATOR_DAILY_CHARGED_CAP; i++) {
      h.fake.seed("operatorActions", [{
        userId: MEMBER, tier: 3, toolId: "test.charged", summary: "Made the test thing",
        channel: "chat_text", priceQuoted: 400, priceCharged: 400, result: "done",
        createdAt: new Date(),
      }]);
    }
    const proposal = await proposeAction({ userId: MEMBER, toolId: "test.charged", channel: "chat_text" });
    if (proposal.status !== "proposed") throw new Error("unreachable");
    const out = await executeAction({ userId: MEMBER, toolId: "test.charged", channel: "chat_text", pendingId: proposal.pendingId });
    expect(out.status).toBe("refused");
    expect(out.reason).toBe("daily_cap");
    expect(state.chargedRuns).toBe(0);
    expect(lastAudit().resultReason).toBe("daily_cap");
    // the confirmation survived the refusal — it was never consumed
    const pending = h.fake.store("operatorPendingActions").rows[0];
    expect(pending.status).toBe("pending");
  });

  it("free reads do not count toward the charged cap", async () => {
    for (let i = 0; i < OPERATOR_DAILY_CHARGED_CAP + 5; i++) {
      h.fake.seed("operatorActions", [{
        userId: MEMBER, tier: 0, toolId: "credits.balance", summary: "Checked Visual Bucs balance",
        channel: "chat_text", priceCharged: null, result: "done",
        createdAt: new Date(),
      }]);
    }
    const proposal = await proposeAction({ userId: MEMBER, toolId: "test.charged", channel: "chat_text" });
    if (proposal.status !== "proposed") throw new Error("unreachable");
    const out = await executeAction({ userId: MEMBER, toolId: "test.charged", channel: "chat_text", pendingId: proposal.pendingId });
    expect(out.status).toBe("done");
  });
});
