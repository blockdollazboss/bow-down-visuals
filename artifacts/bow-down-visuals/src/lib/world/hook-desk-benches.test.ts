/**
 * hook-desk-benches — Stack 400 world parity (census B-16 /
 * B-17 / B-20) seam pins. The hooks family's remaining rails
 * must post where their 2D twins post, at the registry's
 * prices, shape payloads field-for-field like the twins, gate
 * runs on the twins' own readiness rules, and hold every
 * answer to the twins' usability bars — drift parses to null,
 * never to dressed-up rows.
 */
import { describe, expect, it } from "vitest";
import {
  AI_INTERVIEW_PACKAGE_PATH,
  AI_INTERVIEW_QUESTIONS_PATH,
  ANALYZE_HOOK_PATH,
  DIAG_PLATFORMS,
  DOCTOR_PLATFORMS,
  DOCTOR_VIDEO_TYPES,
  OPENINGS_PATH,
  RETENTION_DOCTOR_PATH,
  SEO_SCORE_PATH,
  STYLE_STEALER_PATH,
  TREND_JACKER_PATH,
  aiInterviewPackageCost,
  aiInterviewQuestionsCost,
  buildDoctorPayload,
  buildHookAnalysisPayload,
  buildInterviewPackagePayload,
  buildInterviewQuestionsPayload,
  buildOpeningsPayload,
  buildSeoScorePayload,
  buildStyleStealerPayload,
  buildTrendDraftPayload,
  doctorDropOffValid,
  doctorOfResponse,
  doctorReady,
  hookAnalysisOfResponse,
  hookAnalysisReady,
  hookAnalyzerCost,
  interviewPackageOfResponse,
  interviewPackageReady,
  interviewQaPairs,
  interviewQuestionsOfResponse,
  interviewQuestionsReady,
  openingsCost,
  openingsOfResponse,
  openingsReady,
  retentionDoctorCost,
  seoScoreCost,
  seoScoreOfResponse,
  seoScoreReady,
  seoTagsFromText,
  styleFormulaOfResponse,
  styleStealerCost,
  styleStealerReady,
  trendDraftOfResponse,
  trendDraftReady,
  trendJackerCost,
} from "./hook-desk";
import { getCreditCost } from "../credit-costs";

describe("the rails + the prices — the registry's, matching the twins", () => {
  it("B-16: ai-interview questions 100 + package 200", () => {
    expect(AI_INTERVIEW_QUESTIONS_PATH).toBe("/api/ai-interview/questions");
    expect(AI_INTERVIEW_PACKAGE_PATH).toBe("/api/ai-interview/package");
    expect(getCreditCost(AI_INTERVIEW_QUESTIONS_PATH)?.cost).toBe(100);
    expect(getCreditCost(AI_INTERVIEW_PACKAGE_PATH)?.cost).toBe(200);
    expect(aiInterviewQuestionsCost()).toBe(100);
    expect(aiInterviewPackageCost()).toBe(200);
  });

  it("B-17: three-second-lab openings 200", () => {
    expect(OPENINGS_PATH).toBe("/api/three-second-lab/openings");
    expect(getCreditCost(OPENINGS_PATH)?.cost).toBe(200);
    expect(openingsCost()).toBe(200);
  });

  it("B-20: diagnostics 75 / 75 / 150 / 200 / 200", () => {
    expect(ANALYZE_HOOK_PATH).toBe("/api/analyze-hook");
    expect(SEO_SCORE_PATH).toBe("/api/seo-score");
    expect(RETENTION_DOCTOR_PATH).toBe("/api/retention-doctor");
    expect(TREND_JACKER_PATH).toBe("/api/trend-jacker/draft");
    expect(STYLE_STEALER_PATH).toBe("/api/style-stealer/analyze");
    expect(hookAnalyzerCost()).toBe(75);
    expect(seoScoreCost()).toBe(75);
    expect(retentionDoctorCost()).toBe(150);
    expect(trendJackerCost()).toBe(200);
    expect(styleStealerCost()).toBe(200);
  });

  it("carries the twins' enums verbatim", () => {
    expect(DIAG_PLATFORMS).toEqual(["tiktok", "instagram", "youtube", "x"]);
    expect(DOCTOR_VIDEO_TYPES).toEqual([
      "music-video",
      "tutorial",
      "vlog",
      "short",
      "promo",
      "livestream-clip",
      "other",
    ]);
    expect(DOCTOR_PLATFORMS).toEqual(["tiktok", "instagram", "youtube", "x"]);
  });
});

describe("payloads — the twins' posts, field for field", () => {
  it("interview questions: { topic, niche } trimmed", () => {
    expect(buildInterviewQuestionsPayload({ topic: "  my single ", niche: " hip-hop " })).toEqual({
      topic: "my single",
      niche: "hip-hop",
    });
  });

  it("interview qa pairs keep only answered questions; the package posts { topic, qa }", () => {
    const qa = interviewQaPairs(["Q1", "Q2", "Q3"], [" A1 ", "", "A3"]);
    expect(qa).toEqual([
      { question: "Q1", answer: "A1" },
      { question: "Q3", answer: "A3" },
    ]);
    expect(buildInterviewPackagePayload({ topic: " t ", qa })).toEqual({ topic: "t", qa });
  });

  it("openings: { videoDescription, niche } trimmed", () => {
    expect(buildOpeningsPayload({ videoDescription: " d ", niche: " n " })).toEqual({
      videoDescription: "d",
      niche: "n",
    });
  });

  it("analyze-hook: transcript clipped to 3000, niche to 100, mode rides", () => {
    const body = buildHookAnalysisPayload({
      transcript: ` ${"x".repeat(4000)} `,
      platform: "tiktok",
      niche: "y".repeat(150),
      mode: "viral",
    });
    expect(body.platform).toBe("tiktok");
    expect(body.mode).toBe("viral");
    expect((body.transcript as string).length).toBe(3000);
    expect((body.niche as string).length).toBe(100);
  });

  it("seo-score: tags split/trimmed/capped at 15, booleans ride", () => {
    expect(seoTagsFromText(" a, b ,,c ")).toEqual(["a", "b", "c"]);
    expect(seoTagsFromText(Array.from({ length: 20 }, (_, i) => `t${i}`).join(","))).toHaveLength(15);
    expect(
      buildSeoScorePayload({
        title: " T ",
        description: " D ",
        tagsText: "x, y",
        niche: " n ",
        hasChapters: true,
        hasCaptions: false,
      }),
    ).toEqual({
      title: "T",
      description: "D",
      tags: ["x", "y"],
      niche: "n",
      hasChapters: true,
      hasCaptions: false,
    });
  });

  it("retention-doctor: only valid rows ride, as numbers; optionals only when set", () => {
    expect(doctorDropOffValid({ at: "0:45", dropPct: "30" })).toBe(true);
    expect(doctorDropOffValid({ at: "45", dropPct: "30" })).toBe(false);
    expect(doctorDropOffValid({ at: "0:45", dropPct: "0" })).toBe(false);
    expect(doctorDropOffValid({ at: "0:45", dropPct: "100" })).toBe(false);
    expect(doctorDropOffValid({ at: "0:45", dropPct: "" })).toBe(false);
    expect(
      buildDoctorPayload({
        title: " My video ",
        dropOffs: [
          { at: "0:45", dropPct: "30" },
          { at: "bad", dropPct: "10" },
          { at: "1:20", dropPct: "55" },
        ],
        totalLength: "3:00",
        niche: " music ",
        videoType: "music-video",
        platform: "",
      }),
    ).toEqual({
      title: "My video",
      dropOffs: [
        { at: "0:45", dropPct: 30 },
        { at: "1:20", dropPct: 55 },
      ],
      totalLength: "3:00",
      niche: "music",
      videoType: "music-video",
    });
    const bare = buildDoctorPayload({
      title: "T",
      dropOffs: [{ at: "0:10", dropPct: "5" }],
      totalLength: "abc",
      niche: "",
      videoType: "",
      platform: "",
    });
    expect(bare).toEqual({ title: "T", dropOffs: [{ at: "0:10", dropPct: 5 }] });
  });

  it("trend-jacker: the niche defaults to Music when blank", () => {
    expect(buildTrendDraftPayload({ trend: " t ", trendWhy: " w ", niche: " ", styleNotes: " s " })).toEqual({
      trend: "t",
      trendWhy: "w",
      niche: "Music",
      styleNotes: "s",
    });
    expect(
      buildTrendDraftPayload({ trend: "t", trendWhy: "", niche: " fitness ", styleNotes: "" }),
    ).toEqual({ trend: "t", trendWhy: "", niche: "fitness", styleNotes: "" });
  });

  it("style-stealer: { videoUrl, description, niche } trimmed", () => {
    expect(buildStyleStealerPayload({ videoUrl: " u ", description: " d ", niche: " n " })).toEqual({
      videoUrl: "u",
      description: "d",
      niche: "n",
    });
  });
});

describe("readiness — the twins' run gates", () => {
  it("gates hold shut on blank required input", () => {
    expect(interviewQuestionsReady(" x ")).toBe(true);
    expect(interviewQuestionsReady("  ")).toBe(false);
    expect(interviewPackageReady(["Q"], [""])).toBe(false);
    expect(interviewPackageReady(["Q"], ["a"])).toBe(true);
    expect(interviewPackageReady([], ["a"])).toBe(false);
    expect(openingsReady("d")).toBe(true);
    expect(openingsReady("")).toBe(false);
    expect(hookAnalysisReady("h")).toBe(true);
    expect(hookAnalysisReady(" ")).toBe(false);
    expect(seoScoreReady("t")).toBe(true);
    expect(seoScoreReady("")).toBe(false);
    expect(doctorReady("abc", [{ at: "0:45", dropPct: "30" }])).toBe(true);
    expect(doctorReady("ab", [{ at: "0:45", dropPct: "30" }])).toBe(false);
    expect(doctorReady("abc", [{ at: "x", dropPct: "30" }])).toBe(false);
    expect(trendDraftReady("t")).toBe(true);
    expect(trendDraftReady("")).toBe(false);
    expect(styleStealerReady("d")).toBe(true);
    expect(styleStealerReady("")).toBe(false);
  });
});

describe("response guards — drift is null, never dressed-up rows", () => {
  it("interview questions: capped at 5; empty or drifted is null", () => {
    expect(interviewQuestionsOfResponse({ questions: ["a", "b", "c", "d", "e", "f"] })).toEqual([
      "a",
      "b",
      "c",
      "d",
      "e",
    ]);
    expect(interviewQuestionsOfResponse({ questions: [] })).toBeNull();
    expect(interviewQuestionsOfResponse({ questions: "nope" })).toBeNull();
    expect(interviewQuestionsOfResponse(null)).toBeNull();
  });

  it("interview package: the clips array is the payload; missing is null", () => {
    expect(
      interviewPackageOfResponse({
        clips: [{ quote: " q ", why: " w " }, { quote: " ", why: "x" }, "junk"],
        quoteCards: [" card "],
        promoOutline: [" step "],
      }),
    ).toEqual({
      clips: [{ quote: "q", why: "w" }],
      quoteCards: ["card"],
      promoOutline: ["step"],
    });
    expect(interviewPackageOfResponse({ quoteCards: [] })).toBeNull();
    expect(interviewPackageOfResponse({ clips: "nope" })).toBeNull();
  });

  it("openings: sorted best-first like the section; textless rows drop; empty is null", () => {
    const parsed = openingsOfResponse({
      openings: [
        { text: "low", visual: "v", score: 40, reasoning: "r" },
        { text: "high", visual: "v", score: 92, reasoning: "r" },
        { text: " ", visual: "v", score: 99, reasoning: "r" },
      ],
    });
    expect(parsed?.map((o) => o.text)).toEqual(["high", "low"]);
    expect(openingsOfResponse({ openings: [] })).toBeNull();
    expect(openingsOfResponse({})).toBeNull();
  });

  it("hook analysis: needs an analysis with an overallScore; axes clamp 0–10", () => {
    const parsed = hookAnalysisOfResponse({
      analysis: {
        curiosityGap: 12,
        patternInterrupt: 7,
        clarity: -2,
        overallScore: 86,
        verdict: " strong ",
        weaknesses: [" w "],
        rewrittenHook: " new ",
        rewriteNotes: [],
        alternativeHooks: [" alt "],
      },
    });
    expect(parsed?.curiosityGap).toBe(10);
    expect(parsed?.clarity).toBe(0);
    expect(parsed?.overallScore).toBe(86);
    expect(parsed?.verdict).toBe("strong");
    expect(hookAnalysisOfResponse({ analysis: { verdict: "x" } })).toBeNull();
    expect(hookAnalysisOfResponse({})).toBeNull();
  });

  it("seo score: needs the result + overallScore; bad-severity issues drop", () => {
    const parsed = seoScoreOfResponse({
      result: {
        overallScore: 71,
        dimensions: {
          titleStrength: 80,
          keywordCoverage: 60,
          descriptionQuality: 70,
          tagRelevance: 65,
          packagingComplete: 90,
        },
        issues: [
          { severity: "high", message: " m ", fix: " f " },
          { severity: "fatal", message: "x", fix: "y" },
        ],
        optimizedTitle: " T ",
        optimizedDescriptionFirst150: " D ",
      },
    });
    expect(parsed?.overallScore).toBe(71);
    expect(parsed?.dimensions.titleStrength).toBe(80);
    expect(parsed?.issues).toHaveLength(1);
    expect(seoScoreOfResponse({ result: {} })).toBeNull();
    expect(seoScoreOfResponse({})).toBeNull();
  });

  it("retention doctor: needs a report card AND a usable diagnosis", () => {
    const parsed = doctorOfResponse({
      reportCard: { grade: "B", score: 78, headline: " h " },
      summary: " s ",
      diagnoses: [
        {
          at: "0:45",
          dropPct: 30,
          causeCategory: "pacing",
          causeLabel: " Slow stretch ",
          diagnosis: " d ",
          prescription: " p ",
          fixAction: "editor",
          fixLabel: " Open the editor ",
          fixUrl: "/editor",
        },
        { at: "1:00", dropPct: "wide", causeLabel: "x", prescription: "y" },
      ],
    });
    expect(parsed?.reportCard.grade).toBe("B");
    expect(parsed?.diagnoses).toHaveLength(1);
    expect(parsed?.diagnoses[0]?.fixAction).toBe("editor");
    expect(doctorOfResponse({ reportCard: { grade: "B", score: 1 }, diagnoses: [] })).toBeNull();
    expect(doctorOfResponse({ diagnoses: [{ at: "0:1", dropPct: 1, causeLabel: "x", prescription: "y" }] })).toBeNull();
  });

  it("trend draft: no hook or no script is null", () => {
    expect(
      trendDraftOfResponse({ hook: " h ", script: " s ", visualPlan: [" v "], caption: " c ", hashtags: [" t "] }),
    ).toEqual({ hook: "h", script: "s", visualPlan: ["v"], caption: "c", hashtags: ["t"] });
    expect(trendDraftOfResponse({ hook: "h" })).toBeNull();
    expect(trendDraftOfResponse({ script: "s" })).toBeNull();
  });

  it("style formula: no formula or no hook line is null; recipe + hints ride", () => {
    const parsed = styleFormulaOfResponse({
      formula: {
        hook: " h ",
        pacing: " p ",
        cutPattern: " c ",
        captionStyle: " gold ",
        audioCues: " a ",
        whyItWorks: " w ",
      },
      editRecipe: { name: " Recipe ", steps: [" s1 "] },
      applyHints: { captionStyle: "karaoke", effects: ["VHS"], overlays: [] },
    });
    expect(parsed?.formula.captionStyle).toBe("gold");
    expect(parsed?.editRecipe).toEqual({ name: "Recipe", steps: ["s1"] });
    expect(parsed?.applyHints?.captionStyle).toBe("karaoke");
    expect(styleFormulaOfResponse({ formula: { hook: " " } })).toBeNull();
    expect(styleFormulaOfResponse({})).toBeNull();
  });
});
