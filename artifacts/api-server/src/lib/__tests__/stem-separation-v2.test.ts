/**
 * Tests for the v2 vocal isolation improvements (2026-09-25):
 *  - findBestVocalWindowStartSeconds picks the window with the most vocal
 *    activity (center-channel vocal-band energy), not just the loudest;
 *  - the ebur128 scan no longer uses framelog=quiet (which suppressed the
 *    frame logs on ffmpeg 8+, silently degrading to window start 0);
 *  - postProcessVocalStem normalizes + silence-trims for IVC input;
 *  - FROM_SONG_WINDOW_STRATEGY env override (vocal default, loudest legacy).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:child_process", () => ({ spawn: vi.fn() }));
vi.mock("node:fs", () => ({
  promises: {
    mkdtemp: vi.fn(async () => "/tmp/stems-test"),
    writeFile: vi.fn(async () => {}),
    access: vi.fn(async () => {}),
    rm: vi.fn(async () => {}),
  },
}));

import { spawn } from "node:child_process";
import {
  findBestVocalWindowStartSeconds,
  findLoudestWindowStartSeconds,
  postProcessVocalStem,
  trimSongToBestWindow,
} from "../stem-separation";
import { resolveFromSongWindowStrategy } from "../../routes/artist-voices";

function scriptedChild(stdoutText = "", stderrText = "") {
  const dataHandlers: Record<"stdout" | "stderr", Array<(d: Buffer) => void>> = {
    stdout: [],
    stderr: [],
  };
  const closeHandlers: Array<(code: number) => void> = [];
  const mkStream = (name: "stdout" | "stderr") => ({
    on: vi.fn((ev: string, cb: (d: Buffer) => void) => {
      if (ev === "data") dataHandlers[name].push(cb);
      return mkStream(name);
    }),
  });
  const child: any = {
    stdout: mkStream("stdout"),
    stderr: mkStream("stderr"),
    kill: vi.fn(),
    on: vi.fn((ev: string, cb: (...args: any[]) => void) => {
      if (ev === "close") closeHandlers.push(cb as (code: number) => void);
      return child;
    }),
    finish: (code = 0) => {
      for (const h of dataHandlers.stdout) h(Buffer.from(stdoutText));
      for (const h of dataHandlers.stderr) h(Buffer.from(stderrText));
      for (const h of closeHandlers) h(code);
    },
  };
  return child;
}

/** Build fake ebur128 stderr: rows of [startSec, endSec, M] at 10s steps. */
function eburStderr(segs: Array<[number, number, string]>): string {
  const lines: string[] = [];
  for (const [s, e, m] of segs) {
    for (let t = s; t < e; t += 10) {
      lines.push(
        `[Parsed_ebur128_0 @ 0x123] t: ${t.toFixed(1)}  TARGET:-23 LUFS    M: ${m} S: ${m}     I: -70.0 LUFS`,
      );
    }
  }
  return lines.join("\n");
}

function spawnCalls() {
  return vi.mocked(spawn).mock.calls.map((c) => ({ bin: c[0], args: c[1] as string[] }));
}

describe("findBestVocalWindowStartSeconds", () => {
  beforeEach(() => {
    vi.mocked(spawn).mockReset();
  });

  it("picks the window with the most vocal-band center energy", async () => {
    // 0-60s: instrumental (low vocal-band energy), 60-150s: vocals, 150-240s: quiet.
    // Loudest-window would also pick 60s here, but the filter chain must be the vocal one.
    const child = scriptedChild(
      "",
      eburStderr([
        [0, 60, "-40.0"],
        [60, 150, "-18.0"],
        [150, 240, "-45.0"],
      ]),
    );
    vi.mocked(spawn).mockReturnValue(child as any);
    const p = findBestVocalWindowStartSeconds("/tmp/song.mp3", 90);
    child.finish(0);
    expect(await p).toBe(60);
    const { args } = spawnCalls()[0];
    const af = args[args.indexOf("-af") + 1];
    // Vocal-band center-channel chain, not plain ebur128
    expect(af).toContain("pan=mono");
    expect(af).toContain("highpass=f=200");
    expect(af).toContain("lowpass=f=4000");
    expect(af).toContain("ebur128");
    expect(af).not.toContain("framelog=quiet");
  });

  it("prefers vocal sections over a louder instrumental drop", async () => {
    // 0-90s: loud instrumental drop (-10), 90-180s: slightly quieter but
    // vocal-forward verse (-14). Vocal-band energy is what matters here —
    // the scan sees the vocal band, so the verse wins despite lower loudness.
    const child = scriptedChild(
      "",
      eburStderr([
        [0, 90, "-25.0"], // low vocal-band energy in the drop
        [90, 180, "-14.0"], // high vocal-band energy in the verse
        [180, 240, "-40.0"],
      ]),
    );
    vi.mocked(spawn).mockReturnValue(child as any);
    const p = findBestVocalWindowStartSeconds("/tmp/song.mp3", 90);
    child.finish(0);
    expect(await p).toBe(90);
  });

  it("falls back to 0 when the scan is unparseable", async () => {
    const child = scriptedChild("", "garbage output");
    vi.mocked(spawn).mockReturnValue(child as any);
    const p = findBestVocalWindowStartSeconds("/tmp/song.mp3", 90);
    child.finish(0);
    expect(await p).toBe(0);
  });
});

describe("ebur128 framelog fix", () => {
  beforeEach(() => {
    vi.mocked(spawn).mockReset();
  });

  it("findLoudestWindowStartSeconds does not use framelog=quiet", async () => {
    const child = scriptedChild("", eburStderr([[0, 240, "-15.0"]]));
    vi.mocked(spawn).mockReturnValue(child as any);
    const p = findLoudestWindowStartSeconds("/tmp/song.mp3", 90);
    child.finish(0);
    await p;
    const { args } = spawnCalls()[0];
    const af = args[args.indexOf("-af") + 1];
    expect(af).not.toContain("framelog=quiet");
    expect(af).toContain("ebur128");
  });
});

describe("trimSongToBestWindow", () => {
  beforeEach(() => {
    vi.mocked(spawn).mockReset();
  });

  async function runBestWindow(strategy: "vocal" | "loudest") {
    const probe = scriptedChild("240.0\n", "");
    const scan = scriptedChild("", eburStderr([[0, 240, "-15.0"]]));
    const trim = scriptedChild("", "");
    vi.mocked(spawn)
      .mockReturnValueOnce(probe as any)
      .mockReturnValueOnce(scan as any)
      .mockReturnValueOnce(trim as any);
    const p = trimSongToBestWindow("/tmp/song.mp3", "/tmp/wd", 90, strategy);
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(1));
    probe.finish(0);
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(2));
    scan.finish(0);
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(3));
    trim.finish(0);
    return { result: await p, calls: spawnCalls() };
  }

  it("uses the vocal-band filter chain for the vocal strategy", async () => {
    const { calls } = await runBestWindow("vocal");
    const af = calls[1].args[calls[1].args.indexOf("-af") + 1];
    expect(af).toContain("pan=mono");
    expect(af).toContain("highpass");
  });

  it("uses plain ebur128 for the loudest strategy", async () => {
    const { calls } = await runBestWindow("loudest");
    const af = calls[1].args[calls[1].args.indexOf("-af") + 1];
    expect(af).not.toContain("pan=mono");
    expect(af).toContain("ebur128");
  });
});

describe("postProcessVocalStem", () => {
  beforeEach(() => {
    vi.mocked(spawn).mockReset();
  });

  it("loudness-normalizes, de-bleeds, and silence-trims the vocal stem", async () => {
    const child = scriptedChild("", "");
    vi.mocked(spawn).mockReturnValue(child as any);
    const p = postProcessVocalStem("/tmp/wd/vocals.wav", "/tmp/wd");
    child.finish(0);
    const out = await p;
    expect(out).toContain("vocals-ivc.wav");
    const { args } = spawnCalls()[0];
    const af = args[args.indexOf("-af") + 1];
    expect(af).toContain("loudnorm");
    expect(af).toContain("lowpass");
    expect(af).toContain("silenceremove");
    // Mono output for IVC
    expect(args[args.indexOf("-ac") + 1]).toBe("1");
  });
});

describe("FROM_SONG_WINDOW_STRATEGY", () => {
  it("defaults to vocal", () => {
    expect(resolveFromSongWindowStrategy({} as any)).toBe("vocal");
  });

  it("accepts loudest explicitly", () => {
    const env = { FROM_SONG_WINDOW_STRATEGY: "loudest" } as any;
    expect(resolveFromSongWindowStrategy(env)).toBe("loudest");
  });

  it("falls back to vocal on invalid values", () => {
    const env = { FROM_SONG_WINDOW_STRATEGY: "bogus" } as any;
    expect(resolveFromSongWindowStrategy(env)).toBe("vocal");
  });
});
