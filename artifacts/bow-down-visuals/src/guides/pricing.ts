import type { PageGuide } from "./types";

export const pricingGuide: PageGuide = {
  route: "/pricing",
  pageName: "Pricing",
  summary:
    "Pick the plan that matches your grind — Visual Bucs packs for AI generations, with Creator Pro and Creator Elite tiers for creators who want it all.",
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
      targetText: "Creator Pro",
      title: "Creator Pro — $12/mo",
      body: "Creator Pro drops your platform fee to 7% on every sale, and adds your own custom domain, unlimited products in your shop, premium gold-luxury themes, the pro analytics dashboard (funnels, sources, cohorts), and 25 AI promotion boosts a month.",
      tip: "Selling regularly? The fee drop from 10% to 7% pays for the plan by itself.",
    },
    {
      targetText: "Creator Elite",
      title: "Creator Elite — $29/mo",
      body: "Creator Elite is the top tier — the lowest platform fee on the site at 5%, priority placement in discovery, a dedicated support badge with priority support, and 100 AI promotion boosts a month, with everything in Creator Pro included.",
      tip: "For creators selling and promoting every week, the 5% fee and the boost stack are the whole game.",
    },
    {
      targetText: "Visual Buc Packs",
      title: "Need a top-up?",
      body: "Running low mid-month? Grab a Visual Bucs pack without changing your plan. Top up anytime and keep creating.",
      tip: "Packs never expire — buy bigger when you're flush, spend when you're inspired.",
    },
  ],
};
