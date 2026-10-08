/* ─── Creator verticals — canonical list (Worker 6, discovery) ─────────────
   The platform serves ALL creators, not music-only. This is the single
   source of truth for the vertical set used by:
   - Discovery: /charts vertical switcher, /browse, /vertical/:vertical,
     search filters
   - Onboarding: "what kind of creator are you?" (Worker 1 / coordinator —
     import VERTICALS here instead of defining a second list)
   - Profile settings: creator_profiles.vertical (migration 0089)

   Keep the keys stable — they are stored in the DB. */

export const VERTICALS = [
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

export type VerticalKey = (typeof VERTICALS)[number];

export interface VerticalMeta {
  key: VerticalKey;
  label: string;
  plural: string;
  tagline: string;
  /** Short onboarding pitch: "what kind of creator are you?" */
  pitch: string;
}

export const VERTICAL_META: Record<VerticalKey, VerticalMeta> = {
  music: {
    key: "music",
    label: "Music",
    plural: "Artists",
    tagline: "Tracks, beats and anthems",
    pitch: "Artists, producers, DJs — drop tracks and build your sound.",
  },
  video: {
    key: "video",
    label: "Video",
    plural: "Video creators",
    tagline: "Shorts, vlogs and series",
    pitch: "YouTubers, TikTokers, filmmakers — your videos live here.",
  },
  gaming: {
    key: "gaming",
    label: "Gaming",
    plural: "Streamers",
    tagline: "Streams, clips and highlights",
    pitch: "Streamers and gamers — clips, highlights and live moments.",
  },
  podcast: {
    key: "podcast",
    label: "Podcasts",
    plural: "Podcasters",
    tagline: "Episodes and conversations",
    pitch: "Podcasters and hosts — episodes your audience can't miss.",
  },
  film: {
    key: "film",
    label: "Film",
    plural: "Filmmakers",
    tagline: "Shorts, docs and features",
    pitch: "Filmmakers — shorts, docs and features with a real audience.",
  },
  tv: {
    key: "tv",
    label: "TV",
    plural: "TV creators",
    tagline: "Episodes, shows and series",
    pitch: "Show creators — episodic series built for bingeing.",
  },
  influencer: {
    key: "influencer",
    label: "Influencers",
    plural: "Influencers",
    tagline: "Lifestyle, brand deals, collabs",
    pitch: "Influencers — grow your audience and land brand deals.",
  },
  education: {
    key: "education",
    label: "Education",
    plural: "Educators",
    tagline: "Courses, tutorials, how-tos",
    pitch: "Educators and coaches — teach what you know, get paid.",
  },
  other: {
    key: "other",
    label: "More",
    plural: "Creators",
    tagline: "Everything else breaking the internet",
    pitch: "Doing something the categories can't contain? Even better.",
  },
};

export function isVerticalKey(v: string): v is VerticalKey {
  return (VERTICALS as readonly string[]).includes(v);
}

export function verticalLabel(v: string): string {
  return isVerticalKey(v) ? VERTICAL_META[v].label : v;
}
