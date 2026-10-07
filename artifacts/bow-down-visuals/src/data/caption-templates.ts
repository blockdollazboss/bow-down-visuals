/* ─── Caption pack library ───
   Public, SEO-friendly packs that deep-link into Hook Studio's captions tab
   with ?tab=captions&template=<slug>. Browsable without login; login +
   credits kick in at generation time. */

export interface CaptionPack {
  slug: string;
  title: string;
  /** SEO meta description (~150 chars). */
  metaDescription: string;
  /** Short card blurb. */
  blurb: string;
  category: string;
  /** Preloaded topic for the caption generator. */
  topic: string;
  /** Preloaded platform. */
  platform: "tiktok" | "instagram" | "youtube" | "twitter";
  /** Preloaded tone hint. */
  tone: string;
  /** Keywords for SEO / filtering. */
  keywords: string[];
  /** Emoji for the card icon. */
  emoji: string;
}

export const CAPTION_CATEGORIES = [
  "All",
  "Launch",
  "Promo",
  "Engagement",
  "Everyday",
] as const;

export const CAPTION_PACKS: CaptionPack[] = [
  {
    slug: "single-release-captions",
    title: "Single Release Captions",
    metaDescription: "Caption pack for new single releases. Drop-day captions with streaming CTAs for TikTok, Instagram, and YouTube.",
    blurb: "Drop-day captions with streaming call-to-actions.",
    category: "Launch",
    topic: "my new single is out now on all platforms",
    platform: "instagram",
    tone: "hype, celebratory",
    keywords: ["single release caption", "new music caption", "song drop instagram caption"],
    emoji: "🚀",
  },
  {
    slug: "music-video-launch-captions",
    title: "Music Video Launch Captions",
    metaDescription: "Caption pack for music video premieres. Premiere-day captions that drive views across every platform.",
    blurb: "Premiere-day captions built to drive video views.",
    category: "Launch",
    topic: "my new music video just premiered",
    platform: "youtube",
    tone: "excited, cinematic",
    keywords: ["music video caption", "video premiere caption", "youtube premiere description"],
    emoji: "🎬",
  },
  {
    slug: "album-announcement-captions",
    title: "Album Announcement Captions",
    metaDescription: "Caption pack for album and EP announcements. Build anticipation with tracklist teases and pre-save CTAs.",
    blurb: "Anticipation-building captions for album announcements.",
    category: "Launch",
    topic: "announcing my debut album with tracklist reveal",
    platform: "instagram",
    tone: "emotional, proud",
    keywords: ["album announcement caption", "ep release caption", "tracklist reveal"],
    emoji: "💿",
  },
  {
    slug: "tour-promo-captions",
    title: "Tour Promo Captions",
    metaDescription: "Caption pack for tour announcements and ticket promos. City-by-city hype with ticket link CTAs.",
    blurb: "Ticket-selling captions for tour announcements.",
    category: "Promo",
    topic: "tour dates announced, tickets on sale Friday",
    platform: "tiktok",
    tone: "energetic, urgent",
    keywords: ["tour announcement caption", "concert promo caption", "ticket sale post"],
    emoji: "🎟️",
  },
  {
    slug: "merch-drop-captions",
    title: "Merch Drop Captions",
    metaDescription: "Caption pack for merch launches. Story-driven captions that sell the piece, not just the product shot.",
    blurb: "Story-driven captions for merch and product drops.",
    category: "Promo",
    topic: "new merch collection drop, limited quantities",
    platform: "instagram",
    tone: "bold, exclusive",
    keywords: ["merch drop caption", "clothing brand launch", "product launch caption"],
    emoji: "👕",
  },
  {
    slug: "stream-milestone-captions",
    title: "Streaming Milestone Captions",
    metaDescription: "Caption pack for celebrating streaming milestones. Thank-you captions for 1M streams, playlist adds, and chart wins.",
    blurb: "Thank-you captions for streaming milestones and wins.",
    category: "Promo",
    topic: "just hit 1 million streams, thank you to everyone listening",
    platform: "twitter",
    tone: "grateful, humble",
    keywords: ["1 million streams caption", "milestone thank you post", "spotify milestone"],
    emoji: "🏆",
  },
  {
    slug: "question-engagement-captions",
    title: "Question Engagement Captions",
    metaDescription: "Caption pack built for comments. Open-ended questions that get your audience talking and boost reach.",
    blurb: "Comment-bait captions engineered for engagement.",
    category: "Engagement",
    topic: "asking fans which song should get a music video next",
    platform: "tiktok",
    tone: "playful, curious",
    keywords: ["engagement caption", "question post ideas", "get more comments"],
    emoji: "💬",
  },
  {
    slug: "behind-the-scenes-captions",
    title: "Behind the Scenes Captions",
    metaDescription: "Caption pack for studio and process posts. Raw, real captions for behind-the-scenes content.",
    blurb: "Raw and real captions for behind-the-scenes posts.",
    category: "Engagement",
    topic: "late night in the studio finishing the album",
    platform: "instagram",
    tone: "authentic, raw",
    keywords: ["behind the scenes caption", "studio post caption", "bts instagram caption"],
    emoji: "🎧",
  },
  {
    slug: "fan-shoutout-captions",
    title: "Fan Shoutout Captions",
    metaDescription: "Caption pack for fan appreciation posts. Shout out your day-ones and turn supporters into community.",
    blurb: "Appreciation captions that turn fans into community.",
    category: "Engagement",
    topic: "shoutout to the fans who have been here since day one",
    platform: "instagram",
    tone: "warm, appreciative",
    keywords: ["fan appreciation post", "thank you fans caption", "community building"],
    emoji: "❤️",
  },
  {
    slug: "motivational-monday-captions",
    title: "Motivational Monday Captions",
    metaDescription: "Caption pack for motivational posts. Start the week with bars that inspire your audience to create.",
    blurb: "Monday-motivation captions for creator audiences.",
    category: "Everyday",
    topic: "motivational message for independent creators chasing their dreams",
    platform: "twitter",
    tone: "inspiring, direct",
    keywords: ["motivational caption", "monday motivation quote", "creator inspiration"],
    emoji: "⚡",
  },
  {
    slug: "throwback-captions",
    title: "Throwback Captions",
    metaDescription: "Caption pack for throwback posts. Nostalgic captions for old photos, early work, and how-far-we've-come moments.",
    blurb: "Nostalgic captions for throwback posts.",
    category: "Everyday",
    topic: "throwback to my first ever performance 5 years ago",
    platform: "instagram",
    tone: "nostalgic, reflective",
    keywords: ["throwback caption", "tbt instagram caption", "nostalgia post"],
    emoji: "📼",
  },
  {
    slug: "new-week-new-music-captions",
    title: "New Week New Music Captions",
    metaDescription: "Caption pack for regular content drops. Keep the feed active with fresh-music energy every week.",
    blurb: "Fresh-drop energy captions for weekly content.",
    category: "Everyday",
    topic: "new music every Friday, this week's drop is different",
    platform: "tiktok",
    tone: "confident, consistent",
    keywords: ["weekly content caption", "new music friday", "consistent posting"],
    emoji: "🗓️",
  },
];

export function getCaptionPack(slug: string): CaptionPack | undefined {
  return CAPTION_PACKS.find((p) => p.slug === slug);
}
