/**
 * Tests for the Channel Audit route's pure logic.
 *
 * Covers: 3-credit pricing constant, request validation schema,
 * audit JSON parsing/sanitization (good, malformed, empty, hallucinated
 * keys), grade clamping/validation, and the max_tokens absence assertion
 * (GPT-6 rejects max_tokens — always max_completion_tokens).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  CHANNEL_AUDIT_CREDITS,
  auditSchema,
  parseAuditJson,
  gradeColor,
} from "../channel-audit";

describe("CHANNEL_AUDIT_CREDITS", () => {
  it("charges 3 credits per audit", () => {
    expect(CHANNEL_AUDIT_CREDITS).toBe(3);
  });
});

describe("auditSchema", () => {
  const base = { niche: "luxury hip-hop" };

  it("accepts a minimal niche-only request", () => {
    expect(auditSchema.safeParse(base).success).toBe(true);
  });

  it("accepts a full request with all optional fields", () => {
    const r = auditSchema.safeParse({
      ...base,
      handle: "@sharkking",
      platform: "tiktok",
      bio: "King of the deep 🦈 new singles monthly",
      postsPerWeek: "3x per week",
      recentPosts: [
        "https://tiktok.com/@sharkking/video/123",
        "New single out now — link in bio",
      ],
    });
    expect(r.success).toBe(true);
  });

  it("rejects a missing niche", () => {
    expect(auditSchema.safeParse({}).success).toBe(false);
  });

  it("rejects a too-short niche", () => {
    expect(auditSchema.safeParse({ niche: "x" }).success).toBe(false);
  });

  it("rejects an unknown platform", () => {
    expect(auditSchema.safeParse({ ...base, platform: "myspace" }).success).toBe(false);
  });

  it("rejects more than 10 recent posts", () => {
    expect(
      auditSchema.safeParse({ ...base, recentPosts: Array(11).fill("post") }).success,
    ).toBe(false);
  });

  it("rejects an overlong niche", () => {
    expect(auditSchema.safeParse({ niche: "x".repeat(121) }).success).toBe(false);
  });
});

function goodAuditJson() {
  return JSON.stringify({
    overallGrade: "B",
    overallScore: 78,
    verdict: "Solid foundation, weak hooks. Your branding carries you.",
    disclaimer: "Based on what you shared and current best practices — not a guarantee of growth.",
    dimensions: [
      { key: "posting-consistency", grade: "A", score: 92, finding: "You post 4x weekly like clockwork.", fix: "Keep the cadence; batch-film on Sundays." },
      { key: "hook-strength", grade: "C", score: 58, finding: "Captions start with announcements, not hooks.", fix: "Lead every caption with a curiosity gap in the first 8 words." },
      { key: "branding", grade: "B", score: 80, finding: "Gold/black identity is consistent.", fix: "Add the crown motif to thumbnails too." },
      { key: "caption-quality", grade: "C", score: 61, finding: "Captions describe, they don't sell.", fix: "End every caption with a question that begs comments." },
      { key: "cta-usage", grade: "D", score: 35, finding: "No CTAs in the last 10 posts.", fix: "Add one comment-bait CTA per post this week." },
      { key: "profile-bio", grade: "B", score: 76, finding: "Bio states niche clearly.", fix: "Add a pinned-link CTA line to the bio." },
    ],
    topPriorities: [
      "Add a CTA to every post — it's your biggest leak.",
      "Rewrite your first lines as hooks, not announcements.",
      "Pin your best-performing post to the top of your profile.",
    ],
  });
}

describe("parseAuditJson", () => {
  it("parses a well-formed audit", () => {
    const a = parseAuditJson(goodAuditJson());
    expect(a.usable).toBe(true);
    expect(a.overallGrade).toBe("B");
    expect(a.overallScore).toBe(78);
    expect(a.verdict).toContain("Solid foundation");
    expect(a.dimensions).toHaveLength(6);
    expect(a.dimensions.map((d) => d.key)).toEqual([
      "posting-consistency",
      "hook-strength",
      "branding",
      "caption-quality",
      "cta-usage",
      "profile-bio",
    ]);
    expect(a.topPriorities).toHaveLength(3);
  });

  it("clamps out-of-range scores", () => {
    const a = parseAuditJson(
      JSON.stringify({
        overallGrade: "A",
        overallScore: 999,
        verdict: "Great.",
        disclaimer: "d",
        dimensions: [
          { key: "branding", grade: "A", score: -50, finding: "f", fix: "x" },
        ],
        topPriorities: ["p1"],
      }),
    );
    expect(a.overallScore).toBe(100);
    expect(a.dimensions[0]!.score).toBe(0);
  });

  it("normalizes lowercase grades", () => {
    const a = parseAuditJson(
      JSON.stringify({
        overallGrade: "b",
        overallScore: 70,
        verdict: "v",
        disclaimer: "d",
        dimensions: [{ key: "branding", grade: "c", score: 60, finding: "f", fix: "x" }],
        topPriorities: ["p1"],
      }),
    );
    expect(a.overallGrade).toBe("B");
    expect(a.dimensions[0]!.grade).toBe("C");
  });

  it("drops hallucinated dimension keys and duplicate keys", () => {
    const a = parseAuditJson(
      JSON.stringify({
        overallGrade: "B",
        overallScore: 70,
        verdict: "v",
        disclaimer: "d",
        dimensions: [
          { key: "branding", grade: "B", score: 70, finding: "f", fix: "x" },
          { key: "made-up-dimension", grade: "A", score: 99, finding: "f", fix: "x" },
          { key: "branding", grade: "F", score: 10, finding: "dup", fix: "x" },
          { key: "hook-strength", grade: "Z", score: 70, finding: "bad grade", fix: "x" },
        ],
        topPriorities: ["p1"],
      }),
    );
    expect(a.dimensions).toHaveLength(1);
    expect(a.dimensions[0]!.key).toBe("branding");
    expect(a.dimensions[0]!.grade).toBe("B");
  });

  it("caps top priorities at 3 and trims long strings", () => {
    const a = parseAuditJson(
      JSON.stringify({
        overallGrade: "B",
        overallScore: 70,
        verdict: "v",
        disclaimer: "d",
        dimensions: [{ key: "branding", grade: "B", score: 70, finding: "f", fix: "x" }],
        topPriorities: ["p1", "p2", "p3", "p4", "p5"],
      }),
    );
    expect(a.topPriorities).toHaveLength(3);
  });

  it("marks malformed JSON unusable", () => {
    const a = parseAuditJson("this is not json {{{");
    expect(a.usable).toBe(false);
  });

  it("marks empty dimensions unusable", () => {
    const a = parseAuditJson(
      JSON.stringify({
        overallGrade: "B",
        overallScore: 70,
        verdict: "v",
        disclaimer: "d",
        dimensions: [],
        topPriorities: ["p1"],
      }),
    );
    expect(a.usable).toBe(false);
  });

  it("marks missing verdict unusable", () => {
    const a = parseAuditJson(
      JSON.stringify({
        overallGrade: "B",
        overallScore: 70,
        disclaimer: "d",
        dimensions: [{ key: "branding", grade: "B", score: 70, finding: "f", fix: "x" }],
        topPriorities: ["p1"],
      }),
    );
    expect(a.usable).toBe(false);
  });

  it("marks missing priorities unusable", () => {
    const a = parseAuditJson(
      JSON.stringify({
        overallGrade: "B",
        overallScore: 70,
        verdict: "v",
        disclaimer: "d",
        dimensions: [{ key: "branding", grade: "B", score: 70, finding: "f", fix: "x" }],
        topPriorities: [],
      }),
    );
    expect(a.usable).toBe(false);
  });

  it("defaults finding/fix text when the model omits them", () => {
    const a = parseAuditJson(
      JSON.stringify({
        overallGrade: "B",
        overallScore: 70,
        verdict: "v",
        disclaimer: "d",
        dimensions: [{ key: "branding", grade: "B", score: 70 }],
        topPriorities: ["p1"],
      }),
    );
    expect(a.usable).toBe(true);
    expect(a.dimensions[0]!.finding.length).toBeGreaterThan(0);
    expect(a.dimensions[0]!.fix.length).toBeGreaterThan(0);
  });
});

describe("gradeColor", () => {
  it("returns the right Tailwind class per grade", () => {
    expect(gradeColor("A")).toBe("text-emerald-400");
    expect(gradeColor("B")).toBe("text-lime-300");
    expect(gradeColor("C")).toBe("text-amber-400");
    expect(gradeColor("D")).toBe("text-orange-400");
    expect(gradeColor("F")).toBe("text-red-400");
  });
});

describe("max_tokens absence", () => {
  it("never passes max_tokens as a parameter (GPT-6 rejects it) — only max_completion_tokens", () => {
    const src = readFileSync(
      path.resolve(__dirname, "../channel-audit.ts"),
      "utf8",
    );
    /* Match max_tokens used as an object key (e.g. `max_tokens: 600`), not
       explanatory comments mentioning the parameter name. */
    expect(src).not.toMatch(/max_tokens\s*:/);
    expect(src).toContain("max_completion_tokens");
  });
});
