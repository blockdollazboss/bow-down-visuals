/**
 * Now-playing studio reporter — pure logic (stack900 lane D3).
 * URL identity for signed library URLs, the DJ-library parse, the
 * program-track resolution, and the reporter's send decisions with
 * injected senders + clock. The fetch glue (createNowPlayingReporter)
 * is exercised by the API suite's REST tests from the other side.
 */
import { describe, expect, it, vi } from "vitest";
import {
  NOW_PLAYING_HEARTBEAT_MS,
  NowPlayingReporter,
  normalizeMediaUrl,
  parseDjLibrary,
  resolveProgramTrack,
  trackReport,
  type LibraryTrackLite,
  type ProgramMediaLite,
} from "./now-playing-reporter";

const CATALOG: LibraryTrackLite[] = [
  { id: "song-1", title: "Midnight Run", audioUrl: "https://cdn.example.com/songs/midnight.mp3?token=AAA", durationSec: 213 },
  { id: "song-2", title: "Second Song", audioUrl: "https://cdn.example.com/songs/second.mp3", durationSec: null },
];

describe("normalizeMediaUrl", () => {
  it("a rotated signed token is the same track; a different path is not", () => {
    expect(normalizeMediaUrl("https://cdn.example.com/songs/midnight.mp3?token=BBB"))
      .toBe(normalizeMediaUrl("https://cdn.example.com/songs/midnight.mp3?token=AAA"));
    expect(normalizeMediaUrl("https://cdn.example.com/songs/other.mp3"))
      .not.toBe(normalizeMediaUrl("https://cdn.example.com/songs/midnight.mp3"));
  });

  it("unparseable URLs still shed their query", () => {
    expect(normalizeMediaUrl("media file.mp3?x=1")).toBe("media file.mp3");
  });
});

describe("parseDjLibrary", () => {
  it("reads the wire shape: string durations, analysis fallback, junk dropped", () => {
    const parsed = parseDjLibrary({
      tracks: [
        { id: "a", title: "One", audioUrl: "https://x/1.mp3", durationSec: "187", analysis: null },
        { id: "b", title: "Two", audioUrl: "https://x/2.mp3", durationSec: null, analysis: { durationSec: 95 } },
        { id: "c", title: "Three", audioUrl: "", durationSec: "10" },
        { title: "No id", audioUrl: "https://x/4.mp3" },
        "junk",
      ],
    });
    expect(parsed).toEqual([
      { id: "a", title: "One", audioUrl: "https://x/1.mp3", durationSec: 187 },
      { id: "b", title: "Two", audioUrl: "https://x/2.mp3", durationSec: 95 },
    ]);
    expect(parseDjLibrary(null)).toEqual([]);
    expect(parseDjLibrary({})).toEqual([]);
  });
});

describe("resolveProgramTrack", () => {
  const media = (over: Partial<ProgramMediaLite>): ProgramMediaLite => ({
    mediaUrl: "https://cdn.example.com/songs/midnight.mp3?token=ZZZ",
    visible: true,
    playing: true,
    ...over,
  });

  it("a visible, playing, library-matched source is the program track", () => {
    expect(resolveProgramTrack([media({})], CATALOG)?.id).toBe("song-1");
  });

  it("hidden, paused, or unmatched sources report nothing", () => {
    expect(resolveProgramTrack([media({ visible: false })], CATALOG)).toBeNull();
    expect(resolveProgramTrack([media({ playing: false })], CATALOG)).toBeNull();
    expect(resolveProgramTrack([media({ mediaUrl: "https://cdn.example.com/clips/intro.mp4" })], CATALOG)).toBeNull();
    expect(resolveProgramTrack([media({ mediaUrl: null })], CATALOG)).toBeNull();
    expect(resolveProgramTrack([], CATALOG)).toBeNull();
  });

  it("scene order breaks ties", () => {
    const two = [
      media({ mediaUrl: "https://cdn.example.com/songs/second.mp3" }),
      media({}),
    ];
    expect(resolveProgramTrack(two, CATALOG)?.id).toBe("song-2");
  });
});

describe("NowPlayingReporter decisions", () => {
  function harness() {
    const post = vi.fn(async () => {});
    const clear = vi.fn(async () => {});
    let now = 1_000_000;
    const reporter = new NowPlayingReporter({ post, clear, now: () => now });
    return { post, clear, reporter, advance: (ms: number) => { now += ms; } };
  }
  const track = trackReport(CATALOG[0]!, "Stage Star");
  const other = trackReport(CATALOG[1]!, "Stage Star");

  it("first sighting posts a start; repeats inside the heartbeat window don't", async () => {
    const { post, reporter, advance } = harness();
    await reporter.observe(track);
    await reporter.observe(track);
    advance(NOW_PLAYING_HEARTBEAT_MS - 1);
    await reporter.observe(track);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it("the heartbeat re-posts the same track once the window lapses", async () => {
    const { post, reporter, advance } = harness();
    await reporter.observe(track);
    advance(NOW_PLAYING_HEARTBEAT_MS);
    await reporter.observe(track);
    expect(post).toHaveBeenCalledTimes(2);
  });

  it("a track change posts immediately, even inside the window", async () => {
    const { post, reporter } = harness();
    await reporter.observe(track);
    await reporter.observe(other);
    expect(post).toHaveBeenCalledTimes(2);
    expect(post.mock.calls[1]![0].title).toBe("Second Song");
  });

  it("silence clears exactly once; dispose after a track clears too", async () => {
    const { clear, reporter } = harness();
    await reporter.observe(null);
    expect(clear).not.toHaveBeenCalled();
    await reporter.observe(track);
    await reporter.observe(null);
    await reporter.observe(null);
    expect(clear).toHaveBeenCalledTimes(1);
    await reporter.observe(track);
    await reporter.dispose();
    expect(clear).toHaveBeenCalledTimes(2);
  });

  it("a failed post marks nothing sent — the next observe retries", async () => {
    const post = vi.fn(async () => { throw new Error("offline"); });
    const clear = vi.fn(async () => {});
    const reporter = new NowPlayingReporter({ post, clear, now: () => 0 });
    await reporter.observe(track);
    await reporter.observe(track);
    expect(post).toHaveBeenCalledTimes(2);
  });
});
