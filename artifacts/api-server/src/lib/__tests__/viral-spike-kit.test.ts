/**
 * viral-spike-kit.test.ts — kit builder contract: kits exist only for
 * proven spikes, steps follow CREATE → BRAND → PROMOTE → MONEY, every
 * step links to an existing tool and requires the creator's own action
 * (the kit never acts), and headlines never invent a multiplier.
 */
import { describe, expect, it } from "vitest";
import { buildViralSpikeKit, spikeHeadline, type SpikeContentRef } from "../viral-spike-kit";
import { detectSpike, type ViewSample } from "../viral-spike";

const H = 3_600_000;
const T0 = 1_700_000_000_000;

const CONTENT: SpikeContentRef = {
  kind: "showcase",
  id: "33333333-3333-4333-8333-333333333333",
  title: "My First Studio Session",
  slug: "my-first-studio-session",
};

function spikeVerdict() {
  const samples: ViewSample[] = [];
  for (let h = 0; h <= 72; h += 6) samples.push({ atMs: T0 + h * H, views: 10 * h });
  const last = samples[samples.length - 1]!;
  samples.push({ atMs: last.atMs + 6 * H, views: last.views + 900 });
  const v = detectSpike(samples);
  if (v.status !== "spike") throw new Error("fixture must spike");
  return v;
}

describe("buildViralSpikeKit", () => {
  it("builds a kit for a proven spike", () => {
    const kit = buildViralSpikeKit(CONTENT, spikeVerdict());
    expect(kit).not.toBeNull();
    expect(kit!.basis).toBe("measured_multiplier");
    expect(kit!.headline).toContain("+900 views");
    expect(kit!.headline).toContain("× its usual pace");
  });

  it("returns null for no_spike and for insufficient_data — no kit on unproven data", () => {
    const flat: ViewSample[] = [
      { atMs: T0, views: 0 },
      { atMs: T0 + 6 * H, views: 20 },
    ];
    expect(buildViralSpikeKit(CONTENT, detectSpike(flat))).toBeNull();
    expect(buildViralSpikeKit(CONTENT, detectSpike([{ atMs: T0, views: 999_999 }]))).toBeNull();
  });

  it("steps run strictly in CREATE → BRAND → PROMOTE → MONEY order", () => {
    const kit = buildViralSpikeKit(CONTENT, spikeVerdict())!;
    const order = { create: 0, brand: 1, promote: 2, money: 3 } as const;
    const stages = kit.steps.map((s) => s.stage);
    const sorted = [...stages].sort((a, b) => order[a] - order[b]);
    expect(stages).toEqual(sorted);
    expect(new Set(stages)).toEqual(new Set(["create", "brand", "promote", "money"]));
  });

  it("includes the pin, sequel and caption-variant follow-ups from the brief", () => {
    const kit = buildViralSpikeKit(CONTENT, spikeVerdict())!;
    const actions = kit.steps.map((s) => s.action);
    expect(actions).toContain("pin");
    expect(actions).toContain("sequel");
    expect(actions).toContain("caption_variants");
    const sequel = kit.steps.find((s) => s.action === "sequel")!;
    expect(sequel.detail).toContain(CONTENT.title);
  });

  it("every step links to an existing site route and a named existing tool", () => {
    const kit = buildViralSpikeKit(CONTENT, spikeVerdict())!;
    const knownRoutes = new Set([
      "/video-editor",
      "/hooks?tab=styler",
      "/branding-kit",
      "/showcase/my-first-studio-session",
      "/promote",
      "/coach",
      "/earnings",
    ]);
    for (const step of kit.steps) {
      expect(knownRoutes.has(step.href)).toBe(true);
      expect(step.tool.length).toBeGreaterThan(0);
    }
  });

  it("NEVER acts on its own: every step requires creator action and zero auto actions are taken", () => {
    const kit = buildViralSpikeKit(CONTENT, spikeVerdict())!;
    expect(kit.auto_actions_taken).toBe(0);
    for (const step of kit.steps) expect(step.requires_creator_action).toBe(true);
  });

  it("first-surge headline says there is no baseline — it never prints a multiplier", () => {
    const v = detectSpike([
      { atMs: T0, views: 10 },
      { atMs: T0 + 6 * H, views: 900 },
    ]);
    if (v.status !== "spike") throw new Error("fixture must spike");
    const headline = spikeHeadline(CONTENT, v);
    expect(headline).toContain("no earlier baseline");
    expect(headline).not.toContain("×");
    const kit = buildViralSpikeKit(CONTENT, v)!;
    expect(kit.basis).toBe("first_surge");
  });

  it("pin step falls back to /showcase when the content has no slug", () => {
    const kit = buildViralSpikeKit({ ...CONTENT, kind: "short", slug: null }, spikeVerdict())!;
    expect(kit.steps.find((s) => s.action === "pin")!.href).toBe("/showcase");
  });
});
