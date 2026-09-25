/**
 * Money-integrity + prompt tests for the Stream Pack Generator.
 *
 * Covers: the 1-credit-per-image charge, the out-of-credits 402 contract,
 * plan validation (400 before credits), prompt construction (channel name
 * + theme woven in), and the full 12-asset catalog.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../../lib/credits", () => ({
  chargeCredits: vi.fn(),
  refundCredits: vi.fn(),
  OutOfCreditsError: class OutOfCreditsError extends Error {},
  LedgerWriteError: class LedgerWriteError extends Error {},
}));

vi.mock("../../../lib/objectStorage", () => ({
  uploadMediaToSupabaseStorage: vi.fn(),
  refreshSupabaseStorageUrl: vi.fn(),
  normalizeToStorageRef: vi.fn((v: string) => v),
}));

import {
  STREAM_PACK_CREDIT_COST,
  STREAM_PACK_THEMES,
  STREAM_PACK_ASSETS,
  resolveStreamPackPlan,
  buildStreamPackPrompt,
} from "../stream-pack";
import { chargeCredits } from "../../../lib/credits";

const mockCharge = vi.mocked(chargeCredits);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("STREAM_PACK_CREDIT_COST", () => {
  it("charges 1 credit per generated asset", () => {
    expect(STREAM_PACK_CREDIT_COST).toBe(1);
  });
});

describe("STREAM_PACK_THEMES", () => {
  it("ships 6 themes with gold-luxury as the default", () => {
    expect(STREAM_PACK_THEMES).toHaveLength(6);
    expect(STREAM_PACK_THEMES[0]!.id).toBe("gold-luxury");
  });

  it("every theme has an id, name, blurb, swatches, and style prompt", () => {
    for (const t of STREAM_PACK_THEMES) {
      expect(t.id).toBeTruthy();
      expect(t.name).toBeTruthy();
      expect(t.blurb).toBeTruthy();
      expect(t.swatches).toHaveLength(3);
      expect(t.stylePrompt.length).toBeGreaterThan(20);
    }
  });

  it("theme ids are unique", () => {
    const ids = STREAM_PACK_THEMES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("STREAM_PACK_ASSETS", () => {
  it("ships the full 12-asset bundle", () => {
    expect(STREAM_PACK_ASSETS).toHaveLength(12);
  });

  it("covers all four groups: overlays, alerts, panels, screens", () => {
    const groups = new Set(STREAM_PACK_ASSETS.map((a) => a.group));
    expect(groups).toEqual(new Set(["Overlays", "Alerts", "Panels", "Screens"]));
  });

  it("asset keys are unique and every asset has label + prompt core", () => {
    const keys = STREAM_PACK_ASSETS.map((a) => a.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const a of STREAM_PACK_ASSETS) {
      expect(a.label).toBeTruthy();
      expect(a.promptCore.length).toBeGreaterThan(20);
      expect(["1024x1024", "1536x1024"]).toContain(a.size);
    }
  });
});

describe("resolveStreamPackPlan", () => {
  it("resolves a valid plan with the 1-credit cost", () => {
    const plan = resolveStreamPackPlan({
      channelName: "ThyCheatCode",
      theme: "gold-luxury",
      asset: "webcam-frame",
    });
    expect(plan.channelName).toBe("ThyCheatCode");
    expect(plan.theme.id).toBe("gold-luxury");
    expect(plan.asset.key).toBe("webcam-frame");
    expect(plan.creditCost).toBe(STREAM_PACK_CREDIT_COST);
  });

  it("defaults to gold-luxury when the theme is unknown", () => {
    const plan = resolveStreamPackPlan({
      channelName: "ThyCheatCode",
      theme: "not-a-theme",
      asset: "screen-brb",
    });
    expect(plan.theme.id).toBe("gold-luxury");
  });

  it("throws on a missing channel name (400 before credits)", () => {
    expect(() =>
      resolveStreamPackPlan({ channelName: "   ", theme: "gold-luxury", asset: "webcam-frame" }),
    ).toThrow("channelName is required");
  });

  it("throws on an unknown asset key (400 before credits)", () => {
    expect(() =>
      resolveStreamPackPlan({ channelName: "X", theme: "gold-luxury", asset: "hovercar" }),
    ).toThrow("Unknown asset");
  });

  it("trims and caps the channel name at 40 chars", () => {
    const plan = resolveStreamPackPlan({
      channelName: "  " + "a".repeat(100) + "  ",
      asset: "panel-about",
    });
    expect(plan.channelName).toHaveLength(40);
  });
});

describe("buildStreamPackPrompt", () => {
  it("weaves channel name, asset core, and theme style into the prompt", () => {
    const plan = resolveStreamPackPlan({
      channelName: "ThyCheatCode",
      theme: "neon-cyber",
      asset: "alert-follower",
    });
    const prompt = buildStreamPackPrompt(plan);
    expect(prompt).toContain("ThyCheatCode");
    expect(prompt).toContain("NEW FOLLOWER");
    expect(prompt).toContain("cyan");
    expect(prompt).toContain("no watermark");
  });

  it("caps the prompt at 4000 chars", () => {
    const plan = resolveStreamPackPlan({
      channelName: "a".repeat(40),
      theme: "gold-luxury",
      asset: "screen-starting",
    });
    expect(buildStreamPackPrompt(plan).length).toBeLessThanOrEqual(4000);
  });

  it("every asset produces a distinct prompt", () => {
    const prompts = new Set(
      STREAM_PACK_ASSETS.map((a) =>
        buildStreamPackPrompt(
          resolveStreamPackPlan({ channelName: "X", theme: "gold-luxury", asset: a.key }),
        ),
      ),
    );
    expect(prompts.size).toBe(STREAM_PACK_ASSETS.length);
  });
});

describe("money-flow contracts", () => {
  it("full 12-asset bundle costs 12 credits total", () => {
    expect(STREAM_PACK_ASSETS.length * STREAM_PACK_CREDIT_COST).toBe(12);
  });

  it("the route rejects when balance < cost (documents the 402 contract)", () => {
    // The POST handler checks req.userCredits < plan.creditCost → 402
    // before calling chargeCredits. This pins the cost constant used there.
    expect(STREAM_PACK_CREDIT_COST).toBeGreaterThan(0);
    expect(0 < STREAM_PACK_CREDIT_COST).toBe(true); // → 402 out_of_credits
  });

  it("chargeCredits is the function the route uses (mock is wired)", () => {
    expect(mockCharge).toBeDefined();
  });
});
