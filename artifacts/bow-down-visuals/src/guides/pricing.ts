import type { PageGuide } from "./types";

export const pricingGuide: PageGuide = {
  route: "/pricing",
  pageName: "Pricing",
  summary:
    "Pick the plan that matches your grind — monthly Visual Bucs for AI generations, with VIP and MVP tiers for creators who want it all.",
  steps: [
    {
      target: "main h1",
      title: "Fuel for the machine",
      body: "Everything AI on this site runs on Visual Bucs — songs, videos, clips, thumbnails. Your plan is your monthly fuel tank. Pick the one that matches how much you create.",
      tip: "Math it out: a song is 400 Visual Bucs, a video clip is 400. Count your monthly output, then pick the tank that fits.",
      askPrompt: "Which pricing plan is right for me?",
    },
    {
      targetText: "Most Popular",
      title: "The sweet spot",
      body: "The most popular plan is marked for you — it's where most active creators land. Enough Visual Bucs for steady releases without overpaying.",
      tip: "Start here. You can always upgrade mid-grind when your output grows.",
    },
    {
      targetText: "VIP",
      title: "Go VIP",
      body: "VIP is for creators playing to win — priority generation queue, early access to new AI models, 4K output, and exclusive templates nobody else gets.",
      tip: "If you're releasing weekly, the priority queue alone pays for itself in saved time.",
    },
    {
      targetText: "MVP",
      title: "The top tier",
      body: "MVP is the full cheat code — 4,000 Visual Bucs, instant generation, 8K output, custom AI style training on your brand, API access, and a dedicated account manager.",
      tip: "Labels, agencies, and power creators — this is your tier.",
    },
    {
      targetText: "Visual Buc Packs",
      title: "Need a top-up?",
      body: "Running low mid-month? Grab a Visual Bucs pack without changing your plan. Top up anytime and keep creating.",
      tip: "Packs never expire — buy bigger when you're flush, spend when you're inspired.",
    },
  ],
};
