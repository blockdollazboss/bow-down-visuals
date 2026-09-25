/**
 * Tests for the Playlist Pitcher.
 *
 * Covers: the 2-credit pitch kit price, the curator starter list (honesty
 * contract — every entry is a real channel, starter-flagged), genre
 * filtering, the pitch-kit prompt builder, the response parser (strict
 * sanitization + incomplete-output rejection), and the standing rule that
 * no route ever sends `max_tokens` (only `max_completion_tokens`).
 */
import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";
import {
  PLAYLIST_PITCH_CREDIT_COST,
  PITCH_KIT_DISCLAIMER,
  CURATOR_STARTER_LIST,
  GENRE_FILTERS,
  getCuratorsByGenre,
  buildPitchKitPrompt,
  parsePitchKitResponse,
  PITCH_STATUSES,
} from "../playlist-pitch";

describe("PLAYLIST_PITCH_CREDIT_COST", () => {
  it("charges 2 credits per pitch kit", () => {
    expect(PLAYLIST_PITCH_CREDIT_COST).toBe(2);
  });
});

describe("PITCH_KIT_DISCLAIMER", () => {
  it("is honest: pitching improves odds, never guarantees placement", () => {
    expect(PITCH_KIT_DISCLAIMER).toMatch(/never guarantees/i);
    expect(PITCH_KIT_DISCLAIMER).toMatch(/improves your odds/i);
  });
});

describe("CURATOR_STARTER_LIST", () => {
  it("ships a non-empty starter list", () => {
    expect(CURATOR_STARTER_LIST.length).toBeGreaterThanOrEqual(5);
  });

  it("every entry is starter-flagged with a real submission channel", () => {
    for (const c of CURATOR_STARTER_LIST) {
      expect(c.id).toBeTruthy();
      expect(c.name).toBeTruthy();
      expect(c.platform).toBeTruthy();
      expect(c.genres.length).toBeGreaterThan(0);
      expect(c.focus).toBeTruthy();
      expect(c.submitVia).toBeTruthy();
      expect(c.starter).toBe(true);
    }
  });

  it("ids are unique", () => {
    const ids = CURATOR_STARTER_LIST.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("never fabricates a personal curator email address", () => {
    const blob = JSON.stringify(CURATOR_STARTER_LIST);
    expect(blob).not.toMatch(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
  });

  it("includes the free official Spotify editorial path", () => {
    const spotify = CURATOR_STARTER_LIST.find((c) => c.id === "spotify-for-artists");
    expect(spotify).toBeDefined();
    expect(spotify!.submitVia).toMatch(/free/i);
  });
});

describe("getCuratorsByGenre", () => {
  it("'all' returns the full list", () => {
    expect(getCuratorsByGenre("all")).toHaveLength(CURATOR_STARTER_LIST.length);
  });

  it("filters to genre-matching curators", () => {
    const hiphop = getCuratorsByGenre("hip-hop");
    expect(hiphop.length).toBeGreaterThan(0);
    expect(hiphop.length).toBeLessThan(CURATOR_STARTER_LIST.length);
    for (const c of hiphop) {
      expect(c.genres).toContain("hip-hop");
    }
  });

  it("is case-insensitive and trims", () => {
    expect(getCuratorsByGenre("  Hip-Hop ")).toEqual(getCuratorsByGenre("hip-hop"));
  });

  it("every GENRE_FILTER has at least one curator", () => {
    for (const g of GENRE_FILTERS) {
      if (g === "all") continue;
      expect(getCuratorsByGenre(g).length).toBeGreaterThan(0);
    }
  });
});

describe("buildPitchKitPrompt", () => {
  it("includes the song title and returns JSON-only instruction", () => {
    const prompt = buildPitchKitPrompt({
      songTitle: "Midnight Gold",
      artistName: "Shark King",
      songDescription: "",
      genre: "Hip-Hop",
      mood: "",
      tempo: "",
      lyrics: "",
      releaseDate: "",
      curatorName: "",
      playlistName: "",
    });
    expect(prompt).toContain("Midnight Gold");
    expect(prompt).toContain("Shark King");
    expect(prompt).toContain("Hip-Hop");
    expect(prompt).toMatch(/return only json/i);
    expect(prompt).toMatch(/never guarantee placement/i);
  });

  it("personalizes when a curator is named, uses placeholders otherwise", () => {
    const named = buildPitchKitPrompt({
      songTitle: "X", artistName: "", songDescription: "", genre: "",
      mood: "", tempo: "", lyrics: "", releaseDate: "",
      curatorName: "DJ Luna", playlistName: "Late Night Drive",
    });
    expect(named).toContain("DJ Luna");
    expect(named).toContain("Late Night Drive");

    const anon = buildPitchKitPrompt({
      songTitle: "X", artistName: "", songDescription: "", genre: "",
      mood: "", tempo: "", lyrics: "", releaseDate: "",
      curatorName: "", playlistName: "",
    });
    expect(anon).toContain("[Curator Name]");
    expect(anon).toContain("[Playlist Name]");
  });

  it("includes lyrics for theme analysis when provided", () => {
    const prompt = buildPitchKitPrompt({
      songTitle: "X", artistName: "", songDescription: "", genre: "",
      mood: "", tempo: "", lyrics: "gold chains in the moonlight", releaseDate: "",
      curatorName: "", playlistName: "",
    });
    expect(prompt).toContain("gold chains in the moonlight");
  });
});

describe("parsePitchKitResponse", () => {
  const good = JSON.stringify({
    analysis: {
      genre: "Alt R&B",
      mood: "moody, late-night",
      energy: 62,
      tempoFeel: "slow burn",
      comparableArtists: ["The Weeknd", "Brent Faiyaz", "6LACK"],
      playlistFit: ["late-night R&B editorial", "chill vibes user lists"],
      oneLiner: "A slow-burning alt-R&B confession built for 2AM drives.",
    },
    pitchEmail: {
      subject: "Alt-R&B single 'Midnight Gold' — fits your late-night list",
      body: "Hi [Curator Name],\n\nMidnight Gold is a slow-burning alt-R&B confession...",
    },
    dmPitch: "Hey! Just dropped an alt-R&B single that would sit perfect on your late-night list — [Streaming Link]",
    followUp: "Floating this back up in case it got buried!",
  });

  it("parses a complete pitch kit", () => {
    const kit = parsePitchKitResponse(good);
    expect(kit.analysis.genre).toBe("Alt R&B");
    expect(kit.analysis.energy).toBe(62);
    expect(kit.analysis.comparableArtists).toHaveLength(3);
    expect(kit.pitchEmail.subject.length).toBeGreaterThan(0);
    expect(kit.pitchEmail.body.length).toBeGreaterThan(0);
    expect(kit.dmPitch.length).toBeGreaterThan(0);
    expect(kit.disclaimer).toBe(PITCH_KIT_DISCLAIMER);
  });

  it("clamps energy to 0-100", () => {
    const kit = parsePitchKitResponse(
      good.replace('"energy":62', '"energy":999'),
    );
    expect(kit.analysis.energy).toBe(100);
  });

  it("rejects invalid JSON", () => {
    expect(() => parsePitchKitResponse("not json")).toThrow(/invalid JSON/i);
  });

  it("rejects an incomplete pitch kit (missing email body)", () => {
    const bad = JSON.stringify({
      analysis: { oneLiner: "x" },
      pitchEmail: { subject: "s", body: "" },
      dmPitch: "d",
      followUp: "f",
    });
    expect(() => parsePitchKitResponse(bad)).toThrow(/incomplete/i);
  });

  it("falls back to a default follow-up when missing", () => {
    const noFollowUp = JSON.stringify({
      ...JSON.parse(good),
      followUp: "",
    });
    const kit = parsePitchKitResponse(noFollowUp);
    expect(kit.followUp.length).toBeGreaterThan(10);
  });
});

describe("PITCH_STATUSES", () => {
  it("covers the sent/pending/accepted pipeline", () => {
    expect(PITCH_STATUSES).toContain("sent");
    expect(PITCH_STATUSES).toContain("pending");
    expect(PITCH_STATUSES).toContain("accepted");
    expect(PITCH_STATUSES).toContain("rejected");
  });
});

describe("max_tokens ban", () => {
  it("the route source never uses max_tokens (only max_completion_tokens)", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "..", "playlist-pitch.ts"),
      "utf8",
    );
    // Strip max_completion_tokens first, then assert no bare max_tokens remains.
    const stripped = src.replace(/max_completion_tokens/g, "");
    expect(stripped).not.toMatch(/max_tokens/);
    expect(src).toMatch(/max_completion_tokens/);
  });
});
