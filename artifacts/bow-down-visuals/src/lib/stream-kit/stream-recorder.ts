/**
 * stream-recorder.ts — the broadcaster-side VOD recorder.
 *
 * While a stream is live, the studio records the SAME processed feed it
 * publishes (kit picture + cleaned voice) with MediaRecorder. Chunks land
 * in a ChunkSink as they arrive — OPFS (Origin Private File System) when
 * the browser offers it, so a two-hour stream never sits in RAM; memory
 * only as the fallback, with a size warning once it grows past the cap.
 * On stop, the sink finalizes to a single Blob the studio uploads through
 * the site's storage path and registers on the stream (POST /live-streams/:id/vod).
 *
 * Failure honesty: if a sink write fails mid-recording, the recorder
 * marks itself failed and stops collecting (the live broadcast is never
 * disturbed) — the studio then tells the creator the recording didn't
 * save instead of pretending otherwise.
 */

export interface ChunkSink {
  write: (chunk: Blob) => Promise<void>;
  finalize: (mimeType: string) => Promise<Blob>;
  abort: () => Promise<void>;
}

export class MemoryChunkSink implements ChunkSink {
  private _chunks: Blob[] = [];
  bytes = 0;
  async write(chunk: Blob): Promise<void> {
    this._chunks.push(chunk);
    this.bytes += chunk.size;
  }
  async finalize(mimeType: string): Promise<Blob> {
    return new Blob(this._chunks, { type: mimeType });
  }
  async abort(): Promise<void> {
    this._chunks = [];
    this.bytes = 0;
  }
}

interface OpfsRoot {
  getFileHandle: (name: string, opts?: { create?: boolean }) => Promise<FileSystemFileHandle>;
  removeEntry: (name: string) => Promise<void>;
}

/** OPFS-backed sink: chunks stream to a private file, not RAM. */
export class OpfsChunkSink implements ChunkSink {
  private _handle: FileSystemFileHandle | null = null;
  private _writable: FileSystemWritableFileStream | null = null;
  private _root: OpfsRoot | null = null;
  private _name: string;
  bytes = 0;

  constructor(name = `bdv-live-${Date.now()}.webm`) {
    this._name = name;
  }

  static async isAvailable(): Promise<boolean> {
    try {
      const storage = navigator.storage as StorageManager & {
        getDirectory?: () => Promise<OpfsRoot>;
      };
      if (typeof storage?.getDirectory !== "function") return false;
      await storage.getDirectory();
      return true;
    } catch {
      return false;
    }
  }

  async open(): Promise<void> {
    const storage = navigator.storage as StorageManager & { getDirectory: () => Promise<OpfsRoot> };
    this._root = await storage.getDirectory();
    this._handle = await this._root.getFileHandle(this._name, { create: true });
    this._writable = await this._handle.createWritable();
  }

  async write(chunk: Blob): Promise<void> {
    if (!this._writable) throw new Error("Recording file isn't open.");
    await this._writable.write(chunk);
    this.bytes += chunk.size;
  }

  async finalize(mimeType: string): Promise<Blob> {
    if (!this._handle || !this._root) throw new Error("Recording file isn't open.");
    await this._writable?.close();
    this._writable = null;
    const file = await this._handle.getFile();
    const blob = new Blob([file], { type: mimeType });
    await this._root.removeEntry(this._name).catch(() => undefined);
    return blob;
  }

  async abort(): Promise<void> {
    try {
      await this._writable?.abort();
    } catch {
      /* already closed */
    }
    this._writable = null;
    if (this._root) await this._root.removeEntry(this._name).catch(() => undefined);
  }
}

/** House mime preference order (same as the editor's screen recorder). */
export const RECORDER_MIME_CANDIDATES = [
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
] as const;

export function pickRecorderMimeType(
  isTypeSupported: (mime: string) => boolean = (m) =>
    typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(m),
): string {
  for (const c of RECORDER_MIME_CANDIDATES) {
    try {
      if (isTypeSupported(c)) return c;
    } catch {
      /* ignore */
    }
  }
  return "";
}

export interface StreamRecorderDeps {
  /** Injected MediaRecorder implementation (tests). */
  mediaRecorderImpl?: typeof MediaRecorder;
  /** Force a sink (tests); default: OPFS when available, else memory. */
  sink?: ChunkSink;
  /** Memory-sink warning threshold in bytes (default 750MB). */
  memoryWarnBytes?: number;
  onWarning?: (message: string) => void;
  onError?: (err: unknown) => void;
}

export class StreamRecorder {
  /** True once a chunk write has failed — the recording will not save. */
  failed = false;
  /** Which sink ended up holding the recording: 'opfs' | 'memory'. */
  sinkKind: "opfs" | "memory" | null = null;
  readonly mimeType: string;
  private _recorder: MediaRecorder | null = null;
  private _sink: ChunkSink | null = null;
  private _deps: StreamRecorderDeps;
  private _warned = false;
  private _stopped: Promise<{ blob: Blob; mimeType: string } | null> | null = null;

  constructor(deps: StreamRecorderDeps = {}) {
    this._deps = deps;
    this.mimeType = pickRecorderMimeType(
      deps.mediaRecorderImpl ? (m) => deps.mediaRecorderImpl!.isTypeSupported(m) : undefined,
    );
  }

  get recording(): boolean {
    return this._recorder?.state === "recording";
  }

  async start(stream: MediaStream, timesliceMs = 5000): Promise<void> {
    if (this._recorder) return;
    const MR = this._deps.mediaRecorderImpl ?? (typeof MediaRecorder !== "undefined" ? MediaRecorder : undefined);
    if (!MR) throw new Error("This browser can't record the stream (MediaRecorder unavailable).");

    // Choose the sink BEFORE the first chunk exists: OPFS creation
    // failing here costs nothing; a mid-recording failure costs the VOD.
    if (this._deps.sink) {
      this._sink = this._deps.sink;
      this.sinkKind = this._deps.sink instanceof OpfsChunkSink ? "opfs" : "memory";
      if (this._sink instanceof OpfsChunkSink) await this._sink.open();
    } else if (await OpfsChunkSink.isAvailable()) {
      const sink = new OpfsChunkSink();
      try {
        await sink.open();
        this._sink = sink;
        this.sinkKind = "opfs";
      } catch {
        this._sink = new MemoryChunkSink();
        this.sinkKind = "memory";
      }
    } else {
      this._sink = new MemoryChunkSink();
      this.sinkKind = "memory";
    }

    const recorder = this.mimeType ? new MR(stream, { mimeType: this.mimeType }) : new MR(stream);
    this._recorder = recorder;
    const warnAt = this._deps.memoryWarnBytes ?? 750 * 1024 * 1024;
    recorder.ondataavailable = (ev: BlobEvent) => {
      if (!ev.data || ev.data.size === 0 || this.failed) return;
      const sink = this._sink;
      if (!sink) return;
      sink.write(ev.data).catch((err) => {
        // One bad write poisons the file (WebM chunks aren't resumable) —
        // stop collecting, flag it, and let the broadcast carry on.
        this.failed = true;
        this._deps.onError?.(err);
        try {
          recorder.stop();
        } catch {
          /* already stopped */
        }
      });
      if (!this._warned && this.sinkKind === "memory" && sink instanceof MemoryChunkSink && sink.bytes > warnAt) {
        this._warned = true;
        this._deps.onWarning?.(
          "This recording is getting long — it's being held in memory and could be lost if the tab closes.",
        );
      }
    };
    recorder.start(timesliceMs);
  }

  /** Stop recording and return the finished Blob (null when it failed). */
  async stop(): Promise<{ blob: Blob; mimeType: string } | null> {
    if (this._stopped) return this._stopped;
    this._stopped = (async () => {
      const recorder = this._recorder;
      if (!recorder) return null;
      if (recorder.state !== "inactive") {
        await new Promise<void>((resolve) => {
          recorder.onstop = () => resolve();
          try {
            recorder.stop();
          } catch {
            resolve();
          }
        });
      }
      this._recorder = null;
      if (this.failed || !this._sink) {
        await this._sink?.abort().catch(() => undefined);
        return null;
      }
      const blob = await this._sink.finalize(this.mimeType || "video/webm");
      return { blob, mimeType: this.mimeType || "video/webm" };
    })();
    return this._stopped;
  }
}
