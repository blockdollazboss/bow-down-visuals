/* ─── LLC state filing data (2026) ─────────────────────────────────────
   Filing fees + ongoing state fees for all 50 states, compiled from
   llc.org/llc-costs (updated ~Aug 2026) and boostsuite.com (2026).
   Processing times: published Secretary of State ranges where available;
   otherwise marked "typical" — online filing is almost always fastest.
   Verify current numbers with your Secretary of State before filing.

   KEEP IN SYNC with artifacts/api-server/src/lib/llc-state-fees.ts
   (the backend copy feeds the AI plan generator). */

export interface LlcStateInfo {
  /** 2-letter code */
  code: string;
  name: string;
  /** One-time Articles of Organization filing fee, USD */
  filingFee: number;
  /** Recurring state cost, human-readable */
  ongoing: string;
  /** Approximate ongoing yearly cost, USD (for the estimator; 0 if none) */
  ongoingYearly: number;
  /** Typical processing time, human-readable */
  processing: string;
}

export const LLC_STATES: LlcStateInfo[] = [
  { code: "AL", name: "Alabama", filingFee: 208, ongoing: "$50/yr privilege tax (min.)", ongoingYearly: 50, processing: "1–4 weeks (often faster online)" },
  { code: "AK", name: "Alaska", filingFee: 250, ongoing: "$100 every 2 years", ongoingYearly: 50, processing: "1–4 weeks (often faster online)" },
  { code: "AZ", name: "Arizona", filingFee: 50, ongoing: "$0 — no annual report", ongoingYearly: 0, processing: "1–4 weeks (often faster online)" },
  { code: "AR", name: "Arkansas", filingFee: 45, ongoing: "$150/yr franchise tax", ongoingYearly: 150, processing: "1–4 weeks (often faster online)" },
  { code: "CA", name: "California", filingFee: 70, ongoing: "$800/yr franchise tax", ongoingYearly: 800, processing: "7–14 days" },
  { code: "CO", name: "Colorado", filingFee: 50, ongoing: "$10/yr periodic report", ongoingYearly: 10, processing: "Same day – 1 day" },
  { code: "CT", name: "Connecticut", filingFee: 120, ongoing: "$80/yr annual report", ongoingYearly: 80, processing: "1–4 weeks (often faster online)" },
  { code: "DE", name: "Delaware", filingFee: 110, ongoing: "$300/yr annual tax", ongoingYearly: 300, processing: "1–3 days" },
  { code: "FL", name: "Florida", filingFee: 125, ongoing: "$138.75/yr annual report", ongoingYearly: 138.75, processing: "5–7 days" },
  { code: "GA", name: "Georgia", filingFee: 100, ongoing: "$50/yr annual registration", ongoingYearly: 50, processing: "1–4 weeks (often faster online)" },
  { code: "HI", name: "Hawaii", filingFee: 50, ongoing: "$15/yr annual report", ongoingYearly: 15, processing: "1–4 weeks (often faster online)" },
  { code: "ID", name: "Idaho", filingFee: 100, ongoing: "$0 — report required, no fee", ongoingYearly: 0, processing: "1–4 weeks (often faster online)" },
  { code: "IL", name: "Illinois", filingFee: 150, ongoing: "$75/yr annual report", ongoingYearly: 75, processing: "5–10 days" },
  { code: "IN", name: "Indiana", filingFee: 95, ongoing: "$31 every 2 years", ongoingYearly: 15.5, processing: "1–4 weeks (often faster online)" },
  { code: "IA", name: "Iowa", filingFee: 50, ongoing: "$30 every 2 years", ongoingYearly: 15, processing: "1–4 weeks (often faster online)" },
  { code: "KS", name: "Kansas", filingFee: 160, ongoing: "$55/yr annual report", ongoingYearly: 55, processing: "1–4 weeks (often faster online)" },
  { code: "KY", name: "Kentucky", filingFee: 40, ongoing: "$15/yr annual report", ongoingYearly: 15, processing: "1–4 weeks (often faster online)" },
  { code: "LA", name: "Louisiana", filingFee: 100, ongoing: "$35/yr annual report", ongoingYearly: 35, processing: "1–4 weeks (often faster online)" },
  { code: "ME", name: "Maine", filingFee: 175, ongoing: "$85/yr annual report", ongoingYearly: 85, processing: "1–4 weeks (often faster online)" },
  { code: "MD", name: "Maryland", filingFee: 100, ongoing: "$300/yr annual report", ongoingYearly: 300, processing: "1–4 weeks (often faster online)" },
  { code: "MA", name: "Massachusetts", filingFee: 500, ongoing: "$500/yr annual report", ongoingYearly: 500, processing: "1–4 weeks (often faster online)" },
  { code: "MI", name: "Michigan", filingFee: 50, ongoing: "$25/yr annual statement", ongoingYearly: 25, processing: "1–4 weeks (often faster online)" },
  { code: "MN", name: "Minnesota", filingFee: 155, ongoing: "$0 — renewal required, no fee", ongoingYearly: 0, processing: "1–4 weeks (often faster online)" },
  { code: "MS", name: "Mississippi", filingFee: 50, ongoing: "$0 — report required, no fee", ongoingYearly: 0, processing: "1–4 weeks (often faster online)" },
  { code: "MO", name: "Missouri", filingFee: 50, ongoing: "$0 — no annual report", ongoingYearly: 0, processing: "1–4 weeks (often faster online)" },
  { code: "MT", name: "Montana", filingFee: 35, ongoing: "$20/yr annual report", ongoingYearly: 20, processing: "1–4 weeks (often faster online)" },
  { code: "NE", name: "Nebraska", filingFee: 100, ongoing: "$10 every 2 years", ongoingYearly: 5, processing: "1–4 weeks (often faster online)" },
  { code: "NV", name: "Nevada", filingFee: 425, ongoing: "$350/yr (annual list + license)", ongoingYearly: 350, processing: "1–7 days" },
  { code: "NH", name: "New Hampshire", filingFee: 100, ongoing: "$100/yr annual report", ongoingYearly: 100, processing: "1–4 weeks (often faster online)" },
  { code: "NJ", name: "New Jersey", filingFee: 125, ongoing: "$75/yr annual report", ongoingYearly: 75, processing: "1–4 weeks (often faster online)" },
  { code: "NM", name: "New Mexico", filingFee: 50, ongoing: "$0 — no annual report", ongoingYearly: 0, processing: "1–15 days" },
  { code: "NY", name: "New York", filingFee: 200, ongoing: "$9 every 2 years (+ publication cost)", ongoingYearly: 4.5, processing: "7–10 days" },
  { code: "NC", name: "North Carolina", filingFee: 125, ongoing: "$200/yr annual report", ongoingYearly: 200, processing: "1–4 weeks (often faster online)" },
  { code: "ND", name: "North Dakota", filingFee: 135, ongoing: "$50/yr annual report", ongoingYearly: 50, processing: "1–4 weeks (often faster online)" },
  { code: "OH", name: "Ohio", filingFee: 99, ongoing: "$0 — no annual report", ongoingYearly: 0, processing: "5–7 days" },
  { code: "OK", name: "Oklahoma", filingFee: 100, ongoing: "$25/yr annual certificate", ongoingYearly: 25, processing: "1–4 weeks (often faster online)" },
  { code: "OR", name: "Oregon", filingFee: 100, ongoing: "$100/yr annual report", ongoingYearly: 100, processing: "1–4 weeks (often faster online)" },
  { code: "PA", name: "Pennsylvania", filingFee: 125, ongoing: "$7 every 10 years (decennial)", ongoingYearly: 0.7, processing: "5–7 days" },
  { code: "RI", name: "Rhode Island", filingFee: 150, ongoing: "$50/yr annual report", ongoingYearly: 50, processing: "1–4 weeks (often faster online)" },
  { code: "SC", name: "South Carolina", filingFee: 110, ongoing: "$0 — no annual report", ongoingYearly: 0, processing: "1–4 weeks (often faster online)" },
  { code: "SD", name: "South Dakota", filingFee: 150, ongoing: "$50/yr annual report", ongoingYearly: 50, processing: "1–4 weeks (often faster online)" },
  { code: "TN", name: "Tennessee", filingFee: 300, ongoing: "$300/yr minimum annual report", ongoingYearly: 300, processing: "1–4 weeks (often faster online)" },
  { code: "TX", name: "Texas", filingFee: 300, ongoing: "$0 for most LLCs (no-tax-due report)", ongoingYearly: 0, processing: "3–5 days" },
  { code: "UT", name: "Utah", filingFee: 54, ongoing: "$18/yr annual renewal", ongoingYearly: 18, processing: "1–4 weeks (often faster online)" },
  { code: "VT", name: "Vermont", filingFee: 125, ongoing: "$35/yr annual report", ongoingYearly: 35, processing: "1–4 weeks (often faster online)" },
  { code: "VA", name: "Virginia", filingFee: 100, ongoing: "$50/yr annual registration", ongoingYearly: 50, processing: "1–4 weeks (often faster online)" },
  { code: "WA", name: "Washington", filingFee: 200, ongoing: "$60/yr annual report", ongoingYearly: 60, processing: "1–4 weeks (often faster online)" },
  { code: "WV", name: "West Virginia", filingFee: 100, ongoing: "$25/yr annual report", ongoingYearly: 25, processing: "1–4 weeks (often faster online)" },
  { code: "WI", name: "Wisconsin", filingFee: 130, ongoing: "$25/yr annual report", ongoingYearly: 25, processing: "1–4 weeks (often faster online)" },
  { code: "WY", name: "Wyoming", filingFee: 100, ongoing: "$60/yr minimum annual report", ongoingYearly: 60, processing: "1–5 days" },
];

export function getLlcState(code: string): LlcStateInfo | undefined {
  return LLC_STATES.find((s) => s.code === code.toUpperCase());
}

export const LLC_STATE_CODES = LLC_STATES.map((s) => s.code);

/** Registered-agent service tiers for the cost estimator (typical market rates). */
export const REGISTERED_AGENT_TIERS = [
  { key: "diy", label: "Be my own agent", yearly: 0, blurb: "Free — you list your own address (it's public record)" },
  { key: "budget", label: "Budget service", yearly: 100, blurb: "~$100/yr — basic mail forwarding" },
  { key: "premium", label: "Premium service", yearly: 300, blurb: "~$300/yr — compliance alerts + extras" },
] as const;

export type RegisteredAgentTier = (typeof REGISTERED_AGENT_TIERS)[number]["key"];

export function getAgentTier(key: string) {
  return REGISTERED_AGENT_TIERS.find((t) => t.key === key) ?? REGISTERED_AGENT_TIERS[0];
}
