import { describe, expect, it } from "vitest";
import {
  DESKS, DESK_KEYS, SUITE_NAME, allModules, deskByKey, deskByRoute, moduleByKey, modulesAccepting,
} from "./desks";

describe("desk registry", () => {
  it("names the suite and lists the hub plus the four desks", () => {
    expect(SUITE_NAME).toBe("Visual Vibes");
    expect(DESK_KEYS).toEqual(["hub", "video", "audio", "photo", "generate"]);
    expect(DESKS).toHaveLength(5);
  });

  it("gives every desk a house name, blurb, and canonical route", () => {
    for (const desk of DESKS) {
      expect(desk.name.length).toBeGreaterThan(0);
      expect(desk.blurb.length).toBeGreaterThan(0);
      expect(desk.route.startsWith("/")).toBe(true);
    }
    expect(deskByKey("video").route).toBe("/video-editor");
    expect(deskByKey("audio").route).toBe("/audio-studio");
    expect(deskByKey("photo").route).toBe("/thumbnail-studio");
    expect(deskByKey("generate").route).toBe("/create");
    expect(deskByKey("hub").route).toBe("/hub");
  });

  it("keeps module keys unique and routes absolute", () => {
    const keys = allModules().map((mod) => mod.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const mod of allModules()) {
      expect(mod.route.startsWith("/")).toBe(true);
      expect(moduleByKey(mod.key)).toBe(mod);
    }
  });

  it("resolves desks from tab/panel deep-links", () => {
    expect(deskByRoute("/video-editor?tab=lyric-video")?.key).toBe("video");
    expect(deskByRoute("/audio-studio?tab=stems&mode=vocals")?.key).toBe("audio");
    expect(deskByRoute("/thumbnail-studio?tab=abtest")?.key).toBe("photo");
    expect(deskByRoute("/create?panel=coverart")?.key).toBe("generate");
    expect(deskByRoute("/hub")?.key).toBe("hub");
    expect(deskByRoute("/video-studio")?.key).toBe("generate");
  });

  it("uses house vocabulary only — no other-company names, no 'Simple' mode label", () => {
    const labels = DESKS.flatMap((d) => [d.name, d.blurb, ...d.modules.map((mod) => mod.label)]).join(" ");
    for (const banned of ["CapCut", "Suno", "Runway", "ElevenLabs", "OpenAI", "Simple"]) {
      expect(labels).not.toContain(banned);
    }
  });

  it("knows which modules can receive each core asset kind (handoff targets)", () => {
    expect(modulesAccepting("song").some((mod) => mod.key === "editor")).toBe(true);
    expect(modulesAccepting("stems").some((mod) => mod.desk === "audio")).toBe(true);
    expect(modulesAccepting("video").some((mod) => mod.key === "thumbnail-generate")).toBe(true);
    expect(modulesAccepting("image").some((mod) => mod.key === "editor")).toBe(true);
  });
});
