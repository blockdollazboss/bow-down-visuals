/**
 * Tests for lib/library-song.ts — the shared "record a finished output in
 * the caller's song library" insert (linkage fix, audit DE-6).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const state = vi.hoisted(() => ({
  inserted: [] as any[],
  failInsert: false,
}));

vi.mock("@workspace/db", () => {
  const songsTable = { __table: "songs", id: "id" };
  return {
    songsTable,
    db: {
      insert: vi.fn(() => ({
        values: (v: any) => {
          state.inserted.push(v);
          return {
            returning: async () => {
              if (state.failInsert) throw new Error("db down");
              return [{ id: "song-new-1" }];
            },
          };
        },
      })),
    },
  };
});

import { librarySongTitle, recordLibrarySong, uuidOrNull } from "../library-song";

beforeEach(() => {
  state.inserted = [];
  state.failInsert = false;
});

describe("recordLibrarySong", () => {
  it("inserts the canonical songs-row shape and returns the new id", async () => {
    const id = await recordLibrarySong({
      userId: "user-1",
      title: "Midnight Run (Master)",
      audioUrl: "https://cdn.example/master.mp3",
      audioPath: "ref:master.mp3",
      source: "master",
      parentSongId: "123e4567-e89b-12d3-a456-426614174000",
      durationSec: 187.4,
    });
    expect(id).toBe("song-new-1");
    expect(state.inserted).toEqual([
      {
        user_id: "user-1",
        title: "Midnight Run (Master)",
        audio_url: "https://cdn.example/master.mp3",
        audio_path: "ref:master.mp3",
        source: "master",
        parent_song_id: "123e4567-e89b-12d3-a456-426614174000",
        artist_vault_id: null,
        duration_sec: "187",
      },
    ]);
  });

  it("a malformed parent id becomes null instead of a failed FK insert", async () => {
    await recordLibrarySong({
      userId: "user-1",
      title: "X (Cleaned)",
      audioUrl: "https://cdn.example/x.mp3",
      source: "cleanup",
      parentSongId: "not-a-uuid",
    });
    expect(state.inserted[0].parent_song_id).toBeNull();
    expect(state.inserted[0].audio_path).toBeNull();
    expect(state.inserted[0].duration_sec).toBeNull();
  });

  it("a failed insert returns null (the delivered job must not fail with it)", async () => {
    state.failInsert = true;
    const id = await recordLibrarySong({
      userId: "user-1",
      title: "X (Master)",
      audioUrl: "https://cdn.example/x.mp3",
      source: "master",
    });
    expect(id).toBeNull();
  });
});

describe("librarySongTitle / uuidOrNull", () => {
  it("strips the extension and appends the pass suffix", () => {
    expect(librarySongTitle("My Song (rough).mp3", "Master")).toBe("My Song (rough) (Master)");
    expect(librarySongTitle("take2.WAV", "Cleaned")).toBe("take2 (Cleaned)");
    expect(librarySongTitle("", "Mix")).toBe("Untitled (Mix)");
  });

  it("uuidOrNull passes real uuids only", () => {
    expect(uuidOrNull("123e4567-e89b-12d3-a456-426614174000")).toBe("123e4567-e89b-12d3-a456-426614174000");
    expect(uuidOrNull("song-42")).toBeNull();
    expect(uuidOrNull(null)).toBeNull();
    expect(uuidOrNull(undefined)).toBeNull();
  });
});
