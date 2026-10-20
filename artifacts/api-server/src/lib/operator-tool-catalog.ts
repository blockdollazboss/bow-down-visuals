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

/** Lane A ships exactly ONE live tool — the Tier-0 balance proof — so
    the whole pipeline (marker → executor → rail → audit → reply) is
    provable end to end. Lanes B–F register theirs here as they land. */
export const OPERATOR_TOOL_DEFS: readonly OperatorToolDef[] = [
  {
    id: "credits.balance",
    tier: 0,
    name: "Check your Visual Bucs balance",
    blurb: "the member asks how many Visual Bucs they have, or what their balance is",
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
