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
    Lane F adds the Tier-4 admin-only World verbs below. */
export const OPERATOR_TOOL_DEFS: readonly OperatorToolDef[] = [
  {
    id: "credits.balance",
    tier: 0,
    name: "Check your Visual Bucs balance",
    blurb: "the member asks how many Visual Bucs they have, or what their balance is",
    priceVb: null,
  },
  /* ── Tier 4 — admin-only authority (Lane F). The World's verbs,
     worked by Thy Cheat Code ONLY on an admin account's command:
     the executor's Gate 2 refuses every non-admin session (and
     everyone when ADMIN_EMAILS is unset) before a handler can
     run, and audits the attempt. He keeps the peace automatically
     (Lane G); he never punishes on his own judgment — every one
     of these fires only because an admin said so. ──────────── */
  {
    id: "world.kick",
    tier: 4,
    name: "Remove a person from the World",
    blurb: "an admin commands removing (kicking) a named person from the palace room they are standing in",
    priceVb: null,
    argsHint: "target (the person's display name, exactly as it shows in the World), room (optional — only to settle it when two people share the name)",
  },
  {
    id: "world.mute",
    tier: 4,
    name: "Mute or unmute a person in the World",
    blurb: "an admin commands muting or unmuting a named person's voice in the palace room they are standing in",
    priceVb: null,
    argsHint: "target (the person's display name), muted (true to mute, false to unmute — omit to mute), room (optional — only to settle it when two people share the name)",
  },
  {
    id: "world.herald",
    tier: 4,
    name: "Herald an announcement to the whole palace",
    blurb: "an admin commands an announcement spoken to every room in the palace at once",
    priceVb: null,
    argsHint: "text (the announcement, in the admin's own words)",
  },
  {
    id: "world.stage_promote",
    tier: 4,
    name: "Promote a listener to speaker on a stage",
    blurb: "an admin commands promoting a named listener to speaker in a stage room",
    priceVb: null,
    argsHint: "target (the person's display name)",
  },
  {
    id: "world.stage_demote",
    tier: 4,
    name: "Demote a speaker back to listener on a stage",
    blurb: "an admin commands demoting a named speaker back to listener in a stage room",
    priceVb: null,
    argsHint: "target (the person's display name)",
  },
  {
    id: "world.lock_person",
    tier: 4,
    name: "Lock a person out of a World room",
    blurb: "an admin commands locking a named member out of a World room for a time — they are removed now if they are standing in it, and the door refuses them until the time passes or an admin lifts the lock",
    priceVb: null,
    argsHint: "target (the person's display name), minutes (how long the lock lasts, from the admin's words — omit for 60), room (optional — the room to lock them out of; omit for the room they are standing in)",
  },
  {
    id: "world.unlock_person",
    tier: 4,
    name: "Lift a person's World room lock early",
    blurb: "an admin commands lifting a named member's room lock before its time is up",
    priceVb: null,
    argsHint: "target (the person's display name), room (optional — only when the person is locked out of more than one room)",
  },
  {
    id: "world.lock_room",
    tier: 4,
    name: "Lock a World room's door",
    blurb: "an admin commands locking a room's door — the people inside stay, nobody new joins, and only an admin account can still walk in",
    priceVb: null,
    argsHint: "room (the room's name, e.g. Music Hall, or its room id)",
  },
  {
    id: "world.unlock_room",
    tier: 4,
    name: "Unlock a World room's door",
    blurb: "an admin commands unlocking a room's door so people can join it again",
    priceVb: null,
    argsHint: "room (the room's name, e.g. Music Hall, or its room id)",
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
