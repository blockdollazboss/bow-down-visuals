/**
 * export-toggle-decision.test.ts — stack400 lane 3 regression.
 *
 * The Oct 28 payments-gate failure, end-to-end through the REAL render
 * pipeline (real ffmpeg; only the DB job store / storage / supabase /
 * ledger shell is mocked): the owner toggled the watermark OFF and
 * every attempt still ran as "Branded export — free (0 Visual Bucs)",
 * because the editor-default branding watermark (enabled + house mark)
 * overrode the toggle in the prediction AND the render, and the plan
 * gate forced branded for free/trial users at any price.
 *
 * Pinned behavior (A-01/A-02/A-07):
 *  - toggle OFF + default branding + free plan → the job completes
 *    CLEAN (result.watermarked === false) and 400 VB is RESERVED at
 *    job start;
 *  - toggle ON → the job completes BRANDED (watermarked === true) and
 *    nothing is reserved or charged.
 *
 * This file also guards the lane-3 workspace-root fix: it runs the
 * module from source (vitest), where the old fixed three-level
 * MODULE_DIR hop resolved the house-watermark path one level short and
 * every branded export died at the pre-spawn check.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { execFile } from "child_process";
import { promisify } from "util";
import { createServer, type Server } from "http";
import { mkdtemp, rm, readFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

const execFileAsync = promisify(execFile);

const captured = vi.hoisted(() => ({
  completed: [] as Array<{ jobId: string; result: Record<string, unknown> }>,
  failed: [] as Array<{ jobId: string; error: { message: string } }>,
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
    failJob: vi.fn(async (jobId: string, error: { message: string }) => {
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

describe("export toggle decision — end-to-end (lane 3 regression)", () => {
  let server: Server;
  let base = "";
  let dir = "";

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "lane3-toggle-"));
    const clipPath = join(dir, "clip.mp4");
    const songPath = join(dir, "song.mp3");
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

  function makeBody(addWatermark: boolean) {
    return {
      projectId: "e2401c06-ecef-478b-ae29-9158fe36cbb1",
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
      addWatermark,
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
    } as never;
  }

  function resetCaptured() {
    captured.completed.length = 0;
    captured.failed.length = 0;
    captured.reserved.length = 0;
    captured.released.length = 0;
  }

  it("toggle OFF + default branding + free plan → CLEAN, 400 VB reserved at job start", async () => {
    resetCaptured();
    const ctx = {
      body: makeBody(false),
      userId: "user-1",
      userPlan: "free",
      userSupabase: fakeUserSupabase(),
      log: logStub,
      statusRef: { current: null },
    } as never;

    await runExportJobInBackground("job-clean", ctx);

    expect(captured.failed).toEqual([]);
    expect(captured.completed).toHaveLength(1);
    expect(captured.completed[0]!.result.watermarked).toBe(false);
    expect(captured.completed[0]!.result.url).toBe("https://example.test/final.mp4");
    // A-07: the clean price is held when the job starts, never released
    // on success (the hold becomes the charge).
    expect(captured.reserved).toEqual([{ jobId: "job-clean", cost: 400 }]);
    expect(captured.released).toEqual([]);
  }, 300_000);

  it("toggle ON + default branding + free plan → BRANDED, nothing reserved (A-01)", async () => {
    resetCaptured();
    const ctx = {
      body: makeBody(true),
      userId: "user-1",
      userPlan: "free",
      userSupabase: fakeUserSupabase(),
      log: logStub,
      statusRef: { current: null },
    } as never;

    await runExportJobInBackground("job-branded", ctx);

    expect(captured.failed).toEqual([]);
    expect(captured.completed).toHaveLength(1);
    expect(captured.completed[0]!.result.watermarked).toBe(true);
    expect(captured.reserved).toEqual([]);
    expect(captured.released).toEqual([]);
  }, 300_000);
});
