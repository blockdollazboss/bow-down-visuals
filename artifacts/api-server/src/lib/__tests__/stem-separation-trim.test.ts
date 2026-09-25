/**
 * Pre-trim tests for the from-song voice-clone path: when `trimSeconds` is
 * set, ffmpeg must cut the song down to its loudest window BEFORE Demucs
 * runs (Demucs on a full-length song timed out after 10 min on the 2GB
 * Render box, 2026-09-25). Covers:
 *  - trim is invoked before Demucs, and Demucs receives the trimmed file;
 *  - the loudest window is selected (skips quiet intros);
 *  - the window is clamped so it never runs past the end of the song;
 *  - short files pass through to Demucs untrimmed;
 *  - a failed duration probe falls back to the old full-file behavior;
 *  - an unparseable loudness scan falls back to the start of the file;
 *  - the trimSeconds option controls the window length.
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
import { separateVocalStems } from "../stem-separation";

/**
 * Fake child process with scripted stdout/stderr: `finish(code)` flushes the
 * scripted stream data to "data" listeners, then fires "close" listeners.
 */
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

/** Build fake ebur128 output: sections of [startSec, endSec, momentaryLUFS]. */
function eburStderr(sections: Array<[number, number, string]>): string {
  const lines: string[] = [];
  for (const [s, e, m] of sections) {
    for (let t = s; t < e; t++) {
      lines.push(
        `[Parsed_ebur128_0 @ 0xabc] t: ${t.toFixed(1)}          M: ${m}           S: ${m}           I: -70.0 LUFS       LRA:   0.0 LU`,
      );
    }
  }
  return lines.join("\n");
}

const spawnCalls = () =>
  vi.mocked(spawn).mock.calls.map(([bin, args]) => ({ bin, args: args as string[] }));
const argAfter = (args: string[], flag: string) => args[args.indexOf(flag) + 1];

describe("separateVocalStems trimSeconds (from-song pre-trim)", () => {
  beforeEach(() => {
    vi.mocked(spawn).mockReset();
  });

  /**
   * Drive the 4-spawn trim flow: ffprobe -> ebur128 scan -> ffmpeg trim ->
   * demucs. Returns the promise plus the spawned children for assertions.
   */
  async function runTrimFlow(eburText: string, durationStdout = "240.0\n", trimSecs = 90) {
    const probe = scriptedChild(durationStdout, "");
    const loud = scriptedChild("", eburText);
    const trim = scriptedChild("", "");
    const demucs = scriptedChild("", "");
    vi.mocked(spawn)
      .mockReturnValueOnce(probe as any)
      .mockReturnValueOnce(loud as any)
      .mockReturnValueOnce(trim as any)
      .mockReturnValueOnce(demucs as any);
    const p = separateVocalStems(Buffer.from("fake-audio"), {
      model: "htdemucs",
      trimSeconds: trimSecs,
    });
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(1));
    probe.finish(0);
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(2));
    loud.finish(0);
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(3));
    trim.finish(0);
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(4));
    demucs.finish(0);
    const result = await p;
    return { result, calls: spawnCalls() };
  }

  it("trims the loudest window BEFORE Demucs runs, and Demucs reads the trimmed file", async () => {
    // 0-30s silence, 30-120s loud chorus, 120-240s quiet: window must start at 30s.
    const { result, calls } = await runTrimFlow(
      eburStderr([
        [0, 30, "-inf"],
        [30, 120, "-12.0"],
        [120, 240, "-40.0"],
      ]),
    );

    expect(calls).toHaveLength(4);
    // 1: duration probe
    expect(calls[0].bin).toBe("ffprobe");
    // 2: loudness scan
    expect(calls[1].bin).toBe("ffmpeg");
    expect(calls[1].args.join(" ")).toContain("ebur128");
    // 3: the trim — must happen BEFORE Demucs (call 4)
    expect(calls[2].bin).toBe("ffmpeg");
    expect(argAfter(calls[2].args, "-ss")).toBe("30.00");
    expect(argAfter(calls[2].args, "-t")).toBe("90.00");
    expect(calls[2].args[calls[2].args.length - 1]).toContain("song-trim.wav");
    // 4: Demucs on the trimmed file, lighter model intact
    expect(calls[3].bin).toBe("python3");
    expect(argAfter(calls[3].args, "-n")).toBe("htdemucs");
    const demucsInput = calls[3].args[calls[3].args.length - 1];
    expect(demucsInput).toContain("song-trim.wav");
    // Stems resolve under the trimmed basename
    expect(result.vocalsPath).toContain("song-trim");
  });

  it("clamps the window so it never runs past the end of the song", async () => {
    // Loud only in the last 40s of a 240s song: raw best start (200s) must
    // clamp to duration - window = 150s.
    const { calls } = await runTrimFlow(
      eburStderr([
        [0, 200, "-40.0"],
        [200, 240, "-12.0"],
      ]),
    );
    expect(argAfter(calls[2].args, "-ss")).toBe("150.00");
    expect(argAfter(calls[2].args, "-t")).toBe("90.00");
  });

  it("respects the trimSeconds option for the window length", async () => {
    const { calls } = await runTrimFlow(
      eburStderr([
        [0, 30, "-inf"],
        [30, 240, "-12.0"],
      ]),
      "240.0\n",
      45,
    );
    expect(argAfter(calls[2].args, "-ss")).toBe("30.00");
    expect(argAfter(calls[2].args, "-t")).toBe("45.00");
  });

  it("passes short files straight to Demucs with no trim", async () => {
    const probe = scriptedChild("45.0\n", "");
    const demucs = scriptedChild("", "");
    vi.mocked(spawn).mockReturnValueOnce(probe as any).mockReturnValue(demucs as any);

    const p = separateVocalStems(Buffer.from("fake-audio"), {
      model: "htdemucs",
      trimSeconds: 90,
    });
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(1));
    probe.finish(0);
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(2));
    demucs.finish(0);
    await p;

    const calls = spawnCalls();
    expect(calls).toHaveLength(2);
    expect(calls[0].bin).toBe("ffprobe");
    expect(calls[1].bin).toBe("python3");
    expect(calls[1].args[calls[1].args.length - 1]).toContain("song.mp3");
    expect(calls.some((c) => c.args.includes("-ss"))).toBe(false);
  });

  it("falls back to the full file when the duration probe fails", async () => {
    const probe = scriptedChild("", "boom");
    const demucs = scriptedChild("", "");
    vi.mocked(spawn).mockReturnValueOnce(probe as any).mockReturnValue(demucs as any);

    const p = separateVocalStems(Buffer.from("fake-audio"), {
      model: "htdemucs",
      trimSeconds: 90,
    });
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(1));
    probe.finish(1); // ffprobe error
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(2));
    demucs.finish(0);
    await p;

    const calls = spawnCalls();
    expect(calls).toHaveLength(2);
    expect(calls[1].bin).toBe("python3");
    expect(calls[1].args[calls[1].args.length - 1]).toContain("song.mp3");
  });

  it("falls back to the start of the file when the loudness scan is unparseable", async () => {
    const { calls } = await runTrimFlow("this is not ebur128 output\nnope\n");
    expect(calls).toHaveLength(4);
    expect(argAfter(calls[2].args, "-ss")).toBe("0.00");
    expect(argAfter(calls[2].args, "-t")).toBe("90.00");
  });

  it("does not trim when trimSeconds is unset (lip-sync / voice-swap paths)", async () => {
    const demucs = scriptedChild("", "");
    vi.mocked(spawn).mockReturnValue(demucs as any);
    const p = separateVocalStems(Buffer.from("fake-audio"), { model: "mdx_extra_q" });
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledOnce());
    demucs.finish(0);
    const result = await p;
    expect(spawn).toHaveBeenCalledOnce();
    expect(spawnCalls()[0].bin).toBe("python3");
    expect(result.vocalsPath).toContain("song");
  });
});
