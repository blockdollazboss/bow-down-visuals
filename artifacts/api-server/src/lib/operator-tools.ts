/* ─── Cloud Operator Phase 2 — the tool registry (handlers) ───────────
   Each catalog entry (lib/operator-tool-catalog.ts) gets ONE handler
   here. A handler runs AS the caller: the executor passes the caller's
   own session identity, and every rail underneath owner-scopes its
   work, so a handler can never reach into somebody else's account.

   A handler returns a ToolRunResult built from the RAIL's real
   outcome — the executor writes the audit row from this result and
   composes the member's reply from `replyText`, which the handler
   builds out of rail data (never model text). If a handler throws,
   the executor audits `failed` with the error and the member hears
   an honest failure, never a claim of success.

   Lane A registers exactly one tool: the Tier-0 balance proof. */

import { getCreditBalance } from "./credits";
import {
  OPERATOR_TOOL_DEFS,
  type OperatorToolDef,
} from "./operator-tool-catalog";
import {
  TIER3_HANDLERS,
  TIER3_VALIDATORS,
} from "./operator-tools-tier3";

export interface OperatorToolContext {
  /** The caller's own user id, resolved from their session server-side. */
  userId: string;
  /** The caller's session email (Tier-4 audit carries the admin's). */
  userEmail?: string;
  /** Tool arguments the proposal carried ({} for no-arg tools). */
  args: Record<string, unknown>;
  /** One key per consumed confirmation ("operator:<pendingId>"),
      handed to rails that accept a client idempotency key so a
      confirmed action can never double-charge at the rail either —
      the executor's single-use consumption is the first wall, this
      key is the second. Null for unconfirmed (free) executions. */
  idempotencyKey?: string | null;
}

/** Proposal-time argument check (Lane E). A charged tool whose
    arguments come from the member's message validates them BEFORE a
    confirmation is created: an incomplete request proposes nothing
    and the member is asked for the missing piece (askText) — the
    operator never invents a prompt, a length, or a product. On
    success the validator returns the NORMALIZED args that get baked
    into the pending row (and its hash): what was confirmed is
    exactly what runs. */
export type OperatorArgsVerdict =
  | { ok: true; args: Record<string, unknown> }
  | { ok: false; askText: string };

export interface ToolRunResult {
  /** Plain-words summary for the audit row, e.g. "Checked Visual Bucs balance". */
  summary: string;
  /** Optional target descriptor (post, person, room) for the audit row. */
  target?: string | null;
  /** VB the rail actually charged (charged tools only). 0 when the
      rail charged and refunded — say so in resultReason. */
  priceCharged?: number | null;
  /** The rail charge's idempotency key, when the rail produced one. */
  idempotencyKey?: string | null;
  /** The member-facing reply, composed HERE from rail data. */
  replyText: string;
}

export interface OperatorTool extends OperatorToolDef {
  handler: (ctx: OperatorToolContext) => Promise<ToolRunResult>;
  /** Optional proposal-time argument validation/normalization. */
  validateArgs?: (input: {
    userId: string;
    args: Record<string, unknown>;
  }) => Promise<OperatorArgsVerdict>;
}

function fmtVb(n: number): string {
  return n.toLocaleString("en-US");
}

const HANDLERS: Record<string, OperatorTool["handler"]> = {
  /* Tier 0 proof tool: the live balance, straight off the credits
     rail (profiles.credits — the same read requireAuth stamps onto
     every signed-in request). Free, no confirmation. */
  "credits.balance": async (ctx) => {
    const balance = await getCreditBalance(ctx.userId);
    return {
      summary: "Checked Visual Bucs balance",
      replyText: `You have ${fmtVb(balance)} Visual Bucs. 🦈`,
    };
  },

  /* Tier 3 charged rails (Lane E) — handlers + validators live in
     lib/operator-tools-tier3.ts and are merged in here so this file
     stays the one registry. */
  ...TIER3_HANDLERS,
};

const VALIDATORS: Record<string, NonNullable<OperatorTool["validateArgs"]>> = {
  ...TIER3_VALIDATORS,
};

function validatorFor(id: string): OperatorTool["validateArgs"] {
  return Object.prototype.hasOwnProperty.call(VALIDATORS, id) ? VALIDATORS[id] : undefined;
}

export const OPERATOR_TOOLS: readonly OperatorTool[] = OPERATOR_TOOL_DEFS.map(
  (def) => {
    const handler = HANDLERS[def.id];
    if (!handler) {
      /* A catalog entry with no handler is a build error, not a
         runtime state — fail loud at module load, never in a chat. */
      throw new Error(`Operator tool "${def.id}" has a catalog entry but no handler.`);
    }
    const validateArgs = validatorFor(def.id);
    return validateArgs ? { ...def, handler, validateArgs } : { ...def, handler };
  },
);

export function getTool(id: string): OperatorTool | undefined {
  return OPERATOR_TOOLS.find((t) => t.id === id);
}
