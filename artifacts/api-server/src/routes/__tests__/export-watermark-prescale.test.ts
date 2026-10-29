/**
 * export-watermark-prescale.test.ts — stack700 export-memory.
 *
 * The restart hunt (see stack600 rung 4's forensics + the stack700
 * local reproduction) proved the container deaths at "[export] pass A
 * (video) starting" are a memory-total kill: Node's ~280 MB baseline
 * plus ffmpeg's pass-A working set vs the 512 MB instance, with the
 * watchdog blind (it samples only the Node process). Bisecting the
 * exact gate re-run #3 graph locally (1080x1920, crf 18, effects
 * Film Grain + Blur + Warm Grade, watermark loop):
 *
 *   encode only .................... 119 MB peak RSS
 *   + effects chain ................ 153 MB
 *   + watermark loop (full-size) ... 262 MB   <- the watermark leg
 *   + watermark pre-scaled ......... 205 MB   <- this fix
 *
 * The watermark is fed as a `-loop 1` still and scaled INSIDE the
 * graph, but decoded frames queue ahead of that scale at the
 * source's full size (house mark 1600x1600 RGBA = ~10 MB/frame).
 * The fix pre-scales the feed copy to the exact display width the
 * graph targets, so the in-graph scale becomes an identity and the
 * output is byte-identical (md5-verified locally).
 *
 * Pinned behavior: a branded export spawns exactly one pre-scale
 * invocation (single-frame scale to the graph's watermark width,
 * PNG out), and the pass A invocation's `-loop 1 -i` input is that
 * pre-scaled file — never the full-size original. Proven with the
 * Lane E argv-recording PATH-shadow harness over a real render.
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

describe("watermark feed pre-scale — pass A never loops the full-size original", () => {
  let server: Server;
  let base = "";
  let dir = "";
  let clipPath = "";
  let songPath = "";
  let realFfmpeg = "";
  let argvLog = "";

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "stack700-wmfeed-"));
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

  it("spawns one pre-scale to the graph's watermark width and feeds pass A the scaled copy", async () => {
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
      await runExportJobInBackground("job-wm-prescale", ctx);
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

    // ── The pre-scale spawn: exactly one invocation writes a
    //    bdv-wm-feed-*.png via a -vf scale=<W>:-2 single-frame scale.
    const prescales = invocations.filter((args) =>
      args.some((a) => /bdv-wm-feed-.*\.png$/.test(a)) && args.includes("-vf"),
    );
    expect(prescales).toHaveLength(1);
    const prescale = prescales[0]!;
    const feedPath = prescale.find((a) => /bdv-wm-feed-.*\.png$/.test(a))!;
    const vfIdx = prescale.indexOf("-vf");
    const prescaleWidth = /^scale=(\d+):-2$/.exec(prescale[vfIdx + 1]!)?.[1];
    expect(prescaleWidth).toBeTruthy();
    // Its input is the original image, not the feed file itself.
    const prescaleInput = prescale[prescale.indexOf("-i") + 1]!;
    expect(prescaleInput).not.toContain("bdv-wm-feed-");

    // ── The pass A spawn (the one carrying the rung-4 graph cap):
    //    its -loop input is the pre-scaled feed file, and the graph's
    //    own watermark scale targets the SAME width (so the in-graph
    //    scale is an identity — the output cannot change).
    const passA = invocations.find((args) => args.includes("-filter_complex_threads"))!;
    expect(passA).toBeTruthy();
    const loopIdx = passA.indexOf("-loop");
    expect(loopIdx).toBeGreaterThan(-1);
    expect(passA[loopIdx + 1]).toBe("1");
    expect(passA[loopIdx + 2]).toBe("-i");
    expect(passA[loopIdx + 3]).toBe(feedPath);

    const graph = passA[passA.indexOf("-filter_complex") + 1]!;
    const graphWmWidth = /scale=(\d+):-2,format=rgba/.exec(graph)?.[1];
    expect(graphWmWidth).toBe(prescaleWidth);

    // ── No invocation anywhere loops a full-size original: every
    //    -loop input in the whole render is the pre-scaled feed.
    for (const args of invocations) {
      for (let i = 0; i < args.length; i++) {
        if (args[i] === "-loop") {
          expect(args[i + 2]).toBe("-i");
          expect(args[i + 3]).toBe(feedPath);
        }
      }
    }
  }, 300_000);
});
