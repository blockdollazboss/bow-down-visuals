import { pgTable, uuid, jsonb, timestamp } from "drizzle-orm/pg-core";

/**
 * "Move Home" concierge onboarding (competitor-study/social-platforms.md
 * candidate C2). One row per member, created lazily on their first
 * Move Home read. The row carries the whole resumable checklist:
 *
 *   answers — what the creator told us in the intake (their words only).
 *   drafts  — the per-step drafts Thy Cheat Code assembled in one pass
 *             from the answers, the creator's existing on-platform
 *             content, and their ALREADY-connected social accounts.
 *             Drafts are inert data here: nothing in this table is
 *             public, sellable, or sendable.
 *   steps   — per-step state machine: pending → drafted → approved |
 *             skipped. A step only leaves `drafted` through the
 *             creator's explicit per-step approval, which is the moment
 *             the draft is applied to its real rail (creator_profiles,
 *             store_products, press_kits, email_lists, scheduled_posts)
 *             and the applied row's id is stamped in `appliedRef`.
 *
 * The flow is free: no credits column exists here and no Move Home code
 * path charges. Charged sub-steps a creator takes afterwards (e.g.
 * scheduling one of the drafted launch posts) ride their own rails
 * with their own prices and confirmations.
 */

export const MOVE_HOME_STEP_KEYS = [
  "profile",
  "store",
  "press_kit",
  "email_list",
  "launch_posts",
] as const;

export type MoveHomeStepKey = (typeof MOVE_HOME_STEP_KEYS)[number];

export type MoveHomeStepStatus = "pending" | "drafted" | "approved" | "skipped";

export interface MoveHomeStepState {
  status: MoveHomeStepStatus;
  draftedAt?: string;
  decidedAt?: string;
  /** Id of the row the approval created/applied on the step's real rail. */
  appliedRef?: string;
  /** Honest blocker for a step that cannot be drafted yet
      (e.g. launch_posts with no connected account). Never a fake. */
  blockedReason?: "no_connected_accounts" | "needs_media" | "needs_profile";
}

/** What the creator provides in the intake — their words, nothing inferred. */
export interface MoveHomeAnswers {
  displayName?: string;
  /** Creator lane: music | video | gaming | podcast | film | tv | influencer | education | other */
  vertical?: string;
  genre?: string;
  /** One or two sentences in the creator's own words — the bio seed. */
  bioSeed?: string;
  tagline?: string;
  location?: string;
  /** Desired profile handle (slug). Validated at draft + apply time. */
  handle?: string;
  /** Social URLs the creator typed themselves (never "imported"). */
  socialLinks?: Record<string, string>;
  /** Title for a starter product when they have no priced content yet. */
  starterProductTitle?: string;
}

export interface MoveHomeProfileDraft {
  slug: string;
  displayName: string;
  vertical: string;
  bio: string;
  socialLinks: Record<string, string>;
  /** True when a profile already exists and approval updates it. */
  updatesExisting: boolean;
}

export interface MoveHomeStoreProductDraft {
  kind: "download" | "digital";
  title: string;
  description: string;
  priceCents: number;
  /** profile_tracks.id this product sells, when drafted from real content. */
  sourceTrackId?: string;
  /** True when the price is a suggestion the creator should confirm. */
  suggestedPrice: boolean;
}

export interface MoveHomeStoreDraft {
  products: MoveHomeStoreProductDraft[];
}

export interface MoveHomePressKitDraft {
  handle: string;
  artistName: string;
  tagline: string;
  bio: string;
  genre: string;
  location: string;
  instagramUrl: string;
  tiktokUrl: string;
  youtubeUrl: string;
  topTracks: Array<{ title: string; url: string }>;
}

export interface MoveHomeEmailDraft {
  name: string;
  handle: string;
  description: string;
  welcomeSubject: string;
  welcomeBody: string;
  /** True when the creator already has a list and approval only
      sets the welcome email on it. */
  updatesExisting: boolean;
}

export interface MoveHomeLaunchPostDraft {
  platform: "instagram" | "tiktok" | "facebook";
  /** social_accounts.id — an ALREADY-connected account, never invented. */
  accountId: string;
  accountLabel: string;
  caption: string;
  hashtags: string;
  /** The creator's own existing media (video, artwork, banner, avatar). */
  mediaUrl: string | null;
  mediaType: "video" | "image";
}

export interface MoveHomeLaunchDraft {
  posts: MoveHomeLaunchPostDraft[];
}

export interface MoveHomeDrafts {
  profile?: MoveHomeProfileDraft;
  store?: MoveHomeStoreDraft;
  press_kit?: MoveHomePressKitDraft;
  email_list?: MoveHomeEmailDraft;
  launch_posts?: MoveHomeLaunchDraft;
  /** How the copy was produced: polished by the AI rail, or assembled
      deterministically from the creator's own words when AI was off. */
  copySource?: "ai" | "assembled";
}

export const moveHomeProgressTable = pgTable("move_home_progress", {
  userId: uuid("user_id").primaryKey(),
  answers: jsonb("answers").$type<MoveHomeAnswers>().notNull().default({}),
  drafts: jsonb("drafts").$type<MoveHomeDrafts>().notNull().default({}),
  steps: jsonb("steps")
    .$type<Partial<Record<MoveHomeStepKey, MoveHomeStepState>>>()
    .notNull()
    .default({}),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type MoveHomeProgress = typeof moveHomeProgressTable.$inferSelect;
export type NewMoveHomeProgress = typeof moveHomeProgressTable.$inferInsert;
