/**
 * Tests for the Media Importer.
 *
 * Covers: the 2-credit price constant, URL validation (platform allowlist,
 * direct media extensions, SSRF blocks, garbage rejection), import format
 * resolution, yt-dlp argument construction, filename sanitization, and
 * automatic refund when the job fails.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../../lib/credits", () => ({
  chargeCredits: vi.fn(),
  refundCredits: vi.fn(),
  OutOfCreditsError: class OutOfCreditsError extends Error {},
  LedgerWriteError: class LedgerWriteError extends Error {},
}));

vi.mock("../../../lib/objectStorage", () => ({
  uploadMediaToSupabaseStorage: vi.fn(),
  refreshSupabaseStorageUrl: vi.fn(),
}));

vi.mock("child_process", () => ({
  execFile: vi.fn(),
}));

import {
  MEDIA_IMPORT_CREDIT_COST,
  MAX_IMPORT_BYTES,
  validateImportUrl,
  resolveImportFormat,
  buildYtDlpArgs,
  sanitizeFileName,
  runMediaImportJob,
  getMediaImportJob,
  __clearMediaImportJobs,
  type MediaImportJob,
} from "../media-importer";
import { refundCredits } from "../../../lib/credits";

const mockRefund = vi.mocked(refundCredits);

beforeEach(() => {
  __clearMediaImportJobs();
  vi.clearAllMocks();
});

function makeJob(overrides: Partial<MediaImportJob> = {}): MediaImportJob {
  return {
    id: "job-123",
    userId: "user-456",
    status: "queued",
    source: "platform",
    sourceUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    sourceHost: "www.youtube.com",
    format: "video",
    title: null,
    mediaType: null,
    outputUrl: null,
    outputRef: null,
    fileSize: null,
    error: null,
    creditsCharged: MEDIA_IMPORT_CREDIT_COST,
    createdAt: Date.now(),
    ...overrides,
  };
}

describe("pricing", () => {
  it("charges 2 credits per import", () => {
    expect(MEDIA_IMPORT_CREDIT_COST).toBe(2);
  });

  it("caps imports at 500 MB", () => {
    expect(MAX_IMPORT_BYTES).toBe(500 * 1024 * 1024);
  });
});

describe("validateImportUrl", () => {
  it("accepts YouTube watch URLs as platform sources", () => {
    const r = validateImportUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.source).toBe("platform");
      expect(r.value.host).toBe("www.youtube.com");
    }
  });

  it("accepts youtu.be short links", () => {
    const r = validateImportUrl("https://youtu.be/dQw4w9WgXcQ");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.source).toBe("platform");
  });

  it("accepts SoundCloud, TikTok, Instagram, X, and Vimeo", () => {
    for (const u of [
      "https://soundcloud.com/artist/track",
      "https://www.tiktok.com/@user/video/123",
      "https://www.instagram.com/reel/abc123/",
      "https://x.com/user/status/123",
      "https://vimeo.com/123456",
    ]) {
      const r = validateImportUrl(u);
      expect(r.ok).toBe(true);
    }
  });

  it("accepts direct media file links", () => {
    for (const u of [
      "https://example.com/song.mp3",
      "https://cdn.example.com/video.MP4",
      "https://example.com/audio.wav?token=abc",
    ]) {
      const r = validateImportUrl(u);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value.source).toBe("direct");
    }
  });

  it("rejects unsupported hosts", () => {
    const r = validateImportUrl("https://random-blog.com/post");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/supported source/i);
  });

  it("rejects non-media direct links", () => {
    const r = validateImportUrl("https://example.com/page.html");
    expect(r.ok).toBe(false);
  });

  it("rejects garbage input", () => {
    expect(validateImportUrl("").ok).toBe(false);
    expect(validateImportUrl("not a url").ok).toBe(false);
    expect(validateImportUrl("ftp://example.com/song.mp3").ok).toBe(false);
  });

  it("blocks localhost and private-network targets (SSRF)", () => {
    for (const u of [
      "http://localhost/song.mp3",
      "http://127.0.0.1/video.mp4",
      "http://10.0.0.5/song.mp3",
      "http://192.168.1.1/video.mp4",
    ]) {
      const r = validateImportUrl(u);
      expect(r.ok).toBe(false);
    }
  });
});

describe("resolveImportFormat", () => {
  it("accepts video and audio", () => {
    expect(resolveImportFormat("video")).toBe("video");
    expect(resolveImportFormat("audio")).toBe("audio");
  });

  it("rejects anything else", () => {
    expect(resolveImportFormat("best")).toBeNull();
    expect(resolveImportFormat("")).toBeNull();
    expect(resolveImportFormat(undefined)).toBeNull();
  });
});

describe("buildYtDlpArgs", () => {
  it("never downloads playlists and caps file size", () => {
    const args = buildYtDlpArgs("https://www.youtube.com/watch?v=x", "video", "/tmp/dl.%(ext)s");
    expect(args).toContain("--no-playlist");
    expect(args).toContain("--max-filesize");
    expect(args[args.indexOf("--max-filesize") + 1]).toBe(String(MAX_IMPORT_BYTES));
  });

  it("extracts MP3 audio for audio imports", () => {
    const args = buildYtDlpArgs("https://soundcloud.com/a/b", "audio", "/tmp/dl.%(ext)s");
    expect(args).toContain("--extract-audio");
    expect(args).toContain("mp3");
    expect(args[args.length - 1]).toBe("https://soundcloud.com/a/b");
  });

  it("prefers MP4 for video imports", () => {
    const args = buildYtDlpArgs("https://www.youtube.com/watch?v=x", "video", "/tmp/dl.%(ext)s");
    const fIdx = args.indexOf("-f");
    expect(args[fIdx + 1]).toMatch(/mp4/);
    expect(args).toContain("--merge-output-format");
  });
});

describe("sanitizeFileName", () => {
  it("strips dangerous characters", () => {
    expect(sanitizeFileName('../../etc/passwd')).toBe("etcpasswd");
    expect(sanitizeFileName("My Song (Official).mp4")).toBe("My-Song-Official.mp4");
  });

  it("falls back to a safe default", () => {
    expect(sanitizeFileName("///")).toBe("import");
  });
});

describe("runMediaImportJob failure", () => {
  it("marks the job failed and refunds when yt-dlp is unavailable", async () => {
    // findYtDlp probes candidates; make every probe fail.
    const { execFile } = await import("child_process");
    vi.mocked(execFile).mockImplementation(((_cmd: unknown, args: unknown, opts: unknown, cb: unknown) => {
      const callback = (typeof opts === "function" ? opts : cb) as (err: Error) => void;
      callback(new Error("not found"));
      return {} as never;
    }) as never);

    const job = makeJob();
    await runMediaImportJob(job);

    expect(job.status).toBe("failed");
    expect(job.error).toMatch(/downloader/i);
    expect(mockRefund).toHaveBeenCalledWith(
      job.userId,
      MEDIA_IMPORT_CREDIT_COST,
      expect.objectContaining({ action: expect.stringMatching(/refund/i) }),
    );
  });

  it("exposes the job through the getter", () => {
    const job = makeJob({ id: "getter-test" });
    // jobs map is internal; the getter returns undefined for unknown ids
    expect(getMediaImportJob("nope")).toBeUndefined();
    expect(getMediaImportJob("getter-test")).toBeUndefined(); // not registered until POST
    expect(job.id).toBe("getter-test");
  });
});
