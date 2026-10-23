import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/* STACK-27 F9 — broken doors / redirect-param collisions (S27-67…S27-70).
 *
 * /ai-audio and /beat-maker are QueryPreservingRedirects whose merge lets
 * INCOMING query params overwrite the TARGET's params. A door that linked
 * to /ai-audio?tab=beats therefore landed on /audio-studio?tab=beats —
 * and Audio Studio's tab parser only accepts its own tab ids, falling
 * back to "cleanup" for anything else. The doors now point straight at
 * the Audio Studio URL they mean: ?tab=aiaudio (the host tab) with the
 * AI Audio sub-tab riding ?sub=, the channel AiAudio actually reads.
 * These pins hold the doors on those direct URLs so the collision can
 * never quietly come back. */

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

const musicStudio = read("../components/editor/music/MusicStudio.tsx");
const beatsPage = read("../pages/beats.tsx");
const soundsPage = read("../pages/sounds.tsx");
const makeSong = read("../pages/make-song.tsx");
const creatorPricing = read("../pages/creator-pricing.tsx");

/** Parse an href the way the router + AiAudio will see it. */
const door = (href: string) => {
  const url = new URL(href, "https://bowdownvisuals.test");
  return { path: url.pathname, params: url.searchParams };
};

describe("S27-67 — beat doors land on the AI Audio beats tab, not Audio Cleanup", () => {
  it("MusicStudio's beat-maker cross-link points directly at Audio Studio", () => {
    expect(musicStudio).toContain('href="/audio-studio?tab=aiaudio&sub=beats"');
    expect(musicStudio).not.toContain('href="/ai-audio?tab=beats"');
    const { path, params } = door("/audio-studio?tab=aiaudio&sub=beats");
    expect(path).toBe("/audio-studio");
    expect(params.get("tab")).toBe("aiaudio");
    expect(params.get("sub")).toBe("beats");
  });

  it("the Beats page 'make your own beat' door points directly at Audio Studio", () => {
    expect(beatsPage).toContain('href="/audio-studio?tab=aiaudio&sub=beats"');
    expect(beatsPage).not.toContain('href="/ai-audio?tab=beats"');
    const { path, params } = door("/audio-studio?tab=aiaudio&sub=beats");
    expect(path).toBe("/audio-studio");
    expect(params.get("tab")).toBe("aiaudio");
    expect(params.get("sub")).toBe("beats");
  });
});
