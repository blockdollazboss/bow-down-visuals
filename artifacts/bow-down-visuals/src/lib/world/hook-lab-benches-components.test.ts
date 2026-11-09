/**
 * hook-lab-benches-components — Stack 400 world parity
 * (census B-16 / B-17 / B-20) source-contract pins. The three
 * HookLab benches must stack at the Hook Desk in StationPanel
 * as ({ isLight }) benches, run every charge through the
 * confirmed-spend seam at the registry prices read live from
 * the seam, and carry their copy in the worldHooksBenches
 * namespace — present, English-verbatim, in all 10 catalogs
 * (non-en UNREVIEWED per the locale honesty law).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const benches = read("../../components/world/native/HookLabBenches.tsx");
const panel = read("../../components/world/StationPanel.tsx");

const SRC = new URL("../../", import.meta.url).pathname;
const LOCALES = ["en", "es", "fr", "pt", "de", "it", "hi", "ar", "ja", "ko"] as const;

function flatten(obj: Record<string, unknown>, prefix = "", out = new Map<string, unknown>()): Map<string, unknown> {
  for (const [k, v] of Object.entries(obj)) {
    const q = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) flatten(v as Record<string, unknown>, q, out);
    else out.set(q, v);
  }
  return out;
}
function load(locale: string): Map<string, unknown> {
  return flatten(JSON.parse(readFileSync(join(SRC, "locales", `${locale}.json`), "utf8")));
}

describe("the bench shapes + the Hook Desk mounts", () => {
  it("are named ({ isLight }) benches rooted at their testids", () => {
    expect(benches).toContain("export function AiInterviewBench({ isLight }: { isLight: boolean })");
    expect(benches).toContain("export function OpeningsBench({ isLight }: { isLight: boolean })");
    expect(benches).toContain("export function DiagnosticsBenches({ isLight }: { isLight: boolean })");
    expect(benches).toContain('data-testid="world-ai-interview-bench"');
    expect(benches).toContain('data-testid="world-openings-bench"');
    expect(benches).toContain('data-testid="world-diagnostics-benches"');
  });

  it("StationPanel stacks all three at the hook-desk station behind DeskDoors", () => {
    expect(panel).toContain('import("@/components/world/native/HookLabBenches")');
    expect(panel).toContain('station.id === "hook-desk"');
    expect(panel).toContain("<AiInterviewBench isLight={isLight} />");
    expect(panel).toContain("<OpeningsBench isLight={isLight} />");
    expect(panel).toContain("<DiagnosticsBenches isLight={isLight} />");
    expect(panel).toContain('resetKey={`${station.id}:ai-interview`}');
    expect(panel).toContain('resetKey={`${station.id}:openings`}');
    expect(panel).toContain('resetKey={`${station.id}:diagnostics`}');
  });
});

describe("every run rides the confirmed-spend seam at the registry price", () => {
  it("the shared runner posts through confirmedFetch and honors the decline + 402", () => {
    expect(benches).toContain("const res = await confirmedFetch(path, {");
    expect(benches).toContain("if (!res) return null; // spend confirmation declined — nothing ran");
    expect(benches).toContain('res.status === 402 || (data as { error?: string }).error === "out_of_credits"');
    expect(benches).toContain('t("worldBenches300.outOfBucs", { feature })');
  });

  it("B-16: both interview rails post through their seam builders at registry costs", () => {
    expect(benches).toContain('"/api/ai-interview/questions"');
    expect(benches).toContain('"/api/ai-interview/package"');
    expect(benches).toContain("buildInterviewQuestionsPayload({ topic, niche })");
    expect(benches).toContain("buildInterviewPackagePayload({ topic, qa: interviewQaPairs(questions, answers) })");
    expect(benches).toContain("aiInterviewQuestionsCost()");
    expect(benches).toContain("aiInterviewPackageCost()");
    expect(benches).toContain("interviewQuestionsOfResponse");
    expect(benches).toContain("interviewPackageOfResponse");
  });

  it("B-17: the openings rail posts through its builder at the registry cost", () => {
    expect(benches).toContain('"/api/three-second-lab/openings"');
    expect(benches).toContain("buildOpeningsPayload({ videoDescription: description, niche })");
    expect(benches).toContain("openingsCost()");
    expect(benches).toContain("openingsOfResponse");
  });

  it("B-20: all five diagnostics rails post through their builders at registry costs", () => {
    expect(benches).toContain('"/api/analyze-hook"');
    expect(benches).toContain('"/api/seo-score"');
    expect(benches).toContain('"/api/retention-doctor"');
    expect(benches).toContain('"/api/trend-jacker/draft"');
    expect(benches).toContain('"/api/style-stealer/analyze"');
    expect(benches).toContain("buildHookAnalysisPayload({ transcript: hookText, platform: hookPlatform, niche: hookNiche, mode })");
    expect(benches).toContain("buildSeoScorePayload({");
    expect(benches).toContain("buildDoctorPayload({");
    expect(benches).toContain("buildTrendDraftPayload({ trend, trendWhy, niche: trendNiche, styleNotes: trendStyle })");
    expect(benches).toContain("buildStyleStealerPayload({ videoUrl: styleUrl, description: styleDesc, niche: styleNiche })");
    expect(benches).toContain("hookAnalyzerCost()");
    expect(benches).toContain("seoScoreCost()");
    expect(benches).toContain("retentionDoctorCost()");
    expect(benches).toContain("trendJackerCost()");
    expect(benches).toContain("styleStealerCost()");
  });

  it("no bench posts a bare fetch or hardcodes a price", () => {
    expect(benches).not.toContain("await fetch(");
    expect(benches).not.toMatch(/overrideCost:\s*\d/);
  });
});

describe("light/dark parity — theme-switched surfaces", () => {
  it("the benches branch their surfaces on isLight", () => {
    expect(benches).toContain('isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"');
    expect(benches).toContain('isLight ? "text-[#6B5B36]" : "text-white/50"');
  });
});

describe("the worldHooksBenches namespace — all 10 catalogs, English-verbatim", () => {
  const cats = new Map(LOCALES.map((l) => [l, load(l)]));
  const enKeys = [...cats.get("en")!.keys()].filter((k) => k.startsWith("worldHooksBenches."));

  it("the namespace exists in en with the bench chrome keys", () => {
    expect(enKeys.length).toBeGreaterThanOrEqual(60);
    for (const k of [
      "worldHooksBenches.interviewTitle",
      "worldHooksBenches.openingsTitle",
      "worldHooksBenches.diagTitle",
      "worldHooksBenches.diagToolHook",
      "worldHooksBenches.diagToolSeo",
      "worldHooksBenches.diagToolDoctor",
      "worldHooksBenches.diagToolTrend",
      "worldHooksBenches.diagToolStyle",
    ]) {
      expect(enKeys).toContain(k);
    }
  });

  it("every key exists in every catalog with the exact English source (UNREVIEWED in non-en)", () => {
    for (const k of enKeys) {
      const enVal = cats.get("en")!.get(k);
      for (const l of LOCALES) {
        expect(cats.get(l)!.get(k), `${l}: ${k}`).toBe(enVal);
      }
    }
  });

  it("every worldHooksBenches key the benches reference exists in en", () => {
    const used = [...benches.matchAll(/t\("worldHooksBenches\.([A-Za-z]+)"/g)].map((m) => `worldHooksBenches.${m[1]}`);
    expect(used.length).toBeGreaterThan(40);
    for (const k of new Set(used)) {
      expect(typeof cats.get("en")!.get(k), k).toBe("string");
    }
  });
});
