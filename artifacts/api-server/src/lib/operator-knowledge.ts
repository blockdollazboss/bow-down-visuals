/* ─── Cloud Operator Phase 1 — feature knowledge at runtime ───────────────
   Loads the GENERATED knowledge base (operator-knowledge.json, built by
   scripts/generate-operator-knowledge.mjs from the codebase's own sources
   of truth) and provides:

     - findFeatures()      — match a user message to real feature entries
     - buildGrounding()    — the ground-truth block injected into the chat
                             system prompt: the full feature index (so the
                             operator knows what exists — and what does NOT)
                             plus full facts for the best matches
     - findInventedPrice() — the no-invention guard: scans a drafted reply
                             for VB figures that exist nowhere in the
                             knowledge base

   Phase 1 is knowledge only. Nothing here executes an action, starts a
   job, charges a credit, or writes anything — the operator answers and
   points; hands are Phase 2. */

import kbJson from "./operator-knowledge.json" with { type: "json" };

export interface OperatorPrice {
  feature: string;
  vb: number;
  endpoint: string;
  source: string;
}

export interface OperatorFeature {
  id: string;
  name: string;
  nameSource: string;
  path: string;
  stage: string;
  access: "public" | "members";
  pageFile: string | null;
  component: string | null;
  endpoints: string[];
  prices: OperatorPrice[];
  description?: string;
  descriptionSource?: string;
  guide?: { pageName: string; route: string };
  inputs?: string[];
  nextSteps: { label: string; path: string; source?: string }[];
}

export interface OperatorKnowledge {
  generatedBy: string;
  baseCommit: string;
  generatedAt: string;
  site: { name: string; title: string | null; description: string | null; source: string };
  counts: Record<string, number>;
  packs: { credits: number; label: string; source: string }[];
  features: OperatorFeature[];
}

export const OPERATOR_KB = kbJson as unknown as OperatorKnowledge;

export const OPERATOR_FEATURES: OperatorFeature[] = OPERATOR_KB.features;

/* ── Matching ────────────────────────────────────────────────────────────── */

const STOPWORDS = new Set([
  "the", "a", "an", "i", "me", "my", "can", "you", "how", "do", "does", "is",
  "it", "to", "for", "of", "on", "in", "what", "where", "when", "much", "many",
  "cost", "costs", "price", "want", "need", "get", "got",
  "with", "and", "or", "your", "yours", "this", "that", "there", "here",
  "please", "tell", "show", "give", "help", "use", "using", "about",
]);
/* "make" is NOT a stopword: it is the discriminating word in the site's
   flagship names (Make a Song, Make a Video). NAME tokenization drops
   only pure function words, so a name keeps its verbs. */
const NAME_STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "to", "of", "for", "in", "on", "with",
  "it", "is", "my", "your",
]);

function tokens(text: string, stop: Set<string> = STOPWORDS): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/[\s-]+/)
    .filter((t) => t.length > 1 && !stop.has(t));
}

function nameTokens(f: OperatorFeature): string[] {
  return tokens(f.name, NAME_STOPWORDS);
}

function pathTokens(f: OperatorFeature): string[] {
  return f.path
    .replace(/^\//, "")
    .split(/[/:?=&-]/)
    .map((s) => s.toLowerCase())
    .filter((s) => s.length > 1);
}

/** Score one feature against the query tokens. Name words are the strongest
    signal, then path words, then description words. */
function scoreFeature(f: OperatorFeature, q: string[]): number {
  const names = nameTokens(f);
  const paths = pathTokens(f);
  const desc = f.description ? tokens(f.description) : [];
  const priceNames = f.prices.flatMap((p) => tokens(p.feature));
  let score = 0;
  for (const t of q) {
    if (names.includes(t)) score += 5;
    else if (names.some((n) => n.startsWith(t) || t.startsWith(n))) score += 2;
    if (paths.includes(t)) score += 3;
    if (priceNames.includes(t)) score += 3;
    if (desc.includes(t)) score += 1;
  }
  // Whole-phrase name mention ("make a song", "brand deals") is the
  // surest hit there is: the query's words, in order, spelling the name.
  const phrase = q.join(" ");
  const namePhrase = nameTokens(f).join(" ");
  if (
    phrase &&
    (phrase === namePhrase || (q.length >= 2 && ` ${namePhrase} `.includes(` ${phrase} `)))
  ) {
    score += 8;
  }
  return score;
}

/** Best-matching real features for a message, strongest first. */
export function findFeatures(message: string, limit = 4): OperatorFeature[] {
  const q = tokens(message);
  if (q.length === 0) return [];
  return OPERATOR_FEATURES.map((f) => ({ f, s: scoreFeature(f, q) }))
    .filter((x) => x.s >= 3)
    .sort((a, b) => b.s - a.s || a.f.name.localeCompare(b.f.name))
    .slice(0, limit)
    .map((x) => x.f);
}

/* ── Grounding block ─────────────────────────────────────────────────────── */

const STAGE_LABEL: Record<string, string> = {
  create: "CREATE",
  brand: "BRAND",
  promote: "PROMOTE",
  money: "MONEY (Get Paid)",
  social: "SOCIAL",
  world: "THE WORLD",
  studio: "MY STUDIO",
  discover: "DISCOVER",
  account: "ACCOUNT & SUPPORT",
  admin: "ADMIN",
};

/** The full feature index — every real feature's name + path, grouped by
    stage. This is the operator's menu: if something is not on it, it does
    not exist on the site. */
export function buildFeatureIndex(): string {
  const byStage = new Map<string, OperatorFeature[]>();
  for (const f of OPERATOR_FEATURES) {
    const arr = byStage.get(f.stage) ?? [];
    arr.push(f);
    byStage.set(f.stage, arr);
  }
  const order = ["create", "brand", "promote", "money", "social", "world", "studio", "discover", "account", "admin"];
  const lines: string[] = [];
  for (const stage of order) {
    const arr = byStage.get(stage);
    if (!arr?.length) continue;
    lines.push(`${STAGE_LABEL[stage] ?? stage.toUpperCase()}: ${arr.map((f) => `${f.name} (${f.path})`).join(" · ")}`);
  }
  return lines.join("\n");
}

/** Full verified facts for one feature — the only facts the operator may
    state about it. Prices appear ONLY when the knowledge entry carries
    them (sourced from the code registry at generation time). */
export function formatFeatureFacts(f: OperatorFeature): string {
  const lines: string[] = [`▸ ${f.name} — path ${f.path} [${STAGE_LABEL[f.stage] ?? f.stage}]`];
  if (f.description) lines.push(`  What it is: ${f.description}`);
  lines.push(f.access === "public" ? "  Access: open to everyone, no sign-in needed." : "  Access: members — sign-in required.");
  if (f.inputs?.length) lines.push(`  Works with: ${f.inputs.join(", ")}.`);
  if (f.prices.length) {
    for (const p of f.prices.slice(0, 6)) {
      lines.push(`  Price: ${p.feature} — ${p.vb === 0 ? "free" : `${p.vb.toLocaleString("en-US")} Visual Bucs`}.`);
    }
  }
  if (f.guide) {
    lines.push(`  Guide: this page has a step-by-step guide ("${f.guide.pageName}") — tell the user to open the page and tap "Walk me through it".`);
  }
  if (f.nextSteps.length) {
    lines.push(`  Hands off to: ${f.nextSteps.map((s) => `${s.label} (${s.path})`).join("; ")}.`);
  }
  return lines.join("\n");
}

/** The complete grounding block for one user message. */
export function buildGrounding(message: string): string {
  const matches = findFeatures(message);
  const parts: string[] = [];
  parts.push(
    `SITE: ${OPERATOR_KB.site.title ?? OPERATOR_KB.site.name}. ${OPERATOR_KB.site.description ?? ""}`.trim(),
  );
  parts.push(
    "CREDIT PACKS (Visual Bucs amounts, from the site's payment code): " +
      OPERATOR_KB.packs.map((p) => p.label).join(" · ") +
      ". Dollar prices for packs are set at checkout — never quote a dollar price for a pack; send people to the Pricing page (/pricing).",
  );
  parts.push("FEATURE INDEX (every feature on the site — if it is not listed here, it does not exist):\n" + buildFeatureIndex());
  if (matches.length) {
    parts.push("VERIFIED FACTS for the features this message is about:\n" + matches.map(formatFeatureFacts).join("\n"));
  } else {
    parts.push(
      "VERIFIED FACTS: no feature in the index matches this message closely. If the user is asking about a feature, say plainly that you don't have it and name the closest real features from the index above.",
    );
  }
  return parts.join("\n\n");
}

/* ── No-invention price guard ────────────────────────────────────────────── */

/** Every VB figure the knowledge base vouches for: all registry prices,
    all pack sizes, and any VB figure stated inside a sourced knowledge
    text (descriptions / guide summaries). */
export const KNOWN_VB_FIGURES: ReadonlySet<number> = (() => {
  const set = new Set<number>([0]);
  for (const f of OPERATOR_FEATURES) {
    for (const p of f.prices) set.add(p.vb);
    if (f.description) {
      for (const m of f.description.matchAll(/(\d[\d,]*)\s*(?:VB|Visual Bucs)/g)) {
        set.add(Number(m[1].replace(/,/g, "")));
      }
    }
  }
  for (const p of OPERATOR_KB.packs) set.add(p.credits);
  return set;
})();

/** First VB/Visual Bucs/credits figure in a reply that the knowledge base
    does NOT vouch for — or null if the reply is clean. */
export function findInventedPrice(reply: string): number | null {
  const re = /(\d[\d,]*)\s*(?:VB|Visual Bucs|credits)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(reply))) {
    const value = Number(m[1].replace(/,/g, ""));
    if (!KNOWN_VB_FIGURES.has(value)) return value;
  }
  return null;
}

/** Honest replacement when the guard trips — no figure is quoted at all. */
export const PRICE_FALLBACK_REPLY =
  "I don't have a verified price for that in front of me, and I won't guess at numbers — the page itself shows the exact price in Visual Bucs before you spend anything. 🦈";
