import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  AI_COACH_COST_VB,
  AI_COACH_FEATURE,
  AI_COACH_PATH,
  ANALYTICS_HUB_MAX_HISTORY,
  ANALYTICS_HUB_STORAGE_KEY,
  ANALYTICS_INSIGHTS_COST_VB,
  ANALYTICS_INSIGHTS_FEATURE,
  ANALYTICS_INSIGHTS_PATH,
  ANALYTICS_NO_CONNECTED_LINE,
  ANALYTICS_OUT_OF_CREDITS_LINE,
  ANALYTICS_OVERVIEW_COST_VB,
  ANALYTICS_OVERVIEW_PATH,
  ANALYTICS_SUGGESTIONS_COST_VB,
  ANALYTICS_SUGGESTIONS_FEATURE,
  ANALYTICS_SUGGESTIONS_PATH,
  AUDIT_DIMENSION_LABELS,
  CHANNEL_AUDIT_COST_VB,
  CHANNEL_AUDIT_FEATURE,
  CHANNEL_AUDIT_PATH,
  COACH_MAX_POSTS,
  COMPETITOR_ANALYSIS_PATH,
  COMPETITOR_COST_VB,
  COMPETITOR_FEATURE,
  GROWTH_PLAN_COST_VB,
  GROWTH_PLAN_FEATURE,
  GROWTH_PLAN_PATH,
  VIRALITY_CHECK_COST_VB,
  VIRALITY_CHECK_FEATURE,
  VIRALITY_CHECK_PATH,
  aiCoachReady,
  analyticsOutOfCredits,
  analyticsTimeAgo,
  blankCoachPost,
  buildAiCoachBody,
  buildAnalyticsAiBody,
  buildChannelAuditBody,
  buildCompetitorBody,
  buildGrowthPlanBody,
  buildViralityBody,
  channelAuditReady,
  competitorReady,
  emptyAnalyticsHubState,
  formatAnalyticsCount,
  hubStateHasData,
  normalizeAiCoach,
  normalizeAnalyticsInsights,
  normalizeAnalyticsOverview,
  normalizeAnalyticsSuggestions,
  normalizeChannelAudit,
  normalizeCompetitorAnalysis,
  normalizeGrowthPlan,
  normalizeViralityCheck,
  parseAnalyticsHubState,
  parseHubStatNumber,
  viralityReady,
  withPlatformStats,
} from "./analytics-desk";
import { getCreditCost } from "../credit-costs";

/* ─── Analytics desk seam (stack100 wave 4, item 24, desk #98) ───
   The My Studio board's Analytics depth desk rides the 2D
   Analytics Hub's own rails. These tests pin the seam: every
   price IS its registry row (read live from credit-costs, and
   the server constant's own default read from the route file —
   never re-typed from memory), the body builders carry the
   page's field names capped at the rails' own schema maxima,
   the hub stats store is the page's OWN localStorage store with
   its load/save discipline, and every normalizer maps its rail's
   answer field-for-field — with a broken or incomplete answer
   reading as a failed read (null), never painted-over content
   and never zero-filled stats. */

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

describe("prices are the registry's own rows", () => {
  const rows: [string, number, string, number, string][] = [
    // path, seam cost, seam feature, ruled cost, ruled feature
    [CHANNEL_AUDIT_PATH, CHANNEL_AUDIT_COST_VB, CHANNEL_AUDIT_FEATURE, 300, "Channel Audit"],
    [VIRALITY_CHECK_PATH, VIRALITY_CHECK_COST_VB, VIRALITY_CHECK_FEATURE, 200, "Virality Pre-Flight Check"],
    [GROWTH_PLAN_PATH, GROWTH_PLAN_COST_VB, GROWTH_PLAN_FEATURE, 200, "Growth Plan"],
    [ANALYTICS_INSIGHTS_PATH, ANALYTICS_INSIGHTS_COST_VB, ANALYTICS_INSIGHTS_FEATURE, 100, "Analytics Insights"],
    [ANALYTICS_SUGGESTIONS_PATH, ANALYTICS_SUGGESTIONS_COST_VB, ANALYTICS_SUGGESTIONS_FEATURE, 100, "Analytics Content Suggestions"],
    [COMPETITOR_ANALYSIS_PATH, COMPETITOR_COST_VB, COMPETITOR_FEATURE, 200, "Competitor Tracker"],
    [AI_COACH_PATH, AI_COACH_COST_VB, AI_COACH_FEATURE, 100, "AI Performance Coach"],
  ];

  it("every seam cost + feature equals the live registry row AND the ruled price", () => {
    for (const [path, cost, feature, ruledCost, ruledFeature] of rows) {
      const row = getCreditCost(path);
      expect(row, path).not.toBeNull();
      expect(cost, path).toBe(row!.cost);
      expect(feature, path).toBe(row!.feature);
      expect(cost, path).toBe(ruledCost);
      expect(feature, path).toBe(ruledFeature);
    }
  });

  it("the paths are the page's own endpoints", () => {
    expect(CHANNEL_AUDIT_PATH).toBe("/api/channel-audit");
    expect(VIRALITY_CHECK_PATH).toBe("/api/virality-check");
    expect(GROWTH_PLAN_PATH).toBe("/api/analytics-hub/insights");
    expect(ANALYTICS_INSIGHTS_PATH).toBe("/api/analytics/insights");
    expect(ANALYTICS_SUGGESTIONS_PATH).toBe("/api/analytics/suggestions");
    expect(COMPETITOR_ANALYSIS_PATH).toBe("/api/competitor-analysis");
    expect(AI_COACH_PATH).toBe("/api/ai-coach");
    expect(ANALYTICS_OVERVIEW_PATH).toBe("/api/analytics/overview");
  });

  it("the overview is free — no registry row exists for it, by design", () => {
    expect(getCreditCost(ANALYTICS_OVERVIEW_PATH)).toBeNull();
    expect(ANALYTICS_OVERVIEW_COST_VB).toBe(0);
  });

  it("each rail's server constant defaults to the same price the registry shows", () => {
    const pins: [string, string][] = [
      [
        "../../../../api-server/src/routes/generate/channel-audit.ts",
        'Number(process.env["CHANNEL_AUDIT_CREDIT_COST"]) || 300',
      ],
      [
        "../../../../api-server/src/routes/generate/virality-check.ts",
        'Number(process.env["VIRALITY_CHECK_CREDIT_COST"]) || 200',
      ],
      [
        "../../../../api-server/src/routes/generate/analytics-hub.ts",
        'Number(process.env["ANALYTICS_HUB_CREDIT_COST"]) || 200',
      ],
      [
        "../../../../api-server/src/routes/generate/competitor-tracker.ts",
        'Number(process.env["COMPETITOR_CREDITS"]) || 200',
      ],
      [
        "../../../../api-server/src/routes/generate/ai-coach.ts",
        'Number(process.env["AI_COACH_CREDITS"]) || 100',
      ],
      [
        "../../../../api-server/src/routes/analytics.ts",
        'Number(process.env["ANALYTICS_INSIGHTS_CREDITS"]) || 100',
      ],
      [
        "../../../../api-server/src/routes/analytics.ts",
        'Number(process.env["ANALYTICS_SUGGESTIONS_CREDITS"]) || 100',
      ],
    ];
    for (const [rel, needle] of pins) {
      expect(read(rel), needle).toContain(needle);
    }
  });

  it("the overview rail is registered free + authed in the route source", () => {
    const route = read("../../../../api-server/src/routes/analytics.ts");
    expect(route).toContain('router.get("/analytics/overview", requireAuth');
    expect(route).toContain("GET  /api/analytics/overview    (authed, FREE)");
  });
});

describe("the out-of-credits truth", () => {
  it("402 or the shared error body reads as out of credits; nothing else does", () => {
    expect(analyticsOutOfCredits(402, null)).toBe(true);
    expect(analyticsOutOfCredits(200, { error: "out_of_credits" })).toBe(true);
    expect(analyticsOutOfCredits(500, { error: "insights_failed" })).toBe(false);
    expect(analyticsOutOfCredits(500, null)).toBe(false);
    expect(analyticsOutOfCredits(200, { creditsUsed: 100 })).toBe(false);
    expect(ANALYTICS_OUT_OF_CREDITS_LINE).toContain("nothing was charged");
  });
});

describe("display helpers never dress unknown as zero", () => {
  it("formatAnalyticsCount: null is an em dash, real numbers compact", () => {
    expect(formatAnalyticsCount(null)).toBe("—");
    expect(formatAnalyticsCount(0)).toBe("0");
    expect(formatAnalyticsCount(999)).toBe("999");
    expect(formatAnalyticsCount(1500)).toBe("1.5K");
    expect(formatAnalyticsCount(2_500_000)).toBe("2.5M");
  });

  it("analyticsTimeAgo speaks plainly", () => {
    const now = Date.parse("2026-11-04T12:00:00Z");
    expect(analyticsTimeAgo(null, now)).toBe("");
    expect(analyticsTimeAgo("2026-11-04T11:59:30Z", now)).toBe("just now");
    expect(analyticsTimeAgo("2026-11-04T11:45:00Z", now)).toBe("15m ago");
    expect(analyticsTimeAgo("2026-11-04T09:00:00Z", now)).toBe("3h ago");
    expect(analyticsTimeAgo("2026-11-02T12:00:00Z", now)).toBe("2d ago");
  });
});

describe("the hub stats store is the page's own store", () => {
  it("the key is the page's key", () => {
    expect(ANALYTICS_HUB_STORAGE_KEY).toBe("analytics-hub-v1");
  });

  it("garbage and absence read as the honest empty state, never a throw", () => {
    expect(parseAnalyticsHubState(null)).toEqual(emptyAnalyticsHubState());
    expect(parseAnalyticsHubState("{not json")).toEqual(emptyAnalyticsHubState());
    expect(parseAnalyticsHubState('{"tiktok": 42}')).toEqual(emptyAnalyticsHubState());
  });

  it("stored stats merge over the defaults; history keeps only real rows, capped at 24", () => {
    const history = Array.from({ length: 30 }, (_, i) => ({ t: i, views30d: i * 10 }));
    const parsed = parseAnalyticsHubState(
      JSON.stringify({
        tiktok: {
          stats: { followers: 1200, views30d: 45000, engagementRate: 250 },
          history: [...history, { t: "bad", views30d: 1 }, { views30d: 2 }],
        },
      }),
    );
    expect(parsed.tiktok.stats.followers).toBe(1200);
    expect(parsed.tiktok.stats.views30d).toBe(45000);
    expect(parsed.tiktok.stats.views7d).toBe(0);
    /* engagement clamps into the rail's own 0..100 range on load */
    expect(parsed.tiktok.stats.engagementRate).toBe(100);
    expect(parsed.tiktok.history).toHaveLength(ANALYTICS_HUB_MAX_HISTORY);
    expect(parsed.tiktok.history[0]).toEqual({ t: 6, views30d: 60 });
    expect(parsed.youtube.stats.followers).toBe(0);
  });

  it("parseHubStatNumber is the page's parseNumber", () => {
    expect(parseHubStatNumber("2500")).toBe(2500);
    expect(parseHubStatNumber("1,200")).toBe(1200);
    expect(parseHubStatNumber("3.9")).toBe(3);
    expect(parseHubStatNumber("abc")).toBe(0);
    expect(parseHubStatNumber("")).toBe(0);
  });

  it("withPlatformStats parses, clamps and appends the snapshot like savePlatform", () => {
    const base = emptyAnalyticsHubState();
    const next = withPlatformStats(
      base,
      "instagram",
      {
        followers: "2,500",
        views7d: "900",
        views30d: "4000",
        engagementRate: "140",
        topPostViews: "777",
      },
      123456,
    );
    expect(next.instagram.stats).toEqual({
      followers: 2500,
      views7d: 900,
      views30d: 4000,
      engagementRate: 100,
      topPostViews: 777,
    });
    expect(next.instagram.history).toEqual([{ t: 123456, views30d: 4000 }]);
    expect(next.tiktok).toEqual(base.tiktok);
    expect(hubStateHasData(next)).toBe(true);
    expect(hubStateHasData(base)).toBe(false);
  });
});

describe("Growth Plan body + answer", () => {
  it("sends only platforms with data, in the page's order; null when empty", () => {
    const state = emptyAnalyticsHubState();
    expect(buildGrowthPlanBody(state)).toBeNull();
    const withData = withPlatformStats(
      withPlatformStats(state, "youtube", {
        followers: "10",
        views7d: "0",
        views30d: "0",
        engagementRate: "0",
        topPostViews: "0",
      }, 1),
      "tiktok",
      {
        followers: "0",
        views7d: "55",
        views30d: "0",
        engagementRate: "0",
        topPostViews: "0",
      },
      2,
    );
    const body = buildGrowthPlanBody(withData);
    expect(body!.platforms.map((p) => p.platform)).toEqual(["tiktok", "youtube"]);
    expect(body!.platforms[0]).toEqual({
      platform: "tiktok",
      followers: 0,
      views7d: 55,
      views30d: 0,
      engagementRate: 0,
      topPostViews: 0,
    });
  });

  it("the answer needs a summary AND a recommendation, or it didn't happen", () => {
    expect(
      normalizeGrowthPlan({
        summary: "Steady climb.",
        recommendations: ["Post Tuesdays", "Reply faster"],
        bestPlatform: "TikTok",
        focusArea: "Hooks",
      }),
    ).toEqual({
      summary: "Steady climb.",
      recommendations: ["Post Tuesdays", "Reply faster"],
      bestPlatform: "TikTok",
      focusArea: "Hooks",
    });
    expect(normalizeGrowthPlan({ summary: "x", recommendations: [] })).toBeNull();
    expect(normalizeGrowthPlan({ recommendations: ["a"] })).toBeNull();
    expect(normalizeGrowthPlan(null)).toBeNull();
    expect(normalizeGrowthPlan("nope")).toBeNull();
  });
});

describe("overview normalization keeps unknowns unknown", () => {
  const fixture = {
    platforms: [
      {
        platform: "instagram",
        accountId: "ig-1",
        username: "king",
        pageName: null,
        status: "ok",
        message: null,
        stats: { followers: 1200, following: 30, mediaCount: 42, totalLikes: null },
        topContent: [
          { id: "a", caption: "Big drop", likes: 300, comments: null, postedAt: null, url: null },
          { id: "b", caption: 42, likes: 1, comments: 1 },
        ],
        fetchedAt: "2026-11-04T10:00:00Z",
      },
      {
        platform: "tiktok",
        accountId: "tt-1",
        username: null,
        pageName: null,
        status: "not_connected",
        message: null,
        stats: null,
        topContent: [],
        fetchedAt: null,
      },
      { platform: "myspace", status: "ok", stats: null, topContent: [] },
      "garbage-row",
    ],
    snapshots: [
      { platform: "instagram", followers: 1100, recordedAt: "2026-11-01" },
      { platform: "instagram", followers: null, recordedAt: "2026-11-03" },
    ],
    fetchedAt: "2026-11-04T10:00:00Z",
    partial: true,
  };

  it("maps the rail's answer field-for-field, dropping broken rows", () => {
    const parsed = normalizeAnalyticsOverview(fixture);
    expect(parsed).not.toBeNull();
    expect(parsed!.platforms).toHaveLength(2);
    const ig = parsed!.platforms[0];
    expect(ig.platform).toBe("instagram");
    expect(ig.status).toBe("ok");
    /* a null stat stays null — never zero-filled */
    expect(ig.stats).toEqual({
      followers: 1200,
      following: 30,
      mediaCount: 42,
      totalLikes: null,
    });
    expect(ig.topContent).toEqual([{ caption: "Big drop", likes: 300, comments: null }]);
    expect(parsed!.platforms[1].status).toBe("not_connected");
    expect(parsed!.snapshots).toEqual([
      { platform: "instagram", followers: 1100 },
      { platform: "instagram", followers: null },
    ]);
    expect(parsed!.partial).toBe(true);
  });

  it("a missing platforms list is a failed read, not an empty board", () => {
    expect(normalizeAnalyticsOverview(null)).toBeNull();
    expect(normalizeAnalyticsOverview({})).toBeNull();
    expect(normalizeAnalyticsOverview({ platforms: "nope" })).toBeNull();
  });
});

describe("the AI layer body + answers", () => {
  const overview = normalizeAnalyticsOverview({
    platforms: [
      {
        platform: "instagram",
        username: "king",
        pageName: null,
        status: "ok",
        message: null,
        stats: { followers: 100, following: 1, mediaCount: 2, totalLikes: 3 },
        topContent: Array.from({ length: 7 }, (_, i) => ({
          caption: `post ${i} ` + "x".repeat(250),
          likes: i,
          comments: i,
        })),
      },
      {
        platform: "tiktok",
        username: null,
        pageName: null,
        status: "expired",
        message: "Reconnect",
        stats: null,
        topContent: [],
      },
    ],
    snapshots: [],
    fetchedAt: "2026-11-04T10:00:00Z",
  })!;

  it("builds from ok platforms only — top 5 posts, captions capped at the rail's 200", () => {
    const body = buildAnalyticsAiBody(overview, "  comedy skits  ");
    expect(body).not.toBeNull();
    expect(body!.platforms).toHaveLength(1);
    const p = body!.platforms[0] as {
      platform: string;
      topContent: { caption: string }[];
    };
    expect(p.platform).toBe("instagram");
    expect(p.topContent).toHaveLength(5);
    expect(p.topContent[0].caption.length).toBe(200);
    expect(body!.niche).toBe("comedy skits");
  });

  it("refuses (null) when no account is reporting — before any spend", () => {
    const none = normalizeAnalyticsOverview({
      platforms: [
        {
          platform: "tiktok",
          username: null,
          pageName: null,
          status: "not_connected",
          message: null,
          stats: null,
          topContent: [],
        },
      ],
      snapshots: [],
      fetchedAt: "",
    })!;
    expect(buildAnalyticsAiBody(none, "")).toBeNull();
    expect(ANALYTICS_NO_CONNECTED_LINE).toContain("Connect an account first");
  });

  it("insights: an insights object with content passes; empty or missing fails", () => {
    expect(
      normalizeAnalyticsInsights({
        insights: {
          headline: "Up 12% this week",
          movers: [{ platform: "Instagram", observation: "Reels doubled", why: "" }],
          bestWindow: "Tue 6–8pm",
          recommendations: ["Post the sequel"],
        },
      }),
    ).toEqual({
      headline: "Up 12% this week",
      movers: [{ platform: "Instagram", observation: "Reels doubled", why: "" }],
      bestWindow: "Tue 6–8pm",
      recommendations: ["Post the sequel"],
    });
    expect(normalizeAnalyticsInsights({ insights: {} })).toBeNull();
    expect(normalizeAnalyticsInsights({ insights: { movers: [{}] } })).toBeNull();
    expect(normalizeAnalyticsInsights({})).toBeNull();
  });

  it("suggestions: title-less rows drop; a non-array answer fails; [] is a real empty", () => {
    expect(
      normalizeAnalyticsSuggestions({
        suggestions: [
          { title: "Sequel to your top post", format: "reel", why: "It worked", hook: "Part 2…" },
          { format: "reel", why: "no title" },
        ],
      }),
    ).toEqual([
      { title: "Sequel to your top post", format: "reel", why: "It worked", hook: "Part 2…" },
    ]);
    expect(normalizeAnalyticsSuggestions({ suggestions: [] })).toEqual([]);
    expect(normalizeAnalyticsSuggestions({})).toBeNull();
    expect(normalizeAnalyticsSuggestions(null)).toBeNull();
  });
});

describe("Channel Audit body + answer", () => {
  it("the gate is the panel's: a niche of 2+", () => {
    const base = {
      niche: "",
      handle: "",
      platform: "multi" as const,
      bio: "",
      postsPerWeek: "",
      recentPostsText: "",
    };
    expect(channelAuditReady(base)).toBe(false);
    expect(channelAuditReady({ ...base, niche: " a " })).toBe(false);
    expect(channelAuditReady({ ...base, niche: "ab" })).toBe(true);
  });

  it("the body trims + caps at the rail's maxima and splits posts by line (max 10)", () => {
    const lines = Array.from({ length: 12 }, (_, i) => ` post ${i} `).join("\n");
    const body = buildChannelAuditBody({
      niche: "  comedy  ",
      handle: " @king ",
      platform: "tiktok",
      bio: "b".repeat(600),
      postsPerWeek: "3x",
      recentPostsText: `${lines}\n\n   \n`,
    });
    expect(body.niche).toBe("comedy");
    expect(body.handle).toBe("@king");
    expect((body.bio as string).length).toBe(500);
    const posts = body.recentPosts as string[];
    expect(posts).toHaveLength(10);
    expect(posts[0]).toBe("post 0");
  });

  it("the answer maps dimensions with the rail's labels; quick-action hrefs are dropped", () => {
    const parsed = normalizeChannelAudit({
      overallGrade: "B",
      overallScore: 74.4,
      verdict: "Solid base.",
      disclaimer: "A read, not a guarantee.",
      dimensions: [
        {
          key: "hook-strength",
          grade: "A",
          score: 91,
          finding: "Openings land.",
          fix: "Keep them.",
          gradeColor: "text-emerald-500",
        },
        { key: "mystery", label: "Mystery", grade: "Z", score: 10, finding: "", fix: "" },
      ],
      topPriorities: ["Post more", ""],
      quickActions: [
        { label: "Open the Scheduler", href: "/scheduler", hint: "Plan the week" },
        { href: "/x", hint: "no label" },
      ],
    });
    expect(parsed).not.toBeNull();
    expect(parsed!.overallScore).toBe(74);
    expect(parsed!.dimensions).toHaveLength(1);
    /* the row arrived without a label — the rail's own label fills in */
    expect(parsed!.dimensions[0].label).toBe(AUDIT_DIMENSION_LABELS["hook-strength"]);
    expect(parsed!.dimensions[0].gradeColor).toBe("text-emerald-500");
    expect(parsed!.topPriorities).toEqual(["Post more"]);
    expect(parsed!.quickActions).toEqual([
      { label: "Open the Scheduler", hint: "Plan the week" },
    ]);
    expect(
      (parsed!.quickActions[0] as unknown as Record<string, unknown>).href,
    ).toBeUndefined();
  });

  it("no grade, no score or no usable dimension = a failed read", () => {
    expect(normalizeChannelAudit({ overallGrade: "Q", overallScore: 10, dimensions: [] })).toBeNull();
    expect(normalizeChannelAudit({ overallGrade: "A", dimensions: [] })).toBeNull();
    expect(
      normalizeChannelAudit({
        overallGrade: "A",
        overallScore: 90,
        dimensions: [{ key: "branding", grade: "A", score: 90 }],
      }),
    ).not.toBeNull();
    expect(normalizeChannelAudit(null)).toBeNull();
  });
});

describe("Virality Pre-Flight body + answer", () => {
  it("the gate is the panel's: a caption is required", () => {
    const base = { platform: "tiktok" as const, caption: "", hashtags: "", hookLine: "" };
    expect(viralityReady(base)).toBe(false);
    expect(viralityReady({ ...base, caption: " x " })).toBe(true);
  });

  it("the body trims + caps at the rail's maxima", () => {
    const body = buildViralityBody({
      platform: "x",
      caption: " c ".repeat(1500),
      hashtags: "h".repeat(600),
      hookLine: "k".repeat(400),
    });
    expect((body.caption as string).length).toBe(2000);
    expect((body.hashtags as string).length).toBe(500);
    expect((body.hookLine as string).length).toBe(300);
    expect(body.platform).toBe("x");
  });

  it("the answer needs a numeric score + a fixes array (the panel's gate)", () => {
    const parsed = normalizeViralityCheck({
      overallScore: 82,
      hookStrength: { score: 90, feedback: "Strong open." },
      captionScore: { score: 70.6, feedback: "Trim it." },
      hashtagAnalysis: { score: 60, feedback: "Too broad.", suggestedHashtags: ["dance", ""] },
      postingTime: { bestTime: "6–8pm", reason: "Your crowd is on." },
      fixes: ["Shorten the caption"],
    });
    expect(parsed).not.toBeNull();
    expect(parsed!.overallScore).toBe(82);
    expect(parsed!.captionScore!.score).toBe(71);
    expect(parsed!.hashtagAnalysis!.suggestedHashtags).toEqual(["dance"]);
    expect(parsed!.postingTime).toEqual({ bestTime: "6–8pm", reason: "Your crowd is on." });
    expect(normalizeViralityCheck({ fixes: [] })).toBeNull();
    expect(normalizeViralityCheck({ overallScore: 50 })).toBeNull();
    expect(normalizeViralityCheck({ overallScore: "50", fixes: [] })).toBeNull();
  });

  it("absent blocks read as absent (null), never as zero scores", () => {
    const parsed = normalizeViralityCheck({ overallScore: 40, fixes: [] });
    expect(parsed!.hookStrength).toBeNull();
    expect(parsed!.hashtagAnalysis).toBeNull();
    expect(parsed!.postingTime).toBeNull();
  });
});

describe("Competitor Tracker body + answer", () => {
  it("the gate mirrors the rail's refine: name 2+ OR url 4+, and a niche of 2+", () => {
    const base = { name: "", url: "", niche: "", notes: "" };
    expect(competitorReady(base)).toBe(false);
    expect(competitorReady({ ...base, name: "ab", niche: "music" })).toBe(true);
    expect(competitorReady({ ...base, url: "x.co", niche: "music" })).toBe(true);
    expect(competitorReady({ ...base, url: "x.c", niche: "music" })).toBe(false);
    expect(competitorReady({ ...base, name: "ab", niche: "m" })).toBe(false);
  });

  it("the body trims + caps at the rail's maxima", () => {
    const body = buildCompetitorBody({
      name: " Rival ",
      url: "u".repeat(3000),
      niche: " travel ",
      notes: "n".repeat(2500),
    });
    expect(body.competitorName).toBe("Rival");
    expect((body.channelUrl as string).length).toBe(2048);
    expect(body.niche).toBe("travel");
    expect((body.notes as string).length).toBe(2000);
  });

  it("the answer needs exactly 3 takeaways + an opportunity (the page's gate); hrefs drop", () => {
    const parsed = normalizeCompetitorAnalysis({
      competitorName: "Rival",
      niche: "travel",
      contentPillars: [{ pillar: "Guides", whatTheyPost: "City guides" }],
      postingCadence: { assessment: "Daily", estimatedPostsPerWeek: 7 },
      topFormats: [{ format: "60s tours", whyItWorks: "Fast value" }],
      strengths: ["Consistency"],
      weaknesses: ["No community posts"],
      opportunities: [{ gap: "No live shows", howToExploit: "Go live weekly" }],
      takeaways: ["One", "Two", "Three"],
      disclaimer: "From what you shared.",
      quickActions: [{ label: "Open Create", href: "/create", hint: "" }],
    });
    expect(parsed).not.toBeNull();
    expect(parsed!.postingCadence).toEqual({
      assessment: "Daily",
      estimatedPostsPerWeek: 7,
    });
    expect(parsed!.quickActions).toEqual([{ label: "Open Create", hint: "" }]);

    const base = {
      opportunities: [{ gap: "g", howToExploit: "h" }],
      takeaways: ["1", "2", "3"],
    };
    expect(normalizeCompetitorAnalysis({ ...base, takeaways: ["1", "2"] })).toBeNull();
    expect(normalizeCompetitorAnalysis({ ...base, opportunities: [] })).toBeNull();
    expect(normalizeCompetitorAnalysis(null)).toBeNull();
  });
});

describe("AI Coach body + answer", () => {
  it("the gate is the page's: at least one titled post", () => {
    expect(aiCoachReady([blankCoachPost()])).toBe(false);
    expect(aiCoachReady([{ ...blankCoachPost(), title: " My post " }])).toBe(true);
  });

  it("the body sends titled posts only, capped at the page's 8 rows, counts floored", () => {
    const posts = [
      ...Array.from({ length: 10 }, (_, i) => ({
        ...blankCoachPost(),
        title: ` post ${i} `,
        views: 100.9,
        likes: -3,
      })),
      blankCoachPost(),
    ];
    const body = buildAiCoachBody({ platform: "youtube", posts, niche: "  music  " });
    const sent = body.posts as { title: string; views: number; likes: number }[];
    expect(sent).toHaveLength(COACH_MAX_POSTS);
    expect(sent[0]).toMatchObject({ title: "post 0", views: 100, likes: 0 });
    expect(body.platform).toBe("youtube");
    expect(body.niche).toBe("music");
  });

  it("the answer needs an insights paragraph or a pattern (the page's gate)", () => {
    expect(
      normalizeAiCoach({
        insights: "Your tutorials outrun your skits.",
        patterns: ["Tutorials win"],
        mistakes: [""],
        nextSteps: ["More tutorials"],
      }),
    ).toEqual({
      insights: "Your tutorials outrun your skits.",
      patterns: ["Tutorials win"],
      mistakes: [],
      nextSteps: ["More tutorials"],
    });
    expect(normalizeAiCoach({ patterns: ["One pattern"] })).not.toBeNull();
    expect(normalizeAiCoach({ insights: "", patterns: [] })).toBeNull();
    expect(normalizeAiCoach(null)).toBeNull();
  });
});
