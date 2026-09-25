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

/** Minimal fake Demucs child process: captures "close"/"error" listeners. */
function fakeChild() {
  const handlers: Record<string, Array<(...args: any[]) => void>> = {};
  const child: any = {
    stderr: { on: vi.fn() },
    kill: vi.fn(),
    on: vi.fn((ev: string, cb: (...args: any[]) => void) => {
      (handlers[ev] ??= []).push(cb);
      return child;
    }),
    emitForTest: (ev: string, ...args: any[]) => handlers[ev]?.forEach((cb) => cb(...args)),
  };
  return child;
}

describe("separateVocalStems model override", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("passes the caller-supplied model to the Demucs spawn args", async () => {
    const child = fakeChild();
    vi.mocked(spawn).mockReturnValue(child);
    const p = separateVocalStems(Buffer.from("fake-audio"), { model: "htdemucs" });
    // spawn happens after the mocked fs awaits — wait for it first.
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledOnce());
    child.emitForTest("close", 0);
    await p;
    expect(spawn).toHaveBeenCalledOnce();
    const args = vi.mocked(spawn).mock.calls[0][1] as string[];
    expect(args).toContain("-n");
    expect(args[args.indexOf("-n") + 1]).toBe("htdemucs");
  });

  it("defaults to the standard model when no override is given", async () => {
    const child = fakeChild();
    vi.mocked(spawn).mockReturnValue(child);
    const p = separateVocalStems(Buffer.from("fake-audio"));
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledOnce());
    child.emitForTest("close", 0);
    await p;
    const args = vi.mocked(spawn).mock.calls[0][1] as string[];
    // DEMUCS_MODEL env is unset in tests, so the code default applies.
    expect(args[args.indexOf("-n") + 1]).toBe("mdx_extra_q");
  });
});
