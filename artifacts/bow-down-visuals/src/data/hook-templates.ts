/* ─── Hook template library ───
   Public, SEO-friendly templates that deep-link into Hook Studio
   with ?template=<slug>. Browsable without login; login + credits kick in
   at generation time. */

export interface HookTemplate {
  slug: string;
  title: string;
  /** SEO meta description (~150 chars). */
  metaDescription: string;
  /** Short card blurb. */
  blurb: string;
  category: string;
  /** Hook Studio video type. */
  videoType: "music-promo" | "behind-the-scenes" | "tutorial" | "announcement";
  /** Preloaded topic for the hook generator. */
  topic: string;
  /** Keywords for SEO / filtering. */
  keywords: string[];
  /** Emoji for the card icon. */
  emoji: string;
}

export const HOOK_CATEGORIES = [
  "All",
  "Music Promo",
  "Behind the Scenes",
  "Tutorial",
  "Announcement",
] as const;

export const HOOK_TEMPLATES: HookTemplate[] = [
  {
    slug: "new-single-release-hook",
    title: "New Single Release Hook",
    metaDescription: "Scroll-stopping hook template for announcing a new single. Plug in your song title and generate 5 viral-ready hooks.",
    blurb: "Drop-announcement hooks built for new music releases.",
    category: "Music Promo",
    videoType: "music-promo",
    topic: "my new single just dropped",
    keywords: ["music promo hook", "single release announcement", "song promo tiktok hook"],
    emoji: "🎵",
  },
  {
    slug: "music-video-premiere-hook",
    title: "Music Video Premiere Hook",
    metaDescription: "Hook template for music video premieres. Tease the visual and drive premiere-day views on Shorts and TikTok.",
    blurb: "Premiere-day hooks that tease the video without spoiling it.",
    category: "Music Promo",
    videoType: "music-promo",
    topic: "my music video premieres tonight",
    keywords: ["music video premiere hook", "video drop announcement", "premiere promo ideas"],
    emoji: "🎬",
  },
  {
    slug: "tour-announcement-hook",
    title: "Tour Announcement Hook",
    metaDescription: "Tour date announcement hook template. Build hype for upcoming shows and sell the experience in 3 seconds.",
    blurb: "Hype-building hooks for tour and show announcements.",
    category: "Music Promo",
    videoType: "music-promo",
    topic: "announcing my first headline tour",
    keywords: ["tour announcement hook", "concert promo ideas", "show announcement tiktok"],
    emoji: "🎤",
  },
  {
    slug: "studio-session-hook",
    title: "Studio Session Hook",
    metaDescription: "Behind-the-scenes studio hook template. Pull viewers into your creative process with raw in-the-booth energy.",
    blurb: "Raw studio-energy hooks for behind-the-scenes clips.",
    category: "Behind the Scenes",
    videoType: "behind-the-scenes",
    topic: "late night studio session making a hit",
    keywords: ["studio vlog hook", "behind the scenes music", "recording session content"],
    emoji: "🎧",
  },
  {
    slug: "day-in-the-life-hook",
    title: "Day in the Life Hook",
    metaDescription: "Day-in-the-life hook template for creators. Open with the most interesting moment, not the alarm clock.",
    blurb: "Creator day-in-the-life openers that skip the boring parts.",
    category: "Behind the Scenes",
    videoType: "behind-the-scenes",
    topic: "day in the life of an independent artist",
    keywords: ["day in the life hook", "creator vlog ideas", "artist lifestyle content"],
    emoji: "📸",
  },
  {
    slug: "songwriting-process-hook",
    title: "Songwriting Process Hook",
    metaDescription: "Hook template for songwriting breakdowns. Show how the song was built, from voice memo to final mix.",
    blurb: "Process-reveal hooks for songwriting breakdown videos.",
    category: "Behind the Scenes",
    videoType: "behind-the-scenes",
    topic: "how I wrote my biggest song in one night",
    keywords: ["songwriting process", "how I made this song", "producer breakdown hook"],
    emoji: "✍️",
  },
  {
    slug: "mixing-tips-hook",
    title: "Mixing Tips Hook",
    metaDescription: "Tutorial hook template for mixing and production tips. Lead with the result, then teach the technique.",
    blurb: "Result-first hooks for production tutorials.",
    category: "Tutorial",
    videoType: "tutorial",
    topic: "3 mixing tricks that make vocals sound expensive",
    keywords: ["mixing tutorial hook", "music production tips", "producer tutorial ideas"],
    emoji: "🎚️",
  },
  {
    slug: "grow-on-tiktok-hook",
    title: "Grow on TikTok Hook",
    metaDescription: "Hook template for creator-growth tutorials. Teach what actually worked, with proof up front.",
    blurb: "Proof-first hooks for growth and strategy tutorials.",
    category: "Tutorial",
    videoType: "tutorial",
    topic: "how I grew from 0 to 100k followers in 90 days",
    keywords: ["tiktok growth tips", "creator tutorial hook", "how to grow on tiktok"],
    emoji: "📈",
  },
  {
    slug: "filming-setup-hook",
    title: "Filming Setup Hook",
    metaDescription: "Tutorial hook template for gear and setup videos. Show the final look first, then break down the rig.",
    blurb: "Gear-reveal hooks for setup and equipment tutorials.",
    category: "Tutorial",
    videoType: "tutorial",
    topic: "my full content filming setup under $500",
    keywords: ["filming setup", "creator gear", "content setup tutorial"],
    emoji: "📷",
  },
  {
    slug: "album-drop-hook",
    title: "Album Drop Hook",
    metaDescription: "Announcement hook template for album and EP releases. Make the drop feel like an event, not a post.",
    blurb: "Event-energy hooks for album and project announcements.",
    category: "Announcement",
    videoType: "announcement",
    topic: "my debut album is finally here",
    keywords: ["album announcement", "ep release promo", "project drop hook"],
    emoji: "💿",
  },
  {
    slug: "merch-launch-hook",
    title: "Merch Launch Hook",
    metaDescription: "Hook template for merch drops. Sell the story behind the piece, not just the product shot.",
    blurb: "Story-driven hooks for merch and product launches.",
    category: "Announcement",
    videoType: "announcement",
    topic: "my new merch collection just launched",
    keywords: ["merch launch", "product drop announcement", "clothing brand promo"],
    emoji: "👕",
  },
  {
    slug: "milestone-celebration-hook",
    title: "Milestone Celebration Hook",
    metaDescription: "Announcement hook template for hit milestones — 1M streams, 100K subs, chart placements. Celebrate with your day-ones.",
    blurb: "Celebration hooks for career milestones and wins.",
    category: "Announcement",
    videoType: "announcement",
    topic: "we just hit 1 million streams",
    keywords: ["milestone announcement", "1 million streams", "creator celebration"],
    emoji: "🏆",
  },
];

export function getHookTemplate(slug: string): HookTemplate | undefined {
  return HOOK_TEMPLATES.find((t) => t.slug === slug);
}
