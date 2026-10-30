/**
 * price-honesty-2.test.ts — round 2 of the display==rail sweep
 * (stack900 Lane J1). Round 1 (finder-display-truth.test.ts) aligned
 * the finder family; this round swept every remaining customer-facing
 * price display — studio tools, editor desks, help copy, the features
 * catalog, Hub workflow cards, and the rendered locale strings —
 * against the rail that actually charges (CREDIT_COSTS registry +
 * route handlers). Every fix is DISPLAY-ONLY; no charge moved.
 *
 * These pins re-derive both sides from the source files so display
 * and charge cannot drift apart silently again. Cases proven
 * display==rail in the sweep are not pinned here; cases where the
 * price itself is an unapproved placeholder on BOTH sides stay
 * owner price questions, not display lies, and stay unpinned.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CREDIT_COSTS, getCreditCost } from "./credit-costs";

function readFe(rel: string): string {
  return readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
}

function readApi(rel: string): string {
  return readFileSync(new URL(`../../../api-server/src/${rel}`, import.meta.url), "utf8");
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

/** Derive a numeric constant from a client source file. */
function deriveClientConstant(rel: string, constant: string): number {
  const src = readFe(rel);
  const re = new RegExp(`(?:export\\s+)?const\\s+${constant}\\s*(?::\\s*number)?\\s*=\\s*([\\d_]+)\\s*;`);
  const m = src.match(re);
  expect(m, `${constant} in ${rel}`).toBeTruthy();
  return Number(m![1].replace(/_/g, ""));
}

/** The creditCost string of one features-catalog entry, by key. */
function featureCost(key: string): string {
  const src = readFe("data/features.ts");
  const start = src.indexOf(`key: "${key}"`);
  expect(start, `feature ${key}`).toBeGreaterThan(-1);
  const m = src.slice(start, start + 600).match(/creditCost: "([^"]+)"/);
  expect(m, `creditCost for ${key}`).toBeTruthy();
  return m![1]!;
}

describe("Developer API docs — bio generation price", () => {
  it("the rail charges 100 (owner ruling: bio generator is 100 VB)", () => {
    expect(deriveServerConstant("routes/generate/bio-pricing.ts", "BIO_COST")).toBe(100);
    // The public API charges the same shared constant.
    expect(readApi("routes/public-api.ts")).toContain("BIO_COST");
  });

  it("DeveloperApiSettings quotes 100 and never 50 for the bio endpoint", () => {
    const src = readFe("components/DeveloperApiSettings.tsx");
    expect(src).not.toContain("50 Visual Bucs");
    expect(src).toContain("Costs <strong>100 Visual Bucs</strong>");
  });
});

describe("features catalog (data/features.ts) — card prices match their rails", () => {
  it("Content Calendar card = the 150 rail (was 100)", () => {
    expect(deriveServerConstant("routes/generate/content-calendar.ts", "CALENDAR_CREDIT_COST")).toBe(150);
    expect(getCreditCost("/api/content-calendar")?.cost).toBe(150);
    expect(featureCost("content-calendar")).toBe("150 Visual Bucs");
  });

  it("Thumbnail Maker floor = the 200 studio-generator rail (was 'From 100')", () => {
    expect(getCreditCost("/api/thumbnail-generator")?.cost).toBe(200);
    expect(featureCost("thumbnail-maker")).toBe("From 200 Visual Bucs");
  });

  it("Audio Studio floor = 75, the cheapest reachable rail (was 'From 50'; no 50 VB action exists there)", () => {
    // Guest Questions (75) is embedded in Audio Studio as the podcast
    // tab; every other Audio Studio rail is 100+.
    expect(getCreditCost("/api/guest-questions")?.cost).toBe(75);
    expect(featureCost("audio-studio")).toBe("From 75 Visual Bucs");
  });

  it("Creator Academy is 'Free to browse', not 'Free' — its AI actions charge 100", () => {
    expect(deriveClientConstant("pages/academy.tsx", "CREDIT_COST")).toBe(100);
    expect(featureCost("creator-academy")).toBe("Free to browse");
  });

  it("Video Editor card names the free branded tier alongside the 400 clean export", () => {
    expect(featureCost("video-editor")).toBe("Free–400 Visual Bucs/export");
  });
});
