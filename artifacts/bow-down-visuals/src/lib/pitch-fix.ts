/* ─── Pitch & Fix — shared frontend vocabulary (UPGRADES 196 + 180) ──
   Mirrors lib/db/src/schema/pitch-fix.ts + the API wire shapes. The
   API is the authority; these lists exist so the page, the admin
   bench, and the tests all speak the same words. */

export const PITCH_CATEGORIES = ["create", "world", "money", "social", "other"] as const;
export type PitchCategory = (typeof PITCH_CATEGORIES)[number];

export const FIX_PAGES = [
  "video_editor",
  "make_song_video",
  "audio_studio",
  "thumbnail_studio",
  "branding_kit",
  "the_world",
  "go_live",
  "earnings",
  "profile",
  "somewhere_else",
] as const;
export type FixPage = (typeof FIX_PAGES)[number];

export const FIX_SEVERITIES = ["blocks_me", "annoying", "small"] as const;
export type FixSeverity = (typeof FIX_SEVERITIES)[number];

export const PITCH_STATUSES = ["reviewing", "approved", "building", "shipped"] as const;
export const FIX_STATUSES = ["received", "confirmed", "fixing", "fixed"] as const;

export interface PitchFixSubmission {
  id: string;
  kind: "pitch" | "fix" | "feedback";
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
  moderationStatus: "pending" | "approved" | "rejected";
  upvoteCount: number;
  shippedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type PitchSort = "top" | "newest";

/** Pitch Board ordering: Top = votes first (ties → newest);
 *  Newest = createdAt descending. Pure — the page feeds it the
 *  approved rows the API returned. */
export function sortPitches(pitches: PitchFixSubmission[], sort: PitchSort): PitchFixSubmission[] {
  const list = [...pitches];
  if (sort === "top") {
    list.sort((a, b) => b.upvoteCount - a.upvoteCount || b.createdAt.localeCompare(a.createdAt));
  } else {
    list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  return list;
}
