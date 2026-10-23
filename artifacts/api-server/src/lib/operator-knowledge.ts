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

/** One duration tier of a tiered price (e.g. a song priced by length):
    the price for anything up to `upToSeconds` long. Sourced at
    generation time from the exported tier table the charging function
    derives from — never hand-typed knowledge. */
export interface OperatorPriceTier {
  upToSeconds: number;
  vb: number;
}

/** One override-form variant of a price (e.g. the clean, unbranded
    form of a render whose branded form is free): a second price the
    SAME endpoint charges, sourced at generation time from the server
    constant the rail charges for that variant. `vb` on the parent
    price stays the registry's base price — neither overwrites the
    other, because they are different facts about one endpoint. */
export interface OperatorPriceVariant {
  feature: string;
  vb: number;
  source: string;
}

export interface OperatorPrice {
  feature: string;
  vb: number;
  endpoint: string;
  source: string;
  /** Duration tiers when the rail prices by length. `vb` stays the
      first tier's figure (the registry's flat record); the tiers are
      the complete price the operator quotes. */
  tiers?: OperatorPriceTier[];
  tiersSource?: string;
  /** Override-form variants of this endpoint's price (see
      OperatorPriceVariant), when the rail charges differently for an
      override form of the same job. */
  variants?: OperatorPriceVariant[];
}

/** A dollar-priced advertising placement (the takeover offers). Dollars
    live here, NEVER in `prices` — that array is Visual Bucs only, and
    the two moneys never mix in one field. Sourced at generation time
    from the lib/db *_OFFER constant the offer endpoint serves. */
export interface OperatorOffer {
  priceDollars: number;
  durationDays: number;
  surfaces: string[];
  inquiryEndpoint: string;
  doorLabel: string;
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
  offer?: OperatorOffer;
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
  "are", "it", "to", "for", "of", "on", "in", "what", "where", "when", "much",
  "many", "cost", "costs", "price", "want", "need", "get", "got",
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

/** Light plural folding ("songs" → "song", "videos" → "video") for the
    weaker tiers only — path, price-name, and description matching. Name
    matching deliberately stays exact/prefix: a plural query word must
    not earn full name weight for a creation tool ("songs" is not the
    name "Make a Song"). Words ending in "ss"/"us" are not plurals. */
function stem(t: string): string {
  return t.length > 3 && t.endsWith("s") && !t.endsWith("ss") && !t.endsWith("us")
    ? t.slice(0, -1)
    : t;
}

function stemIncludes(list: string[], t: string): boolean {
  const s = stem(t);
  return list.some((x) => stem(x) === s);
}

/* ── Collection intent ─────────────────────────────────────────────────
   "Where is my music library?" is a LOCATOR question about the member's
   own collection — but the tokenizer drops "my" as a stopword, so the
   ownership signal never reached scoring and the question was ranked
   exactly like "make music": a creation tool won on raw token overlap
   while the member's collection page ("My Music") earned nothing from
   the word "library" (its name tokenizes to just ["music"]).

   The fix reads the intent off the RAW message before stopwording:
   a possessive ("my"/"mine") or a collection noun ("library"/
   "collection") marks collection intent — unless the message carries
   a creation verb, which makes it a creation question no matter whose
   name is on the output ("How do I make my music video?").

   Under collection intent, a feature that IS a member collection —
   the site's own naming convention: the name starts with "My " — earns
   a decisive bonus when it is about the same content the member named.
   Content is compared by domain, because the collection's head word
   is rarely the member's word: their songs live in My MUSIC, their
   videos in My CLIPS. Domain-less collections (My Projects, My Shop)
   qualify only on a literal shared content token, and only when the
   message names no domain at all. */

const CREATION_VERBS = new Set([
  "make", "makes", "making", "create", "creates", "creating",
  "generate", "generates", "generating", "build", "builds", "building",
]);

const DOMAIN_TOKENS: Record<string, readonly string[]> = {
  audio: ["music", "song", "track", "audio"],
  video: ["video", "clip", "film", "movie"],
};

function domainsOf(list: string[]): Set<string> {
  const out = new Set<string>();
  for (const [domain, words] of Object.entries(DOMAIN_TOKENS)) {
    if (list.some((t) => words.includes(stem(t)))) out.add(domain);
  }
  return out;
}

const COLLECTION_BONUS = 10;

interface MatchContext {
  /** True when the message asks to LOCATE the member's own collection. */
  collection: boolean;
  /** Content domains the message names (audio / video), stemmed compare. */
  domains: Set<string>;
  /** The domain of the LAST domain word in the message — the head noun.
      "music video" names two domains, but the thing being located is a
      video; the bonus follows the head noun so a collection from the
      other domain cannot claim it. */
  headDomain: string | null;
}

function matchContext(message: string, q: string[]): MatchContext {
  const possessive = /\b(my|mine)\b/i.test(message);
  const collectionNoun = q.some((t) => stem(t) === "library" || stem(t) === "collection");
  const creationVerb = q.some((t) => CREATION_VERBS.has(t));
  // A price question is never a locator question, possessive or not:
  // "how much does it cost to publish my link in bio page" is asking
  // what a page charges, and its carrier is found through the price
  // tier — collection treatment must not mute that tier or boost a
  // collection page into its place.
  const priceQuestion = /\b(cost|costs|price|pricing|much)\b/i.test(message);
  let headDomain: string | null = null;
  for (const t of q) {
    for (const [domain, words] of Object.entries(DOMAIN_TOKENS)) {
      if (words.includes(stem(t))) headDomain = domain;
    }
  }
  return {
    collection: (possessive || collectionNoun) && !creationVerb && !priceQuestion,
    domains: domainsOf(q),
    headDomain,
  };
}

function collectionBonus(f: OperatorFeature, q: string[], ctx: MatchContext): number {
  if (!ctx.collection) return 0;
  if (!/^my\s/i.test(f.name)) return 0;
  const own = [...nameTokens(f), ...pathTokens(f)];
  const ownDomains = domainsOf(own);
  if (ctx.headDomain) {
    return ownDomains.has(ctx.headDomain) ? COLLECTION_BONUS : 0;
  }
  // No domain named: a domain-less collection (My Projects, My Shop)
  // qualifies only on a literal shared content token.
  if (ownDomains.size === 0 && own.some((t) => stemIncludes(q, t))) {
    return COLLECTION_BONUS;
  }
  return 0;
}

/** Score one feature against the query tokens. Name words are the strongest
    signal, then path words, then description words. */
function scoreFeature(f: OperatorFeature, q: string[], ctx: MatchContext): number {
  const names = nameTokens(f);
  const paths = pathTokens(f);
  const desc = f.description ? tokens(f.description) : [];
  const priceNames = f.prices.flatMap((p) => tokens(p.feature));
  let score = 0;
  for (const t of q) {
    if (names.includes(t)) score += 5;
    else if (names.some((n) => n.startsWith(t) || t.startsWith(n))) score += 2;
    if (stemIncludes(paths, t)) score += 3;
    // The price-name tier exists for price questions. Under collection
    // intent the member is locating their own things, not buying — what
    // a page can charge for must not outrank the collection page itself
    // (the Songs tab's "Analyze Song Sections" price nearly did).
    if (!ctx.collection && stemIncludes(priceNames, t)) score += 3;
    if (stemIncludes(desc, t)) score += 1;
  }
  // Whole-phrase name mention ("make a song", "brand deals") is the
  // surest hit there is: the query's words, in order, spelling the name.
  // The equality arm requires a MULTI-word name phrase: a one-word query
  // equal to a one-word name ("songs" → Songs) is just the name hit
  // above — paying the phrase bonus too would double-count it and let a
  // tab named after the item outrank the member's collection page.
  const phrase = q.join(" ");
  const namePhrase = nameTokens(f).join(" ");
  if (
    phrase &&
    ((namePhrase.includes(" ") && phrase === namePhrase) ||
      (q.length >= 2 && ` ${namePhrase} `.includes(` ${phrase} `)))
  ) {
    score += 8;
  }
  score += collectionBonus(f, q, ctx);
  return score;
}

/** Best-matching real features for a message, strongest first. */
export function findFeatures(message: string, limit = 4): OperatorFeature[] {
  const q = tokens(message);
  if (q.length === 0) return [];
  const ctx = matchContext(message, q);
  return OPERATOR_FEATURES.map((f) => ({ f, s: scoreFeature(f, q, ctx) }))
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

/** "1 minute" / "3 minutes" / "90 seconds" for a tier length. */
function formatTierLength(seconds: number): string {
  if (seconds % 60 === 0) {
    const mins = seconds / 60;
    return `${mins} minute${mins === 1 ? "" : "s"}`;
  }
  return `${seconds} seconds`;
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
      if (p.tiers?.length) {
        // A length-tiered price replaces the flat line entirely: quoting
        // only the first tier's figure under-quotes every longer job.
        const tiers = p.tiers
          .map((t) => `up to ${formatTierLength(t.upToSeconds)} — ${t.vb.toLocaleString("en-US")} Visual Bucs`)
          .join("; ");
        lines.push(`  Price: ${p.feature} — priced by length: ${tiers}.`);
      } else {
        lines.push(`  Price: ${p.feature} — ${p.vb === 0 ? "free" : `${p.vb.toLocaleString("en-US")} Visual Bucs`}.`);
        // An override-form variant is a second true price for the same
        // endpoint (clean vs branded) — quote it as its own line so the
        // base line never has to carry two figures at once.
        for (const v of p.variants ?? []) {
          lines.push(`  Price: ${v.feature} — ${v.vb === 0 ? "free" : `${v.vb.toLocaleString("en-US")} Visual Bucs`}.`);
        }
      }
    }
  }
  if (f.offer) {
    lines.push(
      `  Price: $${f.offer.priceDollars.toLocaleString("en-US")} for ${f.offer.durationDays} days — a paid advertising placement, priced in dollars (not Visual Bucs).`,
    );
    lines.push(
      `  Book it: ${f.offer.doorLabel} (${f.path}) — the inquiry form for this takeover lives there; send the inquiry and the team follows up.`,
    );
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
    for (const p of f.prices) {
      set.add(p.vb);
      // Tier figures are vouched by the same sourced price entry that
      // carries them — a quoted 800 / 1,200 VB song price is knowledge,
      // not invention, exactly because the entry states the tiers.
      for (const t of p.tiers ?? []) set.add(t.vb);
      // Variant figures likewise: vouched by the sourced variant the
      // price entry carries (e.g. the clean render's 400).
      for (const v of p.variants ?? []) set.add(v.vb);
    }
    if (f.description) {
      for (const m of f.description.matchAll(/(\d[\d,]*)\s*(?:VB|Visual Bucs)/g)) {
        set.add(Number(m[1].replace(/,/g, "")));
      }
    }
  }
  for (const p of OPERATOR_KB.packs) set.add(p.credits);
  return set;
})();

/** Every DOLLAR figure the knowledge base vouches for: the takeover
    offers' prices (the only dollar prices the operator may ever quote —
    pack dollar prices are deliberately NOT knowledge; checkout sets
    them) plus any dollar figure stated inside a sourced knowledge text.
    $0 is vouched the same way 0 VB is: "free" is not an invented price. */
export const KNOWN_DOLLAR_FIGURES: ReadonlySet<number> = (() => {
  const set = new Set<number>([0]);
  for (const f of OPERATOR_FEATURES) {
    if (f.offer) set.add(f.offer.priceDollars);
    if (f.description) {
      for (const m of f.description.matchAll(/\$\s?(\d[\d,]*)/g)) {
        set.add(Number(m[1].replace(/,/g, "")));
      }
    }
  }
  return set;
})();

/** First price figure in a reply that the knowledge base does NOT vouch
    for — or null if the reply is clean. Two passes, two moneys: the VB
    pass (VB / Visual Bucs / credits figures against KNOWN_VB_FIGURES,
    the original Phase 1 guard, unchanged) runs first; then the dollar
    pass ($1,000 / 1000 dollars / USD 1000 against KNOWN_DOLLAR_FIGURES)
    so a reply cannot dress an invented dollar price past the VB guard —
    and a KB-sourced takeover price in dollars ships clean. */
export function findInventedPrice(reply: string): number | null {
  const re = /(\d[\d,]*)\s*(?:VB|Visual Bucs|credits)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(reply))) {
    const value = Number(m[1].replace(/,/g, ""));
    if (!KNOWN_VB_FIGURES.has(value)) return value;
  }
  const dollarRe = /\$\s?(\d[\d,]*)|(\d[\d,]*)\s*(?:dollars|USD)\b|USD\s?(\d[\d,]*)/gi;
  while ((m = dollarRe.exec(reply))) {
    const raw = m[1] ?? m[2] ?? m[3];
    if (!raw) continue;
    const value = Number(raw.replace(/,/g, ""));
    if (!KNOWN_DOLLAR_FIGURES.has(value)) return value;
  }
  return null;
}

/** Honest replacement when the guard trips — no figure is quoted at all. */
export const PRICE_FALLBACK_REPLY =
  "I don't have a verified price for that in front of me, and I won't guess at numbers — the page itself shows the exact price in Visual Bucs before you spend anything. 🦈";
