import type { OnboardingStop } from "./types";

/**
 * First-visit onboarding tour — the core creator loop:
 * Dashboard → Artist Vault → Make Song → Make Video.
 * GuideMe navigates between pages automatically as the user advances.
 */
export const ONBOARDING_TOUR: OnboardingStop[] = [
  {
    route: "/dashboard",
    pageName: "Dashboard",
    step: {
      targetText: "What do you want to create?",
      title: "Welcome to Bow Down Visuals 🦈",
      body: "I'm Thy Cheat Code — your personal coach for this whole site. This is your Dashboard: every tool lives here. Let me walk you through the core loop — the fastest path from idea to finished video.",
      tip: "You can restart this tour anytime by tapping the gold shark button, bottom-left.",
      askPrompt: "I'm brand new — where do I start?",
    },
  },
  {
    route: "/artist-vault",
    pageName: "Artist Vault",
    step: {
      target: "main h1",
      title: "Stop 1 — Build your artist",
      body: "Everything starts here. Create your artist profile with photos and a locked voice. This is what makes every song sound like YOU and every video look like YOU — the AI uses this identity everywhere.",
      tip: "Do this first, do it well. 10 minutes here saves hours of fixing inconsistent generations later.",
      askPrompt: "How do I set up my artist profile?",
    },
  },
  {
    route: "/make-song",
    pageName: "Make a Song",
    step: {
      target: "main h1",
      title: "Stop 2 — Make your song",
      body: "Now the fun part. Describe your vibe, let AI write the lyrics, then generate the full track in your artist's locked voice. Your song is the foundation — videos, clips, and promos all build on it.",
      tip: "Nail the lyrics before you generate audio — the track step costs credits, lyric drafts are cheap.",
      askPrompt: "Walk me through making my first song",
    },
  },
  {
    route: "/make-video",
    pageName: "Make a Music Video",
    step: {
      target: "main h1",
      title: "Stop 3 — Make the video",
      body: "Final stop: turn your song into a music video. AI writes the treatment and storyboard, then generates clips with your artist's face locked in. From here, promo clips and thumbnails take it to the world.",
      tip: "Generate the plan first (cheap), then pay for clips only on scenes you love.",
      askPrompt: "How do I turn my song into a music video?",
    },
  },
  {
    route: "/dashboard",
    pageName: "Dashboard",
    step: {
      targetText: "What do you want to create?",
      title: "You're ready 🏆",
      body: "That's the core loop: Vault → Song → Video → promote. The whole site is built around it, and I'm with you on every page — tap the gold shark anytime you want a walkthrough or have a question. Now go make something illegal.",
      askPrompt: "What should I create first?",
    },
  },
];
