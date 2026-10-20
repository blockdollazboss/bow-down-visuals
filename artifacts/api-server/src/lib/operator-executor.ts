/* ─── Cloud Operator Phase 2 — the executor (Lane A foundation) ───────
   The ONLY door between a chat message and a real site rail. The model
   proposes; this module disposes. For every action it:

     1. resolves the tool from the fixed registry (never from model text),
     2. checks the kill switch, the tier gate, the confirmation, the cap,
     3. calls the rail AS THE CALLER (their session, their permissions),
     4. writes the audit row FROM THE HANDLER'S RESULT — never from
        anything the model said,
     5. returns a code-composed outcome the chat layer can read aloud.

   Laws it enforces (operator-phase2-scope.md):
     - Anything that spends credits confirms first: a charged tool runs
       ONLY against a pending confirmation the server created, and each
       confirmation is consumed exactly once.
     - Authority (Tier 4) is admin-only, proven server-side against
       ADMIN_EMAILS with the same fail-closed rule as routes/admin.ts
       requireAdmin: allowlist unset → NOBODY passes.
     - The operator never punishes on its own judgment: there is no
       code path here that originates an action — every call arrives
       from a member's confirmed request.

   Refusals are audited too (result 'refused' + the gate's reason), so
   the admin readback shows attempts, not just successes. An unknown
   tool id is the one refusal NOT audited: no registry row means no
   action exists to audit — the chat layer answers "I can't do that
   yet" and nothing was attempted against any rail. */

import { createHash } from "crypto";
import { and, desc, eq } from "drizzle-orm";
import {
  db,
  operatorActionsTable,
  operatorPendingActionsTable,
  type OperatorAction,
  type OperatorChannel,
  type OperatorPendingAction,
} from "@workspace/db";
import { getTool, type OperatorTool } from "./operator-tools";
import { toolIsCharged } from "./operator-tool-catalog";
import { logger } from "./logger";

/* ── Constants (build-time, stated here on purpose) ─────────────────── */

/** Per-member daily cap on operator-run CHARGED actions (design §4:
    the runaway-spending guard). Free reads/writes don't count. */
export const OPERATOR_DAILY_CHARGED_CAP = 20;

/** How long a proposal waits for the member's yes before it dies. */
export const OPERATOR_CONFIRMATION_TTL_MS = 10 * 60 * 1000;

/* ── Kill switch ────────────────────────────────────────────────────── */

/** OPERATOR_HANDS_ENABLED — default ON. Set to 0/false/off to still
    his hands: every execution then refuses (audited) while questions
    keep working and the audit log stays readable. */
export function operatorHandsEnabled(): boolean {
  const raw = (process.env["OPERATOR_HANDS_ENABLED"] ?? "").trim().toLowerCase();
  return raw !== "0" && raw !== "false" && raw !== "off";
}

/* ── Admin gate (the requireAdmin pattern, fail-closed) ─────────────── */

function adminEmails(): string[] {
  return (process.env["ADMIN_EMAILS"] ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

/** Same rule as routes/admin.ts requireAdmin: the session email must
    be on ADMIN_EMAILS; unset allowlist → nobody is an admin. */
export function isOperatorAdminEmail(email: string | undefined | null): boolean {
  const e = (email ?? "").trim().toLowerCase();
  return !!e && adminEmails().includes(e);
}

/* ── Types ──────────────────────────────────────────────────────────── */

export type ExecutorStatus = "done" | "refused" | "failed";

export interface ExecutorOutcome {
  status: ExecutorStatus;
  toolId: string;
  /** Gate/error code when status is not "done": hands_disabled,
      not_admin, no_confirmation, confirmation_expired,
      confirmation_replayed, confirmation_cancelled,
      confirmation_mismatch, daily_cap, unknown_tool. */
  reason?: string;
  /** Member-facing reply, composed by code from the rail's result. */
  replyText: string;
  priceQuoted?: number | null;
  priceCharged?: number | null;
}

export interface ExecuteInput {
  userId: string;
  userEmail?: string;
  toolId: string;
  args?: Record<string, unknown>;
  channel: OperatorChannel;
  /** Required for charged tools: the pending confirmation to consume. */
  pendingId?: string;
}

/* ── Args hashing (what was confirmed is what runs) ─────────────────── */

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`).join(",")}}`;
}

export function hashOperatorArgs(args: Record<string, unknown>): string {
  return createHash("sha256").update(canonical(args)).digest("hex");
}

/* ── Audit ──────────────────────────────────────────────────────────── */

interface AuditWrite {
  userId: string;
  adminEmail?: string | null;
  tier: number;
  toolId: string;
  summary: string;
  target?: string | null;
  channel: OperatorChannel;
  priceQuoted?: number | null;
  priceCharged?: number | null;
  idempotencyKey?: string | null;
  result: "done" | "refused" | "failed";
  resultReason?: string | null;
}

/** The audit write must never take the chat down with it — a failed
    audit is logged loudly for reconciliation instead. */
async function writeAudit(row: AuditWrite): Promise<void> {
  try {
    await db.insert(operatorActionsTable).values({
      userId: row.userId,
      adminEmail: row.adminEmail ?? null,
      tier: row.tier,
      toolId: row.toolId,
      summary: row.summary,
      target: row.target ?? null,
      channel: row.channel,
      priceQuoted: row.priceQuoted ?? null,
      priceCharged: row.priceCharged ?? null,
      idempotencyKey: row.idempotencyKey ?? null,
      result: row.result,
      resultReason: row.resultReason ?? null,
    });
  } catch (err) {
    logger.error({ err, toolId: row.toolId }, "[operator] AUDIT WRITE FAILED — action trail has a gap");
  }
}

function refusedOutcome(
  tool: OperatorTool,
  reason: string,
  replyText: string,
  priceQuoted?: number | null,
): ExecutorOutcome {
  return { status: "refused", toolId: tool.id, reason, replyText, priceQuoted: priceQuoted ?? tool.priceVb };
}

/* ── Confirmation protocol ──────────────────────────────────────────── */

export type ProposeOutcome =
  | { status: "proposed"; pendingId: string; priceQuoted: number; expiresAt: Date }
  | {
      status: "refused";
      reason: "hands_disabled" | "not_charged" | "unknown_tool" | "missing_args";
      /** For missing_args: the question the member should be asked
          (composed by the tool's validator from code, e.g. the real
          tier prices) — the chat layer answers with it verbatim. */
      askText?: string;
    };

/** Create a pending confirmation for a charged tool. The quoted price
    is the REGISTRY price at proposal time; if the registry price has
    moved by confirm time, the confirmation refuses (mismatch) and
    the member re-proposes at the true price — nobody is ever charged
    a price they didn't see. One live pending per member: a new
    proposal cancels the previous open one. */
export async function proposeAction(input: {
  userId: string;
  toolId: string;
  args?: Record<string, unknown>;
  channel: OperatorChannel;
}): Promise<ProposeOutcome> {
  const tool = getTool(input.toolId);
  if (!tool) return { status: "refused", reason: "unknown_tool" };
  if (!operatorHandsEnabled()) return { status: "refused", reason: "hands_disabled" };
  if (!toolIsCharged(tool)) return { status: "refused", reason: "not_charged" };

  /* Argument gate (Lane E): a tool that takes details from the
     member's message validates + normalizes them BEFORE any pending
     row exists — an incomplete request proposes nothing (the member
     is asked, nothing is quoted, and a live earlier proposal is left
     untouched). The normalized args are what the pending row (and
     its hash) carries, so what was confirmed is what runs. */
  let args = input.args ?? {};
  if (tool.validateArgs) {
    const verdict = await tool.validateArgs({ userId: input.userId, args });
    if (!verdict.ok) return { status: "refused", reason: "missing_args", askText: verdict.askText };
    args = verdict.args;
  }
  await cancelLivePending(input.userId);
  const expiresAt = new Date(Date.now() + OPERATOR_CONFIRMATION_TTL_MS);
  const [row] = await db
    .insert(operatorPendingActionsTable)
    .values({
      userId: input.userId,
      toolId: tool.id,
      args,
      argsHash: hashOperatorArgs(args),
      priceQuoted: tool.priceVb!,
      channel: input.channel,
      status: "pending",
      expiresAt,
    })
    .returning();
  return { status: "proposed", pendingId: row.id, priceQuoted: tool.priceVb!, expiresAt };
}

/** The member's one live (unexpired, unconsumed) pending confirmation,
    or null. Reading an expired row marks it expired — the state stays
    honest for the next read. */
export async function getLivePending(userId: string): Promise<OperatorPendingAction | null> {
  const rows = await db
    .select()
    .from(operatorPendingActionsTable)
    .where(and(eq(operatorPendingActionsTable.userId, userId), eq(operatorPendingActionsTable.status, "pending")))
    .orderBy(desc(operatorPendingActionsTable.createdAt))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  if (new Date(row.expiresAt).getTime() <= Date.now()) {
    await db
      .update(operatorPendingActionsTable)
      .set({ status: "expired" })
      .where(eq(operatorPendingActionsTable.id, row.id));
    return null;
  }
  return row;
}

async function cancelLivePending(userId: string): Promise<boolean> {
  const live = await getLivePending(userId);
  if (!live) return false;
  await db
    .update(operatorPendingActionsTable)
    .set({ status: "cancelled" })
    .where(and(eq(operatorPendingActionsTable.id, live.id), eq(operatorPendingActionsTable.status, "pending")));
  return true;
}

/** Member said no (or changed the subject with a clear cancel): drop
    the open proposal. Returns true when one was cancelled. */
export async function cancelPendingAction(userId: string): Promise<boolean> {
  return cancelLivePending(userId);
}

/* ── Daily cap ──────────────────────────────────────────────────────── */

function startOfTodayUtc(): number {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime();
}

/** Today's completed charged actions for one member (the cap count).
    Read + counted in code so the rule is identical everywhere. */
export async function countChargedActionsToday(userId: string): Promise<number> {
  const rows = await db
    .select()
    .from(operatorActionsTable)
    .where(eq(operatorActionsTable.userId, userId));
  const since = startOfTodayUtc();
  return rows.filter(
    (r) => r.result === "done" && (r.priceCharged ?? 0) > 0 && new Date(r.createdAt).getTime() >= since,
  ).length;
}

/* ── The executor ───────────────────────────────────────────────────── */

export async function executeAction(input: ExecuteInput): Promise<ExecutorOutcome> {
  const tool = getTool(input.toolId);
  if (!tool) {
    /* No registry row → no action exists. Not audited (see header). */
    return {
      status: "refused",
      toolId: input.toolId,
      reason: "unknown_tool",
      replyText: "I can't do that one yet — but I can walk you through it step by step.",
    };
  }

  const args = input.args ?? {};
  const admin = tool.tier === 4 && isOperatorAdminEmail(input.userEmail);
  const auditBase = {
    userId: input.userId,
    /* The admin email rides the row only when the caller IS one —
       a refused non-admin attempt records the member, not an admin. */
    adminEmail: admin ? (input.userEmail ?? null) : null,
    tier: tool.tier,
    toolId: tool.id,
    summary: tool.name,
    channel: input.channel,
  };

  /* Gate 1 — the kill switch stills every hand. */
  if (!operatorHandsEnabled()) {
    await writeAudit({ ...auditBase, result: "refused", resultReason: "hands_disabled" });
    return refusedOutcome(tool, "hands_disabled",
      "My hands are switched off right now — I can still answer questions and walk you through anything, step by step.");
  }

  /* Gate 2 — Tier 4 authority: admin session or nothing runs. The
     refusal leaks nothing about any target (design §2). */
  if (tool.tier === 4 && !admin) {
    await writeAudit({ ...auditBase, result: "refused", resultReason: "not_admin" });
    return refusedOutcome(tool, "not_admin",
      "That's the King's call, not one I can take from you. I can answer questions, guide you, or file a report for a human to look at.");
  }

  /* Gate 3 — charged tools: confirmation + cap, before any rail moves. */
  let runArgs = args;
  if (toolIsCharged(tool)) {
    if (!input.pendingId) {
      await writeAudit({ ...auditBase, result: "refused", resultReason: "no_confirmation" });
      return refusedOutcome(tool, "no_confirmation",
        `That one costs ${tool.priceVb} Visual Bucs, so I need your yes first — ask me again and I'll put the price in front of you to confirm.`);
    }
    const gate = await validateConfirmation(input, tool);
    if (!gate.ok) {
      await writeAudit({ ...auditBase, result: "refused", resultReason: gate.reason, priceQuoted: gate.priceQuoted ?? tool.priceVb });
      return refusedOutcome(tool, gate.reason, gate.replyText, gate.priceQuoted ?? tool.priceVb);
    }
    runArgs = gate.args;
    const chargedToday = await countChargedActionsToday(input.userId);
    if (chargedToday >= OPERATOR_DAILY_CHARGED_CAP) {
      await writeAudit({ ...auditBase, result: "refused", resultReason: "daily_cap", priceQuoted: tool.priceVb });
      return refusedOutcome(tool, "daily_cap",
        `You've hit today's cap of ${OPERATOR_DAILY_CHARGED_CAP} actions run through me — the site itself has no such cap, so the pages will still do it, or we pick this up tomorrow.`);
    }
    /* Consume exactly once, guarded on status='pending': a replay or
       a race finds no row to consume and refuses. Consumption happens
       only after every other gate has passed, so a refusal never
       burns the member's confirmation. */
    const consumed = await db
      .update(operatorPendingActionsTable)
      .set({ status: "consumed", consumedAt: new Date() })
      .where(and(eq(operatorPendingActionsTable.id, gate.pending.id), eq(operatorPendingActionsTable.status, "pending")))
      .returning();
    if (consumed.length === 0) {
      await writeAudit({ ...auditBase, result: "refused", resultReason: "confirmation_replayed", priceQuoted: gate.pending.priceQuoted });
      return refusedOutcome(tool, "confirmation_replayed",
        "That confirmation was already used — one yes runs one action. Ask me again and I'll set it up fresh.", gate.pending.priceQuoted);
    }
  }

  /* Run the rail AS THE CALLER and audit from ITS result. */
  try {
    const result = await tool.handler({
      userId: input.userId,
      userEmail: input.userEmail,
      args: runArgs,
      /* One idempotency key per consumed confirmation, for rails
         that accept a client key (Lane E) — the second wall against
         a double charge, behind this executor's single-use consume. */
      idempotencyKey: input.pendingId ? `operator:${input.pendingId}` : null,
    });
    await writeAudit({
      ...auditBase,
      summary: result.summary || tool.name,
      target: result.target ?? null,
      priceQuoted: toolIsCharged(tool) ? tool.priceVb : null,
      priceCharged: result.priceCharged ?? (toolIsCharged(tool) ? tool.priceVb : null),
      idempotencyKey: result.idempotencyKey ?? null,
      result: "done",
    });
    return {
      status: "done",
      toolId: tool.id,
      replyText: result.replyText,
      priceQuoted: toolIsCharged(tool) ? tool.priceVb : null,
      priceCharged: result.priceCharged ?? (toolIsCharged(tool) ? tool.priceVb : null),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await writeAudit({
      ...auditBase,
      priceQuoted: toolIsCharged(tool) ? tool.priceVb : null,
      result: "failed",
      resultReason: message.slice(0, 300),
    });
    logger.warn({ err, toolId: tool.id }, "[operator] tool handler failed");
    return {
      status: "failed",
      toolId: tool.id,
      reason: "handler_failed",
      replyText: "That didn't go through on my end — nothing was changed. Give it another try, or open the page and I'll walk you through it.",
      priceQuoted: toolIsCharged(tool) ? tool.priceVb : null,
    };
  }
}

type ConsumeGate =
  | { ok: true; pending: OperatorPendingAction; args: Record<string, unknown> }
  | { ok: false; reason: string; replyText: string; priceQuoted?: number };

/** Validate the pending row a confirmation points at — WITHOUT
    consuming it (consumption is the guarded update in executeAction,
    after the cap gate). Every failure here is an honest refusal. */
async function validateConfirmation(
  input: ExecuteInput,
  tool: OperatorTool,
): Promise<ConsumeGate> {
  const rows = await db
    .select()
    .from(operatorPendingActionsTable)
    .where(eq(operatorPendingActionsTable.id, input.pendingId!))
    .limit(1);
  const pending = rows[0];
  if (!pending || pending.userId !== input.userId || pending.toolId !== tool.id) {
    return { ok: false, reason: "no_confirmation", replyText: "I don't have that confirmation on file anymore — ask me again and I'll set it up fresh." };
  }
  if (pending.status === "consumed") {
    return { ok: false, reason: "confirmation_replayed", priceQuoted: pending.priceQuoted, replyText: "That confirmation was already used — one yes runs one action. Ask me again and I'll set it up fresh." };
  }
  if (pending.status === "cancelled") {
    return { ok: false, reason: "confirmation_cancelled", priceQuoted: pending.priceQuoted, replyText: "That one was cancelled — nothing ran. Ask me again whenever you're ready." };
  }
  if (pending.status === "expired" || new Date(pending.expiresAt).getTime() <= Date.now()) {
    if (pending.status === "pending") {
      await db.update(operatorPendingActionsTable).set({ status: "expired" }).where(eq(operatorPendingActionsTable.id, pending.id));
    }
    return { ok: false, reason: "confirmation_expired", priceQuoted: pending.priceQuoted, replyText: "That confirmation expired — prices only hold for a few minutes so nobody gets charged a stale quote. Ask me again and I'll set it up fresh." };
  }
  /* What was confirmed is what runs: caller-supplied args that differ
     from the confirmed args refuse, and a registry price that moved
     since the quote refuses too. */
  if (input.args && Object.keys(input.args).length > 0 && hashOperatorArgs(input.args) !== pending.argsHash) {
    return { ok: false, reason: "confirmation_mismatch", priceQuoted: pending.priceQuoted, replyText: "That confirmation was for a different request — I won't swap the details after your yes. Ask me again and I'll set up exactly what you want." };
  }
  if (pending.priceQuoted !== tool.priceVb) {
    return { ok: false, reason: "confirmation_mismatch", priceQuoted: pending.priceQuoted, replyText: `The price moved since I quoted it — it's ${tool.priceVb} Visual Bucs now. Ask me again and I'll put the current price in front of you.` };
  }
  return { ok: true, pending, args: (pending.args as Record<string, unknown>) ?? {} };
}

/* ── Readbacks ──────────────────────────────────────────────────────── */

/** Admin bench read: recent actions across members, newest first. */
export async function listOperatorActions(limit = 50): Promise<OperatorAction[]> {
  return db
    .select()
    .from(operatorActionsTable)
    .orderBy(desc(operatorActionsTable.createdAt))
    .limit(Math.min(Math.max(limit, 1), 200));
}

/** Member self-readback ("what did you do for me"): the caller's OWN
    rows only, newest first. There is no parameter that widens this. */
export async function listMyOperatorActions(userId: string, limit = 50): Promise<OperatorAction[]> {
  return db
    .select()
    .from(operatorActionsTable)
    .where(eq(operatorActionsTable.userId, userId))
    .orderBy(desc(operatorActionsTable.createdAt))
    .limit(Math.min(Math.max(limit, 1), 200));
}
