/**
 * beats-ai-tags-price-truth.test.ts — the beats AI tag suggester's buttons
 * display the same 100 Visual Bucs the rail charges.
 *
 * The rail (BEAT_AI_TAGS_CREDIT_COST in api-server routes/generate/
 * beats-pricing.ts, env-overridable via getBeatAiTagsCost) charges 100 on
 * every POST /api/beats/:id/ai-tags — pinned server-side by beats.test.ts.
 * The displays never caught up with the ×100 repricing: the beats page's
 * two AI-tags buttons (the sell form's and the dashboard BeatRow's) rendered
 * a locale string quoting "1cr", the same stale pre-×100 family the owner
 * ruled on for the deal matcher (Oct 29). These pins re-derive the rail
 * constant from the server source and hold the page's display constant,
 * the button wiring, and every locale catalog to it, so display and
 * charge cannot drift apart silently again. Display only — no charge moved.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function readApi(rel: string): string {
  return readFileSync(new URL(`../../../api-server/src/${rel}`, import.meta.url), "utf8");
}

function readPage(rel: string): string {
  return readFileSync(new URL(`../pages/${rel}`, import.meta.url), "utf8");
}

function readLocale(code: string): Record<string, any> {
  return JSON.parse(readFileSync(new URL(`../locales/${code}.json`, import.meta.url), "utf8"));
}

/** Re-derive a server cost constant from source — same approach as
 *  collab-match-price-truth.test.ts (env-default and plain-literal shapes). */
function deriveServerConstant(rel: string, constant: string): number {
  const src = readApi(rel);
  const envDefault = src.match(
    new RegExp(
      `const\\s+${constant}\\s*=\\s*Number\\(process\\.env\\[["'][A-Z0-9_]+["']\\]\\)\\s*\\|\\|\\s*(\\d+)\\b`,
    ),
  );
  if (envDefault) return Number(envDefault[1]);
  const plain = src.match(
    new RegExp(`const\\s+${constant}\\s*(?::\\s*number)?\\s*=\\s*(?:(\\d+)|getCreditCost\\([^)]*\\)\\?\\.cost\\s*\\?\\?\\s*(\\d+))\\b`),
  );
  expect(plain, `${constant} in ${rel}`).toBeTruthy();
  return Number(plain![1]);
}

function derivePageConstant(rel: string, constant: string): number {
  const src = readPage(rel);
  const m = src.match(new RegExp(`const\\s+${constant}\\s*=\\s*(?:(\\d+)|getCreditCost\\([^)]*\\)\\?\\.cost\\s*\\?\\?\\s*(\\d+))\\b`));
  expect(m, `${constant} in ${rel}`).toBeTruthy();
  return Number(m![1] ?? m![2]);
}

describe("beats AI tags — charged == displayed == 100", () => {
  it("the rail charges 100 (BEAT_AI_TAGS_CREDIT_COST default)", () => {
    expect(deriveServerConstant("routes/generate/beats-pricing.ts", "BEAT_AI_TAGS_CREDIT_COST")).toBe(100);
  });

  it("the page display constant mirrors the rail (AI_TAGS_CREDIT_COST)", () => {
    expect(derivePageConstant("beats.tsx", "AI_TAGS_CREDIT_COST")).toBe(100);
  });

  it("both AI-tags buttons render their price from the shared constant", () => {
    const src = readPage("beats.tsx");
    const wired = src.match(/t\("beats\.aiTagsButton", \{ cost: AI_TAGS_CREDIT_COST \}\)/g) ?? [];
    expect(wired).toHaveLength(2);
    expect(src).not.toContain('t("beats.aiTagsButton")');
  });

  it("en copy interpolates the cost instead of quoting 1cr", () => {
    const en = readLocale("en");
    expect(en.beats.aiTagsButton).toBe("Tags · {{cost}} Visual Bucs");
  });

  it("every catalog interpolates the cost — no hardcoded numeral can go stale", () => {
    for (const code of ["ar", "de", "en", "es", "fr", "hi", "it", "ja", "ko", "pt"]) {
      const loc = readLocale(code);
      expect(loc.beats.aiTagsButton, code).toContain("{{cost}}");
      expect(loc.beats.aiTagsButton, code).not.toMatch(/1\s?cr\b/);
    }
  });
});
