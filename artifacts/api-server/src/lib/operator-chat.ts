/* ─── Cloud Operator Phase 2 — the chat-layer action protocol ────────
   Shared by routes/chat.ts and routes/free-chat.ts (ONE implementation,
   imported by both — the Phase 1 discipline; the two routes differ
   only in their model plumbing and auth, never in how actions work).

   THE PROTOCOL:
   - The model proposes an action by ending its reply with a marker
     line: [[DO:<tool-id>]] — and ONLY for tools in the live registry
     the prompt lists. A tool that takes arguments carries them as a
     JSON object right after the id: [[DO:<tool-id> {"k":"v"}]]
     (Lane D). The arguments are data the member gave, never a second
     instruction channel: the executor re-validates everything
     through the rail, and an unparseable args object degrades to {}
     — which makes an argument-requiring handler refuse honestly
     rather than guess. The marker is machine-only; it never reaches
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
import { OPERATOR_TOOL_DEFS, toolIsCharged } from "./operator-tool-catalog";
import { findFeatures } from "./operator-knowledge";
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

/* ── Tier 1 doors (Phase 2 Lane C) ────────────────────────────────────
   A reply can carry a DOOR: a one-tap button under the answer that
   opens the exact desk/tab the answer just named. Doors are computed
   HERE, in the shared chat implementation, from the member's own
   message — both routes attach the result identically, and the model
   never supplies a URL (a model-invented path is exactly the failure
   the Phase 1 guard exists to stop).

   The contract:
   - A door exists ONLY when the knowledge base matches the message to
     a feature that carries a CONCRETE path. No match (or an empty
     path) → no doors at all.
   - A parameterized knowledge entry ("/artist/:slug", "/sponsors/:id")
     describes a page TEMPLATE, not a destination: a door built from
     one would carry the literal placeholder and open nothing real.
     Ranked matches are therefore walked in order and the first entry
     whose path has no ":param" segment supplies the door; when every
     match is a template, the reply carries no door. (The template
     entries still ground the answer's facts — they are knowledge,
     never destinations.)
   - The open door's path is the feature's knowledge-base path VERBATIM
     — deep links included (?tab= / ?panel= ride along untouched).
   - When the matched feature's page has a "Walk me through it" Guide
     (the KB carries guide data for 10 pages), a second door offers it:
     same destination — the guide lives on that page — with kind
     "guide", so the client lands the member there and starts the
     page's own tour (the thy-tour:start convention the in-page coach
     host uses). At most two doors ride a reply.
   - Doors are pure navigation: no state changes, nothing to confirm,
     and a signed-out member's door is a plain link — the site's normal
     sign-in gate answers, exactly like any link. */

export interface OperatorDoor {
  kind: "open" | "guide";
  label: string;
  path: string;
}

/** A knowledge path is a door destination only when it is concrete:
    no ":param" segment (the query string never carries one). */
function isConcretePath(path: string): boolean {
  return path
    .split("?")[0]!
    .split("/")
    .every((seg) => !seg.startsWith(":"));
}

export function buildReplyDoors(message: string): OperatorDoor[] {
  const top = findFeatures(message, 8).find(
    (f) => f.path && isConcretePath(f.path),
  );
  if (!top) return [];
  const doors: OperatorDoor[] = [
    { kind: "open", label: `Open ${top.name}`, path: top.path },
  ];
  if (top.guide) {
    doors.push({ kind: "guide", label: "Walk me through it", path: top.path });
  }
  return doors;
}

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

/* ── Deterministic intent (payfix operator-hands lane) ────────────────
   The marker path above depends on a model choosing to emit a marker —
   and the live widget's fallback brain (the knowledge-base composer)
   cannot emit one at all, so on that path the operator's hands were
   dead: page guides + doors, never a proposal (PASS 4, Oct 26). This
   layer recognizes CLEAR charged-action requests in code, before any
   model runs, and feeds them into the exact same proposeAction path
   the marker uses: registry price quoted by the server, validator
   asks when a detail the member never gave is missing, single-use
   confirmation, executor, same rails. It extracts ONLY what the
   member actually stated — never an invented prompt, length, name,
   or script. Ambiguous or informational phrasing returns null and
   the normal answer path runs untouched. */

export interface OperatorIntent {
  toolId: string;
  args: Record<string, unknown>;
}

function cleanPhrase(s: string): string {
  return s.replace(/\s+/g, " ").replace(/^[\s:—–-]+/, "").replace(/[\s.!?]+$/, "").trim();
}

/** A duration the member stated, in seconds ("30 seconds", "2 minutes",
    "45s", "a 3-minute song"). Null when none was stated. */
function statedSeconds(t: string): number | null {
  const m =
    t.match(/(\d+(?:\.\d+)?)\s*(seconds?|secs?|minutes?|mins?)\b/i) ??
    t.match(/(\d+(?:\.\d+)?)\s*-\s*(second|minute)\b/i) ??
    t.match(/\b(\d+(?:\.\d+)?)s\b/i);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  return /min/i.test(m[2] ?? "") ? Math.round(n * 60) : Math.round(n);
}

function stripDuration(t: string): string {
  return t
    .replace(/,?\s*\bfor\s+\d+(?:\.\d+)?\s*(seconds?|secs?|minutes?|mins?)\b/gi, "")
    .replace(/,?\s*\b\d+(?:\.\d+)?\s*-\s*(second|minute)\s+/gi, " ")
    .replace(/,?\s*\b\d+(?:\.\d+)?\s*(seconds?|secs?|minutes?|mins?)\b/gi, "")
    .replace(/,?\s*\b\d+(?:\.\d+)?s\b/gi, "");
}

/** Informational questions ("how do I…", "what does it cost…") are NOT
    orders — they keep the normal answer path. Direct asks ("can you
    make me…") are orders despite the question mark. */
function isImperativeAsk(t: string): boolean {
  if (/^(how|why|where|when)\b/i.test(t)) return false;
  if (/\bhow (do|can) i\b/i.test(t)) return false;
  if (/^(can|could|will|would) you\b/i.test(t)) return true;
  if (/^(please\b|make\b|create\b|generate\b|write\b|publish\b|run\b|build\b|do\b|give me\b|i want\b|i need\b|let'?s\b)/i.test(t)) return true;
  /* Bare noun orders: "SFX: thunder crash", "sound effect of rain". */
  if (/^(sfx|sound effect|song|video|bio|headshot|brand kit)\b/i.test(t)) return true;
  return false;
}

const SONG_TIERS = ["generate.song.short", "generate.song.standard", "generate.song.long"] as const;

function songIntent(t: string): OperatorIntent | null {
  if (!/\b(song|track)\b/i.test(t)) return null;
  const args: Record<string, unknown> = {};
  const seconds = statedSeconds(t);
  if (seconds !== null) args["lengthSeconds"] = seconds;
  const about = t.match(/\babout\s+(.+)$/i) ?? t.match(/\bsong\s*:\s*(.+)$/i);
  if (about) args["prompt"] = cleanPhrase(stripDuration(about[1]!));
  const tier = seconds === null || seconds <= 60 ? SONG_TIERS[0] : seconds <= 180 ? SONG_TIERS[1] : SONG_TIERS[2];
  return { toolId: tier, args };
}

function bioIntent(t: string): OperatorIntent | null {
  if (/\bpublish\b/i.test(t) && /\bbio\b/i.test(t)) {
    const page = t.match(/\bpublish\s+(?:my\s+)?(?:bio page\s+)?["“]?([a-z0-9-_ ]+?)["”]?\s*$/i);
    return { toolId: "bio.publish", args: page && !/^(it|my bio|the bio|bio)$/i.test(page[1]!.trim()) ? { page: cleanPhrase(page[1]!) } : {} };
  }
  if (!/\bbios?\b/i.test(t)) return null;
  const args: Record<string, unknown> = {};
  /* Personality segment: everything after the word personality/traits. */
  let head = t;
  const pers = t.match(/\b(?:personality|traits)\s*(?:is|:)?\s*(.+)$/i);
  if (pers) {
    args["personality"] = pers[1]!.split(/,|\band\b/i).map((x) => cleanPhrase(x)).filter(Boolean);
    head = t.slice(0, pers.index);
  }
  const forMatch = head.match(/\bfor\s+(?:a\s+|an\s+|the\s+)?(.+?)\s*$/i);
  if (forMatch) {
    const niche = cleanPhrase(forMatch[1]!.replace(/\bwith\s*$/, ""));
    if (niche && !/^(me|my)/i.test(niche)) args["niche"] = niche.replace(/^a\s+/i, "");
  }
  const handle = t.match(/@([a-z0-9_.]+)/i);
  if (handle) args["handle"] = `@${handle[1]}`;
  return { toolId: "bio.generate", args };
}

function sfxIntent(t: string): OperatorIntent | null {
  if (!/\b(sfx|sound effect|sound)\b/i.test(t)) return null;
  let prompt = "";
  const after = t.match(/\b(?:sfx|sound effect)\s*(?:of|for|:)?\s*(.+)$/i);
  const before = t.match(/\b(?:make|create|generate|run)\s+(?:me\s+)?(?:a\s+|an\s+|the\s+)?(.+?)\s+(?:sfx|sound effect|sound)\b/i);
  if (after && after[1] && !/^(effect|effects)$/i.test(after[1].trim())) prompt = after[1];
  else if (before) prompt = before[1]!;
  else if (/\bsound\b/i.test(t)) {
    const of = t.match(/\bsound\s+of\s+(.+)$/i);
    if (of) prompt = of[1]!;
  }
  if (!prompt) return { toolId: "sfx.generate", args: {} };
  const args: Record<string, unknown> = {};
  const seconds = statedSeconds(prompt);
  if (seconds !== null) args["durationSeconds"] = seconds;
  prompt = cleanPhrase(stripDuration(prompt));
  if (prompt) args["prompt"] = prompt;
  const cat: Array<[RegExp, string]> = [
    [/\b(boom|impact|slam|explosion|hit)\b/i, "impacts"],
    [/\bwhoosh|swoosh|fly-?by\b/i, "whooshes"],
    [/\briser|build-?up|rising\b/i, "risers"],
    [/\b(click|pop|notification|ui)\b/i, "ui"],
    [/\b(ambient|atmosphere|room tone|nature)\b/i, "ambient"],
    [/\b(footsteps?|foley)\b/i, "foley"],
  ];
  for (const [re, key] of cat) if (re.test(prompt)) { args["category"] = key; break; }
  return { toolId: "sfx.generate", args };
}

function videoIntent(t: string): OperatorIntent | null {
  if (!/\b(video|clip)\b/i.test(t) || /\bugc\b/i.test(t)) return null;
  const args: Record<string, unknown> = {};
  const m =
    t.match(/\b(?:video|clip)\s+(?:of|about|showing)\s+(.+)$/i) ??
    t.match(/\b(?:video|clip)\s*:\s*(.+)$/i);
  if (m) args["prompt"] = cleanPhrase(m[1]!);
  return { toolId: "generate.video", args };
}

function brandKitIntent(t: string): OperatorIntent | null {
  if (!/\bbrand kit\b/i.test(t)) return null;
  const args: Record<string, unknown> = {};
  let rest = cleanPhrase(t.slice(t.toLowerCase().indexOf("brand kit") + "brand kit".length));
  rest = rest.replace(/^for\s+/i, "");
  if (rest) {
    const vibeMatch = rest.match(/\bvibe\s*(?:is|:)\s*(.+)$/i);
    if (vibeMatch) {
      args["vibe"] = cleanPhrase(vibeMatch[1]!);
      rest = cleanPhrase(rest.slice(0, vibeMatch.index).replace(/,\s*$/, ""));
      if (rest) args["brandName"] = rest;
    } else {
      const parts = rest.split(",").map((x) => cleanPhrase(x)).filter(Boolean);
      if (parts[0]) args["brandName"] = parts[0];
      if (parts[1]) args["vibe"] = parts.slice(1).join(", ").replace(/\s+vibe$/i, "");
      else if (parts[0] && /\s+vibe$/i.test(parts[0])) args["brandName"] = parts[0].replace(/\s+vibe$/i, "");
    }
  }
  return { toolId: "brandkit.generate", args };
}

function headshotIntent(t: string): OperatorIntent | null {
  if (!/\bheadshot\b/i.test(t)) return null;
  const args: Record<string, unknown> = {};
  const preset = t.match(/\b(studio|stage|street|luxury)\b/i);
  if (preset) args["preset"] = preset[1]!.toLowerCase();
  return { toolId: "headshot.generate", args };
}

const STREAM_ASSET_PHRASES: Array<[RegExp, string]> = [
  [/starting[ -]?soon/i, "screen-starting"],
  [/be[ -]?right[ -]?back|\bbrb\b/i, "screen-brb"],
  [/ending screen|stream ending/i, "screen-ending"],
  [/webcam frame/i, "webcam-frame"],
  [/chat frame/i, "chat-frame"],
  [/follower alert/i, "alert-follower"],
  [/subscriber alert|sub alert/i, "alert-subscriber"],
  [/donation alert/i, "alert-donation"],
  [/about panel/i, "panel-about"],
  [/rules panel/i, "panel-rules"],
  [/schedule panel/i, "panel-schedule"],
  [/socials panel/i, "panel-socials"],
];

function streamPackIntent(t: string): OperatorIntent | null {
  if (!/\b(stream graphic|stream pack|starting|brb|webcam frame|chat frame|panel|alert)\b/i.test(t)) return null;
  if (!/\b(make|create|generate|stream)\b/i.test(t)) return null;
  const args: Record<string, unknown> = {};
  for (const [re, key] of STREAM_ASSET_PHRASES) if (re.test(t)) { args["asset"] = key; break; }
  const chan = t.match(/\bchannel\s+(?:name\s+)?(?:is\s+)?([a-z0-9_-]+)/i) ?? t.match(/\bfor\s+([a-z0-9_-]+)\s*$/i);
  if (chan) args["channelName"] = chan[1];
  return { toolId: "streampack.asset", args };
}

function ugcPersonaIntent(t: string): OperatorIntent | null {
  if (!/\bpersona\b/i.test(t)) return null;
  const args: Record<string, unknown> = {};
  const after = t.match(/\bpersona\b\s*(?::|—|–|-)?\s*(.+)$/i);
  if (after) {
    const desc = cleanPhrase(after[1]!.replace(/^(who is|that is|described as)\s+/i, ""));
    if (desc && !/^(for|please)/i.test(desc)) args["description"] = desc;
  }
  return { toolId: "ugc.persona", args };
}

function ugcVideoIntent(t: string): OperatorIntent | null {
  if (!/\b(ugc|product ad)\b/i.test(t)) return null;
  const args: Record<string, unknown> = {};
  const prod = t.match(/\bfor\s+(.+?)(?:,|;|\s+with\s+|\s+in\s+the\s+|\s+style\b|$)/i);
  if (prod && !/^(me|my)/i.test(prod[1]!)) args["productName"] = cleanPhrase(prod[1]!);
  const style = t.match(/\b(unboxing|honest-review|problem-fix|grwm)\b/i);
  if (style) args["style"] = style[1]!.toLowerCase();
  const script = t.match(/\bhook\s*:\s*([^;]+);?\s*lines?\s*:\s*([^;]+);?\s*(?:cta|call to action)\s*:\s*(.+)$/i);
  if (script) {
    args["script"] = {
      hook: cleanPhrase(script[1]!),
      lines: script[2]!.split(/\s*\|\s*|,\s*/).map((x) => cleanPhrase(x)).filter(Boolean),
      cta: cleanPhrase(script[3]!),
    };
  }
  return { toolId: "ugc.video", args };
}

/** Recognize a clear charged-action request, in code. Returns null for
    anything else — questions, small talk, and every free tool keep
    their existing paths. */
export function detectOperatorIntent(message: string): OperatorIntent | null {
  const t = message.trim();
  if (!t || t.length > 2000) return null;
  if (!isImperativeAsk(t)) return null;
  /* Order matters: specific surfaces before generic nouns. */
  if (/\bbios?\b/i.test(t) && (/\bpublish\b/i.test(t) || /\b(generate|make|create|write)\b/i.test(t))) return bioIntent(t);
  if (/\bpersona\b/i.test(t)) return ugcPersonaIntent(t);
  if (/\b(ugc|product ad)\b/i.test(t)) return ugcVideoIntent(t);
  if (/\bbrand kit\b/i.test(t)) return brandKitIntent(t);
  if (/\bheadshot\b/i.test(t)) return headshotIntent(t);
  if (/\b(sfx|sound effect)\b/i.test(t)) return sfxIntent(t);
  const sp = streamPackIntent(t);
  if (sp && sp.args["asset"]) return sp;
  if (/\b(song|track)\b/i.test(t)) return songIntent(t);
  if (/\b(video|clip)\b/i.test(t)) return videoIntent(t);
  if (sp) return sp;
  return null;
}

/** "What charged actions can you perform in chat?" — answered by code
    from the live registry, never by a model or the feature KB. */
export function isCapabilityQuestion(message: string): boolean {
  const t = message.trim();
  if (/\bcharged actions\b/i.test(t)) return true;
  if (/\bwhat\b[^?]*\bcan you\b[^?]*\b(in chat|right here|for me)\b/i.test(t)) return true;
  if (/\b(list|show me|tell me)\b[^?]*\b(you can (do|run|make)|can you do|actions)\b/i.test(t) && /\b(chat|do|run|perform)\b/i.test(t)) return true;
  return false;
}

export function composeCapabilityReply(): string {
  const lines = OPERATOR_TOOL_DEFS.filter((d) => toolIsCharged(d)).map(
    (d) => `• ${d.name} — ${d.priceVb!.toLocaleString("en-US")} Visual Bucs`,
  );
  return (
    `Here's what I can run for you right here in chat — you say the word, I put the price in front of you, and nothing charges until you say "yes":\n` +
    `${lines.join("\n")}\n` +
    `I can run up to 20 charged actions a day for you here. 🦈`
  );
}

/** The shared proposal step: registry price quoted by the server,
    validator asks first when details are missing. Used identically by
    the marker path and the deterministic intent path. */
async function proposeTurn(input: {
  userId: string;
  channel: OperatorChannel;
  toolId: string;
  args: Record<string, unknown>;
}): Promise<OperatorTurnResult> {
  const tool = getTool(input.toolId)!;
  const proposal = await proposeAction({
    userId: input.userId,
    toolId: tool.id,
    args: input.args,
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

/* ── Pre-model deterministic turn: capability listing + clear charged
   requests, handled WITHOUT a model call so the operator's hands work
   on every brain path (KB fallback included). Runs after the pending-
   confirmation pre-turn, before the model. ─────────────────────────── */

export async function processOperatorIntentTurn(input: {
  userId?: string;
  userEmail?: string;
  channel: OperatorChannel;
  message: string;
}): Promise<OperatorTurnResult | null> {
  if (isCapabilityQuestion(input.message)) {
    return {
      replyText: composeCapabilityReply(),
      action: { toolId: "operator.capabilities", status: "done" },
    };
  }
  const intent = detectOperatorIntent(input.message);
  if (!intent) return null;
  const tool = getTool(intent.toolId);
  if (!tool) return null;
  if (!input.userId) {
    return { replyText: NEEDS_SIGN_IN, action: { toolId: tool.id, status: "refused", reason: "needs_sign_in" } };
  }
  if (!toolIsCharged(tool)) return null;
  return proposeTurn({ userId: input.userId, channel: input.channel, toolId: tool.id, args: intent.args });
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

  /* Charged: this turn only PROPOSES, through the shared proposal
     step — the proposal text is composed from the registry price,
     the model's words never quote it, and the marker's args are
     validated first (incomplete → the member is asked, nothing is
     quoted). */
  return proposeTurn({ userId: input.userId, channel: input.channel, toolId: tool.id, args: marker.args });
}
