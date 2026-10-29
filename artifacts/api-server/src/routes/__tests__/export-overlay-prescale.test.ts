/**
 * export-overlay-prescale.test.ts — stack700 overlay-prescale.
 *
 * Follow-on to the export-memory watermark fix (see
 * export-watermark-prescale.test.ts and the stack700 restart-hunt
 * report): the structured overlay images share the watermark's exact
 * queue mechanism. A user's logo enters pass A as a `-loop 1` still
 * input and is scaled INSIDE the graph to its display width
 * (`ov.size` % of the frame) — but decoded frames QUEUE ahead of that
 * scale filter at the SOURCE's full size. Overlay sources are
 * arbitrary user uploads: a 4000x4000 logo queues ~64 MB per RGBA
 * frame ahead of a scale down to a few hundred px, stacked on the
 * same container-total spike the hunt proved kills the 512 MB
 * instance seconds after "pass A starting" (Node's ~280 MB baseline
 * + ffmpeg's working set; the memory watchdog samples only the Node
 * process and cannot see any of it).
 *
 * The fix mirrors §4.5 — pre-scale the feed copy ONCE to the exact
 * width the graph scales to (hoisted `overlayImgWidths`, one source
 * of truth shared with the graph) — behind an IDENTITY GATE: only
 * PNG sources are pre-scaled. Byte-identity was md5-verified locally
 * for PNG in every encoding a logo carries (rgba, pal8, rgb24: the
 * pre-scaled render is byte-identical to the full-size render), and
 * md5-DISPROVEN for JPEG and WebP: the in-graph scaler negotiates a
 * different intermediate format for lossy sources than a standalone
 * pre-scale does, and both candidate chains (format-before-scale,
 * format-after-scale) drift from today's bytes. Lossy sources
 * therefore keep today's full-size feed exactly — no output change,
 * no regression — and the skip is logged. Measured locally (pass-A
 * shape, sibling repro settings): one 4000x4000 PNG logo loop peaks
 * ffmpeg at ~545 MB full-size vs ~177 MB pre-scaled; a PNG+JPEG pair
 * peaks ~643 MB with both legs full-size.
 *
 * Pinned behavior: an export with one PNG and one JPEG overlay image
 * spawns exactly ONE pre-scale invocation (the PNG item, to its
 * graph width), pass A's `-loop 1 -i` inputs are the PNG's pre-
 * scaled feed file and the JPEG's untouched full-size download, and
 * no invocation loops the PNG's full-size download. Proven with the
 * argv-recording PATH-shadow harness over a real render (the gate's
 * ffprobe resolves to the real ffprobe and probes the real
 * downloads, so the gate behaves exactly as in production).
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

const NO_WATERMARK_BRANDING = {
  introCard: { enabled: false, artistName: "", songTitle: "", tagline: "", duration: 3, stylePreset: "luxury-dark" },
  outroCard: { enabled: false, textLine1: "", textLine2: "", ctaPreset: "follow-for-more", customCtaText: "", duration: 3, stylePreset: "luxury-dark" },
  watermark: { enabled: false, bdvWatermark: true, customLogoUrl: null, position: "bottom-right", opacity: "medium", size: "medium" },
  titleOverlay: { showArtistName: false, artistNameText: "", showSongTitle: false, showSectionLabels: false, stylePreset: "clean-white" },
};

const PROJECT_ID = "e2401c06-ecef-478b-ae29-9158fe36cbb1";

// Graph display widths for the two overlay items below at the 9:16
// target (1080 wide): item 0 at size 20% -> 216, item 1 at 50% -> 540.
const EXPECTED_WIDTHS = [216, 540];

describe("overlay image feed pre-scale — PNG feeds pre-scaled, lossy feeds untouched (identity gate)", () => {
  let server: Server;
  let base = "";
  let dir = "";
  let clipPath = "";
  let songPath = "";
  let logoPngPath = "";
  let logoJpgPath = "";
  let realFfmpeg = "";
  let argvLog = "";

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "stack700-ovfeed-"));
    clipPath = join(dir, "clip.mp4");
    songPath = join(dir, "song.mp3");
    logoPngPath = join(dir, "logo.png");
    logoJpgPath = join(dir, "logo.jpg");
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
    // Oversized user-logo stand-ins: a 1200x1200 RGBA PNG and a
    // 1000x800 JPEG — both far larger than their display widths.
    await execFileAsync("ffmpeg", [
      "-y", "-f", "lavfi", "-i", "color=c=0x3366cc:size=1200x1200:duration=1",
      "-frames:v", "1", "-pix_fmt", "rgba", logoPngPath,
    ], { timeout: 60_000 });
    await execFileAsync("ffmpeg", [
      "-y", "-f", "lavfi", "-i", "color=c=0xcc6633:size=1000x800:duration=1",
      "-frames:v", "1", "-pix_fmt", "yuv420p", logoJpgPath,
    ], { timeout: 60_000 });

    const which = await execFileAsync("which", ["ffmpeg"]);
    realFfmpeg = which.stdout.trim().split("\n")[0]!;
    expect(realFfmpeg.length).toBeGreaterThan(0);

    const files: Record<string, { path: string; type: string }> = {
      "clip.mp4": { path: clipPath, type: "video/mp4" },
      "song.mp3": { path: songPath, type: "audio/mpeg" },
      "logo.png": { path: logoPngPath, type: "image/png" },
      "logo.jpg": { path: logoJpgPath, type: "image/jpeg" },
    };
    server = createServer((req, res) => {
      const entry = files[(req.url ?? "").replace("/", "")];
      if (!entry) { res.statusCode = 404; res.end(); return; }
      void readFile(entry.path).then((buf) => {
        res.setHeader("Content-Type", entry.type);
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

  it("pre-scales the PNG overlay item to its graph width, feeds the JPEG item full-size (identity gate)", async () => {
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
      addWatermark: false,
      aiDisclosure: true,
      customWatermarkUrl: null,
      watermarkTheme: "dark",
      watermarkPosition: "bottom-right",
      watermarkSize: "medium",
      watermarkMargin: 16,
      audioSource: "uploaded",
      captions: null,
      captionExportMode: "burn",
      branding: NO_WATERMARK_BRANDING,
      exportRangeStart: null,
      exportRangeEnd: null,
      clipTransitions: [null],
      clipProTools: [null],
      manualGapsBeforeSec: null,
      effects: null,
      overlayItems: [
        { type: "image", source: `${base}/logo.png`, size: 20, position: "bottom-right", opacity: 80 },
        { type: "watermark", source: `${base}/logo.jpg`, size: 50, position: "top-left", opacity: 100 },
      ],
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
      await runExportJobInBackground("job-ov-prescale", ctx);
    } finally {
      process.env["PATH"] = prevPath;
      if (prevLog === undefined) delete process.env["BDV_ARGV_LOG"];
      else process.env["BDV_ARGV_LOG"] = prevLog;
    }

    expect(captured.failed).toEqual([]);
    expect(captured.completed).toHaveLength(1);

    const raw = await readFile(argvLog, "utf8");
    const invocations = raw
      .split("===INVOKE===\n")
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .map((s) => s.split("\n"));
    expect(invocations.length).toBeGreaterThan(1);

    // ── The pre-scale spawns: exactly ONE — the PNG item (idx 0), a
    //    single-frame -vf scale=<W>:-2 writing bdv-ovimg-feed-*-0.png
    //    from that item's downloaded original. The JPEG item (idx 1)
    //    is outside the byte-identical class: no pre-scale for it.
    const prescales = invocations.filter((args) =>
      args.some((a) => /bdv-ovimg-feed-.*\.png$/.test(a)) && args.includes("-vf"),
    );
    expect(prescales).toHaveLength(1);
    const prescale = prescales[0]!;
    const pngFeedPath = prescale.find((a) => /bdv-ovimg-feed-.*\.png$/.test(a))!;
    expect(pngFeedPath).toMatch(/-0\.png$/);
    const vfIdx = prescale.indexOf("-vf");
    expect(prescale[vfIdx + 1]).toBe(`scale=${EXPECTED_WIDTHS[0]}:-2`);
    // Its input is the PNG item's full-size download, not a feed file.
    const prescaleInput = prescale[prescale.indexOf("-i") + 1]!;
    expect(prescaleInput).toContain("bdv-ovimg-");
    expect(prescaleInput).not.toContain("bdv-ovimg-feed-");
    expect(prescaleInput).toMatch(/-0\.png$/);

    // ── The pass A spawn (the one carrying the rung-4 graph cap):
    //    its -loop inputs, in item order, are the PNG's pre-scaled
    //    feed file and the JPEG's untouched full-size download; the
    //    graph's overlay scales target the SAME widths as always
    //    (so the PNG's in-graph scale is an identity and the JPEG's
    //    render path is bit-for-bit today's).
    const passA = invocations.find((args) => args.includes("-filter_complex_threads"))!;
    expect(passA).toBeTruthy();
    const passALoops: string[] = [];
    for (let i = 0; i < passA.length; i++) {
      if (passA[i] === "-loop") {
        expect(passA[i + 1]).toBe("1");
        expect(passA[i + 2]).toBe("-i");
        passALoops.push(passA[i + 3]!);
      }
    }
    expect(passALoops).toHaveLength(2);
    expect(passALoops[0]).toBe(pngFeedPath);
    expect(passALoops[1]).toContain("bdv-ovimg-");
    expect(passALoops[1]).not.toContain("bdv-ovimg-feed-");
    expect(passALoops[1]).toMatch(/-1\.jpe?g$/);
    const jpgOriginalPath = passALoops[1]!;

    const graph = passA[passA.indexOf("-filter_complex") + 1]!;
    const graphWidths = [...graph.matchAll(/scale=(\d+):-2,format=rgba/g)].map((m) => Number(m[1]));
    expect(graphWidths).toEqual(EXPECTED_WIDTHS);

    // ── No invocation anywhere loops the PNG's full-size download;
    //    the only -loop inputs in the whole render are the two above.
    for (const args of invocations) {
      for (let i = 0; i < args.length; i++) {
        if (args[i] === "-loop") {
          expect([pngFeedPath, jpgOriginalPath]).toContain(args[i + 3]);
        }
      }
    }
  }, 300_000);
});
