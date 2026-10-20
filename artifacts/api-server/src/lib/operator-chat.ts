/* ─── Cloud Operator Phase 2 — the chat-layer action protocol ────────
   Shared by routes/chat.ts and routes/free-chat.ts (ONE implementation,
   imported by both — the Phase 1 discipline; the two routes differ
   only in their model plumbing and auth, never in how actions work).

   THE PROTOCOL:
   - The model proposes an action by ending its reply with a marker
     line: [[DO:<tool-id>]] — and ONLY for tools in the live registry
     the prompt lists. The marker is machine-only; it never reaches
     the member.
   - processOperatorReply (post-model): a marker for a FREE tool
     executes immediately through the executor and the reply is the
     executor's code-composed outcome. A marker for a CHARGED tool
     creates a pending confirmation and the reply is a server-composed
     proposal quoting the registry price — the model's own words are
     discarded, so no quoted price can be invented.
   - processOperatorPreTurn (pre-model): when the member has a live
     pending confirmation, a clear "yes" consumes it (exactly once,
     through the executor) and a clear "no" cancels it — both WITHOUT
     a model call, so a confirmation can never be talked around.
     Anything else falls through to the model and the pending simply
     waits out its short expiry.
   - No session (guest surfaces) → actions refuse honestly with a
     sign-in line; nothing executes, nothing is audited (there is no
     member to audit as).

   Replies this module composes are CODE-authored from rail results,
   so the Phase 1 findInventedPrice guard does not apply to them —
   the guard covers model-authored text, and it still runs on every
   model reply that carries no action marker. */

import type { OperatorChannel } from "@workspace/db";
import { getTool } from "./operator-tools";
import { toolIsCharged } from "./operator-tool-catalog";
import {
  cancelPendingAction,
  executeAction,
  getLivePending,
  proposeAction,
  type ExecutorOutcome,
} from "./operator-executor";

export interface OperatorTurnResult {
  replyText: string;
  action: {
    toolId: string;
    status: ExecutorStatus | "proposed" | "cancelled";
    reason?: string;
    priceQuoted?: number | null;
    priceCharged?: number | null;
  };
}

type ExecutorStatus = ExecutorOutcome["status"];

/* ── The marker ───────────────────────────────────────────────────────
   [[DO:<tool-id>]] or, for tools that take details from the member's
   message (Lane E), [[DO:<tool-id> {"prompt":"…","lengthSeconds":45}]].
   The args are JSON the model copies out of the member's own words;
   the server validates them in the executor (a tool with required
   args missing proposes nothing and asks). A small hand parser
   (not a regex) so nested JSON — a UGC script object — survives. */

const MARKER_OPEN = "[[DO:";

export function extractActionMarker(
  reply: string,
): { toolId: string; args: Record<string, unknown> } | null {
  const start = reply.indexOf(MARKER_OPEN);
  if (start < 0) return null;
  let i = start + MARKER_OPEN.length;
  const skipWs = () => {
    while (i < reply.length && /\s/.test(reply[i]!)) i++;
  };
  skipWs();
  const idStart = i;
  while (i < reply.length && /[a-zA-Z0-9_.-]/.test(reply[i]!)) i++;
  if (i === idStart) return null;
  const toolId = reply.slice(idStart, i).toLowerCase();
  skipWs();

  let args: Record<string, unknown> = {};
  if (reply[i] === "{") {
    /* Balanced-brace scan, string-aware, to the matching close. */
    let depth = 0;
    let inStr = false;
    let esc = false;
    let end = -1;
    for (let j = i; j < reply.length; j++) {
      const ch = reply[j]!;
      if (inStr) {
        if (esc) esc = false;
        else if (ch === "\\") esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          end = j;
          break;
        }
      }
    }
    if (end < 0) return { toolId, args };
    try {
      const parsed: unknown = JSON.parse(reply.slice(i, end + 1));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        args = parsed as Record<string, unknown>;
      }
    } catch {
      /* Malformed args JSON: behave as if no args were given — a
         tool that needs them will ask; one that doesn't still runs. */
      args = {};
    }
    i = end + 1;
    skipWs();
  }

  if (reply.slice(i, i + 2) !== "]]") return null;
  return { toolId, args };
}

/* ── Confirmation / cancellation wording ────────────────────────────── */

/* Deliberately tight: a confirmation is a short, unambiguous yes.
   Anything longer goes to the model as a normal message. */
const CONFIRM_RE = /^(yes|yeah|yep|yup|confirm|confirmed|go|go ahead|do it|please do|sure|ok|okay)[.! ]*$/i;
const CANCEL_RE = /^(no|nope|cancel|stop|never ?mind|forget it|don't|do not)[.! ]*$/i;

export function isConfirmationMessage(message: string): boolean {
  const t = message.trim();
  return t.length <= 32 && CONFIRM_RE.test(t);
}

export function isCancellationMessage(message: string): boolean {
  const t = message.trim();
  return t.length <= 32 && CANCEL_RE.test(t);
}

/* ── Composed texts ─────────────────────────────────────────────────── */

const NEEDS_SIGN_IN =
  "I can only run that for signed-in members — sign in, ask me again, and I'll do it right here. 🦈";
const CANT_DO_YET =
  "I can't do that one yet — but I can walk you through it step by step. My hands are growing one tool at a time. 🦈";
const HANDS_OFF =
  "My hands are switched off right now — I can still answer questions and walk you through anything, step by step. 🦈";
const CANCELLED =
  "Dropped it — nothing ran and nothing was charged. 🦈";

function proposalText(name: string, priceVb: number): string {
  return `${name} — ${priceVb.toLocaleString("en-US")} Visual Bucs. Say "yes" and I'll run it, or "no" to drop it. Nothing is charged until you say yes.`;
}

/* ── Pre-model turn: a live pending confirmation gets first claim ───── */

export async function processOperatorPreTurn(input: {
  userId?: string;
  userEmail?: string;
  channel: OperatorChannel;
  message: string;
}): Promise<OperatorTurnResult | null> {
  if (!input.userId) return null;
  const pending = await getLivePending(input.userId);
  if (!pending) return null;

  if (isCancellationMessage(input.message)) {
    await cancelPendingAction(input.userId);
    return {
      replyText: CANCELLED,
      action: { toolId: pending.toolId, status: "cancelled", reason: "cancelled_by_member" },
    };
  }
  if (!isConfirmationMessage(input.message)) return null;

  const outcome = await executeAction({
    userId: input.userId,
    userEmail: input.userEmail,
    toolId: pending.toolId,
    args: (pending.args as Record<string, unknown>) ?? {},
    channel: input.channel,
    pendingId: pending.id,
  });
  return {
    replyText: outcome.replyText,
    action: {
      toolId: outcome.toolId,
      status: outcome.status,
      reason: outcome.reason,
      priceQuoted: outcome.priceQuoted,
      priceCharged: outcome.priceCharged,
    },
  };
}

/* ── Post-model turn: a marker in the model's reply ─────────────────── */

export async function processOperatorReply(input: {
  userId?: string;
  userEmail?: string;
  channel: OperatorChannel;
  modelReply: string;
}): Promise<OperatorTurnResult | null> {
  const marker = extractActionMarker(input.modelReply);
  if (!marker) return null;

  const tool = getTool(marker.toolId);
  if (!tool) {
    return { replyText: CANT_DO_YET, action: { toolId: marker.toolId, status: "refused", reason: "unknown_tool" } };
  }
  if (!input.userId) {
    return { replyText: NEEDS_SIGN_IN, action: { toolId: tool.id, status: "refused", reason: "needs_sign_in" } };
  }

  if (!toolIsCharged(tool)) {
    const outcome = await executeAction({
      userId: input.userId,
      userEmail: input.userEmail,
      toolId: tool.id,
      args: marker.args,
      channel: input.channel,
    });
    return {
      replyText: outcome.replyText,
      action: {
        toolId: outcome.toolId,
        status: outcome.status,
        reason: outcome.reason,
        priceQuoted: outcome.priceQuoted,
        priceCharged: outcome.priceCharged,
      },
    };
  }

  /* Charged: this turn only PROPOSES. The proposal text is composed
     here from the registry price — the model's words never quote it.
     The marker's args ride along: the executor validates them first,
     and an incomplete request proposes nothing — the member is asked
     for the missing detail (missing_args) instead of being quoted. */
  const proposal = await proposeAction({
    userId: input.userId,
    toolId: tool.id,
    args: marker.args,
    channel: input.channel,
  });
  if (proposal.status !== "proposed") {
    return {
      replyText:
        proposal.reason === "hands_disabled"
          ? HANDS_OFF
          : proposal.reason === "missing_args" && proposal.askText
            ? proposal.askText
            : CANT_DO_YET,
      action: { toolId: tool.id, status: "refused", reason: proposal.reason },
    };
  }
  return {
    replyText: proposalText(tool.name, proposal.priceQuoted),
    action: { toolId: tool.id, status: "proposed", priceQuoted: proposal.priceQuoted },
  };
}
