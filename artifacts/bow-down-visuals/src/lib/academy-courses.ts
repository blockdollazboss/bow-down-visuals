/* ─── Creator Academy course catalog (frontend copy) ────────────────────
   KEEP IN SYNC with the backend source of truth at
   artifacts/api-server/src/lib/academy-courses.ts — same course ids,
   titles, levels, and lesson ids/titles. Browsing this catalog is free
   (pure UI); AI learning paths, coach Q&A, and lesson content cost
   1 credit each via /api/academy/*. */

export type AcademyLevel = "beginner" | "intermediate" | "advanced";

export interface AcademyLessonMeta {
  id: string;
  title: string;
  summary: string;
  minutes: number;
}

export interface AcademyCourse {
  id: string;
  title: string;
  tagline: string;
  description: string;
  level: AcademyLevel;
  duration: string;
  lessons: AcademyLessonMeta[];
}

export const ACADEMY_COURSES: AcademyCourse[] = [
  {
    id: "video-production",
    title: "Video Production Masterclass",
    tagline: "Shoot like a studio, edit like a pro.",
    description:
      "From framing to final export — the complete production toolkit for creators who want their videos to look expensive on any budget.",
    level: "beginner",
    duration: "6 lessons · ~2 hrs",
    lessons: [
      { id: "framing", title: "Framing & Camera Angles", summary: "Rule of thirds, headroom, and the angles that flatter every creator on camera.", minutes: 18 },
      { id: "lighting", title: "Lighting on a Budget", summary: "One window and one lamp is all you need — the 3-point setup simplified for bedrooms.", minutes: 22 },
      { id: "audio", title: "Audio: The 50% Rule", summary: "Viewers forgive bad video, never bad audio. Mics, rooms, and the $30 upgrade that changes everything.", minutes: 20 },
      { id: "editing", title: "Editing Fundamentals", summary: "Cuts, pacing, and J/L cuts — the invisible edits that keep people watching.", minutes: 25 },
      { id: "color", title: "Color & Look", summary: "Build a signature look with basic grading: exposure, white balance, and one LUT.", minutes: 18 },
      { id: "export", title: "Export Settings for Every Platform", summary: "Resolution, bitrate, and codecs decoded — stop uploading mushy videos.", minutes: 15 },
    ],
  },
  {
    id: "tiktok-growth",
    title: "TikTok Growth Playbook",
    tagline: "Crack the algorithm, keep the followers.",
    description:
      "How TikTok actually decides what blows up — hooks, cadence, trends, and the analytics that matter, taught as a repeatable system.",
    level: "beginner",
    duration: "6 lessons · ~2 hrs",
    lessons: [
      { id: "algorithm", title: "How the Algorithm Actually Works", summary: "Watch time, rewatches, and the interest graph — what the For You page rewards in 2026.", minutes: 20 },
      { id: "hooks", title: "The 3-Second Hook", summary: "Pattern interrupts, open loops, and the first frame — win the swipe or lose the viewer.", minutes: 22 },
      { id: "cadence", title: "Posting Cadence & Timing", summary: "How often to post, when to post, and why consistency beats volume.", minutes: 15 },
      { id: "trends", title: "Trends: Ride vs. Start", summary: "When to jump on a sound and when to start your own — the trend-jacking playbook.", minutes: 18 },
      { id: "analytics", title: "Analytics That Actually Matter", summary: "Average watch time, profile conversion, and the 3 numbers to check weekly.", minutes: 20 },
      { id: "conversion", title: "From Views to Followers", summary: "Turn viral moments into a loyal audience with series, CTAs, and pinned strategy.", minutes: 18 },
    ],
  },
  {
    id: "youtube-shorts",
    title: "YouTube & Shorts Strategy",
    tagline: "Long-form depth, Shorts reach — one engine.",
    description:
      "Run YouTube as a system: long-form builds trust, Shorts build reach, and packaging (titles + thumbnails) decides who clicks.",
    level: "intermediate",
    duration: "6 lessons · ~2.5 hrs",
    lessons: [
      { id: "flywheel", title: "The Long-Form / Shorts Flywheel", summary: "How Shorts feed long-form and long-form feeds revenue — designing the loop.", minutes: 22 },
      { id: "packaging", title: "Titles & Thumbnails That Get Clicked", summary: "Curiosity gaps, contrast, and the 2-second thumbnail test.", minutes: 25 },
      { id: "retention", title: "Retention Editing", summary: "Open loops, payoffs, and pacing maps — edit for the graph, not your ego.", minutes: 28 },
      { id: "shelf", title: "The Shorts Shelf Strategy", summary: "Remix long-form into Shorts that rank — the repurposing pipeline.", minutes: 20 },
      { id: "community", title: "Community & Comments", summary: "Turn comment sections into content fuel and loyalty machines.", minutes: 15 },
      { id: "playlists", title: "Playlists & Packaging Series", summary: "Binge mechanics: playlists, series branding, and session time.", minutes: 18 },
    ],
  },
  {
    id: "monetization",
    title: "Monetization 101",
    tagline: "Turn attention into income.",
    description:
      "Every revenue stream a creator can tap — platform programs, sponsorships, digital products — and how to stack them into real income.",
    level: "beginner",
    duration: "5 lessons · ~2 hrs",
    lessons: [
      { id: "streams", title: "The Revenue Streams Map", summary: "Ad revenue, sponsors, affiliates, products, services — the full menu ranked by effort.", minutes: 20 },
      { id: "programs", title: "Platform Monetization Programs", summary: "YouTube Partner Program, TikTok Rewards, Instagram bonuses — thresholds and timelines.", minutes: 22 },
      { id: "sponsors", title: "Sponsorships & Pricing Yourself", summary: "Media kits, outreach scripts, and what to actually charge at every size.", minutes: 25 },
      { id: "products", title: "Digital Products & Affiliates", summary: "Sell once, earn forever — presets, templates, courses, and affiliate picks.", minutes: 25 },
      { id: "stack", title: "Building the Money Stack", summary: "Sequence your streams so each one funds the next — the 12-month plan.", minutes: 20 },
    ],
  },
  {
    id: "branding",
    title: "Personal Branding for Creators",
    tagline: "Be recognizable in 10 seconds.",
    description:
      "Your lane, your look, your voice — build a brand so distinct that viewers know it's you before they see your name.",
    level: "beginner",
    duration: "5 lessons · ~1.5 hrs",
    lessons: [
      { id: "lane", title: "Finding Your Lane", summary: "Niche down without boxing yourself in — the 3-circle positioning exercise.", minutes: 18 },
      { id: "visual", title: "Visual Identity System", summary: "Colors, fonts, thumbnails, and set design — the Bow Down gold-standard approach.", minutes: 20 },
      { id: "voice", title: "Voice & Personality", summary: "Catchphrases, opinions, and energy — why people follow people, not content.", minutes: 18 },
      { id: "consistency", title: "Consistency Without Burnout", summary: "Brand systems that run on autopilot: templates, rituals, and batch days.", minutes: 20 },
      { id: "test", title: "The 10-Second Test", summary: "Audit any video in 10 seconds: would a stranger know it's yours?", minutes: 12 },
    ],
  },
  {
    id: "content-systems",
    title: "Content Systems & Workflow",
    tagline: "Run your channel like a studio.",
    description:
      "Advanced systems for serious creators: batching, repurposing pipelines, AI-assisted workflows, and the metrics loop that compounds growth.",
    level: "advanced",
    duration: "5 lessons · ~2 hrs",
    lessons: [
      { id: "batching", title: "Batching Like a Studio", summary: "Shoot a month of content in two days — the batch-day blueprint.", minutes: 25 },
      { id: "repurposing", title: "The Repurposing Machine", summary: "One idea → 10 assets: the pipeline from long-form to clips to posts.", minutes: 28 },
      { id: "ai-workflow", title: "AI-Assisted Workflow", summary: "Scripts, hooks, captions, and edits with AI in the loop — speed without slop.", minutes: 25 },
      { id: "calendar", title: "Content Calendar Design", summary: "Plan 90 days in an afternoon: pillars, formats, and flex slots.", minutes: 20 },
      { id: "metrics", title: "Measure & Iterate", summary: "The weekly review ritual: what to keep, kill, and double down on.", minutes: 22 },
    ],
  },
];

export function getAcademyCourse(courseId: string): AcademyCourse | undefined {
  return ACADEMY_COURSES.find((c) => c.id === courseId);
}
