/**
 * N17 Fan Links — the FE play hand-back (stack1300 trailing step).
 *
 * The server records a fan link's ARRIVAL when a counted play hands
 * back the code the fan arrived with (both play doors share one
 * reader: ?fan= on the play URL, or a fanCode field in the JSON
 * body). The landing page's URL carries ?fan=<code>; these pins prove
 * the FE play surfaces carry it into their play calls — and that a
 * play with no code in the URL stays byte-identical to before, so
 * ordinary plays remain ordinary.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  currentFanCode,
  fanCodeFromSearch,
  playPathWithFanCode,
} from "./upg-fans";
import { recordPlay } from "./streaming";

const root = join(import.meta.dirname, "..");
const read = (...parts: string[]) => readFileSync(join(root, ...parts), "utf8");

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fanCodeFromSearch — the code the landing URL carried", () => {
  it("reads ?fan= among other params", () => {
    expect(fanCodeFromSearch("?fan=abc123")).toBe("abc123");
    expect(fanCodeFromSearch("?utm=x&fan=zz-9_1&ref=y")).toBe("zz-9_1");
  });

  it("is null when the URL carries no code", () => {
    expect(fanCodeFromSearch("")).toBeNull();
    expect(fanCodeFromSearch("?start=42")).toBeNull();
    expect(fanCodeFromSearch("?fan=")).toBeNull();
  });
});

describe("currentFanCode — the live page's URL", () => {
  it("reads window.location.search when a window exists", () => {
    vi.stubGlobal("window", { location: { search: "?fan=live42" } });
    expect(currentFanCode()).toBe("live42");
  });

  it("is null with no window (server / tests) and no code", () => {
    expect(currentFanCode()).toBeNull();
    vi.stubGlobal("window", { location: { search: "" } });
    expect(currentFanCode()).toBeNull();
  });
});

describe("playPathWithFanCode — the media door's ride-along", () => {
  it("returns the path byte-identical when there is no code", () => {
    expect(playPathWithFanCode("/api/media/track/t1/play", null)).toBe(
      "/api/media/track/t1/play",
    );
  });

  it("appends ?fan= when the fan arrived carrying a code", () => {
    expect(playPathWithFanCode("/api/media/video/v9/play", "abc123")).toBe(
      "/api/media/video/v9/play?fan=abc123",
    );
  });
});

describe("recordPlay — every streaming surface's play call", () => {
  it("carries the code when the page URL has one", () => {
    const fetchStub = vi.fn(() => Promise.resolve(new Response()));
    vi.stubGlobal("fetch", fetchStub);
    vi.stubGlobal("window", { location: { search: "?fan=abc123" } });
    recordPlay("track", "t-1");
    expect(fetchStub).toHaveBeenCalledWith("/api/media/track/t-1/play?fan=abc123", {
      method: "POST",
    });
  });

  it("posts the bare path, byte-identical, when there is no code", () => {
    const fetchStub = vi.fn(() => Promise.resolve(new Response()));
    vi.stubGlobal("fetch", fetchStub);
    vi.stubGlobal("window", { location: { search: "" } });
    recordPlay("video", "v-2");
    expect(fetchStub).toHaveBeenCalledWith("/api/media/video/v-2/play", {
      method: "POST",
    });
  });
});

describe("wiring — the direct play posts carry the code too", () => {
  it("ChartsRadio hands the code back as the discovery body's fanCode", () => {
    const src = read("components", "discovery", "ChartsRadio.tsx");
    expect(src).toContain("currentFanCode");
    expect(src).toContain("fanCode");
    /* Absent code → the body is exactly { kind, mediaId } as before:
       the field rides only when a code exists. */
    expect(src).toMatch(/\.\.\.\(fanCode \? \{ fanCode \} : \{\}\)/);
  });

  it("the shorts feed builds its play path through the shared helper", () => {
    const src = read("pages", "shorts.tsx");
    expect(src).toContain("playPathWithFanCode");
    expect(src).toContain("currentFanCode");
    expect(src).not.toContain("fetch(`/api/media/video/${item.id}/play`");
  });

  it("recordPlay itself rides the shared helper (one home, no copies)", () => {
    const src = read("lib", "streaming.ts");
    expect(src).toContain("playPathWithFanCode");
    expect(src).toContain("currentFanCode");
  });
});
