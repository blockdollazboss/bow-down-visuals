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

/** Parse hub-workflows steps: label + href + creditNote per step. */
function hubSteps(): { label: string; href: string; note: string }[] {
  const lines = readFe("lib/hub-workflows.ts").split("\n");
  const out: { label: string; href: string; note: string }[] = [];
  let label = "";
  let href = "";
  for (const ln of lines) {
    const lm = ln.match(/label: "([^"]+)"/);
    if (lm) label = lm[1]!;
    const hm = ln.match(/href: "([^"]+)"/);
    if (hm) href = hm[1]!;
    const nm = ln.match(/creditNote: "([^"]+)"/);
    if (nm) out.push({ label, href, note: nm[1]! });
  }
  return out;
}

describe("Hub workflow cards (lib/hub-workflows.ts) — notes match their rails", () => {
  const steps = hubSteps();
  const notesFor = (label: string, hrefPart: string) =>
    steps.filter((s) => s.label === label && s.href.includes(hrefPart)).map((s) => s.note);

  it("Samples = from 500 (sample-pack tiers start at 500; was 100)", () => {
    expect(getCreditCost("/api/sample-pack/generate")?.cost).toBe(500);
    expect(notesFor("Samples", "sub=samples")).toEqual(["from 500 Visual Bucs"]);
  });

  it("Master (quick mode) = 400, the Express master rail (was 200)", () => {
    expect(getCreditCost("/api/mastering")?.cost).toBe(400);
    expect(notesFor("Master", "mode=quick")).toEqual(["400 Visual Bucs"]);
  });

  it("Intros = 750 (5s × 150/s; was 200)", () => {
    expect(getCreditCost("/api/generate-intro-outro")?.cost).toBe(750);
    expect(notesFor("Intros", "tab=intros")).toEqual(["750 Visual Bucs"]);
  });

  it("Stream Pack = 100 (was 200)", () => {
    expect(getCreditCost("/api/stream-pack/generate")?.cost).toBe(100);
    expect(notesFor("Stream Pack", "tab=stream")).toEqual(["100 Visual Bucs"]);
  });

  it("A/B Test = 200, the thumbnail-test rail (was 100)", () => {
    expect(getCreditCost("/api/thumbnail-test")?.cost).toBe(200);
    expect(notesFor("A/B Test", "tab=abtest")).toEqual(["200 Visual Bucs"]);
  });

  it("every cover-art panel step spans the real 100–200 model range (was 200–300)", () => {
    const cover = steps.filter((s) => s.href.includes("panel=coverart"));
    expect(cover.length).toBeGreaterThan(0);
    for (const s of cover) expect(s.note).not.toContain("200–300");
    const ranged = cover.filter((s) => s.note.includes("–"));
    expect(ranged.map((s) => s.note)).toEqual([
      "100–200 Visual Bucs", "100–200 Visual Bucs", "100–200 Visual Bucs", "100–200 Visual Bucs",
    ]);
  });

  it("scheduler plan steps = 150, the calendar auto-fill rail (was 100)", () => {
    expect(getCreditCost("/api/wave8/calendar/autofill")?.cost).toBe(150);
    const plan = steps.filter((s) => s.href.includes("/scheduler?tab=plan"));
    expect(plan.length).toBe(5);
    for (const s of plan) expect(s.note).toBe("150 Visual Bucs");
  });

  it("Distribute = from 1,000, the cheapest release tier (was 'from 100')", () => {
    expect(deriveServerConstant("routes/generate/distribution.ts", "DISTRIBUTION_RELEASE_CREDITS")).toBe(1000);
    const src = readApi("routes/generate/distribution.ts");
    const block = src.slice(src.indexOf("RELEASE_TIER_CREDITS"), src.indexOf("} as const"));
    // single falls back to the 1,000 base; ep/album default to 2,000/3,000.
    expect(block).toContain("DISTRIBUTION_RELEASE_CREDITS");
    expect(block).toContain("|| 2000");
    expect(block).toContain("|| 3000");
    expect(notesFor("Distribute", "/distribute")).toEqual(["from 1,000 Visual Bucs"]);
  });

  it("LLC steps = 100, the guide's AI rail (was 'free')", () => {
    expect(deriveClientConstant("pages/llc-guide.tsx", "CREDIT_COST")).toBe(100);
    expect(notesFor("LLC", "/llc-guide")).toEqual(["100 Visual Bucs"]);
    expect(notesFor("LLC Setup", "/llc-guide")).toEqual(["100 Visual Bucs"]);
  });

  it("voiceover steps carry the per-minute unit (rail is 200/min, not flat 200)", () => {
    expect(getCreditCost("/api/voiceover/generate")?.cost).toBe(200);
    const vo = steps.filter((s) => s.href.includes("tab=voiceover"));
    expect(vo.length).toBe(6);
    for (const s of vo) expect(s.note).toBe("200 Visual Bucs/min");
  });

  it("Translate carries the per-minute unit (rail is 500/min/language)", () => {
    expect(getCreditCost("/api/video-translator/translate")?.cost).toBe(500);
    expect(notesFor("Translate", "tab=translate")).toEqual(["500 Visual Bucs/min"]);
  });
});

describe("rendered locale strings — baked prices match their rails (all 10 catalogs)", () => {
  const LOCALES = ["en", "es", "fr", "de", "it", "pt", "ja", "ko", "ar", "hi"];
  const load = (loc: string) =>
    JSON.parse(readFe(`locales/${loc}.json`)) as Record<string, never>;
  const numerals = (s: string) => (s.match(/\d[\d,]*/g) ?? []).map((n) => Number(n.replace(/,/g, "")));

  it("Audio Studio master tab range is the real 400–1,500 (was the pre-x100 '4 to 15')", () => {
    expect(getCreditCost("/api/mastering")?.cost).toBe(400);
    expect(getCreditCost("/api/mix-master/mix")?.cost).toBe(1500);
    for (const loc of LOCALES) {
      const v = (load(loc)["audioStudio"] as { desc: { master: string } }).desc.master;
      expect(numerals(v), `${loc} master range`).toEqual([400, 1500]);
    }
  });

  it("Make Video 'uses credits' note = the 200 video-plan rail (was 100)", () => {
    expect(getCreditCost("/api/generate-video-plan")?.cost).toBe(200);
    for (const loc of LOCALES) {
      const v = (load(loc)["makeVideo"] as { usesCredits: string }).usesCredits;
      // (ja's string also carries a "1" — "per 1 generation", a count.)
      expect(numerals(v), `${loc} makeVideo note`).toContain(200);
      expect(numerals(v), `${loc} makeVideo note`).not.toContain(100);
    }
  });

  it("Song + Video note = the single 400 charge (was 200)", () => {
    expect(deriveServerConstant("routes/generate/song-video.ts", "CREDIT_COST")).toBe(400);
    for (const loc of LOCALES) {
      const v = (load(loc)["songAndVideo"] as { usesCreditsNote: string }).usesCreditsNote;
      expect(numerals(v), `${loc} songAndVideo note`).toEqual([400]);
    }
  });
});

describe("latent fallback copy — no pre-x100 'cr' figures survive in audited surfaces", () => {
  it("audio-studio stems mode fallbacks carry no legacy credit figures", () => {
    const src = readFe("pages/audio-studio.tsx");
    expect(src).not.toMatch(/· \d+cr"/);
    expect(src).toContain('defaultValue: "Full split"');
  });

  it("thumbnail-studio's single-shot comment states the rail truth (100 + 200 = 300)", () => {
    const src = readFe("pages/thumbnail-studio.tsx");
    expect(src).not.toContain("1-credit single-shot");
    expect(getCreditCost("/api/generate-thumbnail")?.cost).toBe(300);
  });
});
