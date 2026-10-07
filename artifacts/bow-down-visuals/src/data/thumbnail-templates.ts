/* ─── Thumbnail template library ───
   Public, SEO-friendly templates that deep-link into the Thumbnail Maker
   with ?template=<slug>. Browsable without login; login + credits kick in
   at generation time. */

export interface ThumbnailTemplate {
  slug: string;
  title: string;
  /** SEO meta description (~150 chars). */
  metaDescription: string;
  /** Short card blurb. */
  blurb: string;
  category: string;
  /** Thumbnail Maker style preset id. */
  stylePreset: string;
  aspectRatio: "16:9" | "9:16";
  /** Preloaded prompt for the maker. */
  prompt: string;
  /** Preloaded overlay text suggestion. */
  overlayText: string;
  /** Keywords for SEO / filtering. */
  keywords: string[];
  /** Emoji for the card icon. */
  emoji: string;
}

export const THUMBNAIL_TEMPLATES: ThumbnailTemplate[] = [
  {
    slug: "fitness-transformation-youtube-thumbnail",
    title: "Fitness Transformation Thumbnail",
    metaDescription: "High-CTR fitness transformation YouTube thumbnail template. Bold before/after style with punchy text — plug in your photos and generate.",
    blurb: "Before/after split with bold transformation text. Built for fitness channels.",
    category: "Fitness",
    stylePreset: "before-after",
    aspectRatio: "16:9",
    prompt: "Dramatic fitness transformation thumbnail, split screen before and after, muscular physique progress, high contrast gym lighting, bold impactful composition",
    overlayText: "90 DAY RESULTS",
    keywords: ["fitness youtube thumbnail", "transformation thumbnail", "gym thumbnail ideas", "before after thumbnail"],
    emoji: "💪",
  },
  {
    slug: "podcast-episode-thumbnail",
    title: "Podcast Episode Thumbnail",
    metaDescription: "Podcast YouTube thumbnail template with shocked-guest style and episode text. Designed to stop the scroll on podcast clips and full episodes.",
    blurb: "Guest reaction style with episode hook text. For podcasts and interviews.",
    category: "Podcast",
    stylePreset: "shocked-face",
    aspectRatio: "16:9",
    prompt: "Podcast thumbnail, expressive guest reaction face close-up, dramatic studio lighting, microphone visible, bold modern composition with space for text",
    overlayText: "HE SAID WHAT?!",
    keywords: ["podcast thumbnail", "podcast youtube thumbnail ideas", "interview thumbnail", "podcast cover art"],
    emoji: "🎙️",
  },
  {
    slug: "gaming-video-thumbnail",
    title: "Gaming Video Thumbnail",
    metaDescription: "Gaming YouTube thumbnail template — explosive action style with game-character energy and bold text built for gaming channels.",
    blurb: "Explosive action style with bold game text. For gamers and streamers.",
    category: "Gaming",
    stylePreset: "gaming",
    aspectRatio: "16:9",
    prompt: "Epic gaming thumbnail, explosive action scene, dramatic game character pose, neon glow effects, high energy composition, vibrant colors",
    overlayText: "INSANE CLUTCH",
    keywords: ["gaming thumbnail", "youtube gaming thumbnail ideas", "gamer thumbnail", "stream thumbnail"],
    emoji: "🎮",
  },
  {
    slug: "money-finance-youtube-thumbnail",
    title: "Money & Finance Thumbnail",
    metaDescription: "Finance YouTube thumbnail template in luxury gold style. Premium money-talk aesthetic that signals wealth content instantly.",
    blurb: "Luxury gold money aesthetic. For finance and business channels.",
    category: "Finance",
    stylePreset: "luxury",
    aspectRatio: "16:9",
    prompt: "Luxury finance thumbnail, gold and black premium aesthetic, cash and charts subtly in background, confident wealthy mood, high-end composition",
    overlayText: "HOW I MADE $10K",
    keywords: ["finance youtube thumbnail", "money thumbnail", "business thumbnail ideas", "investing thumbnail"],
    emoji: "💰",
  },
  {
    slug: "vlog-travel-thumbnail",
    title: "Vlog & Travel Thumbnail",
    metaDescription: "Bright vlog travel thumbnail template with sunny adventurous energy. Perfect for travel vlogs, day-in-the-life, and lifestyle content.",
    blurb: "Sunny adventurous vlog style. For travel and lifestyle creators.",
    category: "Vlog",
    stylePreset: "vlog",
    aspectRatio: "16:9",
    prompt: "Bright travel vlog thumbnail, sunny exotic location background, happy adventurous creator energy, vibrant saturated colors, inviting composition",
    overlayText: "I MOVED HERE?!",
    keywords: ["vlog thumbnail", "travel youtube thumbnail", "lifestyle thumbnail ideas", "vlog thumbnail ideas"],
    emoji: "☀️",
  },
  {
    slug: "youtube-shorts-thumbnail",
    title: "YouTube Shorts Thumbnail",
    metaDescription: "Vertical 9:16 thumbnail template optimized for YouTube Shorts. Bold text-pop style that grabs attention in the Shorts feed.",
    blurb: "Vertical 9:16 text-pop style. Built for Shorts and Reels.",
    category: "Shorts",
    stylePreset: "bold-text-pop",
    aspectRatio: "9:16",
    prompt: "Vertical short-form thumbnail, bold explosive text-pop style, high contrast, attention-grabbing central subject, optimized for mobile feed",
    overlayText: "WAIT FOR IT",
    keywords: ["youtube shorts thumbnail", "shorts thumbnail ideas", "vertical thumbnail", "reels thumbnail"],
    emoji: "📱",
  },
  {
    slug: "tech-review-thumbnail",
    title: "Tech Review Thumbnail",
    metaDescription: "Tech review YouTube thumbnail template with sleek product-showcase style. Clean premium look for gadget reviews and unboxings.",
    blurb: "Sleek product showcase style. For tech reviewers and unboxers.",
    category: "Tech",
    stylePreset: "luxury",
    aspectRatio: "16:9",
    prompt: "Premium tech review thumbnail, sleek gadget product shot, dark studio background with rim lighting, modern minimal composition, high-end feel",
    overlayText: "WORTH IT?",
    keywords: ["tech thumbnail", "review youtube thumbnail", "unboxing thumbnail", "gadget thumbnail ideas"],
    emoji: "📦",
  },
  {
    slug: "cooking-food-thumbnail",
    title: "Cooking & Food Thumbnail",
    metaDescription: "Mouth-watering cooking YouTube thumbnail template. Close-up food style with bold text that makes viewers hungry enough to click.",
    blurb: "Mouth-watering close-up food style. For cooking channels.",
    category: "Food",
    stylePreset: "bold-text-pop",
    aspectRatio: "16:9",
    prompt: "Delicious food thumbnail, extreme close-up of dish with steam rising, vibrant appetizing colors, rustic kitchen background blur, mouth-watering composition",
    overlayText: "BEST RECIPE EVER",
    keywords: ["cooking thumbnail", "food youtube thumbnail", "recipe thumbnail ideas", "food channel thumbnail"],
    emoji: "🍔",
  },
  {
    slug: "music-video-thumbnail",
    title: "Music Video Thumbnail",
    metaDescription: "Music video YouTube thumbnail template with bold artist energy. Dramatic performer style built for musicians and music channels.",
    blurb: "Dramatic performer energy. For musicians and music videos.",
    category: "Music",
    stylePreset: "shocked-face",
    aspectRatio: "16:9",
    prompt: "Dramatic music video thumbnail, artist performer mid-performance, concert stage lighting with haze, intense emotional expression, cinematic composition",
    overlayText: "NEW SINGLE OUT NOW",
    keywords: ["music video thumbnail", "musician youtube thumbnail", "song thumbnail", "music channel thumbnail ideas"],
    emoji: "🎵",
  },
  {
    slug: "educational-tutorial-thumbnail",
    title: "Tutorial & Educational Thumbnail",
    metaDescription: "Educational YouTube thumbnail template with clear before/after learning style. Signals value and transformation for tutorial content.",
    blurb: "Clear value-driven tutorial style. For educators and how-tos.",
    category: "Education",
    stylePreset: "before-after",
    aspectRatio: "16:9",
    prompt: "Clean educational thumbnail, split concept showing problem vs solution, bright clear lighting, minimal distraction, trustworthy teacher energy",
    overlayText: "LEARN IN 10 MIN",
    keywords: ["tutorial thumbnail", "educational youtube thumbnail", "how to thumbnail", "course thumbnail ideas"],
    emoji: "📚",
  },
  {
    slug: "real-estate-thumbnail",
    title: "Real Estate Thumbnail",
    metaDescription: "Real estate YouTube thumbnail template in luxury style. Premium property aesthetic for agents, investors, and house tours.",
    blurb: "Premium property luxury style. For real estate creators.",
    category: "Real Estate",
    stylePreset: "luxury",
    aspectRatio: "16:9",
    prompt: "Luxury real estate thumbnail, stunning modern mansion exterior at golden hour, premium property photography style, aspirational composition",
    overlayText: "$2M HOUSE TOUR",
    keywords: ["real estate thumbnail", "house tour thumbnail", "property youtube thumbnail", "realtor thumbnail ideas"],
    emoji: "🏠",
  },
  {
    slug: "reaction-video-thumbnail",
    title: "Reaction Video Thumbnail",
    metaDescription: "Reaction video YouTube thumbnail template with exaggerated expression style. Built for reactors and commentary channels.",
    blurb: "Exaggerated reaction expression style. For reactors and commentary.",
    category: "Entertainment",
    stylePreset: "shocked-face",
    aspectRatio: "16:9",
    prompt: "Reaction video thumbnail, exaggerated shocked facial expression close-up, dramatic lighting, blurred content preview in background, high emotion composition",
    overlayText: "I CAN'T BELIEVE THIS",
    keywords: ["reaction thumbnail", "commentary youtube thumbnail", "react thumbnail ideas", "entertainment thumbnail"],
    emoji: "😱",
  },
];

export const THUMBNAIL_CATEGORIES = [
  "All",
  ...Array.from(new Set(THUMBNAIL_TEMPLATES.map((t) => t.category))),
];

export function getThumbnailTemplate(slug: string): ThumbnailTemplate | undefined {
  return THUMBNAIL_TEMPLATES.find((t) => t.slug === slug);
}
