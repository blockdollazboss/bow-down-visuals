/**
 * export-prepare-stale-honesty.test.ts — stack500 lane E regression.
 *
 * The Oct 28 payments-gate Pass 3(a) failure, proven from the live
 * export_jobs rows: two branded attempts shared ONE prepareId
 * (0a3f1cfb…) and both rows' error message was exactly "Export failed".
 * Root cause: executeExport's prepare hard stops throw plain objects
 * { status, error, code: "PREPARE_STALE" }, but its catch rebuilt every
 * failure as { status: 500, message: "Export failed" } — destroying the
 * message AND the code the client's auto-recovery keys on — while the
 * finally deleted the prepare session after the first run and the
 * client never invalidated its copy.
 *
 * Pinned behavior (this lane):
 *  - a PREPARE_STALE hard stop lands in the persisted job error INTACT
 *    (message + code), never laundered to "Export failed";
 *  - the gate scenario end-to-end: two exports, one prepare session —
 *    the first completes and consumes the session; the second fails
 *    with PREPARE_STALE intact (the row the client's re-prepare
 *    recovery reads), instead of dying generically;
 *  - production diagnostics: a pass-A ffmpeg failure persists
 *    ffmpegExitCode + stderrTail on the job error with IS_DEV false
 *    (vitest NODE_ENV=test) — previously stripped outside development.
 *
 * Harness mirrors export-toggle-decision.test.ts (lane 3): the real
 * pipeline runs; only the DB job store / storage / supabase / ledger
 * shell is mocked. The prepared-exports registry is the REAL in-memory
 * store, so session consumption is the production behavior.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { execFile } from "child_process";
import { promisify } from "util";
import { createServer, type Server } from "http";
import { mkdtemp, rm, readFile, copyFile, mkdir, writeFile, chmod } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

const execFileAsync = promisify(execFile);

const captured = vi.hoisted(() => ({
  completed: [] as Array<{ jobId: string; result: Record<string, unknown> }>,
  failed: [] as Array<{ jobId: string; error: { message: string; code?: string; stderrTail?: string[]; ffmpegExitCode?: number | null } }>,
  reserved: [] as Array<{ jobId: string; cost: number }>,
  released: [] as Array<{ jobId: string; cost: number }>,
}));

vi.mock("../../lib/export-jobs", () => {
  const jobRow = (id: string) => ({
    id,
    userId: "user-1",
    projectId: "proj-1",
    state: "active",
    stage: "starting",
    creditsCharged: false,
    params: {},
    result: null,
    error: null,
    updatedAt: Date.now(),
  });
  return {
    createExportJob: vi.fn(async (userId: string, projectId: string, params: unknown) => ({ ...jobRow("job-1"), userId, projectId, params })),
    getExportJob: vi.fn(async (id: string) => jobRow(id)),
    claimJobForRun: vi.fn(async (id: string) => jobRow(id)),
    updateJobStage: vi.fn(async () => undefined),
    completeJob: vi.fn(async (jobId: string, result: Record<string, unknown>) => {
      captured.completed.push({ jobId, result });
    }),
    failJob: vi.fn(async (jobId: string, error: { message: string; code?: string; stderrTail?: string[]; ffmpegExitCode?: number | null }) => {
      captured.failed.push({ jobId, error });
    }),
    chargeCreditsForJob: vi.fn(async () => ({ charged: true, creditsAfter: 100_000 })),
    reserveCreditsForJob: vi.fn(async (jobId: string, _userId: string, cost: number) => {
      captured.reserved.push({ jobId, cost });
      return { reserved: true, creditsAfter: 100_000 };
    }),
    releaseJobReservation: vi.fn(async (jobId: string, _userId: string, cost: number) => {
      captured.released.push({ jobId, cost });
    }),
    clearJobChargeFlag: vi.fn(async () => undefined),
    cancelExportJob: vi.fn(async () => undefined),
    recoverInterruptedJobs: vi.fn(async () => undefined),
    enqueueExport: (fn: () => unknown) => { void fn(); },
    describeJobProgress: () => ({ stage: "", progress: 0 }),
  };
});

vi.mock("../../lib/objectStorage", () => ({
  ensureVideoExportsBucket: vi.fn(async () => undefined),
  uploadFileStreamToSupabaseStorage: vi.fn(async () => "r2://video-exports/exports/regression.mp4"),
  refreshSupabaseStorageUrl: vi.fn(async () => "https://example.test/final.mp4"),
  VIDEO_EXPORTS_BUCKET: "video-exports",
}));

vi.mock("../../lib/supabase-admin", () => ({
  getSupabaseAdmin: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ eq: () => ({ single: async () => ({ data: null, error: null }) }) }) }),
      update: () => ({ eq: () => ({ eq: async () => ({ error: null }) }) }),
    }),
  }),
}));

vi.mock("../../lib/payment-record", () => ({
  recordCreditUsageStrict: vi.fn(async () => undefined),
}));

vi.mock("../../lib/retention", () => ({
  recordCreation: vi.fn(async () => undefined),
}));

vi.mock("../../lib/credits", () => {
  class OutOfCreditsError extends Error {}
  return {
    OutOfCreditsError,
    refundCredits: vi.fn(async () => undefined),
  };
});

vi.mock("../generate/producer-tag-lifecycle", () => ({
  getActiveProducerTag: vi.fn(async () => null),
}));

vi.mock("../generate/podcast", () => ({
  probeDurationSeconds: vi.fn(async () => 0),
}));

vi.mock("../../lib/disclosure-metadata", () => ({
  stampVideoFileWithDisclosure: vi.fn(async () => false),
}));

vi.mock("../../lib/proxy-editing", () => ({
  drizzleProxyStore: {},
  resolveExportSources: vi.fn(async () => ({ relinked: 0, urls: [] })),
}));

import { runExportJobInBackground } from "../generate/export-video";
import { registerPreparedExport, getPreparedExport } from "../../lib/prepared-exports";

const logStub = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
  child: () => logStub,
} as never;

function fakeUserSupabase() {
  const project = {
    id: "proj-1",
    user_id: "user-1",
    project_type: "music_video",
    title: "Regression",
    artist_name: "",
    song_title: "",
    genre: "",
    mood: "",
    style: "",
    platform: "",
    input_data: {},
    output_data: {},
    credits_used: 0,
    created_at: new Date().toISOString(),
  };
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            single: async () => ({ data: project, error: null }),
          }),
        }),
      }),
      update: () => ({ eq: () => ({ eq: async () => ({ error: null }) }) }),
    }),
  } as never;
}

/** The editor-default branding block (editor-settings.ts defaults). */
const DEFAULT_BRANDING = {
  introCard: { enabled: false, artistName: "", songTitle: "", tagline: "", duration: 3, stylePreset: "luxury-dark" },
  outroCard: { enabled: false, textLine1: "", textLine2: "", ctaPreset: "follow-for-more", customCtaText: "", duration: 3, stylePreset: "luxury-dark" },
  watermark: { enabled: true, bdvWatermark: true, customLogoUrl: null, position: "bottom-right", opacity: "medium", size: "medium" },
  titleOverlay: { showArtistName: false, artistNameText: "", showSongTitle: false, songTitleText: "", showSectionLabels: false, stylePreset: "clean-white" },
};

const PROJECT_ID = "e2401c06-ecef-478b-ae29-9158fe36cbb1";
const PREPARE_ID = "lane-e-prepare-1";

describe("export error honesty — PREPARE_STALE + production diagnostics (lane E)", () => {
  let server: Server;
  let base = "";
  let dir = "";
  let clipPath = "";
  let songPath = "";
  let realFfmpeg = "";

  beforeAll(async () => {
    // The diagnostics test below proves persistence with IS_DEV false;
    // refuse to run if this environment would silently make it dev.
    expect(process.env["NODE_ENV"]).not.toBe("development");

    dir = await mkdtemp(join(tmpdir(), "laneE-honesty-"));
    clipPath = join(dir, "clip.mp4");
    songPath = join(dir, "song.mp3");
    await execFileAsync("ffmpeg", [
      "-y",
      "-f", "lavfi", "-i", "testsrc2=duration=3:size=720x1280:rate=30",
      "-f", "lavfi", "-i", "sine=frequency=440:duration=3",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", clipPath,
    ], { timeout: 120_000 });
    await execFileAsync("ffmpeg", [
      "-y", "-f", "lavfi", "-i", "sine=frequency=220:duration=5",
      "-c:a", "libmp3lame", songPath,
    ], { timeout: 60_000 });

    const which = await execFileAsync("which", ["ffmpeg"]);
    realFfmpeg = which.stdout.trim().split("\n")[0]!;
    expect(realFfmpeg.length).toBeGreaterThan(0);

    server = createServer((req, res) => {
      const name = (req.url ?? "").replace("/", "");
      const file = name === "clip.mp4" ? clipPath : name === "song.mp3" ? songPath : null;
      if (!file) { res.statusCode = 404; res.end(); return; }
      void readFile(file).then((buf) => {
        res.setHeader("Content-Type", name.endsWith(".mp3") ? "audio/mpeg" : "video/mp4");
        res.end(buf);
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address();
    base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  }, 180_000);

  afterAll(async () => {
    server?.close();
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
  });

  function makeBody(prepareId?: string) {
    return {
      projectId: PROJECT_ID,
      clipUrls: [`${base}/clip.mp4`],
      audioUrl: `${base}/song.mp3`,
      timelineOrder: ["scene-1"],
      testMode: false,
      aspectRatio: "9:16",
      fadeAudioInSec: 0,
      fadeAudioOutSec: 0,
      loopAudio: false,
      audioStartSec: 0,
      matchVideoLength: false,
      addWatermark: true,
      aiDisclosure: true,
      customWatermarkUrl: null,
      watermarkTheme: "dark",
      watermarkPosition: "bottom-right",
      watermarkSize: "medium",
      watermarkMargin: 16,
      audioSource: "uploaded",
      captions: null,
      captionExportMode: "burn",
      branding: DEFAULT_BRANDING,
      exportRangeStart: null,
      exportRangeEnd: null,
      clipTransitions: [null],
      clipProTools: [null],
      manualGapsBeforeSec: null,
      effects: null,
      overlayItems: null,
      adjustmentItems: null,
      ducking: null,
      overlayEffects: null,
      overlayEffectIntensity: null,
      fitMode: "fill",
      ...(prepareId ? { prepareId } : {}),
    } as never;
  }

  function makeCtx(prepareId?: string) {
    return {
      body: makeBody(prepareId),
      userId: "user-1",
      userPlan: "free",
      userSupabase: fakeUserSupabase(),
      log: logStub,
      statusRef: { current: null },
    } as never;
  }

  function resetCaptured() {
    captured.completed.length = 0;
    captured.failed.length = 0;
    captured.reserved.length = 0;
    captured.released.length = 0;
  }

  it("an unknown prepareId fails with PREPARE_STALE intact in the job error — never laundered to 'Export failed'", async () => {
    resetCaptured();
    await runExportJobInBackground("job-stale-unknown", makeCtx("prepare-id-that-never-existed"));

    expect(captured.completed).toEqual([]);
    expect(captured.failed).toHaveLength(1);
    const err = captured.failed[0]!.error;
    expect(err.code).toBe("PREPARE_STALE");
    expect(err.message).toContain("Prepare session expired or not found");
    expect(err.message).not.toBe("Export failed");
  }, 60_000);

  it("two exports, one prepare: the first completes and consumes the session; the second fails PREPARE_STALE intact", async () => {
    // Register a REAL prepared session (copies in their own dir — the
    // first export's cleanup deletes the session dir, as in production).
    const prepDir = join(dir, "prepared-session");
    await mkdir(prepDir, { recursive: true });
    const prepClip = join(prepDir, "clip.mp4");
    const prepSong = join(prepDir, "song.mp3");
    await copyFile(clipPath, prepClip);
    await copyFile(songPath, prepSong);
    registerPreparedExport(PREPARE_ID, {
      projectId: PROJECT_ID,
      exportDir: prepDir,
      clips: [{
        sceneNumber: 1,
        sceneTitle: "Scene 1",
        clipDbId: null,
        provider: null,
        approved: true,
        selected: true,
        sourceFieldName: "scene.demoClipUrl",
        originalUrl: `${base}/clip.mp4`,
        resolvedUrl: `${base}/clip.mp4`,
        sourceType: "upload",
        sourceUrlStartsWithHttp: true,
        sourceUrlDownloadable: true,
        localPath: prepClip,
        fileWritten: true,
        fileExistsAfterWrite: true,
        fileSize: 1,
        duration: 3,
        width: 720,
        height: 1280,
        fps: 30,
        codec: "h264",
        ffprobeValid: true,
        readyForFFmpeg: true,
        error: null,
        responseStatus: 200,
        contentType: "video/mp4",
      }],
      audio: {
        requested: true,
        sourceUrl: `${base}/song.mp3`,
        localPath: prepSong,
        fileWritten: true,
        fileExistsAfterWrite: true,
        fileSize: 1,
        duration: 5,
        ffprobeValid: true,
        ready: true,
        error: null,
        responseStatus: 200,
        contentType: "audio/mpeg",
      },
      allReady: true,
      createdAt: Date.now(),
    });
    expect(getPreparedExport(PREPARE_ID)).toBeDefined();

    // Export #1 on the session: completes (branded, real pipeline).
    resetCaptured();
    await runExportJobInBackground("job-prepared-first", makeCtx(PREPARE_ID));
    expect(captured.failed).toEqual([]);
    expect(captured.completed).toHaveLength(1);
    expect(captured.completed[0]!.result.watermarked).toBe(true);
    // The session is single-use: the first run consumed it.
    expect(getPreparedExport(PREPARE_ID)).toBeUndefined();

    // Export #2 on the SAME (spent) session — the gate scenario. It must
    // fail with the structured PREPARE_STALE the client's auto-recovery
    // reads, not with the laundered generic message both live rows had.
    resetCaptured();
    await runExportJobInBackground("job-prepared-second", makeCtx(PREPARE_ID));
    expect(captured.completed).toEqual([]);
    expect(captured.failed).toHaveLength(1);
    const err = captured.failed[0]!.error;
    expect(err.code).toBe("PREPARE_STALE");
    expect(err.message).toContain("Prepare session expired or not found");
    expect(err.message).not.toBe("Export failed");
  }, 300_000);

  it("a pass-A ffmpeg failure persists exit code + stderr tail on the job error in production mode", async () => {
    // Shadow `ffmpeg` on PATH with a wrapper that delegates everything
    // to the real binary EXCEPT the pass-A invocation (identified by
    // its bdv-export-*-passA output), which fails with exit 3 and
    // distinctive stderr. Phase 1 therefore runs for real; only the
    // delivery pass dies — the exact shape failPass produces live.
    const fakeBin = join(dir, "fakebin");
    await mkdir(fakeBin, { recursive: true });
    const wrapper = [
      "#!/bin/sh",
      'for a in "$@"; do',
      '  case "$a" in',
      "    *passA*)",
      '      echo "fake-ffmpeg: encoder warmup ok" >&2',
      '      echo "Error: simulated render failure (lane E)" >&2',
      "      exit 3",
      "      ;;",
      "  esac",
      "done",
      `exec ${realFfmpeg} "$@"`,
      "",
    ].join("\n");
    await writeFile(join(fakeBin, "ffmpeg"), wrapper);
    await chmod(join(fakeBin, "ffmpeg"), 0o755);

    const prevPath = process.env["PATH"];
    process.env["PATH"] = `${fakeBin}:${prevPath ?? ""}`;
    try {
      resetCaptured();
      await runExportJobInBackground("job-pass-a-dies", makeCtx());
    } finally {
      process.env["PATH"] = prevPath;
    }

    expect(captured.completed).toEqual([]);
    expect(captured.failed).toHaveLength(1);
    const err = captured.failed[0]!.error;
    expect(err.message).toContain("FFmpeg pass A (video) failed (exit 3)");
    expect(err.ffmpegExitCode).toBe(3);
    expect(err.stderrTail).toBeDefined();
    expect(err.stderrTail!.join("\n")).toContain("simulated render failure (lane E)");
  }, 300_000);
});
