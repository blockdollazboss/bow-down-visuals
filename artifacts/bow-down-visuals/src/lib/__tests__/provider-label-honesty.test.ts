/**
 * Provider-string leak pin (stack800 lane 3, item 1 — board #60 family).
 *
 * Raw provider ids are internal names. The server already humanizes
 * them in one place (api-server lib/job-poller.ts providerDisplayName);
 * this pin closes the frontend doors the sweep found still open:
 *
 *  - lipSyncProviderLabel passed UNKNOWN ids through verbatim — any
 *    future provider id would have leaked onto an editor status row.
 *  - AvatarPresenterPanel interpolated the status endpoint's raw enum
 *    ("heygen" / "hedra") straight into its connected line.
 *  - MusicVideoTimeline rendered scene.provider raw in its badge, and
 *    SceneStudio passed any non-"Runway" value through raw.
 *
 * Behavioural pins on the label helpers + structural pins that the
 * surfaces render through them (never the raw field again).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { lipSyncProviderLabel } from "../lip-sync-result-meta";
import { avatarProviderLabel, sceneProviderLabel } from "../provider-display-labels";

const read = (rel: string) =>
  readFileSync(new URL(rel, import.meta.url), "utf8");

describe("lipSyncProviderLabel — no raw id can pass through", () => {
  it("an unknown future provider id falls back to the feature name, never itself", () => {
    expect(lipSyncProviderLabel("some-new-engine-9")).toBe("Lip Sync");
    expect(lipSyncProviderLabel("acme-lip-v2")).toBe("Lip Sync");
    expect(lipSyncProviderLabel("bytedance/latentsync")).toBe("Lip Sync");
  });
  it("the known ids still map to their friendly names", () => {
    expect(lipSyncProviderLabel("latentsync")).toBe("Lip Sync");
    expect(lipSyncProviderLabel("sync")).toBe("Sync");
    expect(lipSyncProviderLabel("wavespeed")).toBe("WaveSpeed");
    expect(lipSyncProviderLabel("hedra")).toBe("Hedra");
    expect(lipSyncProviderLabel("heygen")).toBe("HeyGen");
  });
});

describe("avatarProviderLabel — the status enum never renders raw", () => {
  it("maps the server's closed enum to brand names", () => {
    expect(avatarProviderLabel("heygen")).toBe("HeyGen");
    expect(avatarProviderLabel("hedra")).toBe("Hedra");
    expect(avatarProviderLabel("HEDRA")).toBe("Hedra");
  });
  it("unknown or empty values get the generic feature name, never the raw id", () => {
    expect(avatarProviderLabel("acme-avatar")).toBe("AI avatar");
    expect(avatarProviderLabel(null)).toBe("AI avatar");
    expect(avatarProviderLabel(undefined)).toBe("AI avatar");
    expect(avatarProviderLabel("")).toBe("AI avatar");
  });
});

describe("sceneProviderLabel — only the established display name survives", () => {
  it("Runway ids normalize to the display name", () => {
    expect(sceneProviderLabel("Runway")).toBe("Runway");
    expect(sceneProviderLabel("runway")).toBe("Runway");
    expect(sceneProviderLabel("runway-gen4.5")).toBe("Runway");
  });
  it("any other raw id returns null so the surface falls back or hides the badge", () => {
    expect(sceneProviderLabel("seedance-2.5")).toBeNull();
    expect(sceneProviderLabel("latentsync")).toBeNull();
    expect(sceneProviderLabel("veo3")).toBeNull();
    expect(sceneProviderLabel(null)).toBeNull();
    expect(sceneProviderLabel("")).toBeNull();
  });
});

describe("surfaces render through the labels (structural pins)", () => {
  it("AvatarPresenterPanel never interpolates the raw status provider", () => {
    const panel = read("../../components/video/AvatarPresenterPanel.tsx");
    expect(panel).toContain("avatarProviderLabel(status?.provider)");
    expect(panel).not.toContain('provider: status?.provider ?? "—"');
  });

  it("MusicVideoTimeline's badge renders the label, never scene.provider raw", () => {
    const timeline = read("../../components/MusicVideoTimeline.tsx");
    expect(timeline).toContain("sceneProviderLabel(scene.provider)");
    expect(timeline).not.toMatch(/<Zap[^>]*\/>\s*\{scene\.provider\}/);
  });

  it("SceneStudio's Clip Ready line never passes scene.provider through", () => {
    const studio = read("../../components/SceneStudio.tsx");
    expect(studio).not.toContain('scene.provider === "Runway" ? "Scene Clip" : scene.provider');
    expect(studio).not.toMatch(/\{scene\.provider\s*\?\?/);
  });

  it("LipSyncSection's status rows render the provider only via lipSyncProviderLabel", () => {
    const section = read("../../components/editor/sections/LipSyncSection.tsx");
    // Every JSX interpolation of the raw providerName must be wrapped.
    const rawRenders = section.match(/\{providerName\}/g) ?? [];
    expect(rawRenders).toHaveLength(0);
    expect(section).toContain("lipSyncProviderLabel(providerName)");
  });
});
