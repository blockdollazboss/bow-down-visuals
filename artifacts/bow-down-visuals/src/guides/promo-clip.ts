import type { PageGuide } from "./types";

export const promoClipGuide: PageGuide = {
  route: "/promo-clip",
  pageName: "Promo Clip Maker",
  summary:
    "Feed it your release and AI builds the whole promo campaign — teaser clips, captions, hashtags, and a posting schedule for every platform.",
  steps: [
    {
      target: "main h1",
      title: "Your promo department",
      body: "Releases don't blow up by accident. This tool builds your full promo campaign: what to post, when to post it, and the exact captions and hooks for each platform.",
      tip: "Start your campaign 2 weeks before release day — the AI spaces teasers for maximum hype.",
      askPrompt: "How do I promote my release with the Promo Clip Maker?",
    },
    {
      targetText: "Start From Existing Project",
      title: "Promo from your song",
      body: "Already made a song on the site? Pick it here and the AI pulls the lyrics, mood, and vibe straight in — no retyping.",
      tip: "This is the fast lane — your song's data pre-fills everything.",
    },
    {
      targetText: "Start From Scratch",
      title: "Or start fresh",
      body: "No project yet? Describe the release manually — artist, song, vibe — and the AI builds the campaign around it.",
      tip: "Paste your best bar or hook — the AI turns it into teaser copy.",
    },
    {
      targetText: "Generate",
      title: "Generate the campaign",
      body: "AI produces your teaser clips, platform-ready captions, hashtags, and a day-by-day posting schedule. Review it like a marketing plan, then execute.",
      tip: "Post the highest-energy clip first — the algorithm rewards strong opens.",
    },
  ],
};
