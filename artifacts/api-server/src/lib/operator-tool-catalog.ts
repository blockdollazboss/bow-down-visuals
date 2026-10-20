/* ─── Cloud Operator Phase 2 — the tool catalog (pure metadata) ────────
   The fixed list of things Thy Cheat Code's hands can do. This module
   is DATA ONLY — ids, tiers, plain-words names, and prices read from
   code constants — so the prompt builder (lib/ai-chat-assistant.ts)
   can quote the live tool list without importing any handler or rail.
   The handlers themselves live in lib/operator-tools.ts; the server
   executor that runs them is lib/operator-executor.ts.

   PRICE DISCIPLINE: a tool's price is either null (free — reads,
   doors, free writes) or a number imported from the same code
   constant the rail charges (never hand-typed here). The Phase 1
   no-invention guard keeps covering model-quoted figures; quotes the
   SERVER composes come from this catalog, which is code.

   TIERS (design §1, safe build order):
     0 reads · 1 doors · 2 free writes · 3 charged · 4 admin-only. */

export type OperatorTier = 0 | 1 | 2 | 3 | 4;

export interface OperatorToolDef {
  /** Registry id, e.g. "credits.balance". Stable — audit rows carry it. */
  id: string;
  tier: OperatorTier;
  /** Plain-words name, the way the operator says it. */
  name: string;
  /** What the member asks to get this tool. Used in the prompt's tool list. */
  blurb: string;
  /** Visual Bucs the rail charges, from the rail's own code constant.
      null = free. A priced tool NEVER runs without a consumed
      confirmation (the executor enforces it, not the prompt). */
  priceVb: number | null;
}

/** Lane A shipped exactly ONE live tool — the Tier-0 balance proof —
    so the whole pipeline (marker → executor → rail → audit → reply)
    was provable end to end. Lane B adds the rest of Tier 0 (the live
    reads) here; lanes C–F register theirs as they land. */
export const OPERATOR_TOOL_DEFS: readonly OperatorToolDef[] = [
  {
    id: "credits.balance",
    tier: 0,
    name: "Check your Visual Bucs balance",
    blurb: "the member asks how many Visual Bucs they have, or what their balance is",
    priceVb: null,
  },
  {
    id: "earnings.summary",
    tier: 0,
    name: "Check your earnings",
    blurb: "the member asks what they have earned, how much money they have made, or what their store sales, memberships, brand deals and tips add up to",
    priceVb: null,
  },
  {
    id: "quests.status",
    tier: 0,
    name: "See today's quests",
    blurb: "the member asks where their quests are at, what today's quest trio is, or how their quest progress and marks look",
    priceVb: null,
  },
  {
    id: "world.presence",
    tier: 0,
    name: "See who's in the palace",
    blurb: "the member asks who is in the hall or the World right now, or how many people are around in the palace",
    priceVb: null,
  },
  {
    id: "world.standings",
    tier: 0,
    name: "See the Court Season standings",
    blurb: "the member asks who is winning or leading the Court Season, or what the current season marks standings are",
    priceVb: null,
  },
];

export function getToolDef(id: string): OperatorToolDef | undefined {
  return OPERATOR_TOOL_DEFS.find((t) => t.id === id);
}

/** A tool is "charged" when its rail charges — Tier 3 by construction,
    but the executor keys on the price, not the tier number, so a priced
    tool in any tier still demands a confirmation. */
export function toolIsCharged(def: OperatorToolDef): boolean {
  return def.priceVb !== null && def.priceVb > 0;
}
