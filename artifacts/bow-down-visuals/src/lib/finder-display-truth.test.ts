/**
 * finder-display-truth.test.ts — every displayed price in the finder
 * family (and the whole-client sweep that followed it) must equal the
 * charge on its rail.
 *
 * The stack700 matcher lane proved the sponsor buttons quoted 1 Buc
 * while the rail charged 100. Its addendum found the same disease
 * across the finder family — buttons quoting 1–2 Bucs for rails
 * charging 100–200 — plus one tangled case (the pitch kit: display 2,
 * a client comment claiming "backend + UI agree on 2", a registry the
 * comment called "stale at 1" — while the rail constant, the registry
 * AND the API suite all said 200). This lane aligned every DISPLAY to
 * its rail; no charge moved anywhere. These pins re-derive both sides
 * from the source files so display and charge cannot drift apart
 * silently again.
 *
 * The sweep that followed the named cases covered every *_COST-style
 * display constant in the client. Cases proven display==rail are not
 * pinned here; cases where the price itself is an unapproved
 * placeholder on BOTH sides (podcast dialogue, LUFS, vocal tune, …)
 * are owner price questions, not display lies, and stay unpinned.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CREDIT_COSTS } from "./credit-costs";

function readFe(rel: string): string {
  return readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
}

function readApi(rel: string): string {
  return readFileSync(new URL(`../../../api-server/src/${rel}`, import.meta.url), "utf8");
}

/** Derive a numeric constant from a client source file. */
function deriveClientConstant(rel: string, constant: string): number {
  const src = readFe(rel);
  const re = new RegExp(`(?:export\\s+)?const\\s+${constant}\\s*(?::\\s*number)?\\s*=\\s*([\\d_]+)\\s*;`);
  const m = src.match(re);
  expect(m, `${constant} in ${rel}`).toBeTruthy();
  return Number(m![1].replace(/_/g, ""));
}

/** Derive a server cost constant — plain literal, env-overridable
    default, and nullish-env forms — from the named server file
    (mirrors credit-costs-rail-truth.test.ts). */
function deriveServerConstant(rel: string, constant: string): number {
  const src = readApi(rel);
  const re = new RegExp(
    `(?:export\\s+)?const\\s+${constant}\\s*(?::\\s*number)?\\s*=\\s*(?:Number\\(process\\.env\\[["'][A-Z0-9_]+["']\\](?:\\s*\\?\\?\\s*\\d+)?\\)\\s*\\|\\|\\s*)?([\\d_]+)\\b`,
  );
  const m = src.match(re);
  expect(m, `${constant} in ${rel}`).toBeTruthy();
  return Number(m![1].replace(/_/g, ""));
}

interface Case {
  label: string;
  feFile: string;
  feConstant: string;
  apiFile: string;
  apiConstant: string;
  /** Registry endpoint that must also agree, when one exists. */
  endpoint?: string;
  expected: number;
}

const CASES: Case[] = [
  // ── The named finder family ──────────────────────────────────────
  { label: "brand-deals finder search", feFile: "pages/brand-deals.tsx", feConstant: "SEARCH_COST", apiFile: "routes/generate/brand-deals.ts", apiConstant: "BRAND_DEAL_CREDIT_COST", endpoint: "/api/brand-deals", expected: 200 },
  { label: "brand-deals outreach draft", feFile: "pages/brand-deals.tsx", feConstant: "OUTREACH_COST", apiFile: "routes/generate/brand-deals.ts", apiConstant: "BRAND_DEAL_OUTREACH_CREDIT_COST", endpoint: "/api/brand-deals/outreach", expected: 100 },
  { label: "pitch kit (the tangled case)", feFile: "pages/brand-deals.tsx", feConstant: "PITCH_KIT_COST", apiFile: "routes/generate/sponsorship-outreach.ts", apiConstant: "OUTREACH_CREDIT_COST", endpoint: "/api/outreach", expected: 200 },
  { label: "show finder search", feFile: "pages/shows.tsx", feConstant: "SEARCH_COST", apiFile: "routes/generate/show-finder.ts", apiConstant: "SHOW_FINDER_CREDIT_COST", endpoint: "/api/show-finder", expected: 200 },
  { label: "show finder pitch draft", feFile: "pages/shows.tsx", feConstant: "PITCH_COST", apiFile: "routes/generate/show-finder.ts", apiConstant: "SHOW_FINDER_PITCH_CREDIT_COST", endpoint: "/api/show-finder/pitch", expected: 100 },
  // ── The sweep ────────────────────────────────────────────────────
  { label: "fan decoder", feFile: "components/analytics-hub/FanDecoderSection.tsx", feConstant: "COST", apiFile: "routes/generate/fan-decoder.ts", apiConstant: "DECODE_CREDITS", expected: 100 },
  { label: "deverb", feFile: "components/audio/DeverbPanel.tsx", feConstant: "DEVERB_CREDIT_COST_VB", apiFile: "routes/generate/deverb.ts", apiConstant: "DEVERB_CREDIT_COST", endpoint: "/api/deverb", expected: 1000 },
  { label: "finish my song (audio studio tab)", feFile: "components/audio-studio/FinishMySong.tsx", feConstant: "COST", apiFile: "routes/generate/finish-my-song.ts", apiConstant: "FINISH_CREDIT_COST", expected: 400 },
  { label: "rate my mix", feFile: "components/audio-studio/RateMyMix.tsx", feConstant: "COST", apiFile: "routes/generate/rate-my-mix.ts", apiConstant: "MIX_CREDIT_COST", expected: 100 },
  { label: "cover in motion", feFile: "components/create/CoverInMotionPanel.tsx", feConstant: "COST", apiFile: "routes/generate/cover-in-motion.ts", apiConstant: "MOTION_CREDIT_COST", expected: 400 },
  { label: "dream collab", feFile: "components/create/DreamCollabPanel.tsx", feConstant: "COST", apiFile: "routes/generate/dream-collab.ts", apiConstant: "CONCEPT_CREDITS", expected: 200 },
  { label: "link to hit", feFile: "components/create/LinkToHitPanel.tsx", feConstant: "COST", apiFile: "routes/generate/link-to-hit.ts", apiConstant: "ANALYZE_CREDITS", expected: 300 },
  { label: "meme machine captions", feFile: "components/editor/sections/MemeMachineSection.tsx", feConstant: "COST", apiFile: "routes/generate/meme-machine.ts", apiConstant: "CAPTIONS_CREDITS", endpoint: "/api/meme-machine/captions", expected: 100 },
  { label: "style stealer", feFile: "components/editor/sections/StyleStealerSection.tsx", feConstant: "COST", apiFile: "routes/generate/style-stealer.ts", apiConstant: "ANALYZE_CREDITS", endpoint: "/api/style-stealer/analyze", expected: 200 },
  { label: "stream copilot prep", feFile: "components/go-live/StreamCopilotSection.tsx", feConstant: "PREP_COST", apiFile: "routes/generate/stream-copilot.ts", apiConstant: "PREP_CREDITS", endpoint: "/api/stream-copilot/prep", expected: 100 },
  { label: "stream copilot clip plan", feFile: "components/go-live/StreamCopilotSection.tsx", feConstant: "CLIP_COST", apiFile: "routes/generate/stream-copilot.ts", apiConstant: "CLIP_PLAN_CREDITS", endpoint: "/api/stream-copilot/clip-plan", expected: 100 },
  { label: "AI interview questions", feFile: "components/hooks/AIInterviewSection.tsx", feConstant: "Q_COST", apiFile: "routes/generate/ai-interview.ts", apiConstant: "QUESTIONS_CREDITS", expected: 100 },
  { label: "AI interview package", feFile: "components/hooks/AIInterviewSection.tsx", feConstant: "PKG_COST", apiFile: "routes/generate/ai-interview.ts", apiConstant: "PACKAGE_CREDITS", expected: 200 },
  { label: "comment to video", feFile: "components/hooks/CommentToVideoSection.tsx", feConstant: "COST", apiFile: "routes/generate/comment-to-video.ts", apiConstant: "SCRIPTS_CREDITS", expected: 200 },
  { label: "lyric stories (per card)", feFile: "components/hooks/LyricStoriesSection.tsx", feConstant: "COST_PER_CARD", apiFile: "routes/generate/lyric-stories.ts", apiConstant: "CREDITS_PER_CARD", endpoint: "/api/lyric-stories/generate", expected: 200 },
  { label: "trend jacker draft", feFile: "components/scheduler/TrendJackerSection.tsx", feConstant: "DRAFT_CREDITS", apiFile: "routes/generate/trend-jacker.ts", apiConstant: "DRAFT_CREDITS", endpoint: "/api/trend-jacker/draft", expected: 200 },
  { label: "podcast (per 10 min)", feFile: "lib/podcast.ts", feConstant: "PODCAST_CREDITS_PER_10MIN", apiFile: "routes/generate/podcast.ts", apiConstant: "PODCAST_CREDITS_PER_10MIN", endpoint: "/api/podcast/generate", expected: 300 },
  { label: "analytics hub growth plan", feFile: "pages/analytics-hub.tsx", feConstant: "INSIGHT_COST", apiFile: "routes/generate/analytics-hub.ts", apiConstant: "ANALYTICS_HUB_CREDITS", endpoint: "/api/analytics-hub/insights", expected: 200 },
  { label: "artist vault loop video", feFile: "pages/artist-vault.tsx", feConstant: "LOOP_VIDEO_CREDITS", apiFile: "routes/artist-vaults.ts", apiConstant: "LOOP_VIDEO_CREDITS", expected: 200 },
  { label: "contract analyzer", feFile: "pages/contracts.tsx", feConstant: "CREDIT_COST", apiFile: "routes/generate/contract-analyzer.ts", apiConstant: "CONTRACT_ANALYSIS_CREDITS", expected: 300 },
  { label: "copyright draft", feFile: "pages/copyright.tsx", feConstant: "DRAFT_CREDIT_COST", apiFile: "routes/generate/copyright.ts", apiConstant: "COPYRIGHT_DRAFT_CREDITS", expected: 100 },
  { label: "copyright ask", feFile: "pages/copyright.tsx", feConstant: "ASK_CREDIT_COST", apiFile: "routes/generate/copyright.ts", apiConstant: "COPYRIGHT_ASK_CREDITS", expected: 100 },
  { label: "interview prep session", feFile: "pages/interview-prep.tsx", feConstant: "SESSION_COST", apiFile: "routes/generate/interview-prep.ts", apiConstant: "INTERVIEW_PREP_CREDIT_COST", expected: 200 },
  { label: "interview prep feedback", feFile: "pages/interview-prep.tsx", feConstant: "FEEDBACK_COST", apiFile: "routes/generate/interview-prep.ts", apiConstant: "INTERVIEW_FEEDBACK_CREDIT_COST", expected: 100 },
  { label: "playlist pitch kit", feFile: "pages/label-pitch.tsx", feConstant: "PLAYLIST_KIT_COST", apiFile: "routes/generate/playlist-pitch.ts", apiConstant: "PLAYLIST_PITCH_CREDIT_COST", endpoint: "/api/playlist-pitch/kit", expected: 200 },
  { label: "movie concept", feFile: "pages/movies.tsx", feConstant: "CONCEPT_CREDITS", apiFile: "routes/generate/movies.ts", apiConstant: "CONCEPT_CREDITS", expected: 400 },
  { label: "movie clip detect", feFile: "pages/movies.tsx", feConstant: "CLIP_DETECT_CREDITS", apiFile: "routes/generate/movies.ts", apiConstant: "CLIP_DETECT_CREDITS", expected: 300 },
  { label: "trend forecast", feFile: "pages/trends.tsx", feConstant: "FORECAST_CREDITS", apiFile: "routes/generate/trend-predictor.ts", apiConstant: "FORECAST_CREDITS", endpoint: "/api/trend-predictor/forecast", expected: 200 },
  { label: "trend ideas", feFile: "pages/trends.tsx", feConstant: "IDEAS_CREDITS", apiFile: "routes/generate/trend-predictor.ts", apiConstant: "IDEAS_CREDITS", expected: 100 },
  { label: "stream pack fallback", feFile: "pages/stream-pack.tsx", feConstant: "FALLBACK_CREDIT_COST", apiFile: "routes/generate/stream-pack.ts", apiConstant: "STREAM_PACK_CREDIT_COST", endpoint: "/api/stream-pack/generate", expected: 100 },
  { label: "website build", feFile: "pages/website-builder.tsx", feConstant: "BUILD_COST", apiFile: "routes/generate/website-builder.ts", apiConstant: "WEBSITE_BUILD_CREDITS", endpoint: "/api/website-builder/generate", expected: 3000 },
  { label: "website edit", feFile: "pages/website-builder.tsx", feConstant: "EDIT_COST", apiFile: "routes/generate/website-builder.ts", apiConstant: "WEBSITE_EDIT_CREDITS", endpoint: "/api/website-builder/edit", expected: 200 },
];

describe("displayed prices equal the rails' charges (finder family + sweep)", () => {
  for (const c of CASES) {
    it(`${c.label}: display == rail (${c.expected})`, () => {
      const rail = deriveServerConstant(c.apiFile, c.apiConstant);
      expect(rail).toBe(c.expected);
      expect(deriveClientConstant(c.feFile, c.feConstant)).toBe(rail);
      if (c.endpoint) {
        expect(CREDIT_COSTS[c.endpoint]?.cost, `registry ${c.endpoint}`).toBe(rail);
      }
    });
  }

  it("artist vault reference video: display == duration × per-second rail (1500)", () => {
    const seconds = deriveServerConstant("routes/artist-vaults.ts", "REF_VIDEO_DURATION_SEC");
    const perSec = deriveServerConstant("routes/generate/clip-pricing.ts", "SEEDANCE_720P_CREDITS_PER_SEC_DEFAULT");
    expect(seconds * perSec).toBe(1500);
    expect(deriveClientConstant("pages/artist-vault.tsx", "REF_VIDEO_CREDITS")).toBe(seconds * perSec);
  });

  it("storefront AI shop description: the confirmation override is the rail's 100", () => {
    const rail = deriveServerConstant("routes/generate/shops.ts", "SHOP_AI_CREDIT_COST");
    expect(rail).toBe(100);
    expect(CREDIT_COSTS["/api/shops/ai/shop-description"]?.cost).toBe(rail);
    const page = readFe("pages/storefront-builder.tsx");
    expect(page).toContain("overrideCost: 100, overrideFeature:");
    expect(page).not.toContain("overrideCost: 1,");
  });

  it("audio studio vocal removal: both price sites carry the ×100 the rest of the file uses", () => {
    const page = readFe("pages/audio-studio.tsx");
    expect(page).toContain('{t("vocalRemoval.pageSub", { cost: VOCAL_CREDIT_COST * 100 })}');
    expect(page).toContain('{t("vocalRemoval.removeButton", { cost: VOCAL_CREDIT_COST * 100 })}');
    expect(page).not.toContain('{ cost: VOCAL_CREDIT_COST })}');
    // The underlying unit constant is 3 old-style units; ×100 = the rail.
    expect(deriveClientConstant("pages/audio-studio.tsx", "VOCAL_CREDIT_COST") * 100).toBe(300);
    expect(CREDIT_COSTS["/api/vocal-removal"]?.cost).toBe(300);
  });

  it("stream pack: the regenerate title no longer multiplies the per-image cost by 100", () => {
    const page = readFe("pages/stream-pack.tsx");
    expect(page).not.toContain("creditCost * 100");
    expect(page).toContain('{t("streamPack.regenerate", { cost: creditCost })}');
  });

  it("the stale 'backend + UI agree on 2' claims are gone from both tangled surfaces", () => {
    expect(readFe("pages/brand-deals.tsx")).not.toContain("backend + UI agree on 2");
    expect(readFe("pages/brand-deals.tsx")).not.toContain("registry is stale at 1");
    expect(readFe("pages/trends.tsx")).not.toContain("backend + UI agree on 2");
    expect(readFe("pages/trends.tsx")).not.toContain("registry is stale at 1");
  });

  it("en button copy: the two draft buttons pluralize the unit at their new prices", () => {
    const en = JSON.parse(readFe("locales/en.json")) as Record<string, Record<string, string>>;
    expect(en["brandDeals"]?.["draftButton"]).toBe("Draft my outreach · {{n}} credits");
    expect(en["shows"]?.["draftPitchButton"]).toBe("Draft my pitch · {{cost}} credits");
    // The three sibling buttons already carried the house unit and interpolate.
    expect(en["brandDeals"]?.["huntButton"]).toContain("{{n}} Visual Bucs");
    expect(en["outreach"]?.["generateKit"]).toContain("{{cost}} Visual Bucs");
    expect(en["shows"]?.["findStagesButton"]).toContain("{{cost}} Visual Bucs");
  });
});
