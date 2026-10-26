/**
 * loop-exchange-wiring.test.ts — Loop Exchange (#168) source contracts.
 *
 * Pins:
 * - the panel DOCKS in the existing audio/sample surfaces (Beats
 *   catalog browse + Sounds page) — there is NO standalone
 *   /loop-exchange route and NO App.tsx page for it;
 * - the panel talks to the /api/loop-exchange/* routes only, posts the
 *   poster's terms up front, and records sales in Visual Bucs (test
 *   mode) — no cash/Stripe path anywhere in the surface;
 * - both themes: the panel branches on useIsLightTheme like its
 *   SoundFitPanel neighbour;
 * - no invented people or prices: the surface carries no dollar figure
 *   and no hardcoded VB price — splits are the users' own terms.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = join(__dirname, "..");
const read = (p: string) => readFileSync(join(SRC, p), "utf8");

const panel = read("components/loop-exchange/LoopExchangePanel.tsx");
const lib = read("lib/loop-exchange.ts");
const beats = read("pages/beats.tsx");
const sounds = read("pages/sounds.tsx");
const app = read("App.tsx");

describe("loop exchange docking", () => {
  it("docks inside Beats and Sounds — never a standalone page or route", () => {
    expect(beats).toContain("<LoopExchangePanel />");
    expect(sounds).toContain("<LoopExchangePanel />");
    expect(app).not.toContain("loop-exchange");
    expect(app).not.toContain("LoopExchange");
  });

  it("both themes: the panel branches on the light theme like SoundFitPanel", () => {
    expect(panel).toContain("useIsLightTheme");
    expect(panel).toContain("isLight");
    expect(panel).toContain("#FCF7EA");
    expect(panel).toContain("#14100a");
  });
});

describe("loop exchange panel contracts", () => {
  it("talks to the loop-exchange routes for every step of the deal", () => {
    expect(panel).toContain('"/api/loop-exchange/loops"');
    expect(panel).toContain("/api/loop-exchange/mine");
    expect(panel).toContain("/builds`");
    expect(panel).toContain("/decision`");
    expect(panel).toContain("/sales`");
    expect(panel).toContain("posterSharePct");
  });

  it("the deal flow is all here: post terms, propose, accept/decline, record sale, my earnings", () => {
    for (const key of ["postLoop", "proposeButton", "acceptTerms", "declineTerms", "recordSale", "totalEarned"]) {
      expect(panel).toContain(key);
    }
    // Splits are built through the shared helper (poster at posted
    // terms, builder takes the remainder) — never hand-summed inline.
    expect(panel).toContain("buildProposedSplits");
    expect(lib).toContain("buildProposedSplits");
  });

  it("no cash, no Stripe, no invented price or person anywhere in the surface", () => {
    for (const [name, src] of Object.entries({ panel, lib })) {
      expect(src, name).not.toMatch(/stripe/i);
      expect(src, name).not.toMatch(/\$\d/);
      expect(src, name).not.toMatch(/cash payout/i);
    }
    expect(panel).toContain("Visual Bucs only, never cash");
    expect(panel).toContain("test mode");
  });

  it("the client never computes the money — no fee or allocation math in the helpers", () => {
    expect(lib).not.toMatch(/feeSplit|allocateSplit|0\.05|\* 0\.95/);
    // It only shapes API payloads and the splits a builder proposes.
    expect(lib).toContain("parseSaleResponse");
    expect(lib).toContain("parseMineResponse");
  });
});
