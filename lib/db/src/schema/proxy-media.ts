import { pgTable, uuid, text, integer, boolean, timestamp, doublePrecision, check, uniqueIndex, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * Proxy editing (Stack-200 board item 184, migration 9999-proxy-editing).
 *
 * A proxy is a low-resolution, lightweight copy of ONE heavy original
 * clip, made ONLY so the Visual Vibes editor can scrub / preview /
 * arrange that clip smoothly. It is never a deliverable:
 *
 *  - RELINK HONESTY: export ALWAYS renders from `original_url`. The
 *    proxy row keeps the original beside the proxy precisely so any
 *    clip URL that points at `proxy_url` can be swapped back to the
 *    original before a render starts (see api-server lib/proxy-editing
 *    `resolveExportSources` / `relinkKnownProxyUrls`, wired into the
 *    export job kickoff). There is no code path that exports a proxy.
 *  - ON DEMAND ONLY: a row is created only when the creator asks for a
 *    proxy for a clip that is actually heavy (see HEAVY_* thresholds in
 *    the api-server lib). Light clips get no row and no proxy — the
 *    editor keeps using the original and says so.
 *  - NO PRICES: proxy editing charges nothing and prices nothing.
 *
 * Status lifecycle: pending → generating → ready | failed. A failed
 * generation may be retried by requesting again (the request seam
 * re-queues the same row instead of minting a duplicate).
 */

export const PROXY_STATUSES = ["pending", "generating", "ready", "failed"] as const;
export type ProxyStatus = (typeof PROXY_STATUSES)[number];

/** The one proxy rendition profile: long edge capped at 854 px. */
export const PROXY_MAX_EDGE = 854;
export const PROXY_PROFILE_LABEL = "Proxy 854";

export const proxyMediaTable = pgTable("proxy_media", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  /** Project the clip belongs to, when the request came from a project. */
  projectId: text("project_id"),
  /** THE source of truth for export. Never a proxy URL. */
  originalUrl: text("original_url").notNull(),
  /** Null until generation finishes; only ever read by the PREVIEW. */
  proxyUrl: text("proxy_url"),
  originalWidth: integer("original_width"),
  originalHeight: integer("original_height"),
  originalBytes: integer("original_bytes"),
  originalDurationSec: doublePrecision("original_duration_sec"),
  originalCodec: text("original_codec"),
  proxyWidth: integer("proxy_width"),
  proxyHeight: integer("proxy_height"),
  status: text("status").notNull().default("pending"),
  /** Snapshot of the heavy verdict at request time (audit / honesty). */
  isHeavy: boolean("is_heavy").notNull().default(true),
  heavyReasons: text("heavy_reasons").array(),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check("proxy_media_status_check", sql`${t.status} IN ('pending', 'generating', 'ready', 'failed')`),
  uniqueIndex("proxy_media_user_original_idx").on(t.userId, t.originalUrl),
  index("proxy_media_user_project_idx").on(t.userId, t.projectId, t.createdAt),
  index("proxy_media_proxy_url_idx").on(t.proxyUrl),
  index("proxy_media_status_idx").on(t.status, t.createdAt),
]);

/**
 * Per-account proxy preference. No row = defaults (enabled). When a
 * creator turns proxy editing off, the editor previews originals only
 * and offers no new proxies; existing rows are kept (turning it back
 * on restores them) — off never deletes anyone's media.
 */
export const proxyPrefsTable = pgTable("proxy_prefs", {
  userId: uuid("user_id").primaryKey(),
  enabled: boolean("enabled").notNull().default(true),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ProxyMediaRow = typeof proxyMediaTable.$inferSelect;
export type ProxyPrefsRow = typeof proxyPrefsTable.$inferSelect;
