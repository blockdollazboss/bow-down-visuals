/**
 * Creator verticals for the publish flow (all-in-one, every creator).
 * Keep in sync with the /publish page picker.
 */
export const PUBLISH_VERTICALS = [
  "music",
  "video",
  "gaming",
  "podcast",
  "film",
  "tv",
  "influencer",
  "education",
  "other",
] as const;
export type PublishVertical = (typeof PUBLISH_VERTICALS)[number];

export interface PublishPrefill {
  /** "audio" → profile_tracks row, "video" → profile_videos row */
  type: "audio" | "video";
  category?: PublishVertical;
  /** Creation-tool path to deep-link back to (e.g. "/make-song"). */
  from?: string;
  /** Human label for the back-link (e.g. "Song Maker"). */
  fromLabel?: string;
  audioUrl?: string;
  videoUrl?: string;
  title?: string;
  /** artwork for audio, thumbnail for video */
  artworkUrl?: string;
  genre?: string;
  description?: string;
  durationSec?: number;
  isrc?: string;
  season?: number;
  episode?: number;
}

/**
 * Deep-link protocol for /publish (mirrors ?template=slug in thumbnail-maker).
 *
 *   /publish?type=audio&category=music&audioUrl=…&title=…&artwork=…&genre=…&from=/make-song&fromLabel=Song%20Maker
 *   /publish?type=video&category=film&videoUrl=…&title=…&thumbnail=…&season=1&episode=2&from=/movies&fromLabel=Movies
 *
 * Param contract: type, category, audioUrl, videoUrl, title, artwork,
 * thumbnail, genre, description, durationSec, isrc, season, episode,
 * from, fromLabel.
 * Values are URL-encoded; the page consumes them on mount and clears the
 * query string so a refresh doesn't re-prefill.
 */
export function buildPublishUrl(p: PublishPrefill): string {
  const q = new URLSearchParams();
  q.set("type", p.type);
  if (p.category) q.set("category", p.category);
  if (p.audioUrl) q.set("audioUrl", p.audioUrl);
  if (p.videoUrl) q.set("videoUrl", p.videoUrl);
  if (p.title) q.set("title", p.title);
  if (p.artworkUrl) q.set(p.type === "audio" ? "artwork" : "thumbnail", p.artworkUrl);
  if (p.genre) q.set("genre", p.genre);
  if (p.description) q.set("description", p.description);
  if (typeof p.durationSec === "number" && p.durationSec > 0)
    q.set("durationSec", String(Math.round(p.durationSec)));
  if (p.isrc) q.set("isrc", p.isrc);
  if (typeof p.season === "number" && p.season > 0) q.set("season", String(p.season));
  if (typeof p.episode === "number" && p.episode > 0) q.set("episode", String(p.episode));
  if (p.from) q.set("from", p.from);
  if (p.fromLabel) q.set("fromLabel", p.fromLabel);
  return `/publish?${q.toString()}`;
}
