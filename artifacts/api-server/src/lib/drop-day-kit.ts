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
   land-time promise stands on — a release date and a presave page.

   H3 delta (the G1-scoped remainder): the RELEASE-DAY CHECKLIST and
   the Promote list. assembleChecklist derives the run-through from
   the same real rails — the release's own fields, the kit, the
   presave capture count, and the Scheduler's release-attributed
   posts (scheduled_posts.release_id, migration 0143) — and
   listKitReleases + GET /api/drop-day-kits/mine feed the kit's
   second home, the Drop Day panel docked in Promote. Steps the kit
   cannot verify (the teaser and banners render in Create) are
   'action', never 'done' — a checklist that ticks itself would be
   a lie with a checkbox. */

import { sql, eq, and } from "drizzle-orm";
import { db, dropDayKitsTable, presaveFollowsTable, scheduledPostsTable } from "@workspace/db";
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

/* ── Release-day checklist ──────────────────────────────────────────
   The run-through a creator works before drop day, derived ONLY
   from real state: the release's own fields, the assembled kit, the
   presave capture count, and the announcement posts the Scheduler
   attributes to this release. Three honest states:

   - 'done'   — the rail itself proves it (field present, post
                scheduled/posted, kit armed or landed);
   - 'todo'   — something is missing; the detail names where it is
                fixed (always an existing surface, never this kit);
   - 'action' — the creator's move: the kit holds a spec or a door,
                and only the creator can take the step (render in
                Create, schedule in the Scheduler, activate the kit).

   The teaser and banner steps are NEVER 'done': rendering happens
   in Create and the kit cannot see a render — claiming otherwise
   would tick a box nobody checked. */

export interface AnnounceState {
  draft: number;
  scheduled: number;
  posted: number;
}

export type KitChecklistState = "done" | "todo" | "action";

export interface KitChecklistStep {
  id: "audio" | "artwork" | "release_date" | "presave_page" | "teaser" | "banners" | "announce" | "heads_up";
  label: string;
  state: KitChecklistState;
  detail: string;
}

export function assembleChecklist(input: {
  release: KitRelease;
  kit: DropDayKitPayload | null;
  kitStatus: string | null;
  captures: number;
  announce: AnnounceState;
}): KitChecklistStep[] {
  const { release, kitStatus, captures, announce } = input;
  const steps: KitChecklistStep[] = [];

  steps.push(release.audioUrl
    ? { id: "audio", label: "Track audio", state: "done", detail: "On the release — the teaser short is cut from it." }
    : { id: "audio", label: "Track audio", state: "todo", detail: "Add the track in Distribute — the teaser short is cut from it." });

  steps.push(release.artworkUrl
    ? { id: "artwork", label: "Cover art", state: "done", detail: "On the release — the banner set and the announcement carry it." }
    : { id: "artwork", label: "Cover art", state: "todo", detail: "Add cover art in Distribute — the banner set is built from it." });

  steps.push(release.releaseDate
    ? { id: "release_date", label: "Release date", state: "done", detail: `Set for ${release.releaseDate} — everything on drop day is timed to it.` }
    : { id: "release_date", label: "Release date", state: "todo", detail: "Set the date in Distribute — everything on drop day is timed to it." });

  steps.push(release.presaveSlug
    ? { id: "presave_page", label: "Presave page", state: "done", detail: "Live — fans pre-save there and join the heads-up list." }
    : { id: "presave_page", label: "Presave page", state: "todo", detail: "Send the release to presave in Distribute — fans land there and join the heads-up list." });

  steps.push(!release.audioUrl
    ? { id: "teaser", label: "Teaser short", state: "todo", detail: "Needs the track audio first — the teaser is cut from it." }
    : { id: "teaser", label: "Teaser short", state: "action", detail: "The 15-second teaser spec is ready — it renders in Create, so this step stays open until you've made it." });

  steps.push(!release.artworkUrl
    ? { id: "banners", label: "Banner set", state: "todo", detail: "Needs the cover art first — every banner is built from it." }
    : { id: "banners", label: "Banner set", state: "action", detail: "Four banner sizes are specced from your cover art — they render in Create, so this step stays open until you've made them." });

  if (announce.posted > 0) {
    steps.push({ id: "announce", label: "Launch announcement", state: "done", detail: "Posted through the Scheduler." });
  } else if (announce.scheduled > 0) {
    steps.push({ id: "announce", label: "Launch announcement", state: "done", detail: "Scheduled in the Scheduler — it fires on its own at the time you set." });
  } else if (announce.draft > 0) {
    steps.push({ id: "announce", label: "Launch announcement", state: "action", detail: "A draft is waiting in the Scheduler — open it and set it for release day." });
  } else if (!release.presaveSlug) {
    steps.push({ id: "announce", label: "Launch announcement", state: "todo", detail: "Needs the presave page first — its link rides inside the announcement." });
  } else {
    steps.push({ id: "announce", label: "Launch announcement", state: "action", detail: "Opens in the Scheduler already written, link and cover art riding along — you pick the time and where it posts." });
  }

  if (kitStatus === "landed") {
    steps.push({ id: "heads_up", label: "Fan heads-up", state: "done", detail: "Landed — the presave list got the heads-up at the release moment, exactly once." });
  } else if (kitStatus === "active") {
    steps.push({ id: "heads_up", label: "Fan heads-up", state: "done", detail: `Armed — ${captures} on the presave list get one heads-up email at the release moment.` });
  } else if (kitStatus === "draft") {
    steps.push({ id: "heads_up", label: "Fan heads-up", state: "action", detail: "Activate the kit to arm it — every fan on the presave list gets one heads-up email at the release moment." });
  } else {
    steps.push({ id: "heads_up", label: "Fan heads-up", state: "todo", detail: "Assemble the kit to set this up." });
  }

  return steps;
}

/* ── Store ──────────────────────────────────────────────────────────── */

export interface DropDayKitStore {
  getByRelease(releaseId: string): Promise<Record<string, unknown> | null>;
  listKitsByUser(userId: string): Promise<Array<Record<string, unknown>>>;
  upsertKit(row: { userId: string; releaseId: string; kit: DropDayKitPayload }): Promise<{ id: string }>;
  setStatus(id: string, userId: string, status: "active"): Promise<boolean>;
  captureCount(releaseId: string): Promise<number>;
  announceState(releaseId: string, userId: string): Promise<AnnounceState>;
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
  async listKitsByUser(userId) {
    const rows = await db
      .select()
      .from(dropDayKitsTable)
      .where(eq(dropDayKitsTable.userId, userId));
    return rows as Array<Record<string, unknown>>;
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
  /* The announcement posts the Scheduler attributes to this release
     (release_id, migration 0143), scoped to the kit's owner — a
     count by lifecycle bucket, nothing about anyone else's posts.
     'publishing' counts as scheduled: the poller has claimed it and
     it is on its way out. Failed/cancelled posts count nowhere —
     they announce nothing. */
  async announceState(releaseId, userId) {
    const rows = await db
      .select({ status: scheduledPostsTable.status })
      .from(scheduledPostsTable)
      .where(
        and(
          eq(scheduledPostsTable.release_id, releaseId),
          eq(scheduledPostsTable.user_id, userId),
        ),
      );
    const state: AnnounceState = { draft: 0, scheduled: 0, posted: 0 };
    for (const r of rows) {
      if (r.status === "draft") state.draft += 1;
      else if (r.status === "scheduled" || r.status === "publishing") state.scheduled += 1;
      else if (r.status === "posted") state.posted += 1;
    }
    return state;
  },
};

function rowToKitRelease(r: Record<string, unknown>): KitRelease {
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

const KIT_RELEASE_COLUMNS = sql`id, user_id, title, artist_name, release_date,
           audio_url, artwork_url, status, presave_slug`;

/** Read the release the kit binds to — the same columns the
 *  distribution routes read, presave_slug included. */
export async function readKitRelease(releaseId: string): Promise<KitRelease | null> {
  const rows = await db.execute(sql`
    SELECT ${KIT_RELEASE_COLUMNS}
    FROM distribution_releases
    WHERE id = ${releaseId}
    LIMIT 1`);
  const r = (rows.rows as Array<Record<string, unknown>>)[0];
  return r ? rowToKitRelease(r) : null;
}

/** Every release the caller owns, soonest drop first (undated
 *  releases last, newest first among themselves) — the Promote
 *  panel's list. Same columns, same mapping as readKitRelease. */
export async function listKitReleases(userId: string): Promise<KitRelease[]> {
  const rows = await db.execute(sql`
    SELECT ${KIT_RELEASE_COLUMNS}
    FROM distribution_releases
    WHERE user_id = ${userId}
    ORDER BY (release_date IS NULL), release_date ASC, created_at DESC`);
  return (rows.rows as Array<Record<string, unknown>>).map(rowToKitRelease);
}
