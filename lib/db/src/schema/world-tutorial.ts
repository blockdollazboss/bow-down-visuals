import {
  pgTable,
  uuid,
  integer,
  jsonb,
  timestamp,
} from "drizzle-orm/pg-core";

/**
 * "Your First 10 Minutes" — the tutorial quest line's progress
 * (Ring 3, Phase 6; THE-GAME §4.6 item 6). One row per member,
 * created lazily on their first tutorial read. Steps complete in
 * order: the line is a directed path, and `completedSteps` holds
 * the step KEYS already done (verb steps land here from the
 * World's room hooks; fact steps reconcile from the site's real
 * rails on read — the daily claim, quest progress, a published
 * track, a claimed quest reward).
 *
 * The completion reward is stamped here when it lands
 * (rewardAmountVb + rewardClaimedAt) so the shared weekly quest
 * pool can count it: the reward rides the ≤300 VB/week envelope,
 * it is never a new issuance.
 */
export const worldTutorialProgressTable = pgTable("world_tutorial_progress", {
  userId: uuid("user_id").primaryKey(),
  currentStep: integer("current_step").notNull().default(1),
  completedSteps: jsonb("completed_steps").notNull().default([]),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  rewardAmountVb: integer("reward_amount_vb"),
  rewardClaimedAt: timestamp("reward_claimed_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type WorldTutorialProgress = typeof worldTutorialProgressTable.$inferSelect;
export type NewWorldTutorialProgress = typeof worldTutorialProgressTable.$inferInsert;
