/* ─── Cloud Operator Phase 2 — the tool catalog (pure metadata) ────────
   The fixed list of things Thy Cheat Code's hands can do. This module
   is METADATA ONLY — ids, tiers, plain-words names, and prices. The
   handlers themselves live in lib/operator-tools.ts; the server
   executor that runs them is lib/operator-executor.ts.

   PRICE DISCIPLINE: a tool's price is either null (free — reads,
   doors, free writes) or a number imported from the same code
   constant the rail charges (never hand-typed here). Several rail
   prices are env-overridable constants, so the imports below reach
   the rail modules for the CONSTANTS only — never their handlers —
   and a tripwire test pins every priceVb to the rail's live value.
   The Phase 1 no-invention guard keeps covering model-quoted
   figures; quotes the SERVER composes come from this catalog,
   which is code.

   TIERS (design §1, safe build order):
     0 reads · 1 doors · 2 free writes · 3 charged · 4 admin-only. */

import { GEN45_CREDIT_COST } from "../routes/generate/clip-pricing";
import { creditCostForLength } from "../routes/generate/music-audio";
import { PUBLISH_COST } from "../routes/bio-pages";
import { BRAND_KIT_COST } from "../routes/generate/brand-kit";
import { HEADSHOT_CREDITS } from "../routes/generate/headshot-studio";
import { STREAM_PACK_CREDIT_COST } from "../routes/generate/stream-pack";
import {
  UGC_PERSONA_CREDIT_COST,
  UGC_VIDEO_CREDIT_COST,
} from "../routes/ugc-ads";

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

/** Lane A shipped exactly ONE live tool — the Tier-0 balance proof —
    so the whole pipeline (marker → executor → rail → audit → reply)
    was provable end to end. Lane B adds the rest of Tier 0 (the live
    reads) here; Lane D adds the Tier-2 free writes below; Lane F adds
    the Tier-4 admin-only World verbs below. */
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

  /* ── Lane E — Tier 3 charged rails ────────────────────────────────
     One charged step per confirmation; the rail's charge is the only
     charge. Song prices are DURATION-TIERED in the rail, so each tier
     is its own tool with its own fixed registry price — the price is
     computed by the rail's own creditCostForLength at the tier's
     ceiling, and the tool's validator refuses a length that belongs
     to a different tier before anything is quoted. */
  {
    id: "generate.song.short",
    tier: 3,
    name: "Make a Song — up to 1 minute",
    blurb:
      "the member asks you to make a song up to 1 minute long. Include {\"prompt\":\"what the song is about, in the member's words\",\"lengthSeconds\":the length they asked for, in seconds} in the marker. If they gave no subject or no length, ask instead of marking",
    priceVb: creditCostForLength(60_000),
  },
  {
    id: "generate.song.standard",
    tier: 3,
    name: "Make a Song — up to 3 minutes",
    blurb:
      "the member asks you to make a song over 1 minute and up to 3 minutes long. Include {\"prompt\":\"what the song is about, in the member's words\",\"lengthSeconds\":the length they asked for, in seconds} in the marker. If they gave no subject or no length, ask instead of marking",
    priceVb: creditCostForLength(180_000),
  },
  {
    id: "generate.song.long",
    tier: 3,
    name: "Make a Song — up to 5 minutes",
    blurb:
      "the member asks you to make a song over 3 minutes and up to 5 minutes long. Include {\"prompt\":\"what the song is about, in the member's words\",\"lengthSeconds\":the length they asked for, in seconds} in the marker. If they gave no subject or no length, ask instead of marking",
    priceVb: creditCostForLength(300_000),
  },
  {
    id: "generate.video",
    tier: 3,
    name: "Make a Video (Gen 4.5)",
    blurb:
      "the member asks you to make a video. Include {\"prompt\":\"what the video shows, in the member's words\"} in the marker. If they didn't say what the video should show, ask instead of marking",
    priceVb: GEN45_CREDIT_COST,
  },
  {
    id: "bio.publish",
    tier: 3,
    name: "Publish my bio page",
    blurb:
      "the member asks you to publish their bio page. Include {\"page\":\"the slug or name they mentioned\"} in the marker only if they named a specific page; otherwise mark with no details",
    priceVb: PUBLISH_COST,
  },
  {
    id: "brandkit.generate",
    tier: 3,
    name: "Make my Brand Kit",
    blurb:
      "the member asks you to make their brand kit. Include {\"brandName\":\"their brand or artist name\",\"vibe\":\"the vibe they want\"} in the marker, plus \"industry\" if they named one. If they gave no brand name or no vibe, ask instead of marking",
    priceVb: BRAND_KIT_COST,
  },
  {
    id: "headshot.generate",
    tier: 3,
    name: "Make a Headshot",
    blurb:
      "the member asks you to make a headshot. Include {\"preset\":\"studio, stage, street, or luxury\"} in the marker if they picked a look, or {\"promptText\":\"the look they described\"} if they described one in their own words; mark with no details for the automatic look",
    priceVb: HEADSHOT_CREDITS,
  },
  {
    id: "streampack.asset",
    tier: 3,
    name: "Make a Stream Graphic",
    blurb:
      "the member asks you to make ONE stream graphic (one asset per ask). Include {\"asset\":\"the asset key\",\"channelName\":\"their channel name\"} in the marker. Asset keys: screen-starting (starting-soon screen), screen-brb (be-right-back screen), screen-ending (ending screen), webcam-frame, chat-frame, alert-follower, alert-subscriber, alert-donation, panel-about, panel-rules, panel-schedule, panel-socials. If they didn't say which graphic or give a channel name, ask instead of marking",
    priceVb: STREAM_PACK_CREDIT_COST,
  },
  {
    id: "ugc.video",
    tier: 3,
    name: "Make my UGC Product Ad",
    blurb:
      "the member asks you to generate the video for their UGC product ad. If they name an ad they already set up, mark with no details and the server finds it. To set up a new one in the same ask, include {\"productName\":\"the product\",\"style\":\"unboxing, honest-review, problem-fix, or grwm\",\"script\":{\"hook\":\"the opening line\",\"lines\":[\"spoken lines\"],\"cta\":\"the call to action\"}} — only with details the member actually gave; never write a script they didn't give you. If pieces are missing, ask instead of marking",
    priceVb: UGC_VIDEO_CREDIT_COST,
  },
  {
    id: "ugc.persona",
    tier: 3,
    name: "Make a UGC Persona",
    blurb:
      "the member asks you to create a UGC persona (the on-camera face for their product ads). Include {\"description\":\"who the persona is, in the member's words\"} in the marker. If they didn't describe the persona, ask instead of marking",
    priceVb: UGC_PERSONA_CREDIT_COST,
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
