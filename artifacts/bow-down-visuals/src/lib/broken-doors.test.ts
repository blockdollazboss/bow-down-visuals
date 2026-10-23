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

import { initialBeatMakerTab } from "./beat-maker-tab";
import { loginPathWithNext, postLoginPath } from "./auth-next";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const aiAudio = read("../pages/ai-audio.tsx");

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

describe("S27-68 — the Sounds page SFX door lands on the AI Audio sfx tab", () => {
  it("'Generate SFX with AI' points directly at Audio Studio with sub=sfx", () => {
    expect(soundsPage).toContain('href="/audio-studio?tab=aiaudio&sub=sfx"');
    expect(soundsPage).not.toContain('href="/ai-audio?tab=sfx"');
    const { path, params } = door("/audio-studio?tab=aiaudio&sub=sfx");
    expect(path).toBe("/audio-studio");
    expect(params.get("tab")).toBe("aiaudio");
    expect(params.get("sub")).toBe("sfx");
  });
});

describe("S27-69 — the Producer Tag door can actually reach the Tag tab", () => {
  it("the Make Song door points directly at Audio Studio carrying aitab=tag", () => {
    expect(makeSong).toContain('href="/audio-studio?tab=aiaudio&sub=beats&aitab=tag"');
    expect(makeSong).not.toContain('href="/beat-maker?tab=tag"');
    const { path, params } = door("/audio-studio?tab=aiaudio&sub=beats&aitab=tag");
    expect(path).toBe("/audio-studio");
    expect(params.get("tab")).toBe("aiaudio");
    expect(params.get("sub")).toBe("beats");
    expect(params.get("aitab")).toBe("tag");
  });

  it("BeatMakerModule opens on the Tag tab when aitab=tag", () => {
    expect(initialBeatMakerTab("?tab=aiaudio&sub=beats&aitab=tag")).toBe("tag");
    expect(initialBeatMakerTab("aitab=tag")).toBe("tag");
  });

  it("the plain beats door (sub=beats, no aitab) opens the beats tab, NOT the tag tab", () => {
    expect(initialBeatMakerTab("?tab=aiaudio&sub=beats")).toBe("ai");
    expect(initialBeatMakerTab("")).toBe("ai");
    expect(initialBeatMakerTab("?tab=aiaudio&sub=sfx")).toBe("ai");
  });

  it("the legacy multi-value ?tab= channel still selects the Tag tab", () => {
    expect(initialBeatMakerTab("?tab=aiaudio&tab=tag")).toBe("tag");
  });

  it("BeatMakerModule's opening tab is decided by the shared helper", () => {
    expect(aiAudio).toContain("initialBeatMakerTab(window.location.search)");
  });
});

describe("S27-70 — creator-pricing's signed-out checkout bounce uses ?next=", () => {
  it("the bounce is built with loginPathWithNext, never /login?returnTo=", () => {
    expect(creatorPricing).toContain(
      'loginPathWithNext("/creator-pricing", `returnTo=${encodeURIComponent(returnTo)}`)',
    );
    expect(creatorPricing).not.toContain("/login?returnTo=");
    expect(creatorPricing).not.toContain("honored everywhere");
  });

  it("the bounce round-trips: after sign-in the user lands back on pricing with returnTo intact", () => {
    const bounce = loginPathWithNext("/creator-pricing", `returnTo=${encodeURIComponent("/earnings")}`);
    expect(bounce.startsWith("/login?next=")).toBe(true);
    const loginSearch = bounce.slice("/login".length);
    const landed = postLoginPath(loginSearch);
    expect(landed.startsWith("/creator-pricing?")).toBe(true);
    const landedParams = new URLSearchParams(landed.slice(landed.indexOf("?") + 1));
    expect(landedParams.get("returnTo")).toBe("/earnings");
  });
});
