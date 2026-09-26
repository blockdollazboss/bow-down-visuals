import type { PageGuide } from "./types";

export const thumbnailGuide: PageGuide = {
  route: "/thumbnail",
  pageName: "Thumbnail Maker",
  summary:
    "Design scroll-stopping thumbnails with AI — platform-sized, style-matched to your artist, with bold text that pops in the feed.",
  steps: [
    {
      target: "main h1",
      title: "Win the click",
      body: "Nobody watches what they don't click. This tool generates thumbnails tuned for each platform's size and style — YouTube, TikTok, Instagram — with your artist's face locked in.",
      tip: "Make the thumbnail BEFORE you finish the video — it forces you to know what the video is really about.",
      askPrompt: "What makes a good thumbnail for my music video?",
    },
    {
      targetText: "Platform",
      title: "Step 1 — Pick the platform",
      body: "Each platform crops and displays differently. Pick where this thumbnail lives so the AI sizes and composes it correctly.",
      tip: "YouTube rewards faces + 3 words max. TikTok rewards bold color and motion-feel.",
    },
    {
      targetText: "Style",
      title: "Step 2 — Choose the art style",
      body: "Match the style to your release's visual world — cinematic, anime, gritty, luxury. Consistency between thumbnail and video builds trust with viewers.",
      tip: "Steal like an artist: name the aesthetic ('Euphoria neon', 'vintage film grain').",
    },
    {
      targetText: "Text",
      title: "Step 3 — Add the hook text",
      body: "3 words or less, huge, readable on a phone. Your featured text is the headline — make it a promise the video keeps.",
      tip: "ALL CAPS, high contrast, no more than 3 words. Test it at phone size.",
    },
    {
      targetText: "Your recent thumbnails",
      title: "Your gallery",
      body: "Every thumbnail you've generated is saved here. Compare versions side by side and pick the winner before release day.",
      tip: "Generate 3 variants and ask your audience which they'd click — free A/B test.",
    },
  ],
};
