/* ─── Thy Library — unified template catalog ───
   Data-driven templates for the /library hub. Each template deep-links into
   its tool with the template pre-loaded via ?template=<slug>.
   Browsing is free; generation charges apply in the tools themselves. */

import { THUMBNAIL_TEMPLATES } from "./thumbnail-templates";

export type LibraryTemplateCategory =
  | "Thumbnails"
  | "Carousels"
  | "Intros & Outros"
  | "Social Posts";

export interface LibraryTemplate {
  slug: string;
  title: string;
  blurb: string;
  /** Top-level library category. */
  category: LibraryTemplateCategory;
  /** Niche/topic for filtering (Fitness, Gaming, Business...). */
  niche: string;
  emoji: string;
  /** Deep-link URL — opens the tool with this template pre-loaded. */
  useUrl: string;
  /** Card preview gradient (CSS). */
  gradient: string;
  /** Short usage hint shown on the card. */
  toolLabel: string;
}

export const LIBRARY_TEMPLATE_CATEGORIES: LibraryTemplateCategory[] = [
  "Thumbnails",
  "Carousels",
  "Intros & Outros",
  "Social Posts",
];

/* ─── Thumbnails — built on the existing 32-template catalog ─── */
const THUMBNAIL_GRADIENTS = [
  "linear-gradient(135deg,#7c2d12 0%,#1a0a00 100%)",
  "linear-gradient(135deg,#1e3a8a 0%,#020617 100%)",
  "linear-gradient(135deg,#831843 0%,#0a0a0a 100%)",
  "linear-gradient(135deg,#14532d 0%,#020617 100%)",
  "linear-gradient(135deg,#713f12 0%,#0a0a0a 100%)",
  "linear-gradient(135deg,#4c1d95 0%,#0a0a0a 100%)",
];

const thumbnailTemplates: LibraryTemplate[] = THUMBNAIL_TEMPLATES.map((t, i) => ({
  slug: t.slug,
  title: t.title,
  blurb: t.blurb,
  category: "Thumbnails" as const,
  niche: t.category,
  emoji: t.emoji,
  useUrl: `/thumbnail-studio?template=${t.slug}`,
  gradient: THUMBNAIL_GRADIENTS[i % THUMBNAIL_GRADIENTS.length],
  toolLabel: "Thumbnail Studio",
}));

/* ─── Carousels — 20 templates (deep-link into the carousel maker) ─── */
const CAROUSEL_DEEP_LINK = "/carousel-studio";

interface CarouselSeed { slug: string; title: string; blurb: string; niche: string; emoji: string; gradient: string; }

const CAROUSEL_SEEDS: CarouselSeed[] = [
  { slug: "carousel-bold-statement", title: "Bold Statement", blurb: "One massive claim per slide. Built for hot takes that get saved and shared.", niche: "Viral", emoji: "🔥", gradient: "linear-gradient(135deg,#7c2d12 0%,#0a0a0a 100%)" },
  { slug: "carousel-listicle-5", title: "5-Thing Listicle", blurb: "Numbered list slides — the highest-saving carousel format on Instagram.", niche: "Growth", emoji: "📋", gradient: "linear-gradient(135deg,#1e3a8a 0%,#020617 100%)" },
  { slug: "carousel-before-after", title: "Before / After", blurb: "Transformation story across slides. Fitness, business, glow-ups.", niche: "Fitness", emoji: "🔄", gradient: "linear-gradient(135deg,#14532d 0%,#020617 100%)" },
  { slug: "carousel-myth-buster", title: "Myth Buster", blurb: "Myth on slide one, truth bomb on slide two. Comment bait.", niche: "Viral", emoji: "💣", gradient: "linear-gradient(135deg,#831843 0%,#0a0a0a 100%)" },
  { slug: "carousel-tutorial-steps", title: "Tutorial Steps", blurb: "Step-by-step how-to. Each slide is one clear action.", niche: "Education", emoji: "🪜", gradient: "linear-gradient(135deg,#713f12 0%,#0a0a0a 100%)" },
  { slug: "carousel-quote-pack", title: "Quote Pack", blurb: "Punchy quotes on luxe backgrounds. Made for shares.", niche: "Motivation", emoji: "💬", gradient: "linear-gradient(135deg,#4c1d95 0%,#0a0a0a 100%)" },
  { slug: "carousel-stat-drop", title: "Stat Drop", blurb: "One shocking stat per slide with bold data viz styling.", niche: "Finance", emoji: "📊", gradient: "linear-gradient(135deg,#0c4a6e 0%,#020617 100%)" },
  { slug: "carousel-story-arc", title: "Story Arc", blurb: "Hook → struggle → turning point → win. Narrative carousels that get read to the end.", niche: "Personal Brand", emoji: "📖", gradient: "linear-gradient(135deg,#713f12 0%,#1a0a00 100%)" },
  { slug: "carousel-vs-battle", title: "VS Battle", blurb: "This vs that. Two options duke it out across slides — comments explode.", niche: "Viral", emoji: "⚔️", gradient: "linear-gradient(135deg,#7f1d1d 0%,#0a0a0a 100%)" },
  { slug: "carousel-mistakes", title: "Mistakes To Avoid", blurb: "\"Stop doing this\" format. Authority-building and highly saved.", niche: "Education", emoji: "🚫", gradient: "linear-gradient(135deg,#991b1b 0%,#0a0a0a 100%)" },
  { slug: "carousel-tools-roundup", title: "Tools Roundup", blurb: "Your favorite tools, one per slide. Affiliate-friendly.", niche: "Business", emoji: "🧰", gradient: "linear-gradient(135deg,#1e40af 0%,#020617 100%)" },
  { slug: "carousel-day-in-life", title: "Day In My Life", blurb: "Photo + caption per slide. Lifestyle creators' bread and butter.", niche: "Lifestyle", emoji: "☀️", gradient: "linear-gradient(135deg,#a16207 0%,#0a0a0a 100%)" },
  { slug: "carousel-faq-answers", title: "FAQ Answers", blurb: "Your most-asked questions, answered one slide at a time.", niche: "Business", emoji: "❓", gradient: "linear-gradient(135deg,#0e7490 0%,#020617 100%)" },
  { slug: "carousel-testimonial-wall", title: "Testimonial Wall", blurb: "Client wins and reviews. Social proof that sells while you sleep.", niche: "Business", emoji: "⭐", gradient: "linear-gradient(135deg,#a16207 0%,#1a0a00 100%)" },
  { slug: "carousel-beginner-guide", title: "Beginner's Guide", blurb: "Start-here guide for your niche. The pinned post every profile needs.", niche: "Education", emoji: "🌱", gradient: "linear-gradient(135deg,#15803d 0%,#020617 100%)" },
  { slug: "carousel-hot-take-thread", title: "Hot Take Thread", blurb: "Twitter-thread energy for Instagram. Unpopular opinions, defended.", niche: "Viral", emoji: "🌶️", gradient: "linear-gradient(135deg,#c2410c 0%,#0a0a0a 100%)" },
  { slug: "carousel-checklist", title: "Ultimate Checklist", blurb: "Checkbox slides people screenshot. The most saved format there is.", niche: "Productivity", emoji: "✅", gradient: "linear-gradient(135deg,#166534 0%,#020617 100%)" },
  { slug: "carousel-behind-scenes", title: "Behind The Scenes", blurb: "Process shots + honest captions. Builds trust fast.", niche: "Personal Brand", emoji: "🎬", gradient: "linear-gradient(135deg,#6b21a8 0%,#0a0a0a 100%)" },
  { slug: "carousel-price-breakdown", title: "Price Breakdown", blurb: "Transparent pricing slides. Kills objections before the DM.", niche: "Business", emoji: "💰", gradient: "linear-gradient(135deg,#a16207 0%,#0a0a0a 100%)" },
  { slug: "carousel-mini-course", title: "Mini Course", blurb: "A full lesson in 8 slides. Positions you as the teacher.", niche: "Education", emoji: "🎓", gradient: "linear-gradient(135deg,#1d4ed8 0%,#020617 100%)" },
];

const carouselTemplates: LibraryTemplate[] = CAROUSEL_SEEDS.map((s) => ({
  ...s,
  category: "Carousels" as const,
  useUrl: `${CAROUSEL_DEEP_LINK}?template=${s.slug}`,
  toolLabel: "Carousel Maker",
}));

/* ─── Intros & Outros — 20 templates (deep-link into branding kit) ─── */
const INTRO_DEEP_LINK = "/branding-kit?tab=intros";

interface IntroSeed { slug: string; title: string; blurb: string; niche: string; emoji: string; gradient: string; kind: "Intro" | "Outro"; }

const INTRO_SEEDS: IntroSeed[] = [
  { slug: "intro-gold-reveal", title: "Gold Reveal", blurb: "Your logo bursts through gold particles. Pure luxury.", niche: "Luxury", emoji: "✨", gradient: "linear-gradient(135deg,#a16207 0%,#0a0a0a 100%)", kind: "Intro" },
  { slug: "intro-glitch-slam", title: "Glitch Slam", blurb: "Hard glitch cuts into your channel name. For gaming and tech.", niche: "Gaming", emoji: "📺", gradient: "linear-gradient(135deg,#1e3a8a 0%,#020617 100%)", kind: "Intro" },
  { slug: "intro-cinematic-bars", title: "Cinematic Bars", blurb: "Letterbox bars close in, title fades up. Movie-trailer energy.", niche: "Film", emoji: "🎞️", gradient: "linear-gradient(135deg,#0a0a0a 0%,#1c1917 100%)", kind: "Intro" },
  { slug: "intro-bass-drop", title: "Bass Drop", blurb: "Screen shakes on the drop, logo slams in. Music channels.", niche: "Music", emoji: "🔊", gradient: "linear-gradient(135deg,#7c2d12 0%,#0a0a0a 100%)", kind: "Intro" },
  { slug: "intro-minimal-fade", title: "Minimal Fade", blurb: "Clean fade-in for talking-head and education channels.", niche: "Education", emoji: "◻️", gradient: "linear-gradient(135deg,#1c1917 0%,#0a0a0a 100%)", kind: "Intro" },
  { slug: "intro-neon-sign", title: "Neon Sign", blurb: "Your name flickers on like a neon sign. Nightlife vibe.", niche: "Lifestyle", emoji: "💡", gradient: "linear-gradient(135deg,#831843 0%,#020617 100%)", kind: "Intro" },
  { slug: "intro-shark-bite", title: "Shark Bite", blurb: "The King Shark chomps the screen open. Signature Bow Down energy.", niche: "Brand", emoji: "🦈", gradient: "linear-gradient(135deg,#0c4a6e 0%,#020617 100%)", kind: "Intro" },
  { slug: "intro-typewriter", title: "Typewriter", blurb: "Channel name types out with keystroke sounds. Writer/creator vibe.", niche: "Education", emoji: "⌨️", gradient: "linear-gradient(135deg,#44403c 0%,#0a0a0a 100%)", kind: "Intro" },
  { slug: "intro-zoom-rush", title: "Zoom Rush", blurb: "Hyperspace zoom into your logo. High-energy vlogs.", niche: "Vlogs", emoji: "💫", gradient: "linear-gradient(135deg,#6b21a8 0%,#0a0a0a 100%)", kind: "Intro" },
  { slug: "intro-ink-splash", title: "Ink Splash", blurb: "Ink splatters reveal your brand. Art and tattoo channels.", niche: "Art", emoji: "🖋️", gradient: "linear-gradient(135deg,#18181b 0%,#0a0a0a 100%)", kind: "Intro" },
  { slug: "outro-subscribe-slam", title: "Subscribe Slam", blurb: "Animated subscribe button + bell. The outro every channel needs.", niche: "Growth", emoji: "🔔", gradient: "linear-gradient(135deg,#b91c1c 0%,#0a0a0a 100%)", kind: "Outro" },
  { slug: "outro-next-video", title: "Next Video Cards", blurb: "Two end-screen cards slide in. Keeps viewers watching.", niche: "Growth", emoji: "⏭️", gradient: "linear-gradient(135deg,#1e40af 0%,#020617 100%)", kind: "Outro" },
  { slug: "outro-gold-signoff", title: "Gold Signoff", blurb: "\"Thanks for watching\" in gold script. Classy closer.", niche: "Luxury", emoji: "👑", gradient: "linear-gradient(135deg,#a16207 0%,#0a0a0a 100%)", kind: "Outro" },
  { slug: "outro-comment-cta", title: "Comment CTA", blurb: "\"Drop your take below\" animation. Drives comments.", niche: "Growth", emoji: "💬", gradient: "linear-gradient(135deg,#0e7490 0%,#020617 100%)", kind: "Outro" },
  { slug: "outro-playlist-push", title: "Playlist Push", blurb: "Pushes viewers into your playlist. Watch-time machine.", niche: "Growth", emoji: "📑", gradient: "linear-gradient(135deg,#4c1d95 0%,#0a0a0a 100%)", kind: "Outro" },
  { slug: "outro-social-links", title: "Social Links", blurb: "Your handles animate in one by one. Cross-platform growth.", niche: "Personal Brand", emoji: "🔗", gradient: "linear-gradient(135deg,#155e75 0%,#020617 100%)", kind: "Outro" },
  { slug: "outro-merch-drop", title: "Merch Drop", blurb: "Your products spin into frame. Built to sell.", niche: "Business", emoji: "👕", gradient: "linear-gradient(135deg,#713f12 0%,#0a0a0a 100%)", kind: "Outro" },
  { slug: "outro-blooper-tease", title: "Blooper Tease", blurb: "\"Wait for the bloopers\" card. Retention trick.", niche: "Vlogs", emoji: "🤣", gradient: "linear-gradient(135deg,#a16207 0%,#1a0a00 100%)", kind: "Outro" },
  { slug: "outro-crown-fade", title: "Crown Fade", blurb: "Crown settles over your logo, fade to black. Signature closer.", niche: "Brand", emoji: "👑", gradient: "linear-gradient(135deg,#713f12 0%,#020617 100%)", kind: "Outro" },
  { slug: "outro-live-cta", title: "Go-Live CTA", blurb: "\"Catch me live\" with schedule. Funnels to your streams.", niche: "Streaming", emoji: "📡", gradient: "linear-gradient(135deg,#7f1d1d 0%,#0a0a0a 100%)", kind: "Outro" },
];

const introTemplates: LibraryTemplate[] = INTRO_SEEDS.map((s) => ({
  slug: s.slug,
  title: s.title,
  blurb: s.blurb,
  category: "Intros & Outros" as const,
  niche: `${s.kind} · ${s.niche}`,
  emoji: s.emoji,
  useUrl: `${INTRO_DEEP_LINK}&template=${s.slug}`,
  gradient: s.gradient,
  toolLabel: "Branding Kit",
}));

/* ─── Social Posts — 20 templates ─── */
const SOCIAL_DEEP_LINK = "/create";

interface SocialSeed { slug: string; title: string; blurb: string; niche: string; emoji: string; gradient: string; }

const SOCIAL_SEEDS: SocialSeed[] = [
  { slug: "social-launch-announcement", title: "Launch Announcement", blurb: "Big bold launch post. \"It's here\" energy.", niche: "Business", emoji: "🚀", gradient: "linear-gradient(135deg,#7c2d12 0%,#0a0a0a 100%)" },
  { slug: "social-quote-card", title: "Quote Card", blurb: "Shareable quote on brand background.", niche: "Motivation", emoji: "💭", gradient: "linear-gradient(135deg,#4c1d95 0%,#0a0a0a 100%)" },
  { slug: "social-poll-post", title: "Poll Post", blurb: "This-or-that visual poll. Engagement magnet.", niche: "Viral", emoji: "🗳️", gradient: "linear-gradient(135deg,#1e3a8a 0%,#020617 100%)" },
  { slug: "social-milestone", title: "Milestone Flex", blurb: "100K followers, 1M views — celebrate loud.", niche: "Growth", emoji: "🏆", gradient: "linear-gradient(135deg,#a16207 0%,#0a0a0a 100%)" },
  { slug: "social-testimonial", title: "Testimonial Card", blurb: "Client love, designed to convert.", niche: "Business", emoji: "💛", gradient: "linear-gradient(135deg,#713f12 0%,#0a0a0a 100%)" },
  { slug: "social-event-promo", title: "Event Promo", blurb: "Date, time, hype. Fill your live/event.", niche: "Streaming", emoji: "📅", gradient: "linear-gradient(135deg,#831843 0%,#0a0a0a 100%)" },
  { slug: "social-tip-card", title: "Quick Tip Card", blurb: "One tip, beautifully designed. Daily value posts.", niche: "Education", emoji: "💡", gradient: "linear-gradient(135deg,#0e7490 0%,#020617 100%)" },
  { slug: "social-meme-template", title: "Meme Template", blurb: "Your niche's favorite meme format, branded.", niche: "Viral", emoji: "🐸", gradient: "linear-gradient(135deg,#14532d 0%,#020617 100%)" },
  { slug: "social-collab-announce", title: "Collab Announcement", blurb: "Two creators, one post. Cross-promo gold.", niche: "Growth", emoji: "🤝", gradient: "linear-gradient(135deg,#1d4ed8 0%,#020617 100%)" },
  { slug: "social-giveaway", title: "Giveaway Post", blurb: "Rules + prize, designed to explode reach.", niche: "Viral", emoji: "🎁", gradient: "linear-gradient(135deg,#b91c1c 0%,#0a0a0a 100%)" },
  { slug: "social-playlist-cover", title: "Playlist Cover", blurb: "Cover art for your playlists and mixes.", niche: "Music", emoji: "🎧", gradient: "linear-gradient(135deg,#6b21a8 0%,#0a0a0a 100%)" },
  { slug: "social-lyric-card", title: "Lyric Card", blurb: "Your hardest bar as a shareable visual.", niche: "Music", emoji: "🎤", gradient: "linear-gradient(135deg,#7f1d1d 0%,#0a0a0a 100%)" },
  { slug: "social-sale-promo", title: "Sale Promo", blurb: "Discount post that actually converts.", niche: "Business", emoji: "🏷️", gradient: "linear-gradient(135deg,#991b1b 0%,#0a0a0a 100%)" },
  { slug: "social-recap-post", title: "Week Recap", blurb: "Your week's highlights in one post.", niche: "Personal Brand", emoji: "📰", gradient: "linear-gradient(135deg,#44403c 0%,#0a0a0a 100%)" },
  { slug: "social-ama-invite", title: "AMA Invite", blurb: "\"Ask me anything\" — fills your question box.", niche: "Growth", emoji: "🎙️", gradient: "linear-gradient(135deg,#0c4a6e 0%,#020617 100%)" },
  { slug: "social-countdown", title: "Countdown Post", blurb: "3...2...1... Build anticipation.", niche: "Viral", emoji: "⏳", gradient: "linear-gradient(135deg,#713f12 0%,#1a0a00 100%)" },
  { slug: "social-gratitude", title: "Gratitude Post", blurb: "Thank your community. Loyalty builder.", niche: "Personal Brand", emoji: "🙏", gradient: "linear-gradient(135deg,#a16207 0%,#020617 100%)" },
  { slug: "social-hot-take", title: "Hot Take Card", blurb: "Your spiciest opinion, designed for debate.", niche: "Viral", emoji: "🌶️", gradient: "linear-gradient(135deg,#c2410c 0%,#0a0a0a 100%)" },
  { slug: "social-tutorial-teaser", title: "Tutorial Teaser", blurb: "Tease the full video. Drives clicks.", niche: "Education", emoji: "🎯", gradient: "linear-gradient(135deg,#166534 0%,#020617 100%)" },
  { slug: "social-brand-story", title: "Brand Story", blurb: "Your origin in one beautiful post.", niche: "Personal Brand", emoji: "📜", gradient: "linear-gradient(135deg,#573d08 0%,#0a0a0a 100%)" },
];

const socialTemplates: LibraryTemplate[] = SOCIAL_SEEDS.map((s) => ({
  ...s,
  category: "Social Posts" as const,
  useUrl: `${SOCIAL_DEEP_LINK}?template=${s.slug}`,
  toolLabel: "Create Studio",
}));

/* ─── Unified catalog ─── */
export const LIBRARY_TEMPLATES: LibraryTemplate[] = [
  ...thumbnailTemplates,
  ...carouselTemplates,
  ...introTemplates,
  ...socialTemplates,
];

export const LIBRARY_TEMPLATE_COUNTS: Record<LibraryTemplateCategory, number> = {
  "Thumbnails": thumbnailTemplates.length,
  "Carousels": carouselTemplates.length,
  "Intros & Outros": introTemplates.length,
  "Social Posts": socialTemplates.length,
};

export function getLibraryTemplate(slug: string): LibraryTemplate | undefined {
  return LIBRARY_TEMPLATES.find((t) => t.slug === slug);
}

export function getLibraryTemplatesByCategory(
  category: LibraryTemplateCategory
): LibraryTemplate[] {
  return LIBRARY_TEMPLATES.filter((t) => t.category === category);
}
