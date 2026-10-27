/* ─── Stage Manager (UPGRADE delta #166) ────────────────────────────────
   Thy Cheat Code CO-HOSTS live streams in real time. The delta over
   Stream Copilot (pre-stream prep + post-stream paste; its own header
   admits "no real-time co-hosting"): while the stream runs, the
   co-host —

   · drops the creator's links when chat mentions their keywords
     (the creator's own rules, from creator_live_prefs);
   · pins a supporter's tip message when no paid pin is up (paid
     pins are bought and always outrank the co-host's);
   · plays the Royal Sting at milestones (cumulative tips and
     viewer counts crossing printed thresholds) — a room broadcast
     the clients render with the signature sound set;
   · flags trouble early — behavioral only (repeat spam, rapid
     fire, link storms) — to the CREATOR, as a notification.

   PEACE LAW (standing, unbreakable): the co-host's automatic power
   ceiling is flagging + the helpful actions above. It never kicks,
   mutes, or locks a PERSON — those fire only on an admin account's
   command, exactly as the operator law already holds. (The "mute"
   in this module is the CREATOR muting the co-host.)

   Every action carries its own creator on/off (creator_live_prefs),
   the master switch gates all of it, and the creator can mute the
   co-host mid-stream — the creator is always the senior host.
   Cooldown bookkeeping is in-memory per stream (single instance,
   like chat pacing); the mute + pin persist in
   live_stage_manager_state so they survive across requests. */

import {
  db,
  liveStageManagerStateTable,
  notificationsTable,
  type StageManagerLinkRule,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  drizzleLivePrefsStore,
  getLivePrefs,
  type LivePrefsWire,
} from "./creator-live-prefs";
import { attachJobMapTtl } from "./job-map-sweeper";
import { logger } from "./logger";

export const LINK_DROP_COOLDOWN_MS = 120_000;
export const PIN_COOLDOWN_MS = 60_000;
export const PIN_DURATION_MS = 120_000;
export const STING_COOLDOWN_MS = 60_000;
export const FLAG_COOLDOWN_MS = 300_000;
export const VIEWER_MILESTONES = [25, 50, 100, 250, 500, 1000, 2500, 5000];
export const TIP_MILESTONES_VB = [500, 1000, 2500, 5000, 10000, 25000];

export interface StageState {
  muted: boolean;
  pinnedMessageId: string | null;
  pinnedUntil: Date | null;
}

export interface StageFlag {
  at: number;
  reason: string;
  messageId: string | null;
}

/* ── Per-stream memory (cooldowns, milestone ledgers, flag ring) ─────── */

export interface StageMemory {
  lastLinkDropAt: Map<string, number>;
  lastPinAt: number;
  lastStingAt: number;
  stungViewerMarks: Set<number>;
  stungTipMarks: Set<number>;
  cumulativeTipVb: number;
  recentByUser: Map<string, Array<{ at: number; norm: string }>>;
  recentLinkPosts: Array<{ at: number; userId: string }>;
  lastFlagAtByKey: Map<string, number>;
  flags: StageFlag[];
}

export function freshStageMemory(): StageMemory {
  return {
    lastLinkDropAt: new Map(),
    lastPinAt: Number.NEGATIVE_INFINITY,
    lastStingAt: Number.NEGATIVE_INFINITY,
    stungViewerMarks: new Set(),
    stungTipMarks: new Set(),
    cumulativeTipVb: 0,
    recentByUser: new Map(),
    recentLinkPosts: [],
    lastFlagAtByKey: new Map(),
    flags: [],
  };
}

const memories = attachJobMapTtl(new Map<string, StageMemory>());

export function stageMemoryFor(streamId: string): StageMemory {
  let mem = memories.get(streamId);
  if (!mem) {
    mem = freshStageMemory();
    memories.set(streamId, mem);
  }
  return mem;
}

export function recentStageFlags(streamId: string): StageFlag[] {
  return [...(memories.get(streamId)?.flags ?? [])].reverse();
}

export function __resetStageManagerMemory(): void {
  memories.clear();
}

/* ── Store seam (prefs + persisted state + creator notifications) ────── */

export interface StageManagerStore {
  getPrefs(userId: string): Promise<LivePrefsWire>;
  getState(streamId: string): Promise<StageState>;
  setMuted(streamId: string, muted: boolean): Promise<void>;
  setPin(streamId: string, messageId: string | null, until: Date | null): Promise<void>;
  notifyCreator(creatorUserId: string, title: string, body: string): Promise<void>;
}

export const drizzleStageManagerStore: StageManagerStore = {
  async getPrefs(userId) {
    return getLivePrefs(drizzleLivePrefsStore, userId);
  },
  async getState(streamId) {
    const rows = await db
      .select()
      .from(liveStageManagerStateTable)
      .where(eq(liveStageManagerStateTable.stream_id, streamId))
      .limit(1);
    const row = rows[0];
    if (!row) return { muted: false, pinnedMessageId: null, pinnedUntil: null };
    return {
      muted: row.muted,
      pinnedMessageId: row.pinned_message_id ?? null,
      pinnedUntil: row.pinned_until ? new Date(row.pinned_until) : null,
    };
  },
  async setMuted(streamId, muted) {
    await db
      .insert(liveStageManagerStateTable)
      .values({ stream_id: streamId, muted })
      .onConflictDoUpdate({
        target: liveStageManagerStateTable.stream_id,
        set: { muted, updated_at: new Date() },
      });
  },
  async setPin(streamId, messageId, until) {
    await db
      .insert(liveStageManagerStateTable)
      .values({ stream_id: streamId, pinned_message_id: messageId, pinned_until: until })
      .onConflictDoUpdate({
        target: liveStageManagerStateTable.stream_id,
        set: { pinned_message_id: messageId, pinned_until: until, updated_at: new Date() },
      });
  },
  async notifyCreator(creatorUserId, title, body) {
    await db.insert(notificationsTable).values({
      userId: creatorUserId,
      kind: "stage_manager_flag",
      title,
      body,
      link: "/go-live",
    });
  },
};

/* ── Decisions (pure over prefs + state + memory) ────────────────────── */

export type StageAction =
  | { type: "drop_link"; rule: StageManagerLinkRule }
  | { type: "pin"; messageId: string; durationMs: number }
  | { type: "sting"; milestone: string }
  | { type: "flag"; reason: string; messageId: string | null };

export interface StageChatMessage {
  id: string;
  userId: string;
  body: string;
  kind: "chat" | "tip";
  tipAmountVb: number | null;
}

interface Gate {
  prefs: LivePrefsWire;
  state: StageState;
}

function masterOn(gate: Gate): boolean {
  return gate.prefs.stage_manager_enabled && !gate.state.muted;
}

function pushFlag(
  mem: StageMemory,
  now: number,
  key: string,
  reason: string,
  messageId: string | null,
  out: StageAction[],
): void {
  const last = mem.lastFlagAtByKey.get(key);
  if (last !== undefined && now - last < FLAG_COOLDOWN_MS) return;
  mem.lastFlagAtByKey.set(key, now);
  mem.flags.push({ at: now, reason, messageId });
  if (mem.flags.length > 20) mem.flags.splice(0, mem.flags.length - 20);
  out.push({ type: "flag", reason, messageId });
}

function stingReady(mem: StageMemory, now: number): boolean {
  return now - mem.lastStingAt >= STING_COOLDOWN_MS;
}

function normalizeBody(body: string): string {
  return body.trim().toLowerCase().replace(/\s+/g, " ");
}

const URL_RE = /https?:\/\/|www\./i;

/**
 * Evaluate one freshly-posted chat message. Mutates the memory's
 * cooldown/flag bookkeeping for any action it emits — an emitted
 * action is a spent action, whether or not delivery later hiccups.
 */
export function evaluateChatMessage(
  gate: Gate,
  mem: StageMemory,
  stream: { id: string; ownerUserId: string },
  message: StageChatMessage,
  now: number = Date.now(),
): StageAction[] {
  if (!masterOn(gate)) return [];
  const out: StageAction[] = [];
  const fromOwner = message.userId === stream.ownerUserId;

  /* Link drops: a chatter mentions the creator's keyword, the
     co-host drops the creator's link. The owner's own messages never
     trigger it (the creator drops their own links by hand), and a
     rule can't fire again inside its cooldown. */
  if (gate.prefs.stage_manager_links_enabled && !fromOwner && message.kind === "chat") {
    const bodyLower = message.body.toLowerCase();
    for (const rule of gate.prefs.stage_manager_link_rules) {
      if (!bodyLower.includes(rule.keyword)) continue;
      const last = mem.lastLinkDropAt.get(rule.keyword);
      if (last !== undefined && now - last < LINK_DROP_COOLDOWN_MS) continue;
      mem.lastLinkDropAt.set(rule.keyword, now);
      out.push({ type: "drop_link", rule });
      break; // one link per message — the co-host is not a billboard
    }
  }

  /* Trouble flags (behavioral — never content judgment, never a
     punishment: the creator is told, the creator decides). */
  if (gate.prefs.stage_manager_flags_enabled && !fromOwner) {
    const norm = normalizeBody(message.body);
    const mine = mem.recentByUser.get(message.userId) ?? [];
    mine.push({ at: now, norm });
    const recent = mine.filter((m) => now - m.at <= 90_000);
    mem.recentByUser.set(message.userId, recent);
    const repeats = recent.filter((m) => m.norm === norm && norm.length > 0).length;
    if (repeats >= 3) {
      pushFlag(mem, now, `repeat:${message.userId}`, "A viewer is posting the same message over and over.", message.id, out);
    } else if (recent.filter((m) => now - m.at <= 15_000).length >= 8) {
      pushFlag(mem, now, `rapid:${message.userId}`, "A viewer is posting at a rapid-fire pace.", message.id, out);
    }
    if (URL_RE.test(message.body)) {
      mem.recentLinkPosts.push({ at: now, userId: message.userId });
      mem.recentLinkPosts = mem.recentLinkPosts.filter((p) => now - p.at <= 30_000);
      const posters = new Set(mem.recentLinkPosts.map((p) => p.userId));
      if (mem.recentLinkPosts.length >= 4 && posters.size >= 3) {
        pushFlag(mem, now, "link-storm", "Several viewers are dropping links in quick succession.", message.id, out);
      }
    }
  }

  /* Tip celebration: pin the supporter's tip message (when no paid
     pin is up — the caller enforces that) + sting on tip
     milestones. Tips arrive as their own follow-up (evaluateTip),
     not through this chat path. */
  return out;
}

/** A landed tip: milestone stings + the supporter pin. */
export function evaluateTip(
  gate: Gate,
  mem: StageMemory,
  tip: { messageId: string | null; amountVb: number; paidPinActive: boolean },
  now: number = Date.now(),
): StageAction[] {
  if (!masterOn(gate)) return [];
  const out: StageAction[] = [];
  mem.cumulativeTipVb += Math.max(0, tip.amountVb);

  if (gate.prefs.stage_manager_sting_enabled && stingReady(mem, now)) {
    const crossed = TIP_MILESTONES_VB.filter(
      (m) => mem.cumulativeTipVb >= m && !mem.stungTipMarks.has(m),
    );
    if (crossed.length > 0) {
      const top = Math.max(...crossed);
      for (const m of crossed) mem.stungTipMarks.add(m);
      mem.lastStingAt = now;
      out.push({ type: "sting", milestone: `${top} VB in tips` });
    }
  }

  if (
    gate.prefs.stage_manager_pin_enabled &&
    tip.messageId &&
    !tip.paidPinActive &&
    now - mem.lastPinAt >= PIN_COOLDOWN_MS
  ) {
    mem.lastPinAt = now;
    out.push({ type: "pin", messageId: tip.messageId, durationMs: PIN_DURATION_MS });
  }
  return out;
}

/** The room's viewer count moved: sting when a milestone is crossed. */
export function evaluateViewerCount(
  gate: Gate,
  mem: StageMemory,
  viewerCount: number,
  now: number = Date.now(),
): StageAction[] {
  if (!masterOn(gate)) return [];
  if (!gate.prefs.stage_manager_sting_enabled) return [];
  const crossed = VIEWER_MILESTONES.filter(
    (m) => viewerCount >= m && !mem.stungViewerMarks.has(m),
  );
  if (crossed.length === 0 || !stingReady(mem, now)) return [];
  const top = Math.max(...crossed);
  for (const m of crossed) mem.stungViewerMarks.add(m);
  mem.lastStingAt = now;
  return [{ type: "sting", milestone: `${top} viewers` }];
}

/* ── Orchestration helpers shared by the route hooks ─────────────────── */

/** Load the gate (prefs + state) for a stream's owner. */
export async function loadStageGate(
  store: StageManagerStore,
  stream: { id: string; ownerUserId: string },
): Promise<Gate> {
  const [prefs, state] = await Promise.all([
    store.getPrefs(stream.ownerUserId),
    store.getState(stream.id),
  ]);
  return { prefs, state };
}

/** Deliver a flag: the creator's notification + a loud log line. The
 *  flag ring in memory is the desk's read model. */
export async function deliverStageFlag(
  store: StageManagerStore,
  stream: { id: string; ownerUserId: string; title: string },
  action: Extract<StageAction, { type: "flag" }>,
): Promise<void> {
  logger.warn(
    { streamId: stream.id, reason: action.reason, messageId: action.messageId },
    "stage-manager: trouble flag for the creator",
  );
  await store
    .notifyCreator(
      stream.ownerUserId,
      `Stage Manager flag — ${stream.title}`,
      `${action.reason} Your co-host flagged it for your call — it never acts on a flag itself.`,
    )
    .catch((err) => {
      logger.error({ err, streamId: stream.id }, "stage-manager: flag notification failed");
    });
}
