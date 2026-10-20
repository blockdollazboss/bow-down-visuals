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

   Lane A registered exactly one tool: the Tier-0 balance proof.
   Lane B adds the rest of Tier 0 beside it — earnings, quests,
   palace presence, Court Season standings — each reading the
   member's own live data through the existing rails (shared
   readers/builders, never parallel queries). Two rails live in
   route modules (the earnings readers, the mounted palace), so
   those two handlers reach them by dynamic import: the layering
   stays one-directional (routes import lib, never the reverse at
   load time) and no load-order cycle can form. Lane D's Tier-2 free
   writes live in lib/operator-tools-tier2.ts and merge in below. */

import { getCreditBalance } from "./credits";
import { getDailyQuestsStatus, dbDailyQuestStore } from "./daily-quests";
import { dbQuestPoolStore } from "./quest-pool";
import { getQuestsEnabled } from "./retention";
import {
  currentSeasonStandings,
  dbCourtSeasonStore,
  seasonForDate,
} from "./world-court-season";
import { TIER2_HANDLERS } from "./operator-tools-tier2";
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

/** Cents → the way a person says dollars: "$45" when whole,
    "$45.50" when not. The figure is always the rail's cents,
    only the rendering is rounded — never the value. */
function fmtUsd(cents: number): string {
  const dollars = cents / 100;
  return Number.isInteger(dollars)
    ? `$${dollars.toLocaleString("en-US")}`
    : `$${dollars.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
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

  /* Tier 0: the unified earnings picture — the SAME per-source
     readers GET /api/earnings serves (routes/earnings, exported
     for this caller), with the route's own discipline: each source
     settles on its own, a failed source is reported as a partial
     picture (never folded in as a zero), tips stay in Visual Bucs
     (never added to the dollar total), and tip-jar pledges are
     pending payment, never earnings. If EVERY source fails, the
     handler throws and the executor answers an honest failure —
     there is no number to report. */
  "earnings.summary": async (ctx) => {
    const earnings = await import("../routes/earnings");
    const settle = async <T,>(fn: () => Promise<T>): Promise<T | null> => {
      try {
        return await fn();
      } catch {
        return null;
      }
    };
    const [store, memb, deals, tip] = await Promise.all([
      settle(() => earnings.storeSales(ctx.userId)),
      settle(() => earnings.memberships(ctx.userId)),
      settle(() => earnings.brandDeals(ctx.userId)),
      settle(() => earnings.tips(ctx.userId)),
    ]);
    if (!store && !memb && !deals && !tip) {
      throw new Error("earnings summary: every source failed to load");
    }
    const partial = !store || !memb || !deals || !tip;
    const totalCents = (store?.totalCents ?? 0) + (memb?.totalCents ?? 0) + (deals?.totalCents ?? 0);
    const tipsVb = tip?.streamTipsVb ?? 0;
    const pendingCount = tip?.tipJarPendingCount ?? 0;
    const loadedCount =
      (store?.count ?? 0) + (memb?.count ?? 0) + (deals?.count ?? 0) + (tip?.streamTipCount ?? 0);

    if (totalCents === 0 && tipsVb === 0 && loadedCount === 0 && pendingCount === 0) {
      return {
        summary: "Checked earnings summary",
        replyText: partial
          ? "Nothing is showing on the parts of your earnings I could load — and one part wouldn't answer just now, so check your Earnings page for the full picture. 🦈"
          : "Nothing on the books yet — no store sales, memberships, brand deals, or credited tips so far. They all land on your Earnings page the moment they happen. 🦈",
      };
    }

    const parts: string[] = [];
    if (store && store.totalCents > 0) parts.push(`${fmtUsd(store.totalCents)} from store sales`);
    if (memb && memb.totalCents > 0) parts.push(`${fmtUsd(memb.totalCents)} from memberships`);
    if (deals && deals.totalCents > 0) parts.push(`${fmtUsd(deals.totalCents)} from brand deals`);
    let reply = `You've earned ${fmtUsd(totalCents)} so far`;
    if (parts.length > 0) reply += ` — ${parts.join(", ")}`;
    reply += ".";
    if (tip && tipsVb > 0) {
      reply += ` Plus ${fmtVb(tipsVb)} Visual Bucs in credited stream tips.`;
    }
    if (tip && pendingCount > 0) {
      reply += ` (${fmtUsd(tip.tipJarPendingCents)} in tip-jar pledges is still pending payment — not counted above.)`;
    }
    if (partial) {
      reply += " One part of the picture wouldn't load just now, so treat that as a floor — your Earnings page has the full ledger.";
    }
    return { summary: "Checked earnings summary", replyText: `${reply} 🦈` };
  },

  /* Tier 0: today's Daily Quest Trio + the shared weekly pool,
     through the daily-quests rail's own status read — the same
     getDailyQuestsStatus behind GET /api/retention/quests/daily,
     behind the same quests on/off switch the route honors. */
  "quests.status": async (ctx) => {
    const [enabled, status] = await Promise.all([
      getQuestsEnabled(ctx.userId),
      getDailyQuestsStatus(dbDailyQuestStore, dbQuestPoolStore, ctx.userId),
    ]);
    if (!enabled) {
      return {
        summary: "Checked today's quest status",
        replyText:
          "Quests are switched off in your settings — turn them on and today's trio will be waiting for you. 🦈",
      };
    }
    const lines = status.quests.map((q) =>
      q.claimed
        ? `${q.name}: claimed`
        : q.completed
          ? `${q.name}: finished — ready to claim (${q.rewardVb} Visual Bucs)`
          : `${q.name}: ${q.progress} of ${q.target} done`,
    );
    return {
      summary: "Checked today's quest status",
      replyText:
        `Today's trio — ${lines.join(" · ")}. ` +
        `You've banked ${fmtVb(status.marksTotal)} ${plural(status.marksTotal, "mark", "marks")}, ` +
        `and this week's shared reward pool has ${fmtVb(status.pool.remainingVb)} of ${fmtVb(status.pool.capVb)} Visual Bucs left. 🦈`,
    };
  },

  /* Tier 0: who's in the palace right now — the mounted palace's
     presence snapshot (lib/world-palace), which counts only peers
     the staleness sweep would not reap, deduplicated by presence
     key. Before the WS mount (or in a process without one) there
     is no palace to read: the directory route's own convention
     answers honest zeros, so the hall simply reads quiet. */
  "world.presence": async () => {
    const { getActiveWorldPalace } = await import("../routes/world");
    const palace = getActiveWorldPalace();
    const snapshot = palace
      ? palace.presenceSnapshot()
      : { total: 0, rooms: [] as Array<{ id: string; name: string; count: number; members: string[] }> };
    if (snapshot.total === 0) {
      return {
        summary: "Checked who's in the palace",
        replyText: "The palace is quiet right now — nobody's in any of the rooms. 🦈",
      };
    }
    const roomLines = snapshot.rooms
      .filter((r) => r.count > 0)
      .map((r) => {
        const spoken = r.members.slice(0, 3);
        const names = spoken.join(", ");
        const more = r.count > spoken.length ? "…" : "";
        return `${r.name} has ${r.count}${names ? ` (${names}${more})` : ""}`;
      });
    return {
      summary: "Checked who's in the palace",
      target: "The palace",
      replyText:
        `${fmtVb(snapshot.total)} ${plural(snapshot.total, "person is", "people are")} in the palace right now: ` +
        `${roomLines.join(" · ")}. 🦈`,
    };
  },

  /* Tier 0: the Court Season's live standings — the same computed
     read the Season Marks Wall serves (currentSeasonStandings over
     the court-season store), plus the caller's own placement when
     they're on the ladder but below the spoken top five. */
  "world.standings": async (ctx) => {
    const season = seasonForDate(new Date());
    const standings = await currentSeasonStandings(dbCourtSeasonStore, season);
    if (standings.length === 0) {
      return {
        summary: "Checked Court Season standings",
        replyText: `Court ${season.name} ${season.subtitle} is under way, but nobody has carved a mark yet — the court is wide open. 🦈`,
      };
    }
    const top = standings
      .slice(0, 5)
      .map((s) => `${s.place}. ${s.displayName} — ${fmtVb(s.points)} ${plural(s.points, "mark", "marks")}`)
      .join(" · ");
    let reply = `Live top of the court for ${season.name} ${season.subtitle}: ${top}.`;
    const own = standings.find((s) => s.userId === ctx.userId);
    if (own && own.place > 5) {
      reply += ` You're #${own.place} with ${fmtVb(own.points)} ${plural(own.points, "mark", "marks")}.`;
    }
    reply += " The full wall hangs in the Royal Court Chamber. 🦈";
    return { summary: "Checked Court Season standings", replyText: reply };
  },

  /* Tier 2 — free writes (Lane D, lib/operator-tools-tier2.ts). */
  ...TIER2_HANDLERS,
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
