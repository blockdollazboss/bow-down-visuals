/* Shorts creation wiring (linkage DE-11 / DE-12).
 *
 * "Post a short" surfaces carry ?short=1 into /publish, and the publish
 * page saves a fresh short through POST /api/shorts — the only writer
 * that sets is_short=true — instead of the regular /api/publish/video
 * path (which never sets it, so the "short" landed as a long-form
 * video and never reached the Shorts feed).
 *
 * The editor handoffs below are the shapes the video editor actually
 * consumes: duet/stitch land on the Repurpose tab, which resolves
 * video:<id> through the streaming API; a short's sound attaches via
 * the short:<sound_id> scheme, resolved through GET /api/sounds/:id.
 * These builders are the single source for the contract so the
 * buttons, the receivers, and the tests can't drift apart. */

export const SHORT_MAX_DURATION_SEC = 180;
export const SHORTS_API_PATH = "/api/shorts";

/** The publish-page deep link every "post a short" surface points at.
 *  A sound reference (from a "use this sound" surface) rides along so
 *  the short it creates is stamped with the sound it was made from —
 *  the publish page consumes ?soundId/soundTitle/soundUrl in its
 *  prefill protocol and buildShortPostBody forwards them. */
export function postShortPublishHref(sound?: {
  soundId?: string | null;
  soundTitle?: string | null;
  soundUrl?: string | null;
}): string {
  const q = new URLSearchParams({ type: "video", category: "video", short: "1" });
  if (sound?.soundId) q.set("soundId", sound.soundId);
  if (sound?.soundTitle) q.set("soundTitle", sound.soundTitle);
  if (sound?.soundUrl) q.set("soundUrl", sound.soundUrl);
  return `/publish?${q.toString()}`;
}

/** Editor deep link: duet the given profile video (a short). */
export function duetEditorHref(videoId: string): string {
  return `/video-editor?tab=repurpose&duet=video:${encodeURIComponent(videoId)}`;
}

/** Editor deep link: stitch the given profile video (a short). */
export function stitchEditorHref(videoId: string): string {
  return `/video-editor?tab=repurpose&stitch=video:${encodeURIComponent(videoId)}`;
}

/** Editor deep link: build with a Shorts sound (sound_id, not a track id). */
export function shortSoundEditorHref(soundId: string): string {
  return `/video-editor?tab=repurpose&sound=short:${encodeURIComponent(soundId)}`;
}

export interface ShortPostInput {
  profileId: string;
  title: string;
  videoUrl: string;
  thumbnailUrl?: string | null;
  description?: string;
  tags?: string[];
  durationSec?: number | null;
  publish: boolean;
  /* The sound this short was made from ("use this sound" flows), when
     the client holds a reference. The server stamps it onto the row's
     sound_id/sound_title/sound_url columns (migration 0091) — until
     this contract carried it, product-created shorts landed with the
     sound unrecorded even when the creator picked it deliberately. */
  soundId?: string | null;
  soundTitle?: string | null;
  soundUrl?: string | null;
  /* #29: accessibility description of the cover frame (thumbnail),
     creator-written or AI-suggested on the publish page. Forwarded
     only when non-empty, clamped to the endpoint's 400-char cap. */
  thumbnailAltText?: string | null;
}

/** Body for POST /api/shorts (postShortSchema server-side). Clamps to
 *  the schema's caps so a product-side save never 400s on fat tags or
 *  an over-long duration report. */
export function buildShortPostBody(input: ShortPostInput): Record<string, unknown> {
  const duration =
    input.durationSec == null || !Number.isFinite(input.durationSec)
      ? 0
      : Math.max(0, Math.min(SHORT_MAX_DURATION_SEC, Math.round(input.durationSec)));
  const tags = (input.tags ?? [])
    .map((t) => t.trim().slice(0, 40))
    .filter(Boolean)
    .slice(0, 30);
  const body: Record<string, unknown> = {
    profile_id: input.profileId,
    title: input.title.trim().slice(0, 120),
    video_url: input.videoUrl,
    thumbnail_url: input.thumbnailUrl ?? null,
    description: (input.description ?? "").slice(0, 2000),
    tags,
    duration_sec: duration,
    is_published: input.publish,
  };
  /* Sound reference: forwarded only when the client actually holds one,
     clamped to the endpoint's caps (id 80 / title 120 / url 2048) so a
     sound-carrying save never 400s on a fat reference either. The
     server derives the id from the title when only a title is given. */
  const soundId = input.soundId?.trim().slice(0, 80);
  const soundTitle = input.soundTitle?.trim().slice(0, 120);
  const soundUrl = input.soundUrl?.trim().slice(0, 2048);
  if (soundId) body.sound_id = soundId;
  if (soundTitle) body.sound_title = soundTitle;
  if (soundUrl) body.sound_url = soundUrl;
  const thumbnailAltText = input.thumbnailAltText?.trim().slice(0, 400);
  if (thumbnailAltText) body.thumbnail_alt_text = thumbnailAltText;
  return body;
}
