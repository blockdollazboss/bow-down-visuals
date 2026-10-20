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
  /** Optional: the arguments the tool takes, shown to the model in
      the tool list so it can fill them from what the member actually
      said. Lane D added this with the first argument-carrying tools;
      the marker carries them as a JSON object after the tool id. */
  argsHint?: string;
}

/** Lane A shipped exactly ONE live tool — the Tier-0 balance proof — so
    the whole pipeline (marker → executor → rail → audit → reply) is
    provable end to end. Lanes B–F register theirs here as they land.
    Lane D adds the Tier-2 free writes below. */
export const OPERATOR_TOOL_DEFS: readonly OperatorToolDef[] = [
  {
    id: "credits.balance",
    tier: 0,
    name: "Check your Visual Bucs balance",
    blurb: "the member asks how many Visual Bucs they have, or what their balance is",
    priceVb: null,
  },
  /* ── Tier 2 — free writes (Lane D). Every one rides its rail's own
     write path (the extracted cores in the route modules), writes
     only the caller's own rows, and can be undone by the member in
     the product itself. NO deletes exist at this tier in v1. */
  {
    id: "drafts.reply",
    tier: 2,
    name: "Save a reply draft",
    blurb: "the member asks to save words as their reply draft on a post they name",
    priceVb: null,
    argsHint: "postId, body, tone (optional: hype, grateful, playful, professional)",
  },
  {
    id: "drafts.dm",
    tier: 2,
    name: "Save a DM reply draft",
    blurb: "the member asks to save words as their reply draft in a message thread they name",
    priceVb: null,
    argsHint: "conversationId, body",
  },
  {
    id: "posts.schedule",
    tier: 2,
    name: "Schedule a post",
    blurb: "the member asks to schedule a post with their media for an exact date and time",
    priceVb: null,
    argsHint: "content, mediaUrl, platform (instagram, tiktok, or facebook), scheduledAt (exact ISO date-time, e.g. 2026-10-24T17:00:00Z), hashtags (optional)",
  },
  {
    id: "storyboard.save",
    tier: 2,
    name: "Add to a storyboard",
    blurb: "the member asks to put a shot, note, or image idea into their storyboard",
    priceVb: null,
    argsHint: "boardTitle or boardId (optional — their latest board, or a new one), title, notes, imageUrl, imagePrompt (at least one of the four)",
  },
  {
    id: "settings.legacy-contact",
    tier: 2,
    name: "Set your legacy contact",
    blurb: "the member asks to set or update who inherits their account — a name and an email they give",
    priceVb: null,
    argsHint: "name, email, note (optional)",
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
