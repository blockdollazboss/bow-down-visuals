import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Readable } from "node:stream";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("node:v8", () => ({
  getHeapStatistics: vi.fn(),
  getHeapSnapshot: vi.fn(),
}));

vi.mock("../logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("../objectStorage", () => ({
  SUPABASE_CLIPS_BUCKET: "generated-clips",
  uploadFileStreamToSupabaseStorage: vi.fn(
    async (_bucket: string, objectName: string) =>
      `supabase://generated-clips/${objectName}`,
  ),
}));

import { getHeapStatistics, getHeapSnapshot } from "node:v8";
import { logger } from "../logger";
import { uploadFileStreamToSupabaseStorage } from "../objectStorage";

const MB = 1024 * 1024;
const HEAP_LIMIT = 400 * MB;

let heapUsedBytes = 0;
let rssBytes = 100 * MB;
let snapshotDir = "";
let memoryUsageSpy: ReturnType<typeof vi.spyOn>;

function fakeMemoryUsage(): NodeJS.MemoryUsage {
  return {
    rss: rssBytes,
    heapTotal: 300 * MB,
    heapUsed: heapUsedBytes,
    external: 10 * MB,
    arrayBuffers: 1 * MB,
  };
}

async function loadWatchdog() {
  vi.resetModules();
  return import("../memory-watchdog");
}

beforeEach(async () => {
  vi.clearAllMocks();
  heapUsedBytes = 100 * MB;
  rssBytes = 100 * MB;
  snapshotDir = await mkdtemp(join(tmpdir(), "watchdog-test-"));
  process.env["HEAP_SNAPSHOT_DIR"] = snapshotDir;
  vi.mocked(getHeapStatistics).mockReturnValue({
    heap_size_limit: HEAP_LIMIT,
  } as ReturnType<typeof getHeapStatistics>);
  vi.mocked(getHeapSnapshot).mockImplementation(() =>
    Readable.from([Buffer.from("fake-heapsnapshot")]),
  );
  memoryUsageSpy = vi
    .spyOn(process, "memoryUsage")
    .mockImplementation(fakeMemoryUsage);
});

afterEach(async () => {
  memoryUsageSpy.mockRestore();
  delete process.env["HEAP_SNAPSHOT_DIR"];
  await rm(snapshotDir, { recursive: true, force: true });
});

describe("memory watchdog heap-ratio escalation", () => {
  it("logs info with heapLimitMb + heapRatio at a calm ratio, no snapshot", async () => {
    heapUsedBytes = HEAP_LIMIT * 0.5;
    const wd = await loadWatchdog();
    wd.runMemoryWatchdogTick();
    expect(logger.info).toHaveBeenCalledTimes(1);
    const fields = vi.mocked(logger.info).mock.calls[0]![0] as Record<
      string,
      number
    >;
    expect(fields.heapLimitMb).toBe(400);
    expect(fields.heapRatio).toBe(0.5);
    // Original diary fields unchanged.
    expect(fields.rssMb).toBe(100);
    expect(fields.budgetMb).toBe(512);
    expect(getHeapSnapshot).not.toHaveBeenCalled();
  });

  it("warns at heapRatio >= 0.75 without capturing", async () => {
    heapUsedBytes = HEAP_LIMIT * 0.76;
    const wd = await loadWatchdog();
    wd.runMemoryWatchdogTick();
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(vi.mocked(logger.warn).mock.calls[0]![1]).toContain("75%");
    expect(getHeapSnapshot).not.toHaveBeenCalled();
  });

  it("errors at heapRatio >= 0.90", async () => {
    heapUsedBytes = HEAP_LIMIT * 0.95;
    const wd = await loadWatchdog();
    wd.runMemoryWatchdogTick();
    expect(logger.error).toHaveBeenCalled();
    expect(vi.mocked(logger.error).mock.calls[0]![1]).toContain("90%");
    // Settle the triggered capture so nothing leaks into other tests.
    await wd.getInflightSnapshotCapture();
  });

  it("keeps the original RSS warn when the heap is calm", async () => {
    heapUsedBytes = HEAP_LIMIT * 0.5;
    rssBytes = 500 * MB; // > 80% of the 512 MB container budget
    const wd = await loadWatchdog();
    wd.runMemoryWatchdogTick();
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(vi.mocked(logger.warn).mock.calls[0]![1]).toContain(
      "RSS above 80%",
    );
    expect(getHeapSnapshot).not.toHaveBeenCalled();
  });
});

describe("memory watchdog heap snapshot", () => {
  it("does not capture on a single high tick — the climb must be sustained", async () => {
    heapUsedBytes = HEAP_LIMIT * 0.93;
    const wd = await loadWatchdog();

    wd.runMemoryWatchdogTick();
    expect(wd.getInflightSnapshotCapture()).toBeNull();
    expect(getHeapSnapshot).not.toHaveBeenCalled();

    // A fall-back between high ticks resets the confirmation.
    heapUsedBytes = HEAP_LIMIT * 0.5;
    wd.runMemoryWatchdogTick();
    heapUsedBytes = HEAP_LIMIT * 0.93;
    wd.runMemoryWatchdogTick();
    expect(getHeapSnapshot).not.toHaveBeenCalled();
  });

  it("does not capture at the old 0.85 trigger line", async () => {
    heapUsedBytes = HEAP_LIMIT * 0.87;
    const wd = await loadWatchdog();
    wd.runMemoryWatchdogTick();
    wd.runMemoryWatchdogTick();
    wd.runMemoryWatchdogTick();
    expect(getHeapSnapshot).not.toHaveBeenCalled();
  });

  it("captures exactly once on a sustained climb at >= 0.92, uploads it, and never re-captures", async () => {
    heapUsedBytes = HEAP_LIMIT * 0.93;
    const wd = await loadWatchdog();

    wd.runMemoryWatchdogTick();
    wd.runMemoryWatchdogTick();
    const inflight = wd.getInflightSnapshotCapture();
    expect(inflight).not.toBeNull();
    await inflight;

    expect(getHeapSnapshot).toHaveBeenCalledTimes(1);
    expect(uploadFileStreamToSupabaseStorage).toHaveBeenCalledTimes(1);
    const uploadArgs = vi.mocked(uploadFileStreamToSupabaseStorage).mock
      .calls[0]!;
    expect(uploadArgs[0]).toBe("generated-clips");
    expect(uploadArgs[1]).toMatch(/^diagnostics\/heap-\d+-.*\.heapsnapshot$/);
    // Temp file was cleaned up after a successful upload.
    expect(await readdir(snapshotDir)).toHaveLength(0);
    // The capture is announced at error level with its storage ref.
    const errorMsgs = vi
      .mocked(logger.error)
      .mock.calls.map((c) => String(c[1]));
    expect(errorMsgs.some((m) => m.includes("captured to storage"))).toBe(
      true,
    );

    // Further high ticks do not re-capture.
    wd.runMemoryWatchdogTick();
    await wd.getInflightSnapshotCapture();
    expect(getHeapSnapshot).toHaveBeenCalledTimes(1);
    expect(uploadFileStreamToSupabaseStorage).toHaveBeenCalledTimes(1);
  });

  it("abandons the capture if the heap fell back below 0.88 before the stream opens, and stays armed", async () => {
    let calls = 0;
    memoryUsageSpy.mockImplementation(() => {
      calls += 1;
      // The two confirming ticks are high; the re-sample at capture
      // open has fallen back.
      return { ...fakeMemoryUsage(), heapUsed: calls <= 2 ? HEAP_LIMIT * 0.93 : HEAP_LIMIT * 0.5 };
    });
    const wd = await loadWatchdog();
    wd.runMemoryWatchdogTick();
    wd.runMemoryWatchdogTick();
    await wd.getInflightSnapshotCapture();
    expect(getHeapSnapshot).not.toHaveBeenCalled();

    // Still armed: a later sustained climb captures.
    memoryUsageSpy.mockImplementation(fakeMemoryUsage);
    heapUsedBytes = HEAP_LIMIT * 0.93;
    wd.runMemoryWatchdogTick();
    await wd.getInflightSnapshotCapture();
    expect(getHeapSnapshot).toHaveBeenCalledTimes(1);
  });
});

describe("memory watchdog critical line", () => {
  it("fires the registered handler after 2 consecutive ticks at >= 0.96 — once, and with no snapshot", async () => {
    heapUsedBytes = HEAP_LIMIT * 0.97;
    const wd = await loadWatchdog();
    const handler = vi.fn();
    wd.setMemoryCriticalHandler(handler);

    wd.runMemoryWatchdogTick();
    expect(handler).not.toHaveBeenCalled();
    wd.runMemoryWatchdogTick();
    expect(handler).toHaveBeenCalledTimes(1);
    // One-shot: further critical ticks do not re-fire.
    wd.runMemoryWatchdogTick();
    expect(handler).toHaveBeenCalledTimes(1);
    // The restart outranks the diagnosis: no snapshot was taken.
    expect(getHeapSnapshot).not.toHaveBeenCalled();
    const errorMsgs = vi
      .mocked(logger.error)
      .mock.calls.map((c) => String(c[1]));
    expect(errorMsgs.some((m) => m.includes("CRITICAL"))).toBe(true);
  });

  it("does not fire on a single critical tick, and a fall-back resets the count", async () => {
    heapUsedBytes = HEAP_LIMIT * 0.97;
    const wd = await loadWatchdog();
    const handler = vi.fn();
    wd.setMemoryCriticalHandler(handler);

    wd.runMemoryWatchdogTick();
    heapUsedBytes = HEAP_LIMIT * 0.5;
    wd.runMemoryWatchdogTick();
    heapUsedBytes = HEAP_LIMIT * 0.97;
    wd.runMemoryWatchdogTick();
    expect(handler).not.toHaveBeenCalled();
  });

  it("fires on sustained RSS at >= 98% of the container budget even with a calm heap", async () => {
    heapUsedBytes = HEAP_LIMIT * 0.4;
    rssBytes = 510 * MB; // >= 98% of the 512 MB budget
    const wd = await loadWatchdog();
    const handler = vi.fn();
    wd.setMemoryCriticalHandler(handler);

    wd.runMemoryWatchdogTick();
    wd.runMemoryWatchdogTick();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("exits the process when no handler is registered", async () => {
    heapUsedBytes = HEAP_LIMIT * 0.97;
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((() => undefined) as never);
    try {
      const wd = await loadWatchdog();
      wd.runMemoryWatchdogTick();
      wd.runMemoryWatchdogTick();
      expect(exitSpy).toHaveBeenCalledWith(1);
    } finally {
      exitSpy.mockRestore();
    }
  });
});
