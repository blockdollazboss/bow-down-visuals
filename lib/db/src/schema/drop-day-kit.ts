import { pgTable, uuid, text, jsonb, timestamp, uniqueIndex, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * Drop Day Kit (#169) — UPGRADE of Product Drops + Release Checklist +
 * Promo Clips + presave notify.
 *
 * One kit per music RELEASE (distribution_releases). The kit is the
 * one-tap assembly the audit scoped: a teaser-short spec and a banner
 * set auto-built from the release's OWN art and track, the countdown
 * bound to the release's existing presave page, and the fan heads-up
 * at land time riding the existing presave rail (kit-era captures are
 * presave_follows, which lib/presave-release-notify.ts already fans
 * out exactly once at the release moment).
 *
 * The kit assembles from the release's own fields and never
 * invents: the teaser stays a SPEC (a video — it renders in Create
 * from the kit's pre-loaded link), while the banners carry FINISHED
 * renders since stack1300 — lib/drop-day-kit-render composites the
 * release's own art + verbatim title/artist/date at assembly and
 * stores each render's storage ref on the banner (imageRef; null =
 * still a spec, Create link is the fallback). The kit sits at
 * 'draft' inside the payload until the creator reviews it and
 * activates it. Anything the release lacks (no artwork, no audio,
 * no date, no presave page) is listed in payload.missing — never
 * invented to complete the set. (Migration 0284's header predates
 * the banner renders and is left as the historical record.)
 *
 * Status: draft (assembled, awaiting review) → active (creator
 * approved the kit) → landed (release moment passed; read-side flip,
 * the presave sweeper owns the actual fan-out).
 *
 * Migration: provisional 0284_drop_day_kit.sql (renumbered at join).
 */
export const dropDayKitsTable = pgTable(
  "drop_day_kits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull(),
    /** The distribution release this kit was assembled for. One kit
     *  per release — re-assembly updates the same row. */
    releaseId: uuid("release_id").notNull(),
    /** 'draft' | 'active' | 'landed' */
    status: text("status").notNull().default("draft"),
    /** The assembled kit: { teaser, banners, countdown, missing } —
     *  built by lib/drop-day-kit from the release's own fields. */
    kit: jsonb("kit").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("drop_day_kits_status_check", sql`${t.status} IN ('draft','active','landed')`),
    uniqueIndex("drop_day_kits_release_idx").on(t.releaseId),
  ],
);

