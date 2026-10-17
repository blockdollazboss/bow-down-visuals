import { describe, expect, it, vi, afterEach } from "vitest";
import {
  fetchLibrarySongFile,
  fetchLibrarySongs,
  formatSongDuration,
  librarySongFileName,
  normalizeLibrarySong,
  normalizeLibrarySongs,
  type LibrarySong,
} from "./song-library";

const row = {
  id: "11111111-1111-4111-8111-111111111111",
  user_id: "u1",
  title: "Midnight Crown",
  audio_url: "https://cdn.example/songs/midnight.mp3",
  audio_path: "songs/midnight.mp3",
  source: "master",
  parent_song_id: null,
  duration_sec: "204",
  created_at: "2026-10-17T00:00:00.000Z",
};

describe("song library normalization (DTO discipline at the fetch boundary)", () => {
  it("maps a snake_case row into the client shape", () => {
    expect(normalizeLibrarySong(row)).toEqual({
      id: row.id,
      title: "Midnight Crown",
      audioUrl: "https://cdn.example/songs/midnight.mp3",
      source: "master",
      durationSec: 204,
      createdAt: "2026-10-17T00:00:00.000Z",
    });
  });

  it("accepts a numeric duration_sec and defaults a missing title", () => {
    const song = normalizeLibrarySong({ ...row, title: "", duration_sec: 95 });
    expect(song?.title).toBe("Untitled song");
    expect(song?.durationSec).toBe(95);
  });

  it("drops rows that can't be picked (no id, no audio URL, junk)", () => {
    expect(normalizeLibrarySong({ ...row, id: 42 })).toBeNull();
    expect(normalizeLibrarySong({ ...row, audio_url: "" })).toBeNull();
    expect(normalizeLibrarySong(null)).toBeNull();
    expect(normalizeLibrarySong("nope")).toBeNull();
  });

  it("normalizeLibrarySongs reads the { songs } envelope and filters", () => {
    const songs = normalizeLibrarySongs({ songs: [row, { id: "x" }, null] });
    expect(songs).toHaveLength(1);
    expect(normalizeLibrarySongs({})).toEqual([]);
    expect(normalizeLibrarySongs(null)).toEqual([]);
  });
});

describe("fetchLibrarySongs", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("GETs /api/songs with the caller's token and normalizes", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ songs: [row] }) }));
    vi.stubGlobal("fetch", fetchMock);
    const songs = await fetchLibrarySongs(async () => "tok-1");
    expect(songs).toHaveLength(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/songs");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok-1");
  });

  it("throws on failure so pickers show an honest error, not a fake empty list", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })));
    await expect(fetchLibrarySongs(async () => null)).rejects.toThrow("500");
  });
});

describe("picked song → File (the fetch→File intake)", () => {
  afterEach(() => vi.unstubAllGlobals());

  const song: LibrarySong = {
    id: row.id, title: "Midnight Crown", audioUrl: row.audio_url,
    source: "master", durationSec: 204, createdAt: null,
  };

  it("names the file from the song title + the blob's real type", () => {
    expect(librarySongFileName(song, "audio/wav")).toBe("Midnight Crown.wav");
    expect(librarySongFileName(song, null)).toBe("Midnight Crown.mp3");
    expect(librarySongFileName({ ...song, title: "Take 2.WAV" }, "audio/mpeg")).toBe("Take 2.WAV");
    expect(librarySongFileName({ ...song, title: 'a/b: "rough"?' }, "audio/mpeg")).toBe("a b rough.mp3");
  });

  it("fetchLibrarySongFile downloads the audio into a File", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true, status: 200,
      blob: async () => new Blob(["bytes"], { type: "audio/mpeg" }),
    })));
    const file = await fetchLibrarySongFile(song);
    expect(file.name).toBe("Midnight Crown.mp3");
    expect(file.type).toBe("audio/mpeg");
    expect(file.size).toBe(5);
  });

  it("fetchLibrarySongFile throws when the download fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 404, blob: async () => new Blob([]) })));
    await expect(fetchLibrarySongFile(song)).rejects.toThrow("404");
  });
});

describe("formatSongDuration", () => {
  it("formats m:ss and hides unknown durations", () => {
    expect(formatSongDuration(204)).toBe("3:24");
    expect(formatSongDuration(65)).toBe("1:05");
    expect(formatSongDuration(null)).toBeNull();
    expect(formatSongDuration(-3)).toBeNull();
  });
});
