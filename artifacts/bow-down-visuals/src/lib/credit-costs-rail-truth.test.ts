/**
 * credit-costs-rail-truth.test.ts — the displayed registry must equal
 * the charge on the rail.
 *
 * The Stack-25 accuracy audit proved six CREDIT_COSTS entries
 * misrecorded what their rails charge (the pre-spend confirmation and
 * the operator both quote the registry): jewelry STL showed 200
 * against a 400 charge, auto-grade showed 200 against a 1 charge,
 * sample packs showed 100 against a 500 base charge, and the jewelry
 * estimate / music export / preview render showed prices for rails
 * that charge nothing. The price-registry correction moved every
 * DISPLAY to the rail truth — charges never moved — and these pins
 * re-derive both sides from the source files so display and charge
 * cannot drift apart silently again. (The operator-knowledge suite
 * pins the same six from the knowledge base's side.) One follow-up
 * did move a charge, by owner ruling (Oct 22, 2026): auto-grade's
 * rail default went from its pre-x100 leftover of 1 to 100 VB, and
 * its display moved in lockstep — the pin below now holds both
 * sides at 100.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CREDIT_COSTS } from "./credit-costs";
import { DISTRIBUTION_TIERS, tierCredits } from "./distribution";

function readApi(rel: string): string {
  const url = new URL(`../../../api-server/src/${rel}`, import.meta.url);
  return readFileSync(url, "utf8");
}

/** Independent re-derivation of a server cost constant — plain literal,
    env-overridable default, and nullish-env forms — parsed from the
    named server file itself (mirrors the KB suite's derivation). */
function deriveServerConstant(rel: string, constant: string): number {
  const src = readApi(rel);
  const re = new RegExp(
    `(?:export\\s+)?const\\s+${constant}\\s*(?::\\s*number)?\\s*=\\s*(?:Number\\(process\\.env\\[["'][A-Z0-9_]+["']\\](?:\\s*\\?\\?\\s*\\d+)?\\)\\s*\\|\\|\\s*)?(\\d+)\\b`,
  );
  const m = src.match(re);
  expect(m, `${constant} in ${rel}`).toBeTruthy();
  return Number(m![1]);
}

describe("CREDIT_COSTS displayed prices equal the rails' charges (Stack-25 six)", () => {
  it("jewelry STL export: registry == JEWELRY_STL_CREDIT_COST (400)", () => {
    const rail = deriveServerConstant("routes/generate/jewelry-pricing.ts", "JEWELRY_STL_CREDIT_COST");
    expect(rail).toBe(400);
    expect(CREDIT_COSTS["/api/jewelry/export-stl"]?.cost).toBe(rail);
  });

  // Price audit #1 (2026-11-02): the Gen4.5 Standard clip registry entry
  // is the figure Scene Studio now quotes (display + spend-confirm
  // override, pinned in components/scene-studio-price-wiring.test.ts).
  // It must equal the rail's flat charge — the audit found the component
  // quoting 5 against this 400 charge.
  it("generate runway clip (Gen4.5): registry == GEN45_CREDIT_COST (400)", () => {
    const rail = deriveServerConstant("routes/generate/clip-pricing.ts", "GEN45_CREDIT_COST");
    expect(rail).toBe(400);
    expect(CREDIT_COSTS["/api/generate-runway-clip"]?.cost).toBe(rail);
  });

  it("auto grade: registry == PRO_TOOLS_AI_CREDITS (100)", () => {
    const rail = deriveServerConstant("routes/generate/pro-tools-ai.ts", "PRO_TOOLS_AI_CREDITS");
    expect(rail).toBe(100);
    expect(CREDIT_COSTS["/api/pro-tools/auto-grade"]?.cost).toBe(rail);
  });

  it("sample pack generate: registry base == SAMPLE_PACK_10_CREDITS (500), tiers 1200 / 2000 on the rail", () => {
    const base = deriveServerConstant("routes/generate/sample-pack-pricing.ts", "SAMPLE_PACK_10_CREDITS");
    expect(base).toBe(500);
    expect(deriveServerConstant("routes/generate/sample-pack-pricing.ts", "SAMPLE_PACK_25_CREDITS")).toBe(1200);
    expect(deriveServerConstant("routes/generate/sample-pack-pricing.ts", "SAMPLE_PACK_50_CREDITS")).toBe(2000);
    expect(CREDIT_COSTS["/api/sample-pack/generate"]?.cost).toBe(base);
  });

  const FREE_RAILS = [
    { endpoint: "/api/jewelry/estimate", file: "routes/generate/jewelry.ts", handler: "/jewelry/estimate" },
    { endpoint: "/api/music/export", file: "routes/music-export.ts", handler: "/music/export" },
    { endpoint: "/api/music/preview-render", file: "routes/music-export.ts", handler: "/music/preview-render" },
  ] as const;

  // Stack-28 item 1 (A2-01): the FE distribution fallback constants are a
  // LIVE display path (initial paint + any pricing-fetch failure, including
  // the pre-spend confirmation). They displayed 10/20/30 while the rail
  // charges 1,000/2,000/3,000 — a 100× understatement. The fallback now
  // equals RELEASE_TIER_CREDITS; the rail never reads the FE constants, so
  // no charge moved. Pin re-derives the rail side from the server source:
  // single falls back to DISTRIBUTION_RELEASE_CREDITS, ep/album are
  // env-overridable literals in RELEASE_TIER_CREDITS.
  it("distribution fallback tiers == RELEASE_TIER_CREDITS (1000/2000/3000)", () => {
    const single = deriveServerConstant("routes/generate/distribution.ts", "DISTRIBUTION_RELEASE_CREDITS");
    expect(single).toBe(1000);
    const src = readApi("routes/generate/distribution.ts");
    const ep = src.match(/ep:\s*Number\(process\.env\[["'][A-Z0-9_]+["']\]\)\s*\|\|\s*(\d+)/);
    const album = src.match(/album:\s*Number\(process\.env\[["'][A-Z0-9_]+["']\]\)\s*\|\|\s*(\d+)/);
    expect(ep, "RELEASE_TIER_CREDITS.ep").toBeTruthy();
    expect(album, "RELEASE_TIER_CREDITS.album").toBeTruthy();
    const rail = { single, ep: Number(ep![1]), album: Number(album![1]) };
    expect(rail).toEqual({ single: 1000, ep: 2000, album: 3000 });
    for (const tier of DISTRIBUTION_TIERS) {
      expect(tier.credits).toBe(rail[tier.type]);
      expect(tierCredits(tier.type)).toBe(rail[tier.type]);
    }
    expect(tierCredits("unknown-type")).toBe(rail.single);
  });

  // Stack-28 item 3 (A2-04): the pre-x100 stale family. Eight actions
  // displayed 1–2 VB and had NO registry entry; displays now read the
  // rail truth and the registry records each charge, pinned here by
  // re-deriving every rail constant from its server source file.
  const STALE_FAMILY = [
    { endpoint: "/api/meme-machine/captions", file: "routes/generate/meme-machine.ts", constant: "CAPTIONS_CREDITS", cost: 100 },
    { endpoint: "/api/style-stealer/analyze", file: "routes/generate/style-stealer.ts", constant: "ANALYZE_CREDITS", cost: 200 },
    { endpoint: "/api/three-second-lab/openings", file: "routes/generate/three-second-lab.ts", constant: "OPENINGS_CREDITS", cost: 200 },
    { endpoint: "/api/stream-copilot/prep", file: "routes/generate/stream-copilot.ts", constant: "PREP_CREDITS", cost: 100 },
    { endpoint: "/api/stream-copilot/clip-plan", file: "routes/generate/stream-copilot.ts", constant: "CLIP_PLAN_CREDITS", cost: 100 },
    { endpoint: "/api/trend-jacker/draft", file: "routes/generate/trend-jacker.ts", constant: "DRAFT_CREDITS", cost: 200 },
    { endpoint: "/api/lyric-stories/generate", file: "routes/generate/lyric-stories.ts", constant: "CREDITS_PER_CARD", cost: 200 },
    { endpoint: "/api/community/moderate", file: "routes/generate/community.ts", constant: "COMMUNITY_MODERATE_CREDITS", cost: 100 },
    { endpoint: "/api/community/sentiment", file: "routes/generate/community.ts", constant: "COMMUNITY_SENTIMENT_CREDITS", cost: 100 },
    { endpoint: "/api/community/superfans", file: "routes/generate/community.ts", constant: "COMMUNITY_SUPERFAN_CREDITS", cost: 100 },
    { endpoint: "/api/comment-replies", file: "routes/generate/community.ts", constant: "COMMUNITY_REPLY_CREDITS", cost: 100 },
  ] as const;

  for (const spec of STALE_FAMILY) {
    it(`${spec.endpoint}: registry == ${spec.constant} (${spec.cost})`, () => {
      const rail = deriveServerConstant(spec.file, spec.constant);
      expect(rail).toBe(spec.cost);
      expect(CREDIT_COSTS[spec.endpoint]?.cost).toBe(rail);
    });
  }

  // Stack-28 item 5 (A2-08): the single-shot thumbnail registry said 100,
  // but the rail charges TEXT_CREDIT_COST (100) + IMAGE_CREDIT_COST (200)
  // = 300 on delivery and its 402 pre-check requires 300 up front.
  // Registry now displays the delivered 300, pinned against both parts.
  it("single-shot thumbnail: registry == TEXT_CREDIT_COST + IMAGE_CREDIT_COST (300)", () => {
    const text = deriveServerConstant("routes/generate/thumbnail.ts", "TEXT_CREDIT_COST");
    const image = deriveServerConstant("routes/generate/thumbnail.ts", "IMAGE_CREDIT_COST");
    expect(text).toBe(100);
    expect(image).toBe(200);
    expect(CREDIT_COSTS["/api/generate-thumbnail"]?.cost).toBe(text + image);
  });

  // Stack-28 item 9 (A2-06) recorded the old three-way disagreement;
  // Stack1400 price-fix (audit #4) resolves it. DECIDED (owner ruling,
  // Oct 27): /api/chat carries NO separate charge — the rail default
  // is now CHAT_CREDIT_COST ?? "0" and the registry records 0. An
  // explicit env setting > 0 still wins on the rail (the function-side
  // override is pinned in the api-server chat-credit-cost suite).
  it("/api/chat: registry == getChatCreditCost() default (0, decided free)", () => {
    const src = readApi("lib/ai-chat-assistant.ts");
    const m = src.match(/CHAT_CREDIT_COST"\]\s*\?\?\s*"(\d+)"/);
    expect(m, "CHAT_CREDIT_COST default").toBeTruthy();
    const railDefault = Number(m![1]);
    expect(railDefault).toBe(0);
    expect(CREDIT_COSTS["/api/chat"]?.cost).toBe(railDefault);
    expect(CREDIT_COSTS["/api/chat"]?.cost).toBe(0);
  });

  // Q182 / ruling A-05: AI Upscale is officially 1,500 VB — the registry
  // display, the upscale page's own constant, and the rail charge must
  // all agree at 1,500, and the registry entry must NOT sit under the
  // "PLACEHOLDER prices" group comment (the placeholder state A-05
  // killed). The classic ffmpeg upscale stays 300 on both sides.
  it("generative AI upscale: registry == page == GENERATIVE_UPSCALE_CREDIT_COST (1500, official)", () => {
    const rail = deriveServerConstant("routes/generate/upscale-generative.ts", "GENERATIVE_UPSCALE_CREDIT_COST");
    expect(rail).toBe(1500);
    expect(CREDIT_COSTS["/api/ai-upscale"]?.cost).toBe(rail);
    expect(CREDIT_COSTS["/api/upscale"]?.cost).toBe(300);

    const page = readFileSync(new URL("../pages/upscale.tsx", import.meta.url), "utf8");
    expect(page).toMatch(/const GENERATIVE_UPSCALE_CREDIT_COST = (?:1500|getCreditCost\("\/api\/ai-upscale"\)\?\.cost \?\? 1500);/);

    const registrySrc = readFileSync(new URL("./credit-costs.ts", import.meta.url), "utf8");
    const idx = registrySrc.indexOf('"/api/ai-upscale"');
    expect(idx).toBeGreaterThanOrEqual(0);
    const before = registrySrc.slice(Math.max(0, idx - 320), idx);
    expect(before).toContain("owner ruling A-05");
    expect(before).not.toContain("PLACEHOLDER prices");
  });

  for (const spec of FREE_RAILS) {
    it(`${spec.endpoint}: handler charges nothing and the registry displays 0`, () => {
      const src = readApi(spec.file);
      const start = src.indexOf(`router.post("${spec.handler}"`);
      expect(start, `${spec.handler} in ${spec.file}`).toBeGreaterThanOrEqual(0);
      const rest = src.slice(start);
      const next = rest.slice(1).search(/\n\s*router\.(get|post|put|patch|delete)\(/);
      const slice = next < 0 ? rest : rest.slice(0, next + 1);
      expect(slice).not.toMatch(/chargeCredits\s*\(|deductCredits\s*\(/);
      expect(CREDIT_COSTS[spec.endpoint]?.cost).toBe(0);
    });
  }
});

describe("CREDIT_COSTS parity-wave rows equal the rails' charges (Stack1400)", () => {
  // The World parity waves built in-World desks for these four families
  // before the registry had rows for their rails, so the desks charged
  // through explicit per-desk overrides. The rows now exist; these pins
  // re-derive every figure from the server source so registry, desks,
  // and rails cannot drift apart silently.
  const PARITY_ROWS = [
    { endpoint: "/api/label-pitch/kit", file: "routes/generate/label-pitch.ts", constant: "LABEL_PITCH_CREDIT_COST", cost: 300 },
    { endpoint: "/api/email-list/newsletter", file: "routes/generate/email-list-helpers.ts", constant: "EMAIL_NEWSLETTER_CREDIT_COST", cost: 100 },
    { endpoint: "/api/academy/learning-path", file: "routes/generate/academy.ts", constant: "ACADEMY_CREDIT_COST", cost: 100 },
    { endpoint: "/api/academy/lesson", file: "routes/generate/academy.ts", constant: "ACADEMY_CREDIT_COST", cost: 100 },
    { endpoint: "/api/academy/ask", file: "routes/generate/academy.ts", constant: "ACADEMY_CREDIT_COST", cost: 100 },
    { endpoint: "/api/movies/concept", file: "routes/generate/movies.ts", constant: "CONCEPT_CREDITS", cost: 400 },
    { endpoint: "/api/movies/clip-detect", file: "routes/generate/movies.ts", constant: "CLIP_DETECT_CREDITS", cost: 300 },
  ] as const;

  for (const spec of PARITY_ROWS) {
    it(`${spec.endpoint}: registry == ${spec.constant} (${spec.cost})`, () => {
      const rail = deriveServerConstant(spec.file, spec.constant);
      expect(rail).toBe(spec.cost);
      expect(CREDIT_COSTS[spec.endpoint]?.cost).toBe(rail);
    });
  }
});

describe("CREDIT_COSTS price-coherence backfill rows equal the rails' charges (2026-11-03 census)", () => {
  // The 2026-11-03 four-way census found these rails charging with no
  // registry row at all — pages and World desks quoted the server
  // constants directly, so the operator KB could not quote the prices.
  // Rows were added to the registry mirroring the constants; these pins
  // re-derive every figure from the server source so the three cannot
  // drift apart silently. No rail amount changed anywhere in this lane.
  const BACKFILL_ROWS = [
    { endpoint: "/api/songs/:id/remix", file: "routes/songs.ts", constant: "REMIX_CREDIT_COST", cost: 300 },
    { endpoint: "/api/llc-guide/ask", file: "routes/generate/llc-guide.ts", constant: "LLC_GUIDE_CREDIT_COST", cost: 100 },
    { endpoint: "/api/llc-guide/plan", file: "routes/generate/llc-guide.ts", constant: "LLC_GUIDE_CREDIT_COST", cost: 100 },
    { endpoint: "/api/detect/media", file: "routes/generate/media-detector.ts", constant: "DETECTION_CREDITS", cost: 200 },
    { endpoint: "/api/remove-video-background", file: "routes/generate/video-background-removal.ts", constant: "VIDEO_BG_REMOVAL_COST", cost: 500 },
    { endpoint: "/api/brand-calculator/calculate", file: "routes/generate/brand-calculator.ts", constant: "BRAND_CALC_CREDIT_COST", cost: 200 },
    { endpoint: "/api/interview-prep/session", file: "routes/generate/interview-prep.ts", constant: "INTERVIEW_PREP_CREDIT_COST", cost: 200 },
    { endpoint: "/api/interview-prep/feedback", file: "routes/generate/interview-prep.ts", constant: "INTERVIEW_FEEDBACK_CREDIT_COST", cost: 100 },
    { endpoint: "/api/ai-interview/questions", file: "routes/generate/ai-interview.ts", constant: "QUESTIONS_CREDITS", cost: 100 },
    { endpoint: "/api/ai-interview/package", file: "routes/generate/ai-interview.ts", constant: "PACKAGE_CREDITS", cost: 200 },
    { endpoint: "/api/promo-generator", file: "routes/generate/promo-generator.ts", constant: "PROMO_GENERATOR_CREDITS", cost: 100 },
    { endpoint: "/api/brand-kit", file: "routes/generate/brand-kit.ts", constant: "BRAND_KIT_COST", cost: 200 },
    { endpoint: "/api/contracts/analyze", file: "routes/generate/contract-analyzer.ts", constant: "CONTRACT_ANALYSIS_CREDITS", cost: 300 },
    { endpoint: "/api/cover-in-motion/animate", file: "routes/generate/cover-in-motion.ts", constant: "MOTION_CREDIT_COST", cost: 400 },
    { endpoint: "/api/finish-my-song/complete", file: "routes/generate/finish-my-song.ts", constant: "FINISH_CREDIT_COST", cost: 400 },
    { endpoint: "/api/rate-my-mix/analyze", file: "routes/generate/rate-my-mix.ts", constant: "MIX_CREDIT_COST", cost: 100 },
    { endpoint: "/api/scheduler/posts", file: "routes/scheduler.ts", constant: "SCHEDULER_POST_CREDITS", cost: 100 },
    { endpoint: "/api/scheduler/best-time", file: "routes/scheduler.ts", constant: "SCHEDULER_BEST_TIME_CREDITS", cost: 100 },
    { endpoint: "/api/ugc-ads/persona", file: "routes/ugc-ads.ts", constant: "UGC_PERSONA_CREDIT_COST", cost: 100 },
    { endpoint: "/api/memberships/ai-perks", file: "routes/generate/memberships.ts", constant: "MEMBERSHIPS_AI_CREDITS", cost: 100 },
    { endpoint: "/api/royalties/insights", file: "routes/generate/royalties.ts", constant: "ROYALTY_INSIGHTS_CREDITS", cost: 100 },
    { endpoint: "/api/beats/:id/ai-tags", file: "routes/generate/beats-pricing.ts", constant: "BEAT_AI_TAGS_CREDIT_COST", cost: 100 },
    { endpoint: "/api/contests/:id/announce", file: "routes/generate/contests.ts", constant: "CONTEST_ANNOUNCE_CREDIT_COST", cost: 100 },
    { endpoint: "/api/distribution/metadata", file: "routes/generate/distribution.ts", constant: "AI_CREDIT_COST", cost: 100 },
    { endpoint: "/api/distribution/strategy", file: "routes/generate/distribution.ts", constant: "AI_CREDIT_COST", cost: 100 },
    { endpoint: "/api/distribution/releases/:id/submit", file: "routes/generate/distribution.ts", constant: "DISTRIBUTION_RELEASE_CREDITS", cost: 1000 },
  ] as const;

  for (const spec of BACKFILL_ROWS) {
    it(`${spec.endpoint}: registry == ${spec.constant} (${spec.cost})`, () => {
      const rail = deriveServerConstant(spec.file, spec.constant);
      expect(rail).toBe(spec.cost);
      expect(CREDIT_COSTS[spec.endpoint]?.cost).toBe(rail);
    });
  }

  it("/api/ugc-ads/:id/generate: registry == GEN45_CREDIT_COST (400) via the UGC_VIDEO_CREDIT_COST alias", () => {
    // routes/ugc-ads.ts sets UGC_VIDEO_CREDIT_COST = GEN45_CREDIT_COST;
    // the numeric source of truth is clip-pricing.ts.
    const rail = deriveServerConstant("routes/generate/clip-pricing.ts", "GEN45_CREDIT_COST");
    expect(rail).toBe(400);
    expect(CREDIT_COSTS["/api/ugc-ads/:id/generate"]?.cost).toBe(rail);
  });
});

describe("CREDIT_COSTS spoken-reply row equals the chat-speak rail (QC-200 #14)", () => {
  // The chat drawer's speak button never reads its price from this
  // registry — it reads GET /api/chat/speak/status live — but the
  // operator's knowledge base quotes CREDIT_COSTS, and until this row
  // existed the KB had no spoken-reply price to quote at all (the
  // operator denied the feature exists, Sitting C Q159). The row
  // mirrors the rail's CHAT_SPEAK_CREDITS default; this pin keeps
  // registry and rail from drifting apart.
  it("/api/chat/speak: registry == CHAT_SPEAK_CREDITS (100)", () => {
    const rail = deriveServerConstant("routes/chat-speak.ts", "CHAT_SPEAK_CREDITS");
    expect(rail).toBe(100);
    expect(CREDIT_COSTS["/api/chat/speak"]?.cost).toBe(rail);
    expect(CREDIT_COSTS["/api/chat/speak"]?.feature).toBe("Spoken Reply");
  });
});
