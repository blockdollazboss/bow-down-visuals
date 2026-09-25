/**
 * voice-swap.ts — put a generated song's vocals into an artist's locked voice.
 *
 * Pipeline: isolate vocals (Demucs) → ElevenLabs speech-to-speech with the
 * artist's locked voice_id → remix converted vocals over the original
 * instrumental bed. The melody, timing, and arrangement are untouched; only
 * the vocal timbre becomes the artist's voice.
 *
 * On any failure the caller should fall back to the original song — a song
 * in the "wrong" voice is better than no song.
 */
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { separateVocalStems, cleanupWorkdir } from "./stem-separation.js";

const STS_MODEL = process.env["ELEVENLABS_STS_MODEL"] ?? "eleven_english_sts_v2";
const STS_TIMEOUT_MS = Number(process.env["ELEVENLABS_STS_TIMEOUT_MS"] ?? 300_000);
const MIX_TIMEOUT_MS = 120_000;

async function elevenLabsVoiceChange(
  vocalsPath: string,
  voiceId: string,
  apiKey: string,
): Promise<Buffer> {
  const audioBytes = await fs.readFile(vocalsPath);
  // Copy into a fresh Uint8Array<ArrayBuffer> so TS accepts it as a BlobPart.
  const bytes = new Uint8Array(audioBytes.byteLength);
  bytes.set(audioBytes);
  const form = new FormData();
  form.append("audio", new Blob([bytes], { type: "audio/wav" }), "vocals.wav");
  form.append("model_id", STS_MODEL);
  // voice_settings must be a JSON-encoded string in multipart STS requests.
  form.append(
    "voice_settings",
    JSON.stringify({ stability: 0.5, similarity_boost: 0.8 }),
  );

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), STS_TIMEOUT_MS);
  try {
    const res = await fetch(`https://api.elevenlabs.io/v1/speech-to-speech/${voiceId}`, {
      method: "POST",
      headers: { "xi-api-key": apiKey },
      body: form,
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`ElevenLabs voice change failed (${res.status}): ${errText}`.slice(0, 400));
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0) throw new Error("ElevenLabs voice change returned no audio");
    return buf;
  } finally {
    clearTimeout(timer);
  }
}

function mixVocalsOverInstrumental(
  vocalsPath: string,
  instrumentalPath: string,
  outPath: string,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(
      "ffmpeg",
      [
        "-y",
        "-i",
        instrumentalPath,
        "-i",
        vocalsPath,
        "-filter_complex",
        "amix=inputs=2:duration=longest:normalize=0,alimiter=limit=0.95",
        "-c:a",
        "libmp3lame",
        "-b:a",
        "192k",
        outPath,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let stderr = "";
    child.stderr?.on("data", (d: Buffer) => {
      stderr += d.toString();
      if (stderr.length > 2000) stderr = stderr.slice(-2000);
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("Vocal remix timed out"));
    }, MIX_TIMEOUT_MS);
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`Vocal remix failed (code ${code}): ${stderr}`.slice(0, 400)));
    });
  });
}

/**
 * Return a new song buffer with the vocals converted to `voiceId`.
 * Throws on any failure — the caller falls back to the original mix.
 */
export async function swapSongVocalsToVoice(
  songBuffer: Buffer,
  voiceId: string,
  apiKey: string,
): Promise<Buffer> {
  const { vocalsPath, instrumentalPath, workdir } = await separateVocalStems(songBuffer);
  try {
    const convertedVocals = await elevenLabsVoiceChange(vocalsPath, voiceId, apiKey);
    const convertedPath = join(workdir, "vocals-converted.mp3");
    await fs.writeFile(convertedPath, convertedVocals);
    const finalPath = join(workdir, "final.mp3");
    await mixVocalsOverInstrumental(convertedPath, instrumentalPath, finalPath);
    return await fs.readFile(finalPath);
  } finally {
    await cleanupWorkdir(workdir);
  }
}
