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

export interface CreatorProfile {
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
  follower_count: number;
  total_plays: number;
  referral_code?: string | null;
  custom_domain?: string | null;
  /* Extension fields (Worker 4) — optional, rendered defensively. */
  stream_schedule?: StreamInfo | null;
  media_kit?: MediaKit | null;
  series?: SeriesEntry[] | null;
  merch_items?: MerchItem[] | null;
  events?: ProfileEventItem[] | null;
  social_posts?: SocialPostItem[] | null;
}

export const DEFAULT_THEME: ThemeConfig = { ...THEME_PRESETS[0]! };

export function emptyProfile(overrides: Partial<CreatorProfile> = {}): CreatorProfile {
  const tpl = starterTemplate((overrides.vertical as VerticalId) ?? "other");
  return {
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
    throw new Error((body as { error?: string }).error || `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

export async function fetchPublicProfile(slug: string): Promise<CreatorProfile> {
  const res = await fetch(`/api/creator-profiles/${encodeURIComponent(slug)}`);
  const data = await json<{ profile?: CreatorProfile } | CreatorProfile>(res);
  return (data as { profile?: CreatorProfile }).profile ?? (data as CreatorProfile);
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
  const res = await fetch(`/api/creator-profiles/${encodeURIComponent(slug)}/follow`, { method: "DELETE" });
  return json(res);
}

/* ─── Theme → inline style bridge (safe tokens only) ─── */
export function themeVars(theme: ThemeConfig): React.CSSProperties {
  const f = (id: FontId) => SAFE_FONTS.find((x) => x.id === id)?.stack ?? "'Inter', system-ui, sans-serif";
  const radius = theme.cornerRadius === "pill" ? "999px" : theme.cornerRadius === "rounded" ? "12px" : "2px";
  const pad = theme.spacing === "compact" ? "0.75rem" : theme.spacing === "roomy" ? "2rem" : "1.25rem";
  return {
    "--ap-bg": theme.colors.background,
    "--ap-surface": theme.colors.surface,
    "--ap-primary": theme.colors.primary,
    "--ap-accent": theme.colors.accent,
    "--ap-text": theme.colors.text,
    "--ap-muted": theme.colors.mutedText,
    "--ap-card": theme.colors.cardBg,
    "--ap-border": theme.colors.border,
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
