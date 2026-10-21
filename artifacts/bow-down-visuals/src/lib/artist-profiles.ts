/* ─── Creator Profiles — shared types, verticals, starter templates, themes ──
   The Creator Streaming Platform serves ALL creators equally — music, video,
   gaming, podcast, film, tv, influencer, education, everything on the site.
   Every piece of copy here is audience-agnostic ("fans", "audience",
   "community"), and every default layout is tuned per vertical.

   NOTE: CRUD API (GET /api/creator-profiles/:slug, POST/PUT /api/creator-profiles,
   PUT /api/creator-profiles/me, follows, profile_comments) is Worker 1's
   foundation. These types mirror that contract; the AI designer endpoints
   (/api/ai-page-designer/*) are Worker 4's own. Optional extension fields
   (stream_schedule, media_kit, series) are read defensively — the renderer
   never crashes if they're absent. */

import { formatDuration, type StreamTrack, type StreamVideo } from "@/lib/streaming";

export type VerticalId =
  | "music"
  | "video"
  | "gaming"
  | "podcast"
  | "film"
  | "tv"
  | "influencer"
  | "education"
  | "other";

export interface VerticalMeta {
  id: VerticalId;
  label: string;
  tagline: string;
  emoji: string;
  audienceWord: string;
}

export const VERTICALS: VerticalMeta[] = [
  { id: "music",      label: "Music",            tagline: "Tracks, videos, tour dates",        emoji: "🎵", audienceWord: "fans" },
  { id: "video",      label: "Video Creator",    tagline: "Videos, series, uploads",           emoji: "🎬", audienceWord: "viewers" },
  { id: "gaming",     label: "Gamer / Streamer", tagline: "Streams, clips, highlights",       emoji: "🎮", audienceWord: "community" },
  { id: "podcast",    label: "Podcaster",        tagline: "Episodes, series, live shows",      emoji: "🎙️", audienceWord: "listeners" },
  { id: "film",       label: "Filmmaker",        tagline: "Films, trailers, behind the scenes", emoji: "🎞️", audienceWord: "audience" },
  { id: "tv",         label: "TV / Series",      tagline: "Seasons, episodes, trailers",       emoji: "📺", audienceWord: "audience" },
  { id: "influencer", label: "Influencer",       tagline: "Content, collabs, media kit",      emoji: "⭐", audienceWord: "audience" },
  { id: "education",  label: "Educator",         tagline: "Lessons, courses, resources",       emoji: "📚", audienceWord: "students" },
  { id: "other",      label: "Something Else",   tagline: "Your thing, your way",              emoji: "✨", audienceWord: "fans" },
];

/* Every section type stays available to every creator — verticals only
   change the DEFAULT order and titles. */
export type SectionType =
  | "hero"        // featured media hero (click-to-play)
  | "tracks"      // music tracks / podcast episodes / audio lessons
  | "videos"      // videos / clips & highlights / vlogs / lessons
  | "series"      // series/season/episode grouping (playlists, kind='series')
  | "merch"       // merch shelf (links to their my-shop / products)
  | "events"      // tour dates / premieres / workshops (links to events)
  | "schedule"    // stream schedule + "live now" state
  | "mediakit"    // audience stats, rates, collab CTA → sponsorship flow
  | "posts"       // social posts feed
  | "bio"         // about blocks
  | "shoutwall"   // profile comments
  | "stories"     // 24h stories + highlights (Worker 8)
  | "topcreators"; // MySpace-style avatar strip

export interface ProfileSection {
  id: string;
  type: SectionType;
  title: string;
  visible: boolean;
}

/* ─── Safe theme tokens ONLY. No freeform CSS — custom themes can never
       break layout, mobile or otherwise. ─── */
export interface ThemeConfig {
  themeId: string;
  colors: {
    background: string;
    surface: string;
    primary: string;
    accent: string;
    text: string;
    mutedText: string;
    cardBg: string;
    border: string;
  };
  fonts: { heading: FontId; body: FontId };
  banner: { layout: "full-bleed" | "contained" | "split"; overlayOpacity: number };
  spacing: "compact" | "comfortable" | "roomy";
  cornerRadius: "sharp" | "rounded" | "pill";
}

export type FontId =
  | "Cinzel"
  | "Playfair Display"
  | "Bebas Neue"
  | "DM Serif Display"
  | "Space Grotesk"
  | "Inter";

export const SAFE_FONTS: { id: FontId; stack: string }[] = [
  { id: "Cinzel", stack: "'Cinzel', Georgia, serif" },
  { id: "Playfair Display", stack: "'Playfair Display', Georgia, serif" },
  { id: "Bebas Neue", stack: "'Bebas Neue', 'Arial Narrow', sans-serif" },
  { id: "DM Serif Display", stack: "'DM Serif Display', Georgia, serif" },
  { id: "Space Grotesk", stack: "'Space Grotesk', system-ui, sans-serif" },
  { id: "Inter", stack: "'Inter', system-ui, sans-serif" },
];

export interface ThemePreset extends ThemeConfig {
  name: string;
  blurb: string;
}

/* Six gold/black luxury presets — the house look. */
export const THEME_PRESETS: ThemePreset[] = [
  {
    themeId: "royal-gold",
    name: "Royal Gold",
    blurb: "The house look. Golden black marble, bronze light, cream type.",
    colors: { background: "#0d0a04", surface: "#14100a", primary: "#c9a84c", accent: "#f0d488", text: "#f7ecd2", mutedText: "#a08c5f", cardBg: "#171208", border: "#3d2e12" },
    fonts: { heading: "Cinzel", body: "Inter" },
    banner: { layout: "full-bleed", overlayOpacity: 0.5 },
    spacing: "comfortable", cornerRadius: "rounded",
  },
  {
    themeId: "midnight-gold",
    name: "Midnight Gold",
    blurb: "The signature. Black velvet, molten gold, sharp edges.",
    colors: { background: "#0a0a0b", surface: "#121214", primary: "#d4af37", accent: "#f5d67b", text: "#f5f1e6", mutedText: "#a8a29e", cardBg: "#161618", border: "#2a2416" },
    fonts: { heading: "Cinzel", body: "Inter" },
    banner: { layout: "full-bleed", overlayOpacity: 0.55 },
    spacing: "comfortable", cornerRadius: "sharp",
  },
  {
    themeId: "royal-noir",
    name: "Royal Noir",
    blurb: "Deep noir with champagne highlights — red-carpet energy.",
    colors: { background: "#0d0c10", surface: "#141218", primary: "#c9a227", accent: "#e8c874", text: "#f2ede3", mutedText: "#9c948a", cardBg: "#17141c", border: "#2e2718" },
    fonts: { heading: "Playfair Display", body: "Inter" },
    banner: { layout: "contained", overlayOpacity: 0.4 },
    spacing: "roomy", cornerRadius: "rounded",
  },
  {
    themeId: "stage-lights",
    name: "Stage Lights",
    blurb: "High contrast, big type — built for hype and headlines.",
    colors: { background: "#08080a", surface: "#101012", primary: "#eab308", accent: "#fde047", text: "#ffffff", mutedText: "#b8b4ad", cardBg: "#121215", border: "#332f1a" },
    fonts: { heading: "Bebas Neue", body: "Space Grotesk" },
    banner: { layout: "full-bleed", overlayOpacity: 0.65 },
    spacing: "compact", cornerRadius: "sharp",
  },
  {
    themeId: "velvet-lounge",
    name: "Velvet Lounge",
    blurb: "Warm, intimate, after-hours. Slow burns welcome.",
    colors: { background: "#100c08", surface: "#171009", primary: "#d4a24e", accent: "#f0c987", text: "#f7efe2", mutedText: "#a89a86", cardBg: "#1a130c", border: "#33261a" },
    fonts: { heading: "DM Serif Display", body: "Inter" },
    banner: { layout: "split", overlayOpacity: 0.35 },
    spacing: "roomy", cornerRadius: "pill",
  },
  {
    themeId: "chrome-empire",
    name: "Chrome Empire",
    blurb: "Sleek metallics, futuristic edge — the empire look.",
    colors: { background: "#0b0d10", surface: "#111419", primary: "#c8b06a", accent: "#e9d9a6", text: "#eef0f2", mutedText: "#9aa3ad", cardBg: "#141821", border: "#2b2f1e" },
    fonts: { heading: "Space Grotesk", body: "Inter" },
    banner: { layout: "full-bleed", overlayOpacity: 0.5 },
    spacing: "comfortable", cornerRadius: "rounded",
  },
  {
    themeId: "gilded-minimal",
    name: "Gilded Minimal",
    blurb: "Quiet luxury. Lots of air, one perfect gold line.",
    colors: { background: "#111110", surface: "#161614", primary: "#bfa14f", accent: "#d9c27a", text: "#f4f2ec", mutedText: "#a3a099", cardBg: "#191917", border: "#26251d" },
    fonts: { heading: "Inter", body: "Inter" },
    banner: { layout: "contained", overlayOpacity: 0.3 },
    spacing: "roomy", cornerRadius: "rounded",
  },
];

/* ─── Per-vertical starter templates ─── */
export interface StarterTemplate {
  vertical: VerticalId;
  sections: ProfileSection[];
  themeId: string;
  hint: string;
}

const mk = (order: [SectionType, string][]): ProfileSection[] =>
  order.map(([type, title], i) => ({
    id: `${type}-${i}`,
    type,
    title,
    visible: true,
  }));

export const STARTER_TEMPLATES: StarterTemplate[] = [
  {
    vertical: "music",
    themeId: "midnight-gold",
    hint: "Featured track hero → music → videos → merch → tour. Fans press play in one tap.",
    sections: mk([
      ["hero", "Featured Track"], ["tracks", "Music"], ["videos", "Videos"],
      ["merch", "Merch Shelf"], ["events", "Tour Dates"], ["bio", "About"],
      ["shoutwall", "Shout Wall"], ["topcreators", "Top Creators"],
    ]),
  },
  {
    vertical: "video",
    themeId: "stage-lights",
    hint: "Featured video hero → videos → series/playlists → merch. Video-first wins.",
    sections: mk([
      ["hero", "Featured Video"], ["videos", "Videos"], ["series", "Series & Playlists"],
      ["merch", "Merch Shelf"], ["bio", "About"], ["shoutwall", "Shout Wall"],
      ["topcreators", "Top Creators"], ["events", "Events"],
    ]),
  },
  {
    vertical: "gaming",
    themeId: "chrome-empire",
    hint: "Stream hero with your schedule + live state → clips & highlights → the rest.",
    sections: mk([
      ["hero", "Stream"], ["videos", "Clips & Highlights"], ["schedule", "Stream Schedule"],
      ["series", "Series"], ["merch", "Merch Shelf"], ["bio", "About"],
      ["shoutwall", "Shout Wall"], ["topcreators", "Top Creators"],
    ]),
  },
  {
    vertical: "podcast",
    themeId: "velvet-lounge",
    hint: "Featured episode hero → episodes → series → guest links. Built for the binge.",
    sections: mk([
      ["hero", "Featured Episode"], ["tracks", "Episodes"], ["series", "Series"],
      ["videos", "Video Clips"], ["bio", "About the Show"], ["events", "Live Shows"],
      ["shoutwall", "Shout Wall"], ["topcreators", "Top Creators"],
    ]),
  },
  {
    vertical: "film",
    themeId: "royal-noir",
    hint: "Featured trailer hero → films & seasons → behind-the-scenes. Festival-program energy.",
    sections: mk([
      ["hero", "Featured Trailer"], ["series", "Films & Seasons"], ["videos", "Behind the Scenes"],
      ["bio", "About"], ["events", "Premieres"], ["shoutwall", "Shout Wall"],
      ["topcreators", "Top Creators"], ["merch", "Merch Shelf"],
    ]),
  },
  {
    vertical: "tv",
    themeId: "royal-noir",
    hint: "Same episodic treatment as film: trailer hero → seasons → extras.",
    sections: mk([
      ["hero", "Featured Trailer"], ["series", "Seasons & Episodes"], ["videos", "Behind the Scenes"],
      ["bio", "About"], ["events", "Premieres"], ["shoutwall", "Shout Wall"],
      ["topcreators", "Top Creators"], ["merch", "Merch Shelf"],
    ]),
  },
  {
    vertical: "influencer",
    themeId: "gilded-minimal",
    hint: "Media-kit hero with your stats and rates → collab CTA → content. Brands see the numbers first.",
    sections: mk([
      ["hero", "Featured"], ["mediakit", "Media Kit"], ["videos", "Content"],
      ["tracks", "Audio"], ["merch", "My Picks"], ["bio", "About"],
      ["shoutwall", "Shout Wall"], ["topcreators", "Top Creators"],
    ]),
  },
  {
    vertical: "education",
    themeId: "gilded-minimal",
    hint: "Featured lesson hero → lessons → resources. Proof of value first, story after.",
    sections: mk([
      ["hero", "Featured Lesson"], ["videos", "Lessons"], ["series", "Courses"],
      ["merch", "Resources"], ["bio", "About"], ["events", "Workshops"],
      ["shoutwall", "Shout Wall"], ["topcreators", "Top Creators"],
    ]),
  },
  {
    vertical: "other",
    themeId: "midnight-gold",
    hint: "Balanced default: hero → best content → your story. Every section type is yours to rearrange.",
    sections: mk([
      ["hero", "Featured"], ["videos", "Videos"], ["tracks", "Audio"],
      ["bio", "About"], ["merch", "Merch Shelf"], ["events", "Events"],
      ["shoutwall", "Shout Wall"], ["topcreators", "Top Creators"],
    ]),
  },
];

export function starterTemplate(vertical: VerticalId): StarterTemplate {
  return STARTER_TEMPLATES.find((t) => t.vertical === vertical) ?? STARTER_TEMPLATES[STARTER_TEMPLATES.length - 1]!;
}

export function presetById(themeId: string): ThemePreset {
  return THEME_PRESETS.find((t) => t.themeId === themeId) ?? THEME_PRESETS[0]!;
}

export const SECTION_TYPE_LABELS: Record<SectionType, string> = {
  hero: "Featured Hero",
  tracks: "Tracks / Episodes",
  videos: "Videos / Clips",
  series: "Series & Seasons",
  merch: "Merch Shelf",
  events: "Events / Tour",
  schedule: "Stream Schedule",
  mediakit: "Media Kit",
  posts: "Social Posts",
  bio: "About",
  shoutwall: "Shout Wall",
  stories: "Stories",
  topcreators: "Top Creators",
};

/* ─── Optional extension fields (read defensively) ─── */
export interface StreamSlot {
  day: string;
  time: string;
  label?: string;
}
export interface StreamInfo {
  isLive?: boolean;
  liveUrl?: string;
  platform?: string;
  schedule?: StreamSlot[];
  nextStream?: string;
}
export interface MediaKit {
  followers?: string;
  avgViews?: string;
  engagement?: string;
  audienceNote?: string;
  rates?: { label: string; price: string }[];
  contactEmail?: string;
}
export interface SeriesEpisode {
  id: string;
  title: string;
  thumbnailUrl?: string;
  duration?: string;
}
export interface SeriesSeason {
  season: number | string;
  title?: string;
  episodes: SeriesEpisode[];
}
export interface SeriesEntry {
  id: string;
  title: string;
  kind: "series";
  thumbnailUrl?: string;
  seasons: SeriesSeason[];
}

/* ─── Profile data contract (mirrors Worker 1's creator_profiles API) ─── */
export interface FeaturedMedia {
  kind: "track" | "video" | "episode";
  id: string;
  title?: string;
  url?: string;
  thumbnailUrl?: string;
  /** Deep link to the track/video page — the hero is never an island. */
  pageUrl?: string;
}

export interface MerchItem {
  id: string;
  title: string;
  price?: string;
  imageUrl?: string;
  /** Link to the product. Falls back to the creator's shop. */
  url?: string;
}

export interface ProfileEventItem {
  id: string;
  title: string;
  date?: string;
  venue?: string;
  city?: string;
  /** Link to the event detail. Falls back to /tour. */
  url?: string;
}

export interface SocialPostItem {
  id: string;
  text: string;
  imageUrl?: string;
  url?: string;
  created_at?: string;
}

/* One catalog row as the profile Music / Videos blocks render it
   (thumbnail, title, inline preview, duration · plays, deep link). The
   public-profile endpoint returns the creator's published work as
   snake_case top_tracks / top_videos; the fetch boundary normalizes
   them into this shape (see normalizePublicProfile below) — before
   that mapping existed the blocks read a media_items field no payload
   ever set and rendered nothing for every creator. */
export interface ProfileMediaItem {
  id: string;
  title: string;
  thumbnailUrl?: string;
  url?: string;
  duration?: string;
  plays?: number;
  /** The creator's pinned item (profile-song pin) — the server leads
      the list with it; the row renders the gold "Pinned" treatment. */
  isPinned?: boolean;
  /** Deep link to the track/video page — media rows are never islands. */
  href?: string;
}

export interface SocialProofFigureDto {
  key: string;
  platform: string;
  label: string;
  /** The exact number the platform returned — rendered in full. */
  value: number;
  accountLabel: string;
  updatedAt: string;
  /** Past the 6h fresh window — the strip shows the date either way. */
  stale: boolean;
}

export interface CreatorProfile {
  id: string;
  user_id: string;
  slug: string;
  display_name: string;
  bio: string;
  avatar_url: string | null;
  banner_url: string | null;
  vertical: VerticalId;
  theme_id: string;
  theme_config: ThemeConfig;
  sections: ProfileSection[];
  featured_media: FeaturedMedia | null;
  social_links: Record<string, string>;
  top_creators: string[];
  tip_jar_enabled: boolean;
  ai_design: Record<string, unknown> | null;
  is_public: boolean;
  /* Official house/company account (migration 0125) — e.g. Thy Cheat Code. */
  is_official?: boolean;
  /* Stack 3, item 7: paid-plan state (server-resolved). Free profiles
     carry the "Powered by Bow Down Visuals" footer mark; paid profiles
     are clean. Absent (older payload) reads as NOT paid. */
  paid_plan?: boolean;
  follower_count: number;
  total_plays: number;
  referral_code?: string | null;
  /* The creator's public customer-shop handle — the Merch shelf links
     to /shop/<handle>. Null/absent when they have no shop. */
  shop_handle?: string | null;
  /* Virality wave: the creator's referral rank badge (null when unranked). */
  recruiter_badge?: { stars: number; title: string; signups: number; ratePct: number } | null;
  /* C5: live social proof — verified figures from the creator's
     connected accounts, already shaped server-side for public display
     (hidden / disconnected / >7-day figures never ship). updatedAt is
     when the platform actually returned the number. */
  social_proof?: SocialProofFigureDto[];
  custom_domain?: string | null;
  /* Extension fields (Worker 4) — optional, rendered defensively. */
  stream_schedule?: StreamInfo | null;
  media_kit?: MediaKit | null;
  series?: SeriesEntry[] | null;
  merch_items?: MerchItem[] | null;
  events?: ProfileEventItem[] | null;
  social_posts?: SocialPostItem[] | null;
  /* Published catalog from the public endpoint's top_tracks /
     top_videos, normalized at the fetch boundary. Present on profiles
     loaded through fetchPublicProfile; the Music / Videos blocks read
     it directly. Absent (owner /me payload) renders as no catalog. */
  media_items?: { tracks: ProfileMediaItem[]; videos: ProfileMediaItem[] };
}

export const DEFAULT_THEME: ThemeConfig = { ...THEME_PRESETS[0]! };

export function emptyProfile(overrides: Partial<CreatorProfile> = {}): CreatorProfile {
  const tpl = starterTemplate((overrides.vertical as VerticalId) ?? "other");
  return {
    id: "",
    user_id: "",
    slug: "",
    display_name: "",
    bio: "",
    avatar_url: null,
    banner_url: null,
    vertical: "other",
    theme_id: tpl.themeId,
    theme_config: { ...presetById(tpl.themeId) },
    sections: tpl.sections,
    featured_media: null,
    social_links: {},
    top_creators: [],
    tip_jar_enabled: true,
    ai_design: null,
    is_public: false,
    follower_count: 0,
    total_plays: 0,
    ...overrides,
  };
}

/* ─── API helpers ─── */
async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err = new Error((body as { error?: string }).error || `Request failed (${res.status})`) as Error & { status?: number };
    // Preserve the HTTP status so callers can tell a genuine 404 (page
    // really doesn't exist) from a 500/network failure (page may exist,
    // the load just failed) — those need different UI states.
    err.status = res.status;
    throw err;
  }
  return res.json() as Promise<T>;
}

/* A profile whose layout was never saved (seeded or API-created rows
   store the column default: no sections) would render an empty shell —
   ProfileSections maps the sections array, so no hero, no name, no
   banner ever mounts. Fall back to the vertical's starter layout,
   exactly what profile creation would have stored; a layout the
   creator actually saved is never touched. Also coerce the array
   fields the renderers dereference (sections.filter, top_creators
   .join/.map) so a null can never reach them. */
function withRenderableLayout(p: CreatorProfile): CreatorProfile {
  const sections = Array.isArray(p.sections) && p.sections.length > 0
    ? p.sections
    : starterTemplate(p.vertical ?? "other").sections;
  const top_creators = Array.isArray(p.top_creators) ? p.top_creators : [];
  return { ...p, sections, top_creators };
}

/* ─── Public-profile fetch boundary ───────────────────────────────────
   GET /api/creator-profiles/:slug answers
   { profile, counts, top_tracks, top_videos, playlists } where
   top_tracks / top_videos are the creator's published catalog rows
   (snake_case DTOs — the same shapes streaming.ts types). Normalize
   them onto profile.media_items HERE, at the boundary, so every
   consumer (the Grand Stage Music / Videos blocks included) reads one
   camelCase shape and the wire shape never leaks into components. */
export interface PublicProfileWire {
  profile?: CreatorProfile;
  top_tracks?: StreamTrack[] | null;
  top_videos?: StreamVideo[] | null;
  [key: string]: unknown;
}

function trackToMediaItem(t: StreamTrack): ProfileMediaItem {
  return {
    id: t.id,
    title: t.title,
    thumbnailUrl: t.artwork_url ?? undefined,
    url: t.audio_url,
    duration: t.duration_sec ? formatDuration(t.duration_sec) : undefined,
    plays: t.play_count ?? 0,
    isPinned: t.is_pinned === true,
    /* The track's own stream page — a catalog row always leads
       somewhere real, never a dead click. */
    href: `/track/${t.id}`,
  };
}

function videoToMediaItem(v: StreamVideo): ProfileMediaItem {
  return {
    id: v.id,
    title: v.title,
    thumbnailUrl: v.thumbnail_url ?? undefined,
    url: v.video_url,
    duration: v.duration_sec ? formatDuration(v.duration_sec) : undefined,
    plays: v.view_count ?? 0,
    isPinned: v.is_pinned === true,
    href: `/watch/${v.id}`,
  };
}

export function normalizePublicProfile(data: PublicProfileWire | CreatorProfile): CreatorProfile {
  const wire = data as PublicProfileWire;
  const profile = wire.profile ?? (data as CreatorProfile);
  const tracks = Array.isArray(wire.top_tracks) ? wire.top_tracks.map(trackToMediaItem) : [];
  const videos = Array.isArray(wire.top_videos) ? wire.top_videos.map(videoToMediaItem) : [];
  return withRenderableLayout({ ...profile, media_items: { tracks, videos } });
}

export async function fetchPublicProfile(slug: string): Promise<CreatorProfile> {
  const res = await fetch(`/api/creator-profiles/${encodeURIComponent(slug)}`);
  const data = await json<PublicProfileWire | CreatorProfile>(res);
  return normalizePublicProfile(data);
}

export async function fetchMyProfile(): Promise<CreatorProfile | null> {
  const res = await fetch("/api/creator-profiles/me");
  if (res.status === 404) return null;
  const data = await json<{ profile?: CreatorProfile } | CreatorProfile>(res);
  return (data as { profile?: CreatorProfile }).profile ?? (data as CreatorProfile);
}

export async function saveMyProfile(patch: Partial<CreatorProfile>): Promise<CreatorProfile> {
  const res = await fetch("/api/creator-profiles/me", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  const data = await json<{ profile?: CreatorProfile } | CreatorProfile>(res);
  return (data as { profile?: CreatorProfile }).profile ?? (data as CreatorProfile);
}

export async function createProfile(patch: Partial<CreatorProfile>): Promise<CreatorProfile> {
  const res = await fetch("/api/creator-profiles", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  const data = await json<{ profile?: CreatorProfile } | CreatorProfile>(res);
  return (data as { profile?: CreatorProfile }).profile ?? (data as CreatorProfile);
}

export interface ProfileComment {
  id: string;
  author_name: string;
  author_avatar_url?: string | null;
  /** When the author has a profile, their name links to it. */
  author_slug?: string | null;
  body: string;
  created_at: string;
}

export async function fetchComments(slug: string): Promise<ProfileComment[]> {
  const res = await fetch(`/api/creator-profiles/${encodeURIComponent(slug)}/comments`);
  const data = await json<{ comments?: ProfileComment[] } | ProfileComment[]>(res);
  return (data as { comments?: ProfileComment[] }).comments ?? (data as ProfileComment[]);
}

export async function postComment(slug: string, body: string): Promise<ProfileComment> {
  const res = await fetch(`/api/creator-profiles/${encodeURIComponent(slug)}/comments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ body }),
  });
  const data = await json<{ comment?: ProfileComment } | ProfileComment>(res);
  return (data as { comment?: ProfileComment }).comment ?? (data as ProfileComment);
}

export async function followProfile(slug: string): Promise<{ follower_count: number }> {
  const res = await fetch(`/api/creator-profiles/${encodeURIComponent(slug)}/follow`, { method: "POST" });
  return json(res);
}

export async function unfollowProfile(slug: string): Promise<{ follower_count: number }> {
  const res = await fetch(`/api/creator-profiles/${encodeURIComponent(slug)}/unfollow`, { method: "DELETE" });
  return json(res);
}

/* The light-site palette for profile panels (the house light standard:
   ivory ground, ivory panel, bronze ink). Applied over a creator
   colorway's PANEL tokens only when the site itself is in light theme —
   the creator's gold identity (primary/accent), fonts, and banner art
   are untouched, and dark site theme keeps the colorway exactly as
   the creator picked it. */
export const PROFILE_LIGHT_PANEL = {
  background: "#FBF6E9",
  surface: "#F4E7C3",
  cardBg: "#FCF7EA",
  text: "#2A1E07",
  mutedText: "#6B5B36",
  border: "rgba(201, 168, 76, 0.45)",
} as const;

/* ─── Theme → inline style bridge (safe tokens only) ─── */
export function themeVars(theme: ThemeConfig, light = false): React.CSSProperties {
  const f = (id: FontId) => SAFE_FONTS.find((x) => x.id === id)?.stack ?? "'Inter', system-ui, sans-serif";
  const radius = theme.cornerRadius === "pill" ? "999px" : theme.cornerRadius === "rounded" ? "12px" : "2px";
  const pad = theme.spacing === "compact" ? "0.75rem" : theme.spacing === "roomy" ? "2rem" : "1.25rem";
  const panel = light ? PROFILE_LIGHT_PANEL : null;
  return {
    "--ap-bg": panel?.background ?? theme.colors.background,
    "--ap-surface": panel?.surface ?? theme.colors.surface,
    "--ap-primary": theme.colors.primary,
    "--ap-accent": theme.colors.accent,
    "--ap-text": panel?.text ?? theme.colors.text,
    "--ap-muted": panel?.mutedText ?? theme.colors.mutedText,
    "--ap-card": panel?.cardBg ?? theme.colors.cardBg,
    "--ap-border": panel?.border ?? theme.colors.border,
    /* On-art ink: words that sit directly on the creator's banner art
       (the hero name + bio) keep the colorway's own colors in BOTH
       site themes — the art and its scrim never change with the site
       theme, so the text over them must not either. */
    "--ap-onart-text": theme.colors.text,
    "--ap-onart-muted": theme.colors.mutedText,
    "--ap-heading-font": f(theme.fonts.heading),
    "--ap-body-font": f(theme.fonts.body),
    "--ap-radius": radius,
    "--ap-pad": pad,
  } as React.CSSProperties;
}

export function isValidHex(v: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(v);
}

/* Canonical public URL for a profile — prefers the creator's custom domain
   when set, so shares and badges point at their world, not ours. */
export function profileUrl(profile: Pick<CreatorProfile, "slug" | "custom_domain">): string {
  const path = `/artist/${profile.slug}`;
  if (profile.custom_domain) {
    const host = profile.custom_domain.replace(/^https?:\/\//, "").replace(/\/$/, "");
    return `https://${host}${path}`;
  }
  if (typeof window !== "undefined") return `${window.location.origin}${path}`;
  return path;
}
