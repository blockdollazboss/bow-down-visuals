/**
 * Unit tests for the VOD recorder (stream-recorder.ts) with a fake
 * MediaRecorder: mime preference order, chunk assembly through the
 * memory sink, and the failure contract — a poisoned write marks the
 * recording failed and stop() returns null (the studio must then tell
 * the creator the recording didn't save, never fake it).
 */
import { describe, it, expect, vi } from "vitest";
import {
  StreamRecorder,
  MemoryChunkSink,
  pickRecorderMimeType,
  type ChunkSink,
} from "./stream-recorder";

class FakeMediaRecorder {
  static last: FakeMediaRecorder | null = null;
  static supported = new Set<string>(["video/webm;codecs=vp8,opus", "video/webm"]);
  static isTypeSupported = (m: string) => FakeMediaRecorder.supported.has(m);
  state: string = "inactive";
  mimeType: string;
  ondataavailable: ((ev: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  timeslice: number | undefined;

  constructor(_stream: unknown, opts?: { mimeType?: string }) {
    this.mimeType = opts?.mimeType ?? "";
    FakeMediaRecorder.last = this;
  }
  start(timeslice?: number) {
    this.state = "recording";
    this.timeslice = timeslice;
  }
  stop() {
    if (this.state === "inactive") return;
    this.state = "inactive";
    // Real MediaRecorder fires a final dataavailable before stop; the
    // fake leaves chunk emission to the test for determinism.
    this.onstop?.();
  }
  emit(text: string) {
    this.ondataavailable?.({ data: new Blob([text]) });
  }
}

const fakeStream = () => ({ getTracks: () => [] }) as unknown as MediaStream;

describe("pickRecorderMimeType", () => {
  it("walks the house preference order (vp9 → vp8 → plain webm)", () => {
    expect(pickRecorderMimeType(() => true)).toBe("video/webm;codecs=vp9,opus");
    expect(pickRecorderMimeType((m) => m !== "video/webm;codecs=vp9,opus")).toBe("video/webm;codecs=vp8,opus");
    expect(pickRecorderMimeType((m) => m === "video/webm")).toBe("video/webm");
    expect(pickRecorderMimeType(() => false)).toBe("");
  });
});

describe("StreamRecorder", () => {
  it("records chunks through the sink and finalizes one typed Blob", async () => {
    const sink = new MemoryChunkSink();
    const recorder = new StreamRecorder({
      mediaRecorderImpl: FakeMediaRecorder as never,
      sink,
    });
    // vp9 unsupported by the fake, vp8 is: picker lands on vp8.
    expect(recorder.mimeType).toBe("video/webm;codecs=vp8,opus");

    await recorder.start(fakeStream(), 1000);
    const mr = FakeMediaRecorder.last!;
    expect(mr.state).toBe("recording");
    expect(mr.timeslice).toBe(1000);
    expect(recorder.sinkKind).toBe("memory");

    mr.emit("chunk-one-");
    mr.emit("chunk-two");
    const out = await recorder.stop();
    expect(out).not.toBeNull();
    expect(out!.mimeType).toBe("video/webm;codecs=vp8,opus");
    expect(out!.blob.size).toBe("chunk-one-chunk-two".length);
    expect(await out!.blob.text()).toBe("chunk-one-chunk-two");
    expect(recorder.failed).toBe(false);
  });

  it("a failed chunk write poisons the recording: stop() returns null and onError fires", async () => {
    const onError = vi.fn();
    const badSink: ChunkSink = {
      write: async () => {
        throw new Error("disk full");
      },
      finalize: async () => new Blob(["should not happen"]),
      abort: async () => undefined,
    };
    const recorder = new StreamRecorder({
      mediaRecorderImpl: FakeMediaRecorder as never,
      sink: badSink,
      onError,
    });
    await recorder.start(fakeStream());
    const mr = FakeMediaRecorder.last!;
    mr.emit("doomed chunk");
    // The write rejection lands on a microtask.
    await new Promise((r) => setTimeout(r, 0));
    expect(recorder.failed).toBe(true);
    expect(onError).toHaveBeenCalledTimes(1);
    await expect(recorder.stop()).resolves.toBeNull();
  });

  it("warns once when a memory-held recording passes the size cap", async () => {
    const onWarning = vi.fn();
    const sink = new MemoryChunkSink();
    const recorder = new StreamRecorder({
      mediaRecorderImpl: FakeMediaRecorder as never,
      sink,
      memoryWarnBytes: 4,
      onWarning,
    });
    await recorder.start(fakeStream());
    const mr = FakeMediaRecorder.last!;
    mr.emit("12");
    mr.emit("345"); // bytes 5 > 4 → warn
    mr.emit("678"); // no second warning
    await new Promise((r) => setTimeout(r, 0));
    expect(onWarning).toHaveBeenCalledTimes(1);
    await recorder.stop();
  });

  it("stop() before start() resolves null", async () => {
    const recorder = new StreamRecorder({ mediaRecorderImpl: FakeMediaRecorder as never });
    await expect(recorder.stop()).resolves.toBeNull();
  });
});
