/* ─── Pitch & Fix (Stack-200 UPGRADES 196 + 180) ───────────────────────
   One moderated intake for idea pitches, fix reports, and Feedback
   Pop-Up submissions (migration 0244).

   MODERATION GATE: submissions are born pending and the public board
   functions below only ever return moderation_status = 'approved'
   rows. Team members approve/reject and set board statuses through
   the admin functions — statuses are never submitter-set.

   NO PRICES, NO REWARDS: nothing in this module charges, grants, or
   prices anything. The shipped-idea reward question was never ruled.

   Feedback Pop-Up law (item 180), server half: the prompt may show
   at most once per 7 days per account (FEEDBACK_PROMPT_CAP_MS),
   counted from the SHOWING; the Settings toggle (enabled) outranks
   the cap. The client-side decision (qualifying moment, chance roll,
   suppression contexts) lives in the frontend lib/feedback-prompt.ts;
   this module is the cap/toggle authority it checks with. */

import {
  db,
  pitchFixSubmissionsTable,
  pitchFixVotesTable,
  feedbackPromptPrefsTable,
  PITCH_CATEGORIES,
  FIX_PAGES,
  FIX_SEVERITIES,
  PITCH_BOARD_STATUSES,
  FIX_BOARD_STATUSES,
  type PitchCategory,
  type FixPage,
  type FixSeverity,
} from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";

export const FEEDBACK_PROMPT_CAP_MS = 7 * 24 * 60 * 60 * 1000;
/** Chance a qualifying moment becomes a prompt (before cap/suppression). */
export const FEEDBACK_PROMPT_CHANCE = 0.25;

export type SubmissionKind = "pitch" | "fix" | "feedback";
export type ModerationStatus = "pending" | "approved" | "rejected";

export interface SubmissionWire {
  id: string;
  kind: SubmissionKind;
  source: "door" | "feedback_popup";
  submitterUserId: string;
  submitterName: string;
  title: string;
  body: string;
  why: string | null;
  category: string | null;
  page: string | null;
  severity: string | null;
  rating: number | null;
  status: string;
  moderationStatus: ModerationStatus;
  upvoteCount: number;
  shippedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export class PitchFixError extends Error {
  code: "not_found" | "not_votable" | "invalid_status" | "validation";
  constructor(code: PitchFixError["code"], message: string) {
    super(message);
    this.code = code;
  }
}

/* ─── Storage seam (drizzle in production, in-memory in tests) ─────── */

export interface NewSubmissionRow {
  kind: SubmissionKind;
  source: "door" | "feedback_popup";
  submitterUserId: string;
  submitterName: string;
  title: string;
  body: string;
  why: string | null;
  category: string | null;
  page: string | null;
  severity: string | null;
  rating: number | null;
  status: string;
}

export interface FeedbackPrefsRow {
  enabled: boolean;
  lastPromptedAt: string | null;
  promptCount: number;
}

export interface PitchFixStore {
  insertSubmission(input: NewSubmissionRow): Promise<SubmissionWire>;
  listSubmissions(): Promise<SubmissionWire[]>;
  getSubmission(id: string): Promise<SubmissionWire | null>;
  updateSubmission(
    id: string,
    patch: Partial<Pick<SubmissionWire, "status" | "moderationStatus" | "shippedAt">> & { moderatedByUserId?: string | null; moderatedAt?: string | null },
  ): Promise<SubmissionWire | null>;
  hasVote(submissionId: string, userId: string): Promise<boolean>;
  /** Set the vote on/off; returns the submission's new upvote count. */
  setVote(submissionId: string, userId: string, on: boolean): Promise<number>;
  listVotesForUser(userId: string): Promise<string[]>;
  getFeedbackPrefs(userId: string): Promise<FeedbackPrefsRow | null>;
  upsertFeedbackPrefs(userId: string, prefs: FeedbackPrefsRow): Promise<void>;
}

function rowToWire(r: typeof pitchFixSubmissionsTable.$inferSelect): SubmissionWire {
  return {
    id: r.id,
    kind: r.kind as SubmissionKind,
    source: r.source as SubmissionWire["source"],
    submitterUserId: r.submitterUserId,
    submitterName: r.submitterName,
    title: r.title,
    body: r.body,
    why: r.why,
    category: r.category,
    page: r.page,
    severity: r.severity,
    rating: r.rating,
    status: r.status,
    moderationStatus: r.moderationStatus as ModerationStatus,
    upvoteCount: r.upvoteCount,
    shippedAt: r.shippedAt ? r.shippedAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

export const drizzlePitchFixStore: PitchFixStore = {
  async insertSubmission(input) {
    const rows = await db.insert(pitchFixSubmissionsTable).values(input).returning();
    return rowToWire(rows[0]!);
  },
  async listSubmissions() {
    const rows = await db.select().from(pitchFixSubmissionsTable);
    return rows.map(rowToWire);
  },
  async getSubmission(id) {
    const rows = await db.select().from(pitchFixSubmissionsTable).where(eq(pitchFixSubmissionsTable.id, id)).limit(1);
    return rows[0] ? rowToWire(rows[0]) : null;
  },
  async updateSubmission(id, patch) {
    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (patch.status !== undefined) set["status"] = patch.status;
    if (patch.moderationStatus !== undefined) set["moderationStatus"] = patch.moderationStatus;
    if (patch.shippedAt !== undefined) set["shippedAt"] = patch.shippedAt ? new Date(patch.shippedAt) : null;
    if (patch.moderatedByUserId !== undefined) set["moderatedByUserId"] = patch.moderatedByUserId;
    if (patch.moderatedAt !== undefined) set["moderatedAt"] = patch.moderatedAt ? new Date(patch.moderatedAt) : null;
    const rows = await db.update(pitchFixSubmissionsTable).set(set).where(eq(pitchFixSubmissionsTable.id, id)).returning();
    return rows[0] ? rowToWire(rows[0]) : null;
  },
  async hasVote(submissionId, userId) {
    const rows = await db.select().from(pitchFixVotesTable)
      .where(and(eq(pitchFixVotesTable.submissionId, submissionId), eq(pitchFixVotesTable.userId, userId))).limit(1);
    return rows.length > 0;
  },
  async setVote(submissionId, userId, on) {
    if (on) {
      await db.insert(pitchFixVotesTable).values({ submissionId, userId }).onConflictDoNothing();
      await db.update(pitchFixSubmissionsTable)
        .set({ upvoteCount: sql`(SELECT count(*) FROM pitch_fix_votes WHERE submission_id = ${submissionId})` })
        .where(eq(pitchFixSubmissionsTable.id, submissionId));
    } else {
      await db.delete(pitchFixVotesTable)
        .where(and(eq(pitchFixVotesTable.submissionId, submissionId), eq(pitchFixVotesTable.userId, userId)));
      await db.update(pitchFixSubmissionsTable)
        .set({ upvoteCount: sql`(SELECT count(*) FROM pitch_fix_votes WHERE submission_id = ${submissionId})` })
        .where(eq(pitchFixSubmissionsTable.id, submissionId));
    }
    const rows = await db.select({ c: pitchFixSubmissionsTable.upvoteCount }).from(pitchFixSubmissionsTable)
      .where(eq(pitchFixSubmissionsTable.id, submissionId)).limit(1);
    return rows[0]?.c ?? 0;
  },
  async listVotesForUser(userId) {
    const rows = await db.select({ s: pitchFixVotesTable.submissionId }).from(pitchFixVotesTable)
      .where(eq(pitchFixVotesTable.userId, userId));
    return rows.map((r) => r.s);
  },
  async getFeedbackPrefs(userId) {
    const rows = await db.select().from(feedbackPromptPrefsTable).where(eq(feedbackPromptPrefsTable.userId, userId)).limit(1);
    const r = rows[0];
    if (!r) return null;
    return { enabled: r.enabled, lastPromptedAt: r.lastPromptedAt ? r.lastPromptedAt.toISOString() : null, promptCount: r.promptCount };
  },
  async upsertFeedbackPrefs(userId, prefs) {
    await db.insert(feedbackPromptPrefsTable)
      .values({ userId, enabled: prefs.enabled, lastPromptedAt: prefs.lastPromptedAt ? new Date(prefs.lastPromptedAt) : null, promptCount: prefs.promptCount })
      .onConflictDoUpdate({
        target: feedbackPromptPrefsTable.userId,
        set: { enabled: prefs.enabled, lastPromptedAt: prefs.lastPromptedAt ? new Date(prefs.lastPromptedAt) : null, promptCount: prefs.promptCount, updatedAt: new Date() },
      });
  },
};

/* ─── Submissions ──────────────────────────────────────────────────── */

function cleanName(name: string | undefined): string {
  const n = (name ?? "").trim().slice(0, 40);
  return n || "Creator";
}

export async function submitPitch(
  store: PitchFixStore,
  input: { userId: string; submitterName?: string; title: string; body: string; why?: string; category: PitchCategory },
): Promise<SubmissionWire> {
  if (!(PITCH_CATEGORIES as readonly string[]).includes(input.category)) {
    throw new PitchFixError("validation", "Unknown pitch category.");
  }
  return store.insertSubmission({
    kind: "pitch", source: "door",
    submitterUserId: input.userId, submitterName: cleanName(input.submitterName),
    title: input.title.trim(), body: input.body.trim(), why: input.why?.trim() || null,
    category: input.category, page: null, severity: null, rating: null,
    status: "reviewing",
  });
}

export async function submitFix(
  store: PitchFixStore,
  input: { userId: string; submitterName?: string; title: string; body?: string; page: FixPage; severity: FixSeverity },
): Promise<SubmissionWire> {
  if (!(FIX_PAGES as readonly string[]).includes(input.page)) {
    throw new PitchFixError("validation", "Unknown page.");
  }
  if (!(FIX_SEVERITIES as readonly string[]).includes(input.severity)) {
    throw new PitchFixError("validation", "Unknown severity.");
  }
  return store.insertSubmission({
    kind: "fix", source: "door",
    submitterUserId: input.userId, submitterName: cleanName(input.submitterName),
    title: input.title.trim(), body: (input.body ?? "").trim(), why: null,
    category: null, page: input.page, severity: input.severity, rating: null,
    status: "received",
  });
}

/** A Feedback Pop-Up submission: rating required, ONE line optional.
 *  Lands in the same intake as a fix (kind "feedback", source
 *  "feedback_popup") and moderates identically; once approved it
 *  surfaces on the Fix Board. */
export async function submitFeedback(
  store: PitchFixStore,
  input: { userId: string; submitterName?: string; rating: number; text?: string },
): Promise<SubmissionWire> {
  if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5) {
    throw new PitchFixError("validation", "Rating must be 1–5 stars.");
  }
  const line = (input.text ?? "").replace(/\s*\n\s*/g, " ").trim().slice(0, 400);
  return store.insertSubmission({
    kind: "feedback", source: "feedback_popup",
    submitterUserId: input.userId, submitterName: cleanName(input.submitterName),
    title: line, body: "", why: null,
    category: null, page: null, severity: null, rating: input.rating,
    status: "received",
  });
}

/* ─── Public boards (approved only — the moderation gate) ──────────── */

export interface PublicBoard {
  pitches: SubmissionWire[];
  fixes: SubmissionWire[];
  shipped: SubmissionWire[];
  viewerVotedIds: string[];
}

const byNewest = (a: SubmissionWire, b: SubmissionWire) => b.createdAt.localeCompare(a.createdAt);
const byTop = (a: SubmissionWire, b: SubmissionWire) => b.upvoteCount - a.upvoteCount || byNewest(a, b);

export async function getPublicBoard(store: PitchFixStore, viewerUserId?: string): Promise<PublicBoard> {
  const all = await store.listSubmissions();
  const approved = all.filter((s) => s.moderationStatus === "approved");
  const pitches = approved.filter((s) => s.kind === "pitch").sort(byTop);
  const fixes = approved.filter((s) => s.kind === "fix" || s.kind === "feedback").sort(byNewest);
  const shipped = approved
    .filter((s) => s.status === "shipped" || s.status === "fixed")
    .sort((a, b) => (b.shippedAt ?? b.updatedAt).localeCompare(a.shippedAt ?? a.updatedAt))
    .slice(0, 12);
  const viewerVotedIds = viewerUserId ? await store.listVotesForUser(viewerUserId) : [];
  return { pitches, fixes, shipped, viewerVotedIds };
}

export async function listMySubmissions(store: PitchFixStore, userId: string): Promise<SubmissionWire[]> {
  const all = await store.listSubmissions();
  return all.filter((s) => s.submitterUserId === userId).sort(byNewest);
}

/** Toggle the caller's upvote on a PUBLIC pitch. Pending/rejected
 *  pitches and fix/feedback rows are not votable. */
export async function togglePitchVote(
  store: PitchFixStore, userId: string, submissionId: string,
): Promise<{ voted: boolean; upvoteCount: number }> {
  const sub = await store.getSubmission(submissionId);
  if (!sub || sub.moderationStatus !== "approved" || sub.kind !== "pitch") {
    throw new PitchFixError("not_votable", "That pitch is not open for voting.");
  }
  const has = await store.hasVote(submissionId, userId);
  const count = await store.setVote(submissionId, userId, !has);
  return { voted: !has, upvoteCount: count };
}

/* ─── Moderation (team surface) ────────────────────────────────────── */

export async function listModerationQueue(store: PitchFixStore): Promise<SubmissionWire[]> {
  const all = await store.listSubmissions();
  const rank = (s: SubmissionWire) => (s.moderationStatus === "pending" ? 0 : s.moderationStatus === "approved" ? 1 : 2);
  return all.sort((a, b) => rank(a) - rank(b) || byNewest(a, b));
}

export async function moderateSubmission(
  store: PitchFixStore, adminUserId: string, id: string, decision: "approved" | "rejected", now: Date = new Date(),
): Promise<SubmissionWire> {
  const sub = await store.getSubmission(id);
  if (!sub) throw new PitchFixError("not_found", "Submission not found.");
  const updated = await store.updateSubmission(id, {
    moderationStatus: decision,
    moderatedByUserId: adminUserId,
    moderatedAt: now.toISOString(),
  });
  return updated!;
}

export async function setSubmissionStatus(
  store: PitchFixStore, id: string, status: string, now: Date = new Date(),
): Promise<SubmissionWire> {
  const sub = await store.getSubmission(id);
  if (!sub) throw new PitchFixError("not_found", "Submission not found.");
  const allowed: readonly string[] = sub.kind === "pitch" ? PITCH_BOARD_STATUSES : FIX_BOARD_STATUSES;
  if (!allowed.includes(status)) {
    throw new PitchFixError("invalid_status", `Status "${status}" does not belong to a ${sub.kind}.`);
  }
  const terminal = status === "shipped" || status === "fixed";
  const updated = await store.updateSubmission(id, {
    status,
    shippedAt: terminal ? (sub.shippedAt ?? now.toISOString()) : null,
  });
  return updated!;
}

/* ─── Feedback Pop-Up prefs + cap ──────────────────────────────────── */

export const DEFAULT_FEEDBACK_PREFS: FeedbackPrefsRow = { enabled: true, lastPromptedAt: null, promptCount: 0 };

export async function getFeedbackPrefs(store: PitchFixStore, userId: string): Promise<FeedbackPrefsRow> {
  return (await store.getFeedbackPrefs(userId)) ?? { ...DEFAULT_FEEDBACK_PREFS };
}

export async function setFeedbackEnabled(store: PitchFixStore, userId: string, enabled: boolean): Promise<FeedbackPrefsRow> {
  const current = await getFeedbackPrefs(store, userId);
  const next = { ...current, enabled };
  await store.upsertFeedbackPrefs(userId, next);
  return next;
}

export interface FeedbackEligibility {
  enabled: boolean;
  eligible: boolean;
  reason: "ok" | "disabled" | "capped";
  nextEligibleAt: string | null;
  lastPromptedAt: string | null;
}

/** Pure cap rule: enabled AND (never prompted OR last showing was at
 *  least FEEDBACK_PROMPT_CAP_MS ago). */
export function feedbackEligibility(prefs: FeedbackPrefsRow, now: Date = new Date()): FeedbackEligibility {
  if (!prefs.enabled) {
    return { enabled: false, eligible: false, reason: "disabled", nextEligibleAt: null, lastPromptedAt: prefs.lastPromptedAt };
  }
  if (prefs.lastPromptedAt) {
    const next = new Date(new Date(prefs.lastPromptedAt).getTime() + FEEDBACK_PROMPT_CAP_MS);
    if (now.getTime() < next.getTime()) {
      return { enabled: true, eligible: false, reason: "capped", nextEligibleAt: next.toISOString(), lastPromptedAt: prefs.lastPromptedAt };
    }
  }
  return { enabled: true, eligible: true, reason: "ok", nextEligibleAt: null, lastPromptedAt: prefs.lastPromptedAt };
}

export async function getFeedbackEligibility(store: PitchFixStore, userId: string, now: Date = new Date()): Promise<FeedbackEligibility> {
  return feedbackEligibility(await getFeedbackPrefs(store, userId), now);
}

/** Stamp a SHOWING. Refuses (recorded: false) when the toggle is off or
 *  the cap is still running — the server never lets a client stamp its
 *  way around either. */
export async function recordPromptShown(
  store: PitchFixStore, userId: string, now: Date = new Date(),
): Promise<{ recorded: boolean; eligibility: FeedbackEligibility }> {
  const prefs = await getFeedbackPrefs(store, userId);
  const elig = feedbackEligibility(prefs, now);
  if (!elig.eligible) return { recorded: false, eligibility: elig };
  const next: FeedbackPrefsRow = { enabled: prefs.enabled, lastPromptedAt: now.toISOString(), promptCount: prefs.promptCount + 1 };
  await store.upsertFeedbackPrefs(userId, next);
  return { recorded: true, eligibility: feedbackEligibility(next, now) };
}
