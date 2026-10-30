import { describe, it, expect } from "vitest";
import {
  DISTRIBUTION_PLATFORMS,
  DISTRIBUTION_AI_CREDIT_COST,
  DISTRIBUTION_PACKAGING_CREDITS,
  DISTRIBUTION_STATUSES,
  DISTRIBUTION_TIERS,
  platformLabel,
  isPackaged,
  releaseChecklist,
  releaseChecklistPasses,
  isValidIsrcFormat,
  type ReleaseChecklistInput,
} from "./distribution";

describe("DISTRIBUTION_PLATFORMS", () => {
  it("lists 9 platforms with unique keys and labels", () => {
    expect(DISTRIBUTION_PLATFORMS).toHaveLength(9);
    const keys = DISTRIBUTION_PLATFORMS.map((p) => p.key);
    expect(new Set(keys).size).toBe(9);
    for (const p of DISTRIBUTION_PLATFORMS) {
      expect(p.label.length).toBeGreaterThan(0);
    }
  });

  it("includes the major streaming services", () => {
    const keys = DISTRIBUTION_PLATFORMS.map((p) => p.key);
    expect(keys).toContain("spotify");
    expect(keys).toContain("apple_music");
    expect(keys).toContain("youtube_music");
  });
});

describe("platformLabel", () => {
  it("resolves known keys to labels", () => {
    expect(platformLabel("spotify")).toBe("Spotify");
    expect(platformLabel("apple_music")).toBe("Apple Music");
    expect(platformLabel("tidal")).toBe("Tidal");
  });

  it("falls back to the raw key for unknown platforms", () => {
    expect(platformLabel("myspace")).toBe("myspace");
  });
});

describe("pricing", () => {
  it("prices AI generations at 100 credits", () => {
    expect(DISTRIBUTION_AI_CREDIT_COST).toBe(100);
  });

  it("prices release packaging at 10 credits", () => {
    expect(DISTRIBUTION_PACKAGING_CREDITS).toBe(10);
  });
});

describe("DISTRIBUTION_STATUSES", () => {
  it("has no 'delivered' status — v1 prepares, it never claims delivery", () => {
    expect(DISTRIBUTION_STATUSES).toEqual(["draft", "packaged"]);
    expect(DISTRIBUTION_STATUSES).not.toContain("delivered");
  });
});

describe("isPackaged", () => {
  it("is true only for packaged releases", () => {
    expect(isPackaged("packaged")).toBe(true);
    expect(isPackaged("draft")).toBe(false);
    expect(isPackaged("delivered")).toBe(false);
  });
});

/* ── releaseChecklist — the mirror of the server's submit gate ──────────
   Every expectation below is the server's own boundary (buildChecklist +
   createReleaseSchema in routes/generate/distribution.ts): the client
   must reject exactly what the server rejects, at the same values. */
describe("releaseChecklist (server submit-gate mirror)", () => {
  /* Midnight UTC: the server measures whole days from the date's
     midnight, so the 7-day boundary is exact only against a midnight
     "now" (from noon, a date 7 calendar days out is 6.5 days away and
     the server refuses it — the mirror must refuse it too). */
  const NOW = new Date("2026-10-30T00:00:00Z");
  const good: ReleaseChecklistInput = {
    title: "Midnight Frequencies",
    artistName: "Shark King",
    releaseType: "single",
    audioUrl: "https://cdn.example.com/track.wav",
    artworkUrl: "https://cdn.example.com/cover.jpg",
    releaseDate: "2026-11-20",
    platforms: ["spotify"],
    explicitDeclared: true,
    genre: "Hip-Hop",
    tracks: [{ title: "Midnight Frequencies" }],
    isrc: "",
  };
  const item = (input: ReleaseChecklistInput, key: string) =>
    releaseChecklist(input, NOW).find((i) => i.key === key)!;

  it("passes a complete, honest single", () => {
    expect(releaseChecklistPasses(releaseChecklist(good, NOW))).toBe(true);
  });

  it("title: 2 chars fails, 3 passes (server minimum)", () => {
    expect(item({ ...good, title: "ab" }, "title").ok).toBe(false);
    expect(item({ ...good, title: "abc" }, "title").ok).toBe(true);
    expect(item({ ...good, title: "  ab  " }, "title").ok).toBe(false);
  });

  it("artist: 1 char fails, 2 passes (server minimum)", () => {
    expect(item({ ...good, artistName: "a" }, "artist").ok).toBe(false);
    expect(item({ ...good, artistName: "ab" }, "artist").ok).toBe(true);
  });

  it("cover art is REQUIRED — the old wizard treated it as a warning", () => {
    expect(item({ ...good, artworkUrl: "" }, "artwork").ok).toBe(false);
    expect(item({ ...good, artworkUrl: "not a url" }, "artwork").ok).toBe(false);
    expect(item({ ...good, artworkUrl: "https://x.co/c.png" }, "artwork").ok).toBe(true);
  });

  it("genre is REQUIRED — the old wizard never checked it", () => {
    expect(item({ ...good, genre: "" }, "genre").ok).toBe(false);
    expect(item({ ...good, genre: "  " }, "genre").ok).toBe(false);
    expect(item({ ...good, genre: "Trap" }, "genre").ok).toBe(true);
  });

  it("release date: 6 days out fails, exactly 7 passes (server lead time)", () => {
    expect(item({ ...good, releaseDate: "2026-11-05" }, "releaseDate").ok).toBe(false);
    expect(item({ ...good, releaseDate: "2026-11-06" }, "releaseDate").ok).toBe(true);
    expect(item({ ...good, releaseDate: "" }, "releaseDate").ok).toBe(false);
    expect(item({ ...good, releaseDate: "not-a-date" }, "releaseDate").ok).toBe(false);
  });

  it("track counts follow the type: single exactly 1, EP 2–6, album 7–30", () => {
    const tracks = (n: number) => Array.from({ length: n }, (_, i) => ({ title: `T${i + 1}` }));
    expect(item({ ...good, releaseType: "single", tracks: tracks(2) }, "tracks").ok).toBe(false);
    expect(item({ ...good, releaseType: "ep", tracks: tracks(1) }, "tracks").ok).toBe(false);
    expect(item({ ...good, releaseType: "ep", tracks: tracks(6) }, "tracks").ok).toBe(true);
    expect(item({ ...good, releaseType: "ep", tracks: tracks(7) }, "tracks").ok).toBe(false);
    expect(item({ ...good, releaseType: "album", tracks: tracks(6) }, "tracks").ok).toBe(false);
    expect(item({ ...good, releaseType: "album", tracks: tracks(7) }, "tracks").ok).toBe(true);
    expect(item({ ...good, releaseType: "album", tracks: tracks(30) }, "tracks").ok).toBe(true);
    expect(item({ ...good, releaseType: "album", tracks: tracks(31) }, "tracks").ok).toBe(false);
    expect(item({ ...good, tracks: [{ title: " " }] }, "tracks").ok).toBe(false);
  });

  it("audio must be present and a real URL when typed by hand", () => {
    expect(item({ ...good, audioUrl: "" }, "audio").ok).toBe(false);
    expect(item({ ...good, audioUrl: "track.mp3" }, "audio").ok).toBe(false);
    expect(item({ ...good, audioUrl: "https://x.co/t.mp3" }, "audio").ok).toBe(true);
  });

  it("explicit declaration and platforms are required, as the server requires", () => {
    expect(item({ ...good, explicitDeclared: false }, "explicit").ok).toBe(false);
    expect(item({ ...good, platforms: [] }, "platforms").ok).toBe(false);
  });

  it("ISRCs: blank is fine, the server's 12-char pattern is enforced", () => {
    expect(isValidIsrcFormat("")).toBe(true);
    expect(isValidIsrcFormat("USABC2412345")).toBe(true);
    expect(isValidIsrcFormat("us-abc-24-12345")).toBe(true);
    expect(isValidIsrcFormat("USABC241234")).toBe(false);
    expect(isValidIsrcFormat("USABC24123456")).toBe(false);
    expect(item({ ...good, isrc: "NOPE" }, "isrc").ok).toBe(false);
    expect(item({ ...good, tracks: [{ title: "T", isrc: "XX" }] }, "isrc").ok).toBe(false);
  });

  it("tier blurbs state the server's real ranges (form copy = enforced limit)", () => {
    const blurb = (type: string) => DISTRIBUTION_TIERS.find((t) => t.type === type)!.blurb;
    expect(blurb("ep")).toContain("2–6");
    expect(blurb("album")).toContain("7–30");
  });
});
