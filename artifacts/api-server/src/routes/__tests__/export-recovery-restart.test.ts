/**
 * export-recovery-restart.test.ts — stack600 export-recovery, rungs 1+3.
 *
 * Gate re-run #3's branded-export failure, code-proven in
 * gate3-branded-session-diagnosis.md: prepare sessions live in an
 * in-memory Map; a mid-render process restart (memory watchdog /
 * container OOM) wipes the registry; boot recovery then re-runs the
 * orphaned job WITH its persisted prepareId, and executeExport's single
 * lookup hard-stops PREPARE_STALE against the empty registry — even
 * though the render itself was progressing fine when the process died.
 *
 * Pinned behavior:
 *  - rung 1: dropPrepareIdForRecovery removes ONLY the prepareId from a
 *    recovered job's params (input never mutated), so the re-run takes
 *    the existing live-download path over the persisted clip URLs;
 *  - gate scenario A (no disk seed — the pre-fix world): a session is
 *    prepared and then wiped completely (registry + files), boot
 *    recovery re-drives the job from its persisted params, and the job
 *    COMPLETES via live download instead of failing PREPARE_STALE
 *    (Lane E's harness proves the counterfactual on the same setup:
 *    with the id still supplied, this exact shape fails PREPARE_STALE);
 *  - gate scenario B (rung 2's disk seed): a session prepared before a
 *    restart is rehydrated from session.json by the fresh process, and
 *    a fresh export runs against the ORIGINAL prepared files — proven
 *    by making the clip URL unreachable, so only the on-disk prepared
 *    file can possibly render.
 *
 * Harness mirrors export-prepare-stale-honesty.test.ts (lane E): the
 * real pipeline runs; only the DB job store / storage / supabase /
 * ledger shell is mocked. The prepared-exports registry is the REAL
 * store.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { execFile } from "child_process";
import { promisify } from "util";
import { createServer, type Server } from "http";
import { mkdtemp, rm, readFile, copyFile, mkdir } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

const execFileAsync = promisify(execFile);

const captured = vi.hoisted(() => ({
  completed: [] as Array<{ jobId: string; result: Record<string, unknown> }>,
  failed: [] as Array<{ jobId: string; error: { message: string; code?: string } }>,
  reserved: [] as Array<{ jobId: string; cost: number }>,
  released: [] as Array<{ jobId: string; cost: number }>,
  recoverHandler: null as null | ((job: never) => Promise<void>),
  enqueued: [] as Array<() => unknown>,
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
    failJob: vi.fn(async (jobId: string, error: { message: string; code?: string }) => {
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
    // Capture the recovery handler; the test plays the DB's role and
    // feeds it the orphaned job row.
    recoverInterruptedJobs: vi.fn(async (handler: (job: never) => Promise<void>) => {
      captured.recoverHandler = handler;
    }),
    // Capture the enqueued thunk so the test can await the re-run.
    enqueueExport: (fn: () => unknown) => { captured.enqueued.push(fn); },
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
      // Self-chaining: recovery does select().eq().single(); other
      // callers may chain more .eq()s first.
      select: () => {
        const self: Record<string, unknown> = {
          eq: () => self,
          single: async () => ({ data: { plan: "free" }, error: null }),
        };
        return self;
      },
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

import { runExportJobInBackground, recoverInterruptedExportJobs, dropPrepareIdForRecovery } from "../generate/export-video";
import { registerPreparedExport, getPreparedExport, deletePreparedExport } from "../../lib/prepared-exports";

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
const DEAD_PREPARE_ID = "stack600-dead-prepare";
const SURVIVING_PREPARE_ID = "stack600-surviving-prepare";
/** Nothing listens on port 9 — a download attempt fails immediately. */
const UNREACHABLE_CLIP_URL = "http://127.0.0.1:9/clip.mp4";

describe("export recovery after a process restart (stack600)", () => {
  let server: Server;
  let base = "";
  let dir = "";
  let clipPath = "";
  let songPath = "";

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "stack600-recovery-"));
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

  function makeBody(prepareId?: string, clipUrl?: string) {
    return {
      projectId: PROJECT_ID,
      clipUrls: [clipUrl ?? `${base}/clip.mp4`],
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

  function makeCtx(prepareId?: string, clipUrl?: string) {
    return {
      body: makeBody(prepareId, clipUrl),
      userId: "user-1",
      userPlan: "free",
      userSupabase: fakeUserSupabase(),
      log: logStub,
      statusRef: { current: null },
    } as never;
  }

  function preparedEntry(exportDir: string, clipLocalPath: string, audioLocalPath: string, clipUrl: string) {
    return {
      projectId: PROJECT_ID,
      exportDir,
      clips: [{
        sceneNumber: 1,
        sceneTitle: "Scene 1",
        clipDbId: null,
        provider: null,
        approved: true,
        selected: true,
        sourceFieldName: "scene.demoClipUrl",
        originalUrl: clipUrl,
        resolvedUrl: clipUrl,
        sourceType: "upload",
        sourceUrlStartsWithHttp: true,
        sourceUrlDownloadable: true,
        localPath: clipLocalPath,
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
        localPath: audioLocalPath,
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
    };
  }

  function resetCaptured() {
    captured.completed.length = 0;
    captured.failed.length = 0;
    captured.reserved.length = 0;
    captured.released.length = 0;
    captured.enqueued.length = 0;
  }

  describe("dropPrepareIdForRecovery (rung 1)", () => {
    it("removes only the prepareId — every other param identical, input never mutated", () => {
      const params = {
        projectId: "proj-1",
        clipUrls: ["https://example.test/a.mp4"],
        prepareId: "sess-dead",
        branding: { watermark: { enabled: true } },
        exportRangeStart: null,
      } as never;

      const out = dropPrepareIdForRecovery(params) as Record<string, unknown>;

      expect("prepareId" in out).toBe(false);
      expect(out).toEqual({
        projectId: "proj-1",
        clipUrls: ["https://example.test/a.mp4"],
        branding: { watermark: { enabled: true } },
        exportRangeStart: null,
      });
      expect((params as Record<string, unknown>)["prepareId"]).toBe("sess-dead");
    });

    it("passes params without a prepareId through unchanged", () => {
      const params = { projectId: "proj-1", clipUrls: [] as string[] } as never;
      const out = dropPrepareIdForRecovery(params) as Record<string, unknown>;
      expect(out).toEqual({ projectId: "proj-1", clipUrls: [] });
      expect("prepareId" in out).toBe(false);
    });
  });

  it("gate scenario A — recovered job with a wiped session completes via live download, never PREPARE_STALE", async () => {
    // "Process 1" prepared a session for this job…
    const deadDir = join(dir, "dead-session");
    await mkdir(deadDir, { recursive: true });
    const deadClip = join(deadDir, "clip.mp4");
    const deadSong = join(deadDir, "song.mp3");
    await copyFile(clipPath, deadClip);
    await copyFile(songPath, deadSong);
    registerPreparedExport(DEAD_PREPARE_ID, preparedEntry(deadDir, deadClip, deadSong, `${base}/clip.mp4`));
    expect(getPreparedExport(DEAD_PREPARE_ID)).toBeDefined();

    // …then the process died and NOTHING survived: registry entry and
    // files (including any disk seed) are gone — the pre-fix world.
    deletePreparedExport(DEAD_PREPARE_ID);
    expect(getPreparedExport(DEAD_PREPARE_ID)).toBeUndefined();

    // Boot recovery in the new process re-drives the orphaned job from
    // its persisted params — which still carry the dead prepareId.
    captured.recoverHandler = null;
    await recoverInterruptedExportJobs();
    expect(captured.recoverHandler).toBeTypeOf("function");

    resetCaptured();
    const orphanedJob = {
      id: "job-recovered-1",
      userId: "user-1",
      projectId: PROJECT_ID,
      state: "active",
      stage: "starting",
      creditsCharged: false,
      params: makeBody(DEAD_PREPARE_ID),
      result: null,
      error: null,
      attempts: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } as never;
    await captured.recoverHandler!(orphanedJob);
    expect(captured.enqueued).toHaveLength(1);
    await captured.enqueued[0]!();

    // The re-run took the live-download path over the persisted clip
    // URLs and finished the (branded) render.
    expect(captured.failed).toEqual([]);
    expect(captured.completed).toHaveLength(1);
    expect(captured.completed[0]!.jobId).toBe("job-recovered-1");
    expect(captured.completed[0]!.result.watermarked).toBe(true);
  }, 300_000);

  it("gate scenario B — after a restart, the rehydrated session serves a fresh export against the original files", async () => {
    // "Process 1": a real session is prepared on disk. Its clip URL is
    // UNREACHABLE — if anything in the next process tries the
    // live-download path for this clip, the export cannot succeed.
    const sessDir = join(dir, "surviving-session");
    await mkdir(sessDir, { recursive: true });
    const sessClip = join(sessDir, "clip.mp4");
    const sessSong = join(sessDir, "song.mp3");
    await copyFile(clipPath, sessClip);
    await copyFile(songPath, sessSong);
    registerPreparedExport(
      SURVIVING_PREPARE_ID,
      preparedEntry(sessDir, sessClip, sessSong, UNREACHABLE_CLIP_URL),
    );
    expect(getPreparedExport(SURVIVING_PREPARE_ID)).toBeDefined();

    // The restart: brand-new module state — the registry is empty.
    vi.resetModules();
    const freshPE = await import("../../lib/prepared-exports");
    expect(freshPE.getPreparedExport(SURVIVING_PREPARE_ID)).toBeUndefined();

    // Boot rehydrates from the session.json seed the registration wrote.
    expect(freshPE.rehydratePreparedExports([dir])).toBe(1);
    expect(freshPE.getPreparedExport(SURVIVING_PREPARE_ID)).toBeDefined();

    // A fresh export in the new process runs against the ORIGINAL
    // prepared files (the unreachable URL proves no download happened).
    const freshEV = await import("../generate/export-video");
    resetCaptured();
    await freshEV.runExportJobInBackground("job-after-restart", makeCtx(SURVIVING_PREPARE_ID, UNREACHABLE_CLIP_URL));

    expect(captured.failed).toEqual([]);
    expect(captured.completed).toHaveLength(1);
    expect(captured.completed[0]!.result.watermarked).toBe(true);
    // And the run consumed the restored session like any other.
    expect(freshPE.getPreparedExport(SURVIVING_PREPARE_ID)).toBeUndefined();
  }, 300_000);
});
