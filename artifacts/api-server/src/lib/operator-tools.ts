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

   Lane A registered the Tier-0 balance proof; Lane D's Tier-2 free
   writes live in lib/operator-tools-tier2.ts and merge in below. */

import { getCreditBalance } from "./credits";
import { TIER2_HANDLERS } from "./operator-tools-tier2";
import {
  OPERATOR_TOOL_DEFS,
  type OperatorToolDef,
} from "./operator-tool-catalog";

export interface OperatorToolContext {
  /** The caller's own user id, resolved from their session server-side. */
  userId: string;
  /** The caller's session email (Tier-4 audit carries the admin's). */
  userEmail?: string;
  /** Tool arguments the proposal carried ({} for no-arg tools). */
  args: Record<string, unknown>;
}

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
  /* Tier 2 — free writes (Lane D, lib/operator-tools-tier2.ts). */
  ...TIER2_HANDLERS,
};

export const OPERATOR_TOOLS: readonly OperatorTool[] = OPERATOR_TOOL_DEFS.map(
  (def) => {
    const handler = HANDLERS[def.id];
    if (!handler) {
      /* A catalog entry with no handler is a build error, not a
         runtime state — fail loud at module load, never in a chat. */
      throw new Error(`Operator tool "${def.id}" has a catalog entry but no handler.`);
    }
    return { ...def, handler };
  },
);

export function getTool(id: string): OperatorTool | undefined {
  return OPERATOR_TOOLS.find((t) => t.id === id);
}
