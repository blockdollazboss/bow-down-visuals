/**
 * sample-clearance-wiring.test.ts — Stack-200 N2 source contracts.
 *
 * Pins:
 * - NO standalone page: no /sample-clearance route in App.tsx; the
 *   lane docks into the Songs library cards and the /distribute
 *   release card (beside the checklist).
 * - The panel talks to the lane's real endpoints (declare, list,
 *   acknowledge, alternatives) and the ship check to pre-ship.
 * - Honesty copy: clearance is labelled creator-declared / not
 *   verified; the words "verified clearance" never appear as a claim.
 * - NO money: no price / charge / credit-cost copy in the panel.
 * - Both themes: the panel branches on isLight for its surfaces.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = join(__dirname, "../..");
const read = (p: string) => readFileSync(join(SRC, p), "utf8");

const panel = read("components/sample-clearance/SampleClearancePanel.tsx");
const songs = read("pages/songs.tsx");
const distribute = read("pages/distribute.tsx");
const app = read("App.tsx");

describe("sample clearance docking", () => {
  it("has no standalone page or route", () => {
    expect(app).not.toMatch(/sample-clearance/);
    expect(app).not.toMatch(/SampleClearance/);
  });

  it("docks into the Songs library cards", () => {
    expect(songs).toMatch(/SampleClearancePanel/);
    expect(songs).toMatch(/songId=\{s\.id\}/);
  });

  it("docks into the distribute release card as a pre-ship check", () => {
    expect(distribute).toMatch(/SampleClearanceShipCheck/);
    expect(distribute).toMatch(/releaseId=\{release\.id\}/);
  });
});

describe("sample clearance panel contract", () => {
  it("uses the lane's real endpoints", () => {
    for (const path of ["/declarations", "/acknowledge", "/alternatives", "/pre-ship"]) {
      expect(panel).toContain(path);
    }
    expect(panel).toContain("/api/sample-clearance/");
  });

  it("labels clearance as the creator's statement, never verified", () => {
    expect(panel).toMatch(/not verified/i);
    expect(panel).not.toMatch(/verified clearance|clearance verified|we verified/i);
  });

  it("offers alternatives as offers, linked to the Beats Marketplace", () => {
    expect(panel).toMatch(/Cleared-loop alternatives/);
    expect(panel).toMatch(/Beats Marketplace/);
    expect(panel).not.toMatch(/auto-?swap|automatically replace/i);
  });

  it("moves no money: no price or charge copy", () => {
    const lower = panel.toLowerCase();
    expect(lower).not.toMatch(/\$\d|price:|credits to|charge of/);
    expect(panel).toMatch(/Declaring is free/);
  });

  it("designs both themes", () => {
    expect(panel).toMatch(/isLight/);
    expect(panel).toMatch(/#C9A84C/);
  });

  it("has an honest empty state", () => {
    expect(panel).toMatch(/No samples declared on this track yet/);
  });
});
