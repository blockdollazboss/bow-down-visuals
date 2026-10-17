/* Scheduler deep-link protocol (linkage DE-4).
 *
 * Surfaces that own a release or a song hand the scheduler composer a
 * prefilled announcement through /scheduler?schedule=1 — the user
 * schedules from the thing itself, not from memory. The caption always
 * carries the item's canonical on-site link, and when the item has
 * cover art it rides along as the post's media through the schema's
 * EXISTING mediaUrl/mediaType fields (mediaType has supported "image"
 * since the schema was written; the composer just never sent it).
 *
 * There is deliberately no song field here — a scheduled post for a song
 * announces the track page, but the post belongs to no release. A real
 * release link DOES ride along: when the handoff comes from a release,
 * its id travels as `release` and the composer stamps it onto the
 * created row's release_id column (migration 0143) so release-driven
 * posts stay attributable to the release that spawned them. */

export type SchedulerMediaType = "video" | "image";
export type SchedulerPlatformKey = "instagram" | "tiktok" | "facebook";

export function parseSchedulerMediaType(v: string | null | undefined): SchedulerMediaType {
  return v === "image" ? "image" : "video";
}

export interface SchedulerHandoff {
  caption: string;
  media?: string | null;
  mediaType?: SchedulerMediaType;
  platforms?: SchedulerPlatformKey[];
  /** Distribution release id — present ONLY for release handoffs; the
   *  created scheduled post is stamped with it (release_id, 0143). */
  releaseId?: string | null;
}

export function buildSchedulerHref(h: SchedulerHandoff): string {
  const q = new URLSearchParams();
  q.set("schedule", "1");
  q.set("caption", h.caption);
  if (h.media) {
    q.set("media", h.media);
    q.set("mediaType", h.mediaType ?? "video");
  }
  if (h.platforms?.length) q.set("platform", h.platforms.join(","));
  if (h.releaseId) q.set("release", h.releaseId);
  return `/scheduler?${q.toString()}`;
}

/** Canonical on-site page for a library track. */
export function trackPageUrl(origin: string, trackId: string): string {
  return `${origin}/track/${trackId}`;
}

/** Announcement caption for a library song — the track's own page on
 *  our site is the link, so the post points home, not from memory. */
export function songAnnounceCaption(input: {
  title: string;
  artistName?: string | null;
  trackUrl: string;
}): string {
  const by = input.artistName ? ` by ${input.artistName}` : "";
  return `🎵 "${input.title}"${by} is out now — listen here: ${input.trackUrl} · Made with Bow Down Visuals`;
}

/** Announcement caption for a distribution release — carries the
 *  release's pre-save page, its canonical on-site link. */
export function releaseAnnounceCaption(input: {
  title: string;
  artistName: string;
  releaseDate?: string | null;
  presaveUrl: string;
}): string {
  const when = input.releaseDate ? `drops ${input.releaseDate}` : "is dropping soon";
  return `🎵 ${input.title} by ${input.artistName} ${when} — pre-save it now: ${input.presaveUrl} Made with Bow Down Visuals`;
}
