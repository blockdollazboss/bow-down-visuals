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
