/**
 * Social proof display contract (C5) — the public face of live
 * social-proof sync.
 *
 * vitest here runs jsx:preserve, so per the repo's established split
 * this suite imports the pure display module (lib/social-proof-display)
 * and pins the component's wiring by source. The law:
 *  - counts render EXACT and in full (12,345 — never a rounded "12.3k");
 *  - every figure carries its provenance: the date the platform
 *    actually returned the number; an unparseable date yields NO date
 *    line rather than an invented one;
 *  - the strip renders nothing when no figure is live (source pin:
 *    the component returns null on an empty live list).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { formatProofValue, liveProofFigures, proofUpdatedLabel } from "@/lib/social-proof-display";
import type { SocialProofFigureDto } from "@/lib/artist-profiles";

const FIG: SocialProofFigureDto = {
  key: "instagram.followers",
  platform: "instagram",
  label: "Instagram followers",
  value: 12345,
  accountLabel: "nova.reign",
  updatedAt: "2026-10-21T08:30:00.000Z",
  stale: false,
};

describe("formatProofValue — exact, in full, never rounded up", () => {
  it("formats with thousands separators and no abbreviation", () => {
    expect(formatProofValue(12345)).toBe("12,345");
    expect(formatProofValue(1234567)).toBe("1,234,567");
    expect(formatProofValue(999)).toBe("999");
    expect(formatProofValue(0)).toBe("0");
  });
});

describe("proofUpdatedLabel — provenance or nothing", () => {
  it("renders the measurement date", () => {
    expect(proofUpdatedLabel("2026-10-21T08:30:00.000Z")).toBe("Oct 21, 2026");
  });
  it("an unparseable stamp yields no label rather than a fake date", () => {
    expect(proofUpdatedLabel("not-a-date")).toBe("");
    expect(proofUpdatedLabel("")).toBe("");
  });
});

describe("liveProofFigures", () => {
  it("absent payload reads as no figures; shipped figures pass through untouched", () => {
    expect(liveProofFigures(undefined)).toEqual([]);
    expect(liveProofFigures([FIG])).toEqual([FIG]);
  });
});

describe("SocialProofStrip wiring (source pins)", () => {
  const src = readFileSync(join(__dirname, "SocialProofStrip.tsx"), "utf8");
  it("renders nothing when no figure is live", () => {
    expect(src).toContain("if (live.length === 0) return null;");
  });
  it("renders counts through the exact formatter and dates through the label helper", () => {
    expect(src).toContain("formatProofValue(f.value)");
    expect(src).toContain("proofUpdatedLabel(f.updatedAt)");
    expect(src).toContain("Updated {updated}");
  });
  it("is mounted on the public profile under the masthead badges", () => {
    const page = readFileSync(join(__dirname, "..", "..", "pages", "artist-public.tsx"), "utf8");
    expect(page).toContain("<SocialProofStrip figures={profile.social_proof} />");
  });
});
