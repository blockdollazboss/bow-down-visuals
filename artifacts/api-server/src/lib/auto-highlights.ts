/* ─── Auto-Highlights (UPGRADE delta #172) ──────────────────────────────
   UPGRADE of Streamer Clips: that flow is a MANUAL VOD upload — the
   creator finds the file, pays for an AI analysis, picks moments.
   The delta is the automatic half: when a stream ends and its own
   recording registers, the house reads the stream's OWN signals —
   chat volume, tips, viewer samples, all rows the stream itself
   produced — picks the best 3 windows, and proposes them to the
   creator as drafts.

   The rules that make this honest:
   · A proposal is a draft, never a post. It publishes nothing; the
     creator approves (the cut renders on the Streamer Clips rail at
     that rail's per-clip price) or dismisses.
   · "Best" is computed from the stream's own signals only — no
     transcript model, no invented moments. The reason string on a
     proposal is rendered from the numbers that picked it.
   · The per-creator on/off (creator_live_prefs.auto_highlights_
     enabled) gates generation entirely: off = no proposals, ever.
   · Exactly-once per (stream, window): the proposals table's unique
     index is the ledger, inserts land on-conflict-do-nothing. */

import {
  db,
  liveChatMessagesTable,
  liveStreamsTable,
  liveStreamTipsTable,
  liveViewerSamplesTable,
  streamHighlightProposalsTable,
  type StreamHighlightProposal,
} from "@workspace/db";
import { and, asc, eq } from "drizzle-orm";
import { drizzleLivePrefsStore, getLivePrefs } from "./creator-live-prefs";
import { getStreamerClipJob, startStreamerCutJob } from "../routes/generate/streamer-clips";
import { OutOfCreditsError } from "./credits";
import { logger } from "./logger";

export const HIGHLIGHT_BUCKET_SEC = 30;
export const HIGHLIGHT_CLIP_SEC = 45;
export const HIGHLIGHT_MAX_PROPOSALS = 3;

/* ── Signal math (pure) ──────────────────────────────────────────────── */

export interface SignalBucket {
  index: number;
  startSec: number;
  chatCount: number;
  tipVb: number;
  tipCount: number;
  viewerPeak: number;
  score: number;
}

export interface HighlightCandidate {
  startSec: number;
  endSec: number;
  title: string;
  reason: string;
  signals: { chatPeak: number; tipVb: number; viewerPeak: number };
  score: number;
}

export interface StreamSignals {
  durationSec: number;
  /** Offset seconds (from stream start) of each chat message. */
  chatAtSec: number[];
  tips: Array<{ atSec: number; amountVb: number }>;
  viewerSamples: Array<{ atSec: number; count: number }>;
}

/** Chat counts heaviest per message, a tipped Buc counts once per
 *  Buc, and a watching viewer counts once — the weights are printed
 *  here so the score is auditable, not a black box. */
export const SCORE_CHAT_WEIGHT = 10;
export const SCORE_TIP_WEIGHT = 1;
export const SCORE_VIEWER_WEIGHT = 1;

export function bucketizeSignals(signals: StreamSignals): SignalBucket[] {
  const duration = Math.max(0, Math.floor(signals.durationSec));
  if (duration <= 0) return [];
  const bucketCount = Math.max(1, Math.ceil(duration / HIGHLIGHT_BUCKET_SEC));
  const buckets: SignalBucket[] = Array.from({ length: bucketCount }, (_, i) => ({
    index: i,
    startSec: i * HIGHLIGHT_BUCKET_SEC,
    chatCount: 0,
    tipVb: 0,
    tipCount: 0,
    viewerPeak: 0,
    score: 0,
  }));
  const at = (sec: number) =>
    Math.min(bucketCount - 1, Math.max(0, Math.floor(sec / HIGHLIGHT_BUCKET_SEC)));
  for (const sec of signals.chatAtSec) {
    if (Number.isFinite(sec) && sec >= 0) buckets[at(sec)]!.chatCount += 1;
  }
  for (const tip of signals.tips) {
    if (!Number.isFinite(tip.atSec) || tip.atSec < 0) continue;
    const b = buckets[at(tip.atSec)]!;
    b.tipVb += Math.max(0, tip.amountVb);
    b.tipCount += 1;
  }
  for (const s of signals.viewerSamples) {
    if (!Number.isFinite(s.atSec) || s.atSec < 0) continue;
    const b = buckets[at(s.atSec)]!;
    if (s.count > b.viewerPeak) b.viewerPeak = s.count;
  }
  for (const b of buckets) {
    b.score =
      b.chatCount * SCORE_CHAT_WEIGHT + b.tipVb * SCORE_TIP_WEIGHT + b.viewerPeak * SCORE_VIEWER_WEIGHT;
  }
  return buckets;
}

function mmss(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/** Render the honest provenance of a pick from its own numbers. */
export function describeBucket(b: SignalBucket): { title: string; reason: string } {
  const parts: string[] = [];
  if (b.chatCount > 0) parts.push(`a chat spike (${b.chatCount} messages in ${HIGHLIGHT_BUCKET_SEC}s)`);
  if (b.tipVb > 0) parts.push(`a ${b.tipVb} VB tip`);
  if (b.viewerPeak > 0) parts.push(`${b.viewerPeak} viewers watching`);
  const reason = `House pick from ${parts.join(" + ") || "steady signals"}`;
  const title =
    b.tipVb > 0 && b.tipVb * SCORE_TIP_WEIGHT >= b.chatCount * SCORE_CHAT_WEIGHT
      ? `Big tip moment — ${mmss(b.startSec)}`
      : b.chatCount >= 5
        ? `Chat goes off — ${mmss(b.startSec)}`
        : `Peak moment — ${mmss(b.startSec)}`;
  return { title, reason };
}

/**
 * Pick the best windows: score order, greedily, no two clip windows
 * overlapping. A bucket with no signal at all (score 0) is never a
 * "best moment" — a quiet stream honestly gets no proposals.
 */
export function pickHighlightCandidates(
  signals: StreamSignals,
  opts: { max?: number; clipSec?: number } = {},
): HighlightCandidate[] {
  const max = opts.max ?? HIGHLIGHT_MAX_PROPOSALS;
  const clipSec = opts.clipSec ?? HIGHLIGHT_CLIP_SEC;
  const duration = Math.max(0, Math.floor(signals.durationSec));
  if (duration <= 0) return [];
  const buckets = bucketizeSignals(signals).filter((b) => b.score > 0);
  buckets.sort((a, b) => b.score - a.score || a.index - b.index);
  const taken: Array<{ start: number; end: number }> = [];
  const out: HighlightCandidate[] = [];
  for (const b of buckets) {
    if (out.length >= max) break;
    const center = b.startSec + HIGHLIGHT_BUCKET_SEC / 2;
    let start = Math.round(center - clipSec / 2);
    let end = start + clipSec;
    if (start < 0) {
      start = 0;
      end = Math.min(duration, clipSec);
    }
    if (end > duration) {
      end = duration;
      start = Math.max(0, end - clipSec);
    }
    if (end - start < 5) continue;
    if (taken.some((t) => start < t.end && end > t.start)) continue;
    taken.push({ start, end });
    const { title, reason } = describeBucket(b);
    out.push({
      startSec: start,
      endSec: end,
      title,
      reason,
      signals: { chatPeak: b.chatCount, tipVb: b.tipVb, viewerPeak: b.viewerPeak },
      score: b.score,
    });
  }
  return out.sort((a, b) => a.startSec - b.startSec);
}

/* ── Store + cut rail seams ──────────────────────────────────────────── */

export interface ProposalDraft {
  stream_id: string;
  creator_user_id: string;
  start_sec: number;
  end_sec: number;
  title: string;
  reason: string;
  signals: { chatPeak: number; tipVb: number; viewerPeak: number };
  score: number;
}

export interface AutoHighlightsStore {
  signalsFor(streamId: string, startedAt: Date, endedAt: Date): Promise<StreamSignals>;
  /** Insert a proposal; returns false when the (stream, start)
   *  unique ledger already holds it — the exactly-once gate. */
  insertProposal(draft: ProposalDraft): Promise<boolean>;
  listProposals(streamId: string): Promise<StreamHighlightProposal[]>;
  getProposal(id: string): Promise<StreamHighlightProposal | null>;
  updateProposal(
    id: string,
    patch: Partial<
      Pick<StreamHighlightProposal, "status" | "cut_job_id" | "output_ref" | "output_url">
    >,
  ): Promise<void>;
  streamVodUrl(streamId: string): Promise<string | null>;
}

function offsets(rows: Array<{ created_at: Date | string }>, startMs: number): number[] {
  return rows.map((r) => (new Date(r.created_at).getTime() - startMs) / 1000);
}

export const drizzleAutoHighlightsStore: AutoHighlightsStore = {
  async signalsFor(streamId, startedAt, endedAt) {
    const startMs = startedAt.getTime();
    const [chat, tips, samples] = await Promise.all([
      db
        .select({ created_at: liveChatMessagesTable.created_at })
        .from(liveChatMessagesTable)
        .where(
          and(
            eq(liveChatMessagesTable.stream_id, streamId),
            eq(liveChatMessagesTable.kind, "chat"),
          ),
        ),
      db
        .select({ created_at: liveStreamTipsTable.created_at, amount_vb: liveStreamTipsTable.amount_vb })
        .from(liveStreamTipsTable)
        .where(eq(liveStreamTipsTable.stream_id, streamId)),
      db
        .select({ sampled_at: liveViewerSamplesTable.sampled_at, viewer_count: liveViewerSamplesTable.viewer_count })
        .from(liveViewerSamplesTable)
        .where(eq(liveViewerSamplesTable.stream_id, streamId)),
    ]);
    return {
      durationSec: Math.max(0, (endedAt.getTime() - startMs) / 1000),
      chatAtSec: offsets(chat, startMs),
      tips: tips.map((t) => ({
        atSec: (new Date(t.created_at).getTime() - startMs) / 1000,
        amountVb: t.amount_vb,
      })),
      viewerSamples: samples.map((s) => ({
        atSec: (new Date(s.sampled_at).getTime() - startMs) / 1000,
        count: s.viewer_count,
      })),
    };
  },
  async insertProposal(draft) {
    const rows = await db
      .insert(streamHighlightProposalsTable)
      .values(draft)
      .onConflictDoNothing({
        target: [
          streamHighlightProposalsTable.stream_id,
          streamHighlightProposalsTable.start_sec,
        ],
      })
      .returning({ id: streamHighlightProposalsTable.id });
    return rows.length > 0;
  },
  async listProposals(streamId) {
    return db
      .select()
      .from(streamHighlightProposalsTable)
      .where(eq(streamHighlightProposalsTable.stream_id, streamId))
      .orderBy(asc(streamHighlightProposalsTable.start_sec));
  },
  async getProposal(id) {
    const rows = await db
      .select()
      .from(streamHighlightProposalsTable)
      .where(eq(streamHighlightProposalsTable.id, id))
      .limit(1);
    return rows[0] ?? null;
  },
  async updateProposal(id, patch) {
    await db
      .update(streamHighlightProposalsTable)
      .set({ ...patch, updated_at: new Date() })
      .where(eq(streamHighlightProposalsTable.id, id));
  },
  async streamVodUrl(streamId) {
    const rows = await db
      .select({ vod_url: liveStreamsTable.vod_url })
      .from(liveStreamsTable)
      .where(eq(liveStreamsTable.id, streamId))
      .limit(1);
    return rows[0]?.vod_url ?? null;
  },
};

/** The cut rail: the Streamer Clips job engine, shared verbatim. */
export interface HighlightCutRail {
  startCut(input: {
    userId: string;
    vodUrl: string;
    startSec: number;
    endSec: number;
    title: string;
  }): Promise<{ jobId: string }>;
  getCut(jobId: string): {
    status: "queued" | "processing" | "done" | "failed";
    outputUrl: string | null;
    outputRef: string | null;
  } | null;
}

export const streamerClipsCutRail: HighlightCutRail = {
  async startCut({ userId, vodUrl, startSec, endSec, title }) {
    const { job } = await startStreamerCutJob(userId, vodUrl, [{ startSec, endSec, title }]);
    return { jobId: job.id };
  },
  getCut(jobId) {
    const job = getStreamerClipJob(jobId);
    if (!job) return null;
    const clip = job.clips[0];
    return {
      status: job.status,
      outputUrl: clip?.outputUrl ?? null,
      outputRef: clip?.outputRef ?? null,
    };
  },
};

/* ── Orchestration ───────────────────────────────────────────────────── */

export interface HighlightStreamRow {
  id: string;
  user_id: string;
  started_at: Date | string | null;
  ended_at: Date | string | null;
}

/**
 * The VOD-registration hook for #172: generate the best-3 proposals
 * for an ended stream whose recording just registered. Gated on the
 * creator's on/off; a stream with no usable timeline or no signal
 * honestly produces nothing. Returns how many proposals were newly
 * inserted (re-runs return 0 — the unique ledger holds).
 */
export async function generateHighlightProposals(
  store: AutoHighlightsStore,
  stream: HighlightStreamRow,
  prefsFor: (userId: string) => Promise<{ auto_highlights_enabled: boolean }> = (uid) =>
    getLivePrefs(drizzleLivePrefsStore, uid),
): Promise<number> {
  const prefs = await prefsFor(stream.user_id);
  if (!prefs.auto_highlights_enabled) return 0;
  if (!stream.started_at || !stream.ended_at) return 0;
  const startedAt = new Date(stream.started_at);
  const endedAt = new Date(stream.ended_at);
  if (!(endedAt.getTime() > startedAt.getTime())) return 0;
  const signals = await store.signalsFor(stream.id, startedAt, endedAt);
  const candidates = pickHighlightCandidates(signals);
  let inserted = 0;
  for (const c of candidates) {
    const ok = await store.insertProposal({
      stream_id: stream.id,
      creator_user_id: stream.user_id,
      start_sec: c.startSec,
      end_sec: c.endSec,
      title: c.title,
      reason: c.reason,
      signals: c.signals,
      score: c.score,
    });
    if (ok) inserted += 1;
  }
  return inserted;
}

export type ProposalDecision = "approved" | "dismissed";

/**
 * The creator disposes: approve starts the cut on the Streamer Clips
 * rail (its per-clip price, charged by the rail, refunded by the
 * rail on failure); dismiss closes the draft. Only a 'proposed'
 * proposal can be decided, and only by its creator.
 */
export async function decideHighlightProposal(
  store: AutoHighlightsStore,
  rail: HighlightCutRail,
  userId: string,
  proposalId: string,
  decision: ProposalDecision,
): Promise<StreamHighlightProposal> {
  const proposal = await store.getProposal(proposalId);
  if (!proposal) throw new ProposalError(404, "NOT_FOUND", "That highlight proposal doesn't exist.");
  if (proposal.creator_user_id !== userId) {
    throw new ProposalError(403, "NOT_OWNER", "That highlight isn't yours to decide.");
  }
  if (proposal.status !== "proposed") {
    throw new ProposalError(409, "ALREADY_DECIDED", "That highlight was already decided.");
  }
  if (decision === "dismissed") {
    await store.updateProposal(proposal.id, { status: "dismissed" });
    return { ...proposal, status: "dismissed" };
  }
  const vodUrl = await store.streamVodUrl(proposal.stream_id);
  if (!vodUrl) {
    throw new ProposalError(409, "NO_RECORDING", "The stream recording isn't available to cut.");
  }
  let jobId: string;
  try {
    ({ jobId } = await rail.startCut({
      userId,
      vodUrl,
      startSec: proposal.start_sec,
      endSec: proposal.end_sec,
      title: proposal.title,
    }));
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      throw new ProposalError(402, "OUT_OF_CREDITS", "You're out of Visual Bucs — top up to cut this highlight.");
    }
    throw err;
  }
  await store.updateProposal(proposal.id, { status: "approved", cut_job_id: jobId });
  return { ...proposal, status: "approved", cut_job_id: jobId };
}

/**
 * Settle an approved proposal against its cut job: done → 'posted'
 * with the rendered clip's whereabouts; failed → back to 'proposed'
 * (the rail already refunded the cut; the creator may retry or
 * dismiss). Anything else is returned unchanged.
 */
export async function refreshHighlightProposal(
  store: AutoHighlightsStore,
  rail: HighlightCutRail,
  userId: string,
  proposalId: string,
): Promise<StreamHighlightProposal> {
  const proposal = await store.getProposal(proposalId);
  if (!proposal) throw new ProposalError(404, "NOT_FOUND", "That highlight proposal doesn't exist.");
  if (proposal.creator_user_id !== userId) {
    throw new ProposalError(403, "NOT_OWNER", "That highlight isn't yours.");
  }
  if (proposal.status !== "approved" || !proposal.cut_job_id) return proposal;
  const cut = rail.getCut(proposal.cut_job_id);
  if (!cut || cut.status === "queued" || cut.status === "processing") return proposal;
  if (cut.status === "done") {
    await store.updateProposal(proposal.id, {
      status: "posted",
      output_url: cut.outputUrl,
      output_ref: cut.outputRef,
    });
    return { ...proposal, status: "posted", output_url: cut.outputUrl, output_ref: cut.outputRef };
  }
  logger.warn({ proposalId: proposal.id, jobId: proposal.cut_job_id }, "auto-highlights: cut failed; proposal returned to proposed (rail refunded)");
  await store.updateProposal(proposal.id, { status: "proposed", cut_job_id: null });
  return { ...proposal, status: "proposed", cut_job_id: null };
}

export class ProposalError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "ProposalError";
  }
}
