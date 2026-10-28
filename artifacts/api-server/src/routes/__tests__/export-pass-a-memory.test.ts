/**
 * export-pass-a-memory.test.ts — stack600 export-recovery, rung 4.
 *
 * Crash-trail forensics from gate re-run #3 (production logs, 12:10–
 * 12:20 EDT): all four container deaths were IDENTICAL — the last
 * export line is "[export] pass A (video) starting", then one job-poll
 * GET, then silence, then migrate-boot. No ffmpeg stderr, no exit
 * code, no SIGTERM, no stack trace: the whole container vanishes at
 * pass A spawn. Node was calm (watchdog ticks: rssMb ~278–288,
 * heapRatio ~0.33) — the killer is the CONTAINER total: Node's ~280MB
 * baseline + ffmpeg's pass-A spike vs the 512MB box.
 *
 * Pass A's decoder and x264 encoder were already pinned to 1 thread
 * (earlier OOM scars), but the -filter_complex graph itself defaulted
 * to one thread per host core, and every graph thread queues its own
 * 1080x1920 frame buffers through the effects chain (Film Grain,
 * Blur, Warm Grade) — the last uncapped memory multiplier in the
 * spawn.
 *
 * Pinned behavior (this rung): the pass A invocation — and ONLY that
 * invocation — is constructed with `-filter_complex_threads 1` in
 * head (global-option) position, and the quality contract is
 * undisturbed: the output-position encoder `-threads 1`, the CRF,
 * and the VBV maxrate are all still present. Proven by shadowing
 * `ffmpeg` on PATH with a wrapper that records argv and delegates
 * to the real binary (the Lane E harness pattern), so the pins read
 * the exact command lines a real branded export spawns.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { execFile } from "child_process";
import { promisify } from "util";
import { createServer, type Server } from "http";
import { mkdtemp, rm, readFile, mkdir, writeFile, chmod } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

const execFileAsync = promisify(execFile);

const captured = vi.hoisted(() => ({
  completed: [] as Array<{ jobId: string; result: Record<string, unknown> }>,
  failed: [] as Array<{ jobId: string; error: { message: string; code?: string } }>,
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
    reserveCreditsForJob: vi.fn(async () => ({ reserved: true, creditsAfter: 100_000 })),
    releaseJobReservation: vi.fn(async () => undefined),
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

const DEFAULT_BRANDING = {
  introCard: { enabled: false, artistName: "", songTitle: "", tagline: "", duration: 3, stylePreset: "luxury-dark" },
  outroCard: { enabled: false, textLine1: "", textLine2: "", ctaPreset: "follow-for-more", customCtaText: "", duration: 3, stylePreset: "luxury-dark" },
  watermark: { enabled: true, bdvWatermark: true, customLogoUrl: null, position: "bottom-right", opacity: "medium", size: "medium" },
  titleOverlay: { showArtistName: false, artistNameText: "", showSongTitle: false, songTitleText: "", showSectionLabels: false, stylePreset: "clean-white" },
};

const PROJECT_ID = "e2401c06-ecef-478b-ae29-9158fe36cbb1";

describe("pass A memory discipline — filter graph threads capped (rung 4)", () => {
  let server: Server;
  let base = "";
  let dir = "";
  let clipPath = "";
  let songPath = "";
  let realFfmpeg = "";
  let argvLog = "";

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "stack600-passA-"));
    clipPath = join(dir, "clip.mp4");
    songPath = join(dir, "song.mp3");
    argvLog = join(dir, "argv.log");
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

  it("the pass A spawn — and only that spawn — carries -filter_complex_threads 1 at its head; quality args undisturbed", async () => {
    // Shadow `ffmpeg` on PATH with an argv-recording wrapper that
    // delegates everything to the real binary, so the render is real
    // and every spawned command line is captured verbatim.
    const fakeBin = join(dir, "fakebin");
    await mkdir(fakeBin, { recursive: true });
    const wrapper = [
      "#!/bin/sh",
      "{",
      '  echo "===INVOKE==="',
      '  for a in "$@"; do echo "$a"; done',
      '} >> "$BDV_ARGV_LOG"',
      `exec ${realFfmpeg} "$@"`,
      "",
    ].join("\n");
    await writeFile(join(fakeBin, "ffmpeg"), wrapper);
    await chmod(join(fakeBin, "ffmpeg"), 0o755);

    const body = {
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
    } as never;
    const ctx = {
      body,
      userId: "user-1",
      userPlan: "free",
      userSupabase: fakeUserSupabase(),
      log: logStub,
      statusRef: { current: null },
    } as never;

    const prevPath = process.env["PATH"];
    const prevLog = process.env["BDV_ARGV_LOG"];
    process.env["PATH"] = `${fakeBin}:${prevPath ?? ""}`;
    process.env["BDV_ARGV_LOG"] = argvLog;
    try {
      await runExportJobInBackground("job-argv-pin", ctx);
    } finally {
      process.env["PATH"] = prevPath;
      if (prevLog === undefined) delete process.env["BDV_ARGV_LOG"];
      else process.env["BDV_ARGV_LOG"] = prevLog;
    }

    expect(captured.failed).toEqual([]);
    expect(captured.completed).toHaveLength(1);
    expect(captured.completed[0]!.result.watermarked).toBe(true);

    const raw = await readFile(argvLog, "utf8");
    const invocations = raw
      .split("===INVOKE===\n")
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .map((s) => s.split("\n"));
    expect(invocations.length).toBeGreaterThan(1);

    // Exactly ONE spawned command carries the filter-graph cap…
    const capped = invocations.filter((args) => args.includes("-filter_complex_threads"));
    expect(capped).toHaveLength(1);

    // …and it is the pass A encode (identified by its -passA output).
    const passA = capped[0]!;
    expect(passA.some((a) => /-passA\.mp4$/.test(a))).toBe(true);

    // Global-option position: the cap heads the command line, value 1.
    expect(passA[0]).toBe("-filter_complex_threads");
    expect(passA[1]).toBe("1");

    // The pre-existing discipline is undisturbed: an output-position
    // (after the last -i) -threads 1 still bounds the x264 encoder…
    const lastInputIdx = passA.lastIndexOf("-i");
    const outThreadsIdx = passA.indexOf("-threads", lastInputIdx);
    expect(outThreadsIdx).toBeGreaterThan(lastInputIdx);
    expect(passA[outThreadsIdx + 1]).toBe("1");

    // …and the quality contract is byte-identical in kind: CRF and the
    // VBV maxrate are still set on the pass A encode (values are the
    // pipeline's own computed ones — rung 4 changes neither).
    const crfIdx = passA.indexOf("-crf");
    expect(crfIdx).toBeGreaterThan(-1);
    expect(Number(passA[crfIdx + 1])).toBeGreaterThan(0);
    const maxrateIdx = passA.indexOf("-maxrate");
    expect(maxrateIdx).toBeGreaterThan(-1);
    expect(passA[maxrateIdx + 1]).toMatch(/^\d+k$/);
  }, 300_000);
});
