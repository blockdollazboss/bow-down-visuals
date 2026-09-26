import type { PageGuide } from "./types";

export const brandDealFinderGuide: PageGuide = {
  route: "/brand-deals",
  pageName: "Brand Deal Finder",
  summary:
    "Thy Cheat Code's money-hunt: AI matches you with brand partnership opportunities — sponsored posts, affiliates, ambassadorships — plus an outreach draft for every brand.",
  steps: [
    {
      target: "main h1",
      title: "Brands pay creators who fit",
      body: "The Brand Deal Finder scouts sponsorship, affiliate, and ambassador opportunities matched to your niche, audience size, and content style. Small audiences win on fit, not size.",
      tip: "A 3K-follower artist whose fans buy sneakers beats a 300K generalist for a shoe brand. Fit is the currency.",
      askPrompt: "How do I land my first brand deal with a small audience?",
    },
    {
      targetText: "What kind of deals?",
      title: "Step 1 — Set your hunt",
      body: "Pick your niche, audience tier, platforms, and the deal types you want. Be honest about audience size — the scout gives under-1K creators affiliate and gifting plays, not fantasy ambassadorships.",
      tip: "Your content style matters as much as your niche — 'cinematic performance clips' sells differently than 'talking head'.",
    },
    {
      targetText: "Why it's a fit",
      title: "Step 2 — Read the fit scores",
      body: "Every brand card shows a fit score, why it fits YOU, a labeled value estimate for your tier, and the one-sentence angle for your pitch. Value ranges are estimates — verify programs on the brand's official pages.",
      tip: "Start with the highest fit score, not the biggest brand. Warm fits close; cold giants ghost.",
    },
    {
      targetText: "Draft my outreach",
      title: "Step 3 — Pitch the brand",
      body: "One credit drafts an outreach message tuned to that brand — subject, message, and personalization tips. Personalize the opener, keep it short, and end with one clear ask.",
      tip: "Lead with what the brand gets, never fake numbers, and follow up once. Then move on to the next brand.",
    },
  ],
};
