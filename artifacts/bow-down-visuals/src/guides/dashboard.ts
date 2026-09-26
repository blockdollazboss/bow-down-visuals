import type { PageGuide } from "./types";

export const dashboardGuide: PageGuide = {
  route: "/dashboard",
  pageName: "Dashboard",
  summary:
    "Your command center. Pick what to create, jump back into recent projects, and keep your credits topped up — everything starts here.",
  steps: [
    {
      targetText: "What do you want to create?",
      title: "Pick your mission",
      body: "This is your creator launchpad. Every tool on the site lives here as a card — songs, videos, promo clips, thumbnails. Tap the card that matches what you're making today and the AI takes it from there.",
      tip: "New here? Start with Make Song — everything else (videos, clips, promos) builds on top of a song.",
      askPrompt: "I'm new to Bow Down Visuals — what should I create first?",
    },
    {
      targetText: "Make Song",
      title: "Make a Song",
      body: "The heart of the site. Describe your vibe, pick a genre, and the AI writes full lyrics, hooks, and verses — then generates a complete AI-produced track with your artist's locked voice.",
      tip: "Lock your artist's voice in the Artist Vault first so every song sounds like YOU.",
    },
    {
      targetText: "Make a Music Video",
      title: "Make a Music Video",
      body: "Turn a song into a full visual plan: AI treatments, scene-by-scene storyboards, and generated video clips with your artist's face locked in for consistency.",
      tip: "Video plans are cheap — generate the plan first, then only pay for clips on the scenes you love.",
    },
    {
      targetText: "Promo Clip Maker",
      title: "Promo Clip Maker",
      body: "Drop a release date and let AI build your whole promo campaign — teaser clips, captions, hashtags, and a posting schedule tuned for TikTok, Reels, and Shorts.",
      tip: "Run this 2 weeks before release day. The AI spaces your teasers for maximum hype.",
    },
    {
      targetText: "Recent Projects",
      title: "Recent Projects",
      body: "Everything you've created lives here. Jump back in, download your files, or keep iterating — nothing is ever lost.",
      tip: "Download finals as both video and thumbnail — you'll need both on release day.",
    },
  ],
};
