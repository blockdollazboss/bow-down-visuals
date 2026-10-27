/* ─── Drop Day Kit (#169) — UPGRADE of Product Drops + Release
   Checklist + Promo Clips + presave notify ──────────────────────────
   Existing drops are per-PRODUCT and generate no assets; presave
   pages already count down and the presave sweeper already emails
   followers at the release moment. The delta is the ONE-TAP ASSEMBLY
   for a music RELEASE that ties those rails into a single reviewed
   kit:

   - TEASER SHORT spec — built from the release's own audio + art,
     pre-loaded into Create. A spec, not a render: the creator
     renders it in Create.
   - BANNER SET — four standard sizes, each carrying the release's
     own artwork, title, artist, and date, pre-loaded into the
     cover-art panel.
   - COUNTDOWN — bound to the release's existing presave page (the
     page that already counts down and captures fans).
   - FAN HEADS-UP AT LAND TIME — kit-era captures are presave
     follows, and lib/presave-release-notify.ts already fans out to
     presave_follows exactly once when the release moment arrives.
     The kit adds no second sender; it guarantees the release is on
     that rail and shows the creator the real capture count.

   Honesty rules: the kit is assembled ONLY from the release's own
   fields. Whatever is missing (no audio, no artwork, no date, no
   presave page yet) is named in `missing` — never invented. The kit
   starts as a DRAFT: nothing is live until the creator reviews it
   and activates it, and activation requires the two pieces the
   land-time promise stands on — a release date and a presave page. */

import { sql, eq, and } from "drizzle-orm";
import { db, dropDayKitsTable, presaveFollowsTable } from "@workspace/db";
import { presaveUrl } from "./presave-url";

export interface KitRelease {
  id: string;
  userId: string;
  title: string;
  artistName: string;
  releaseDate: string | null;
  audioUrl: string | null;
  artworkUrl: string | null;
  status: string;
  presaveSlug: string | null;
}

export interface KitTeaser {
  kind: "teaser_short";
  status: "draft";
  durationSec: 15;
  audioUrl: string;
  artworkUrl: string | null;
  createLink: string;
}

export interface KitBanner {
  size: "profile" | "wide" | "post" | "story";
  width: number;
  height: number;
  artworkUrl: string;
  headline: string;
  subline: string;
  createLink: string;
}

export interface DropDayKitPayload {
  teaser: KitTeaser | null;
  banners: KitBanner[];
  countdown: { presaveUrl: string | null; releaseDate: string | null };
  /** Named gaps in the release the kit could not assemble from:
   *  'audio' | 'artwork' | 'release_date' | 'presave_page'. */
  missing: string[];
}

const BANNER_SIZES: Array<{ size: KitBanner["size"]; width: number; height: number }> = [
  { size: "profile", width: 1584, height: 396 },
  { size: "wide", width: 1920, height: 1080 },
  { size: "post", width: 1080, height: 1080 },
  { size: "story", width: 1080, height: 1920 },
];

function teaserCreateLink(release: KitRelease): string {
  const concept = `Teaser short for "${release.title}" by ${release.artistName} — 15 seconds, cut from the release track over its cover art. Drop day: ${release.releaseDate ?? "date to be set"}.`;
  return `/create?panel=video&concept=${encodeURIComponent(concept)}&intent=drop-day-teaser`;
}

function bannerCreateLink(release: KitRelease, size: KitBanner["size"]): string {
  const concept = `Drop-day banner (${size}) for "${release.title}" by ${release.artistName} — the release cover art, the title, and the release date (${release.releaseDate ?? "to be set"}).`;
  return `/create?panel=coverart&concept=${encodeURIComponent(concept)}&intent=drop-day-banner`;
}

/** Pure assembly — the whole kit definition lives here, built only
 *  from the release's own fields. */
export function assembleKit(release: KitRelease): DropDayKitPayload {
  const missing: string[] = [];

  let teaser: KitTeaser | null = null;
  if (release.audioUrl) {
    teaser = {
      kind: "teaser_short",
      status: "draft",
      durationSec: 15,
      audioUrl: release.audioUrl,
      artworkUrl: release.artworkUrl,
      createLink: teaserCreateLink(release),
    };
  } else {
    missing.push("audio");
  }

  let banners: KitBanner[] = [];
  if (release.artworkUrl) {
    const subline = release.releaseDate
      ? `${release.artistName} · ${release.releaseDate}`
      : release.artistName;
    banners = BANNER_SIZES.map((s) => ({
      ...s,
      artworkUrl: release.artworkUrl!,
      headline: release.title,
      subline,
      createLink: bannerCreateLink(release, s.size),
    }));
  } else {
    missing.push("artwork");
  }

  if (!release.releaseDate) missing.push("release_date");
  if (!release.presaveSlug) missing.push("presave_page");

  return {
    teaser,
    banners,
    countdown: {
      presaveUrl: release.presaveSlug ? presaveUrl(release.presaveSlug) : null,
      releaseDate: release.releaseDate,
    },
    missing,
  };
}

/** Activation stands on the land-time promise: a date to count down
 *  to and a presave page for fans to land on. Teaser/banner gaps are
 *  the creator's choice and never block. */
export function activationBlockers(kit: DropDayKitPayload): string[] {
  return kit.missing.filter((m) => m === "release_date" || m === "presave_page");
}

/** 'landed' is derived, never stored by a second writer: an active
 *  kit whose release moment has passed has landed (the presave
 *  sweeper owns the fan-out itself). release_date reads the same way
 *  the presave rail reads it — a YYYY-MM-DD date is UTC midnight. */
export function effectiveKitStatus(
  status: string,
  releaseDate: string | null,
  now: Date = new Date(),
): string {
  if (status !== "active" || !releaseDate) return status;
  const moment = /^\d{4}-\d{2}-\d{2}$/.test(releaseDate)
    ? new Date(`${releaseDate}T00:00:00.000Z`)
    : new Date(releaseDate);
  if (Number.isNaN(moment.getTime())) return status;
  return now >= moment ? "landed" : status;
}

/* ── Store ──────────────────────────────────────────────────────────── */

export interface DropDayKitStore {
  getByRelease(releaseId: string): Promise<Record<string, unknown> | null>;
  upsertKit(row: { userId: string; releaseId: string; kit: DropDayKitPayload }): Promise<{ id: string }>;
  setStatus(id: string, userId: string, status: "active"): Promise<boolean>;
  captureCount(releaseId: string): Promise<number>;
}

export const drizzleDropDayKitStore: DropDayKitStore = {
  async getByRelease(releaseId) {
    const rows = await db
      .select()
      .from(dropDayKitsTable)
      .where(eq(dropDayKitsTable.releaseId, releaseId))
      .limit(1);
    return (rows[0] as Record<string, unknown> | undefined) ?? null;
  },
  async upsertKit(row) {
    const inserted = await db
      .insert(dropDayKitsTable)
      .values({ userId: row.userId, releaseId: row.releaseId, kit: row.kit })
      .onConflictDoUpdate({
        target: dropDayKitsTable.releaseId,
        set: { kit: row.kit, updatedAt: new Date() },
      })
      .returning({ id: dropDayKitsTable.id });
    return { id: inserted[0]!.id };
  },
  async setStatus(id, userId, status) {
    const updated = await db
      .update(dropDayKitsTable)
      .set({ status, updatedAt: new Date() })
      .where(
        and(
          eq(dropDayKitsTable.id, id),
          eq(dropDayKitsTable.userId, userId),
          eq(dropDayKitsTable.status, "draft"),
        ),
      )
      .returning({ id: dropDayKitsTable.id });
    return updated.length > 0;
  },
  async captureCount(releaseId) {
    const rows = await db
      .select({ id: presaveFollowsTable.id })
      .from(presaveFollowsTable)
      .where(eq(presaveFollowsTable.releaseId, releaseId));
    return rows.length;
  },
};

/** Read the release the kit binds to — the same columns the
 *  distribution routes read, presave_slug included. */
export async function readKitRelease(releaseId: string): Promise<KitRelease | null> {
  const rows = await db.execute(sql`
    SELECT id, user_id, title, artist_name, release_date,
           audio_url, artwork_url, status, presave_slug
    FROM distribution_releases
    WHERE id = ${releaseId}
    LIMIT 1`);
  const r = (rows.rows as Array<Record<string, unknown>>)[0];
  if (!r) return null;
  return {
    id: String(r["id"]),
    userId: String(r["user_id"]),
    title: String(r["title"]),
    artistName: String(r["artist_name"]),
    releaseDate: r["release_date"] == null ? null : String(r["release_date"]),
    audioUrl: r["audio_url"] == null ? null : String(r["audio_url"]),
    artworkUrl: r["artwork_url"] == null ? null : String(r["artwork_url"]),
    status: String(r["status"]),
    presaveSlug: r["presave_slug"] == null ? null : String(r["presave_slug"]),
  };
}
