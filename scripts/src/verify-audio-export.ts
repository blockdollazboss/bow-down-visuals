/**
 * End-to-end verification that /api/export-final-video produces an output
 * video whose audio track actually reflects the requested studio mix — not
 * silence and not a stale/mismatched source.
 *
 * Covers:
 *  1. A selected studio mix ends up as the exported audio (distinguishable
 *     via a unique test tone frequency).
 *  2. The "no mix rendered" fallback path (uploaded song) also ends up
 *     correctly embedded, matching its own tone.
 *  3. Fade-in/out actually reduces volume near the edges of the clip.
 *  4. "Match video length" trims audio to the video duration instead of the
 *     (longer) source audio duration.
 *  5. The real Music Studio preview render audibly distinguishes dark,
 *     balanced, and bright master EQ tones.
 *
 * Run with: pnpm --filter @workspace/scripts run verify:audio-export
 * Requires the API Server workflow to be running (default http://127.0.0.1:8080).
 */
import { execFile } from "child_process";
import { promisify } from "util";
import { createServer } from "http";
import { readFile, writeFile, mkdtemp, rm } from "fs/promises";
import path from "path";
import os from "os";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";

const execFileAsync = promisify(execFile);

const API_ORIGIN = process.env["API_ORIGIN"] ?? "http://127.0.0.1:8080";
const SUPABASE_URL = process.env["SUPABASE_URL"] ?? process.env["VITE_SUPABASE_URL"] ?? "";
const SUPABASE_ANON_KEY = process.env["SUPABASE_ANON_KEY"] ?? process.env["VITE_SUPABASE_ANON_KEY"] ?? "";
const SUPABASE_SERVICE_ROLE_KEY = process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "";

let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(condition: boolean, message: string) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    failures.push(message);
    console.log(`  ✗ ${message}`);
  }
}

async function run(cmd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync(cmd, args, { timeout: 60_000 });
}

/* ── Build tiny synthetic test assets ─────────────────────────────────── */
async function makeSilentClip(dest: string, durationSec: number) {
  await run("ffmpeg", [
    "-y", "-f", "lavfi", "-i", `color=c=black:s=640x360:d=${durationSec}:r=30`,
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-t", String(durationSec), dest,
  ]);
}

async function makeTone(dest: string, freqHz: number, durationSec: number) {
  await run("ffmpeg", [
    "-y", "-f", "lavfi", "-i", `sine=frequency=${freqHz}:duration=${durationSec}`,
    "-c:a", "libmp3lame", "-b:a", "128k", dest,
  ]);
}

async function makeEqTestTone(dest: string, durationSec: number) {
  await run("ffmpeg", [
    "-y",
    "-f", "lavfi", "-i", `sine=frequency=120:duration=${durationSec}`,
    "-f", "lavfi", "-i", `sine=frequency=8000:duration=${durationSec}`,
    "-filter_complex",
    "[0:a]volume=0.5[low];[1:a]volume=0.5[high];[low][high]amix=inputs=2:duration=longest:normalize=0,aresample=48000",
    "-c:a", "pcm_s16le",
    dest,
  ]);
}
/* ── ffprobe / ffmpeg analysis helpers ────────────────────────────────── */
async function probe(filePath: string) {
  const { stdout } = await run("ffprobe", [
    "-v", "quiet", "-print_format", "json", "-show_streams", "-show_format", filePath,
  ]);
  const info = JSON.parse(stdout) as {
    streams?: { codec_type?: string }[];
    format?: { duration?: string };
  };
  return {
    hasAudio: !!info.streams?.some((s) => s.codec_type === "audio"),
    hasVideo: !!info.streams?.some((s) => s.codec_type === "video"),
    duration: parseFloat(info.format?.duration ?? "0"),
  };
}

/** Mean volume (dBFS) of the given file/segment, optionally band-limited around a frequency. */
async function meanVolumeDb(filePath: string, opts: { start?: number; duration?: number; bandpassHz?: number } = {}): Promise<number> {
  const args = ["-y"];
  if (opts.start !== undefined) args.push("-ss", String(opts.start));
  args.push("-i", filePath);
  if (opts.duration !== undefined) args.push("-t", String(opts.duration));
  const filters: string[] = [];
  if (opts.bandpassHz) filters.push(`bandpass=f=${opts.bandpassHz}:width_type=h:w=40`);
  filters.push("volumedetect");
  args.push("-af", filters.join(","), "-f", "null", "-");
  const { stderr } = await run("ffmpeg", args);
  const match = stderr.match(/mean_volume:\s*(-?[\d.]+)\s*dB/);
  if (!match) throw new Error(`Could not parse mean_volume from ffmpeg output for ${filePath}`);
  return parseFloat(match[1]!);
}

/* ── Auth: create a throwaway confirmed test user via the service role ── */
async function getTestAccessToken(): Promise<{
  token: string;
  userId: string;
  uploadStem: (filePath: string) => Promise<string>;
  cleanup: () => Promise<void>;
}> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Missing SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY env vars");
  }
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });

  const email = `bdv-audio-export-test-${randomUUID().slice(0, 8)}@gmail.com`;
  const password = `Test-${randomUUID()}`;
  const uploadedStoragePaths: string[] = [];

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
  });
  if (createErr || !created.user) {
    throw new Error(`Failed to create test user: ${createErr?.message}`);
  }

  // The export route charges credits outside development. Provision the
  // throwaway account explicitly so this check is valid in deployment builds,
  // where NODE_ENV is production and the profile trigger may otherwise give
  // the new user only the normal free-tier allowance.
  const { error: profileErr } = await admin.from("profiles").upsert({
    id: created.user.id,
    email,
    plan: "free",
    credits: 100,
  }, { onConflict: "id" });
  if (profileErr) {
    await admin.auth.admin.deleteUser(created.user.id).catch(() => { /* best-effort */ });
    throw new Error(`Failed to provision test user credits: ${profileErr.message}`);
  }

  const { data: signIn, error: signInErr } = await anon.auth.signInWithPassword({ email, password });
  if (signInErr || !signIn.session) {
    await admin.from("profiles").delete().eq("id", created.user.id);
    await admin.auth.admin.deleteUser(created.user.id).catch(() => { /* best-effort */ });
    throw new Error(`Failed to sign in test user: ${signInErr?.message}`);
  }

  const userId = created.user.id;
  return {
    token: signIn.session.access_token,
    userId,
    uploadStem: async (filePath: string) => {
      const storagePath = `${userId}/e2e-${randomUUID()}.wav`;
      const file = await readFile(filePath);
      const { error } = await admin.storage.from("audio-stems").upload(storagePath, file, {
        contentType: "audio/wav",
        upsert: false,
      });
      if (error) throw new Error(`Failed to upload EQ test stem: ${error.message}`);
      uploadedStoragePaths.push(storagePath);
      const { data } = admin.storage.from("audio-stems").getPublicUrl(storagePath);
      return data.publicUrl;
    },
    cleanup: async () => {
      if (uploadedStoragePaths.length > 0) {
        await admin.storage.from("audio-stems").remove(uploadedStoragePaths).catch(() => { /* best-effort */ });
      }
      await admin.from("profiles").delete().eq("id", userId);
      await admin.auth.admin.deleteUser(userId).catch(() => { /* best-effort */ });
    },
  };
}

/* ── Export API call ──────────────────────────────────────────────────── */
interface ExportBody {
  projectId: string;
  clipUrls: string[];
  audioUrl?: string | null;
  audioSource?: string;
  fadeAudioInSec?: number;
  fadeAudioOutSec?: number;
  matchVideoLength?: boolean;
  loopAudio?: boolean;
  exportRangeStart?: number;
  exportRangeEnd?: number;
}

/**
 * Mirrors the fallback branch of `resolveVideoAudioUrl()`
 * (artifacts/bow-down-visuals/src/lib/resolve-video-audio-url.ts) — the
 * client-side function that decides which audio URL to send to export when
 * a studio mix is selected. `scripts` cannot import from an artifact
 * package directly, so this intentionally duplicates just the "mix
 * selected but not rendered" branch: it resolves to the fallback (uploaded
 * song / first stem) URL, exactly like the real client does, while the
 * `audioSource` label sent to the server stays "full-mix" (the user's
 * actual selection) — the server never re-derives the label, it just
 * downloads whatever URL is handed to it. This is what lets this script
 * prove a *true* fallback: audioSource claims "full-mix" but the resolved
 * URL — and therefore the embedded audio — is the uploaded song.
 */
function resolveFallbackAudioUrl(mixRenderedUrl: string | null, uploadedSongUrl: string): string {
  return mixRenderedUrl ?? uploadedSongUrl;
}

async function callExport(token: string, body: ExportBody): Promise<{ url: string; audioIncluded: boolean; duration: number }> {
  const res = await fetch(`${API_ORIGIN}/api/export-final-video`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const json = await res.json() as { url?: string; audioIncluded?: boolean; duration?: number; error?: string };
  if (!res.ok || !json.url) {
    throw new Error(`Export failed (HTTP ${res.status}): ${json.error ?? JSON.stringify(json)}`);
  }
  return { url: json.url, audioIncluded: !!json.audioIncluded, duration: json.duration ?? 0 };
}

interface PreviewBody {
  stems: {
    id: string;
    name: string;
    type: string;
    url: string;
    volume: number;
    muted: boolean;
    solo: boolean;
    pan: number;
    trimStart: number;
    trimEnd: number;
  }[];
  masterVolume: number;
  masterSettings: {
    volume: number;
    compression: number;
    stereoWidth: number;
    bassBoost: number;
    eqTone: "dark" | "balanced" | "bright";
    loudnessTarget: "demo" | "streaming" | "loud";
    limiter: boolean;
    fadeIn: boolean;
    fadeOut: boolean;
  };
  previewSeconds: number;
}

async function callPreview(token: string, body: PreviewBody): Promise<Buffer> {
  const res = await fetch(`${API_ORIGIN}/api/music/preview-render`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Preview render failed (HTTP ${res.status}): ${text}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

async function main() {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "bdv-audio-verify-"));
  const workDir = tmpDir;

  console.log("Building synthetic test assets...");
  const clipShortPath = path.join(workDir, "clip-4s.mp4");
  const clipLongPath = path.join(workDir, "clip-6s.mp4");
  const clipRangePath = path.join(workDir, "clip-10s.mp4");
  const mixTonePath = path.join(workDir, "mix-600hz.mp3");
  const songTonePath = path.join(workDir, "song-300hz.mp3");
  const longTonePath = path.join(workDir, "song-300hz-10s.mp3");
  const eqTonePath = path.join(workDir, "eq-low-high.wav");

  const MIX_FREQ = 600;
  const SONG_FREQ = 300;

  await Promise.all([
    makeSilentClip(clipShortPath, 4),
    makeSilentClip(clipLongPath, 6),
    makeSilentClip(clipRangePath, 10),
    makeTone(mixTonePath, MIX_FREQ, 12),
    makeTone(songTonePath, SONG_FREQ, 12),
    makeTone(longTonePath, SONG_FREQ, 10),
    makeEqTestTone(eqTonePath, 12),
  ]);

  // Serve the synthetic assets over a plain local HTTP server so the API
  // server's downloadToFile() can fetch them exactly like a real Supabase URL.
  const server = createServer((req, res) => {
    (async () => {
      const filePath = path.join(workDir, decodeURIComponent(req.url ?? "").replace(/^\/+/, ""));
      try {
        const buf = await readFile(filePath);
        res.writeHead(200, { "Content-Type": filePath.endsWith(".mp3") ? "audio/mpeg" : "video/mp4" });
        res.end(buf);
      } catch {
        res.writeHead(404);
        res.end();
      }
    })().catch(() => { res.writeHead(500); res.end(); });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  const base = `http://127.0.0.1:${port}`;

  console.log("Creating throwaway Supabase test user...");
  const { token, uploadStem, cleanup } = await getTestAccessToken();

  const downloadedFiles: string[] = [];
  async function downloadOutput(url: string, name: string): Promise<string> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to download export output: HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const dest = path.join(workDir, name);
    await writeFile(dest, buf);
    downloadedFiles.push(dest);
    return dest;
  }

  try {
    /* ── Test 1: short-range export with a studio mix selected → output audio must be the mix tone ── */
    console.log("\n[1] Short-range export with a studio mix selected is sourced from the mix (not the uploaded song)");
    {
      const rangeStart = 2;
      const rangeEnd = 5; // 3s range out of a 10s clip
      const { url, audioIncluded } = await callExport(token, {
        projectId: randomUUID(),
        clipUrls: [`${base}/clip-10s.mp4`],
        audioUrl: resolveFallbackAudioUrl(`${base}/mix-600hz.mp3`, `${base}/song-300hz.mp3`),
        audioSource: "full-mix",
        exportRangeStart: rangeStart,
        exportRangeEnd: rangeEnd,
      });
      assert(audioIncluded, "server reports audioIncluded=true");
      const outPath = await downloadOutput(url, "out-mix-range.mp4");
      const info = await probe(outPath);
      assert(info.hasAudio, "output file has an audio stream");
      assert(Math.abs(info.duration - (rangeEnd - rangeStart)) < 0.5, `output duration ≈ ${rangeEnd - rangeStart}s (the requested range, not the full 10s clip), got ${info.duration.toFixed(2)}s`);
      const mixVol = await meanVolumeDb(outPath, { bandpassHz: MIX_FREQ });
      const songVol = await meanVolumeDb(outPath, { bandpassHz: SONG_FREQ });
      assert(mixVol > songVol + 6, `output audio energy at mix tone (${MIX_FREQ}Hz, ${mixVol.toFixed(1)}dB) dominates over the uploaded-song tone (${SONG_FREQ}Hz, ${songVol.toFixed(1)}dB)`);
    }

    /* ── Test 2: true fallback — mix selected but not rendered → export uses the uploaded song ── */
    console.log("\n[2] Fallback: studio mix selected but unavailable → export falls back to the uploaded song");
    {
      // Simulates the exact scenario resolveVideoAudioUrl() handles client-side:
      // the user's chosen source is still "full-mix" (mixRenderedUrl is null,
      // as if the mix was never rendered or was deleted), so the resolved URL
      // — and therefore the embedded audio — must be the uploaded song, not
      // the mix and not silence, even though the request still labels the
      // selection as "full-mix".
      const resolvedAudioUrl = resolveFallbackAudioUrl(null, `${base}/song-300hz.mp3`);
      assert(resolvedAudioUrl === `${base}/song-300hz.mp3`, "fallback resolution picks the uploaded song when no mix is rendered");

      const { url, audioIncluded } = await callExport(token, {
        projectId: randomUUID(),
        clipUrls: [`${base}/clip-4s.mp4`],
        audioUrl: resolvedAudioUrl,
        audioSource: "full-mix",
        matchVideoLength: true,
      });
      assert(audioIncluded, "server reports audioIncluded=true");
      const outPath = await downloadOutput(url, "out-fallback.mp4");
      const info = await probe(outPath);
      assert(info.hasAudio, "output file has an audio stream");
      const mixVol = await meanVolumeDb(outPath, { bandpassHz: MIX_FREQ });
      const songVol = await meanVolumeDb(outPath, { bandpassHz: SONG_FREQ });
      assert(songVol > mixVol + 6, `output audio energy at the uploaded-song tone (${SONG_FREQ}Hz, ${songVol.toFixed(1)}dB) dominates over the mix tone (${MIX_FREQ}Hz, ${mixVol.toFixed(1)}dB), proving the fallback — not the (unavailable) mix — was embedded`);
    }

    /* ── Test 3: fade-in/out reduce volume at the clip edges ── */
    console.log("\n[3] Fade-in/out audibly reduce volume near the start/end");
    {
      const { url } = await callExport(token, {
        projectId: randomUUID(),
        clipUrls: [`${base}/clip-6s.mp4`],
        audioUrl: `${base}/mix-600hz.mp3`,
        audioSource: "full-mix",
        matchVideoLength: true,
        fadeAudioInSec: 1,
        fadeAudioOutSec: 1,
      });
      const outPath = await downloadOutput(url, "out-fade.mp4");
      const info = await probe(outPath);
      assert(Math.abs(info.duration - 6) < 0.5, `output duration ≈ 6s, got ${info.duration.toFixed(2)}s`);
      const startVol = await meanVolumeDb(outPath, { start: 0, duration: 0.3 });
      const midVol = await meanVolumeDb(outPath, { start: 2.8, duration: 0.4 });
      const endVol = await meanVolumeDb(outPath, { start: 5.7, duration: 0.3 });
      assert(startVol < midVol - 6, `start of clip is quieter than the middle (start ${startVol.toFixed(1)}dB vs mid ${midVol.toFixed(1)}dB) — fade-in applied`);
      assert(endVol < midVol - 6, `end of clip is quieter than the middle (end ${endVol.toFixed(1)}dB vs mid ${midVol.toFixed(1)}dB) — fade-out applied`);
    }

    /* ── Test 4: match-length trims a longer audio track to the video length ── */
    console.log("\n[4] Match video length trims a longer audio track instead of extending the video");
    {
      const { url } = await callExport(token, {
        projectId: randomUUID(),
        clipUrls: [`${base}/clip-4s.mp4`],
        audioUrl: `${base}/song-300hz-10s.mp3`,
        audioSource: "uploaded",
        matchVideoLength: true,
        loopAudio: false,
      });
      const outPath = await downloadOutput(url, "out-matchlength.mp4");
      const info = await probe(outPath);
      assert(Math.abs(info.duration - 4) < 0.5, `output duration ≈ 4s (video length, not the 10s audio length), got ${info.duration.toFixed(2)}s`);
    }

    /* ── Test 5: real Music Studio master EQ — compare measured spectral tilt ── */
    console.log("\n[5] Dark, balanced, and bright master EQ tones produce distinct audible spectral tilt");
    {
      const eqStemUrl = await uploadStem(eqTonePath);
      const eqFrequencies = { low: 120, high: 8000 };
      const tiltByTone: Record<PreviewBody["masterSettings"]["eqTone"], number> = {
        dark: 0,
        balanced: 0,
        bright: 0,
      };

      for (const eqTone of ["dark", "balanced", "bright"] as const) {
        const outputPath = path.join(workDir, `out-eq-${eqTone}.mp3`);
        const output = await callPreview(token, {
          stems: [{
            id: "eq-test-stem",
            name: "EQ Test Composite",
            type: "Full Song Mix",
            url: eqStemUrl,
            volume: 100,
            muted: false,
            solo: false,
            pan: 0,
            trimStart: 0,
            trimEnd: 0,
          }],
          masterVolume: 100,
          masterSettings: {
            volume: 100,
            compression: 0,
            stereoWidth: 50,
            bassBoost: 0,
            eqTone,
            loudnessTarget: "streaming",
            limiter: false,
            fadeIn: false,
            fadeOut: false,
          },
          previewSeconds: 5,
        });
        await writeFile(outputPath, output);
        const lowDb = await meanVolumeDb(outputPath, { start: 1, duration: 2, bandpassHz: eqFrequencies.low });
        const highDb = await meanVolumeDb(outputPath, { start: 1, duration: 2, bandpassHz: eqFrequencies.high });
        tiltByTone[eqTone] = highDb - lowDb;
        assert(
          lowDb > -80 && highDb > -80,
          `${eqTone} render contains measurable low/high test tones (${lowDb.toFixed(1)}dB / ${highDb.toFixed(1)}dB)`,
        );
      }

      assert(
        tiltByTone.dark < tiltByTone.balanced - 1,
        `dark EQ shifts energy toward lows (${tiltByTone.dark.toFixed(1)}dB high-minus-low vs balanced ${tiltByTone.balanced.toFixed(1)}dB)`,
      );
      assert(
        tiltByTone.bright > tiltByTone.balanced + 1,
        `bright EQ shifts energy toward highs (${tiltByTone.bright.toFixed(1)}dB high-minus-low vs balanced ${tiltByTone.balanced.toFixed(1)}dB)`,
      );
      assert(
        tiltByTone.dark < tiltByTone.balanced && tiltByTone.balanced < tiltByTone.bright,
        `balanced EQ stays between dark and bright (${tiltByTone.dark.toFixed(1)}dB < ${tiltByTone.balanced.toFixed(1)}dB < ${tiltByTone.bright.toFixed(1)}dB)`,
      );
    }
  } finally {
    server.close();
    await cleanup();
    await rm(workDir, { recursive: true, force: true }).catch(() => { /* best-effort */ });
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log("\nFailures:");
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("verify-audio-export failed:", err);
  process.exit(1);
});
