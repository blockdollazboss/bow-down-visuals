/**
 * podcast-dialogue.ts — Multi-speaker dialogue backend.
 *
 *  POST /api/podcast/dialogue          render a tagged multi-speaker script
 *                                     into one finished MP3 via ElevenLabs
 *                                     `/v1/text-to-dialogue`
 *  GET  /api/podcast/dialogue/status  feature gate status (key configured?
 *                                     pricing approved?) — powers the
 *                                     frontend's disabled-state banner
 *
 * Script format: one speaker per line, tagged with a name —
 *
 *   ALEX: Welcome back to the show.
 *   JORDAN: Thanks for having me!
 *
 * Each tagged speaker is mapped to an ElevenLabs voice_id on the client;
 * the server re-parses the script and refuses any turn whose speaker has
 * no assigned voice. This is NOT the regular TTS path — `/v1/text-to-dialogue`
 * renders the whole conversation in a single provider call with natural
 * turn-taking, instead of stitching per-voice TTS clips.
 *
 * ── PRICING: PLACEHOLDER — NOT APPROVED ──────────────────────────────
 * DIALOGUE_CREDITS_PER_10MIN (default 3, env-overridable) is a PROPOSAL.
 * DIALOGUE_PRICING_APPROVED is false until the user explicitly approves
 * the price in a reviewed commit — never flip as a drive-by. While false,
 * the server refuses every dialogue request BEFORE any provider call,
 * any credit check, or any charge: nothing generates and nothing moves.
 * ─────────────────────────────────────────────────────────────────────
 *
 * Key gate: ELEVENLABS_API_KEY (same key as the podcast TTS path). When
 * missing, the route 503s with a clear message and the frontend shows a
 * disabled banner instead of the builder.
 */
import { Router } from "express";
import { z } from "zod";
import { randomUUID } from "crypto";
import { execFile } from "child_process";
import { promisify } from "util";
import { writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { requireAuth } from "../../middlewares/require-auth";
import {
  chargeCredits,
  refundCredits,
  OutOfCreditsError,
} from "../../lib/credits";
import { publicApiLimiter } from "../../lib/rate-limit";
import { logger } from "../../lib/logger";
import { refreshSupabaseStorageUrl, uploadMediaToSupabaseStorage } from "../../lib/objectStorage";
import {
  attributionOptIn,
  ATTRIBUTION_TEXT,
} from "../../lib/attribution";
import {
  assembleEpisode,
  probeDurationSeconds,
  WORDS_PER_MINUTE,
  buildPodcastRss,
} from "./podcast";

const router = Router();
const execFileAsync = promisify(execFile);

/* ── Pricing (PLACEHOLDER — see header) ────────────────────────────── */

/**
 * PLACEHOLDER — NOT USER-APPROVED. Proposed: 3 Visual Bucs per 10 minutes
 * of finished dialogue audio (mirrors the podcast studio rate). Env override
 * exists so ops can tune without a code change, but the FINAL price needs
 * the user's explicit approval — see DIALOGUE_PRICING_APPROVED.
 */
export const DIALOGUE_CREDITS_PER_10MIN =
  Number(process.env["DIALOGUE_CREDITS_PER_10MIN"]) || 3;

/** Seconds per billable block (mirrors podcast studio). */
export const DIALOGUE_SECONDS_PER_BLOCK = 600;

/** Explicit approval gate (same pattern as VEO_PRICING_APPROVED). */
export const DIALOGUE_PRICING_APPROVED = false;
/** Bump when the proposed rate changes, so an approval is tied to a version. */
export const DIALOGUE_PRICING_VERSION = "2026-10-11-placeholder";

/** Hard cap on script length (~40 minutes of audio). */
export const MAX_DIALOGUE_SCRIPT_CHARS = 36_000;

/** Max characters per text-to-dialogue input (chunked at sentence bounds). */
export const DIALOGUE_INPUT_CHARS = 2_000;

/** Max dialogue turns per request (provider-side sanity cap). */
export const MAX_DIALOGUE_TURNS = 60;

/** Max speakers per dialogue (keeps the voice-assignment UI sane). */
export const MAX_DIALOGUE_SPEAKERS = 8;

function elevenKey(): string | undefined {
  return process.env["ELEVENLABS_API_KEY"];
}

/* ── Cost estimation (mirrored in frontend lib — keep in sync) ────────── */

export interface DialogueEstimate {
  wordCount: number;
  estimatedSeconds: number;
  billableBlocks: number;
  credits: number;
  turnCount: number;
  speakerCount: number;
}

export function estimateDialogueCost(script: string): DialogueEstimate {
  const { turns, speakers } = parseDialogueScript(script);
  const wordCount = turns
    .join(" ")
    .split(/\s+/)
    .filter(Boolean).length;
  const estimatedSeconds = Math.ceil((wordCount / WORDS_PER_MINUTE) * 60);
  const billableBlocks = Math.max(1, Math.ceil(estimatedSeconds / DIALOGUE_SECONDS_PER_BLOCK));
  return {
    wordCount,
    estimatedSeconds,
    billableBlocks,
    credits: billableBlocks * DIALOGUE_CREDITS_PER_10MIN,
    turnCount: turns.length,
    speakerCount: speakers.length,
  };
}

/* ── Script parsing ──────────────────────────────────────────────────── */

export interface DialogueTurn {
  speaker: string;
  text: string;
}

/** `NAME: line` — names are 1-30 chars, letters/digits/spaces/dashes. */
const SPEAKER_TAG_RE = /^([A-Za-z][A-Za-z0-9 _-]{0,29}):\s*(.+)$/;

/**
 * Split a tagged script into turns. Untagged non-empty lines are dropped
 * (the UI warns about them) — dialogue needs explicit speaker tags so the
 * right voice reads every line.
 */
export function parseDialogueScript(script: string): {
  turns: DialogueTurn[];
  speakers: string[];
  untaggedLines: number;
} {
  const turns: DialogueTurn[] = [];
  const speakerOrder: string[] = [];
  const seen = new Set<string>();
  let untaggedLines = 0;

  for (const rawLine of script.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    if (/^#{1,3}\s+/.test(line)) continue; // ignore markdown headings
    const m = line.match(SPEAKER_TAG_RE);
    if (!m) {
      untaggedLines++;
      continue;
    }
    const speaker = m[1]!.trim();
    const text = m[2]!.trim();
    if (!text) {
      untaggedLines++;
      continue;
    }
    if (!seen.has(speaker)) {
      seen.add(speaker);
      speakerOrder.push(speaker);
    }
    turns.push({ speaker, text });
  }
  return { turns, speakers: speakerOrder, untaggedLines };
}

/**
 * Chunk long text at sentence boundaries so no text-to-dialogue input
 * exceeds the provider's per-input text limit.
 */
function chunkDialogueText(text: string, maxChars: number = DIALOGUE_INPUT_CHARS): string[] {
  if (text.length <= maxChars) return [text];
  const sentences = text.match(/[^.!?]+[.!?]+["']?\s*|[^.!?]+$/g) ?? [text];
  const chunks: string[] = [];
  let current = "";
  for (const s of sentences) {
    if ((current + s).length > maxChars && current) {
      chunks.push(current.trim());
      current = s;
    } else {
      current += s;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.length > 0 ? chunks : [text];
}

/* ── ElevenLabs text-to-dialogue ─────────────────────────────────────── */

interface DialogueInput {
  text: string;
  voice_id: string;
}

async function dialogueToFile(
  apiKey: string,
  inputs: DialogueInput[],
  outPath: string,
): Promise<void> {
  const res = await fetch("https://api.elevenlabs.io/v1/text-to-dialogue", {
    method: "POST",
    headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      inputs,
      settings: {
        stability: 0.5,
        similarity_boost: 0.75,
        style: 0.0,
        use_speaker_boost: true,
        speed: 1.0,
      },
    }),
    signal: AbortSignal.timeout(180_000),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    logger.error(
      { status: res.status, errText: errText.slice(0, 300) },
      "podcast-dialogue: ElevenLabs text-to-dialogue failed",
    );
    throw new Error(`ElevenLabs dialogue failed (${res.status})`);
  }
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length === 0) throw new Error("ElevenLabs returned empty audio");
  await writeFile(outPath, bytes);
}

/* ── Request validation ──────────────────────────────────────────────── */

const speakerSchema = z.object({
  name: z.string().min(1, "Speaker name is required.").max(40),
  voiceId: z.string().min(1, "Each speaker needs a voice.").max(100),
});

const dialogueSchema = z.object({
  title: z.string().min(1, "Episode title is required.").max(200),
  description: z.string().max(2000).optional().default(""),
  script: z.string().min(1, "Write your dialogue first.").max(MAX_DIALOGUE_SCRIPT_CHARS),
  speakers: speakerSchema.array().min(2, "Dialogue needs at least 2 speakers.").max(MAX_DIALOGUE_SPEAKERS),
  musicBed: z.boolean().default(false),
  attribution: attributionOptIn(),
});

/* ── Gate status (powers the frontend disabled banner) ───────────────── */

export type DialogueGateReason = "ok" | "pricing_pending" | "key_missing";

export function dialogueGateStatus(): {
  enabled: boolean;
  reason: DialogueGateReason;
  pricingApproved: boolean;
  keyConfigured: boolean;
  creditsPer10Min: number;
  pricingVersion: string;
} {
  const keyConfigured = Boolean(elevenKey());
  const pricingApproved = DIALOGUE_PRICING_APPROVED;
  const enabled = keyConfigured && pricingApproved;
  const reason: DialogueGateReason = !pricingApproved
    ? "pricing_pending"
    : !keyConfigured
      ? "key_missing"
      : "ok";
  return {
    enabled,
    reason,
    pricingApproved,
    keyConfigured,
    creditsPer10Min: DIALOGUE_CREDITS_PER_10MIN,
    pricingVersion: DIALOGUE_PRICING_VERSION,
  };
}

router.get("/podcast/dialogue/status", publicApiLimiter, (_req, res) => {
  res.json(dialogueGateStatus());
});

/* ── POST /api/podcast/dialogue ──────────────────────────────────────── */

router.post(
  "/podcast/dialogue",
  publicApiLimiter,
  requireAuth,
  async (req, res) => {
    const parsed = dialogueSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({
        error: "Invalid dialogue request.",
        details: parsed.error.issues.map((i) => ({
          field: i.path.join("."),
          message: i.message,
        })),
      });
      return;
    }

    const { title, description, script, speakers, musicBed, attribution } = parsed.data;

    /* ── Gates first: refuse BEFORE any provider call or credit movement ── */
    const gate = dialogueGateStatus();
    if (!gate.pricingApproved) {
      res.status(403).json({
        error: "dialogue_pricing_pending",
        message:
          "Multi-speaker dialogue is built but its price isn't approved yet — " +
          "this feature stays disabled until pricing is confirmed. Nothing was charged.",
      });
      return;
    }
    const apiKey = elevenKey();
    if (!apiKey) {
      res.status(503).json({ error: "Voice service is not configured on this server." });
      return;
    }

    /* ── Parse + validate the tagged script server-side ── */
    const { turns, speakers: detected, untaggedLines } = parseDialogueScript(script);
    if (turns.length === 0) {
      res.status(400).json({
        error: "No tagged dialogue lines found. Tag each line like  ALEX: your line here",
      });
      return;
    }
    if (detected.length > MAX_DIALOGUE_SPEAKERS) {
      res.status(400).json({
        error: `Too many speakers — dialogue supports up to ${MAX_DIALOGUE_SPEAKERS}.`,
      });
      return;
    }
    const voiceByName = new Map(speakers.map((s) => [s.name.trim(), s.voiceId]));
    for (const name of detected) {
      if (!voiceByName.get(name)) {
        res.status(400).json({ error: `Speaker "${name}" has no voice assigned.` });
        return;
      }
    }
    const voiceIds = [...voiceByName.values()];
    if (new Set(voiceIds).size !== voiceIds.length) {
      res.status(400).json({ error: "Each speaker needs a different voice." });
      return;
    }

    /* ── Build provider inputs (chunk long turns, cap total) ── */
    const inputs: DialogueInput[] = [];
    for (const turn of turns) {
      const voice_id = voiceByName.get(turn.speaker)!;
      for (const chunk of chunkDialogueText(turn.text)) {
        inputs.push({ text: chunk, voice_id });
        if (inputs.length >= MAX_DIALOGUE_TURNS) break;
      }
      if (inputs.length >= MAX_DIALOGUE_TURNS) break;
    }
    if (inputs.length === 0) {
      res.status(400).json({ error: "No speakable dialogue found." });
      return;
    }

    /* ── Estimate + charge before generating ── */
    const est = estimateDialogueCost(script);
    const creditsToCharge = est.credits;
    const actionName = "Podcast Dialogue Studio";
    const balance = req.userCredits ?? 0;
    if (balance < creditsToCharge) {
      res.status(402).json({
        error: "out_of_credits",
        message: `This dialogue needs ${creditsToCharge} credits — top up to keep creating.`,
        creditsRequired: creditsToCharge,
      });
      return;
    }

    const { mkdir, rm, readFile } = await import("fs/promises");
    const workDir = join(tmpdir(), `podcast-dialogue-${randomUUID()}`);
    await mkdir(workDir, { recursive: true });
    const cleanup = async () => {
      try {
        await rm(workDir, { recursive: true, force: true });
      } catch { /* best effort */ }
    };

    async function failWithRefund(status: number, message: string): Promise<void> {
      await refundCredits(req.userId!, creditsToCharge, {
        action: `${actionName} — Refund (generation failed)`,
      }).catch((refundErr) =>
        logger.error({ refundErr }, "podcast-dialogue: refund after failure failed"),
      );
      res.status(status).json({ error: message });
    }

    let creditsRemaining = balance;
    try {
      creditsRemaining = await chargeCredits(req.userId!, creditsToCharge, { action: actionName });
    } catch (err) {
      await cleanup();
      if (err instanceof OutOfCreditsError) {
        res.status(402).json({
          error: "out_of_credits",
          message: `This dialogue needs ${creditsToCharge} credits — top up to keep creating.`,
          creditsRequired: creditsToCharge,
        });
        return;
      }
      throw err;
    }

    try {
      /* ── Render the full conversation in one provider call ── */
      const dialoguePath = join(workDir, "dialogue.mp3");
      await dialogueToFile(apiKey, inputs, dialoguePath);

      let episodeMp3Path = dialoguePath;
      if (musicBed) {
        // Sandwich the dialogue between synth intro/outro beds (same honest
        // synth bed the podcast studio uses — labeled as such in the UI).
        episodeMp3Path = join(workDir, "episode.mp3");
        await assembleEpisode([dialoguePath], episodeMp3Path, true, workDir, attribution);
      } else if (attribution) {
        // Virality: audio-only export — the opt-in attribution lands as an
        // ID3 comment tag instead of a burned video credit.
        const taggedPath = join(workDir, "episode-tagged.mp3");
        await execFileAsync("ffmpeg", [
          "-y", "-i", dialoguePath,
          "-metadata", `comment=${ATTRIBUTION_TEXT}`,
          "-c:a", "libmp3lame", "-b:a", "128k",
          taggedPath,
        ], { timeout: 60_000 });
        episodeMp3Path = taggedPath;
      }

      let durationSeconds = await probeDurationSeconds(episodeMp3Path);
      if (durationSeconds <= 0) durationSeconds = est.estimatedSeconds;

      /* ── Upload + RSS ── */
      const audioBytes = await readFile(episodeMp3Path);
      const fileName = `${req.userId}/podcast-dialogue/${randomUUID()}.mp3`;
      let audioUrl: string;
      try {
        audioUrl = await uploadMediaToSupabaseStorage(fileName, audioBytes, "audio/mpeg");
      } catch (err) {
        logger.error({ err }, "podcast-dialogue: upload failed");
        await cleanup();
        await failWithRefund(502, "Dialogue rendered but upload failed — your Visual Bucs were refunded. Please try again.");
        return;
      }
      const audioPlayUrl = await refreshSupabaseStorageUrl(audioUrl);
      const rss = buildPodcastRss({
        title,
        description,
        audioUrl: audioPlayUrl,
        durationSeconds: Math.round(durationSeconds),
        pubDate: new Date(),
        chapters: [],
      });

      await cleanup();
      res.json({
        audioUrl,
        audioRef: `generated-clips/${fileName}`,
        audioPlayUrl,
        title,
        mode: "dialogue",
        speakerCount: detected.length,
        speakers: detected,
        musicBed,
        attribution,
        rssXml: rss,
        durationSeconds: Math.round(durationSeconds),
        untaggedLines,
        creditsUsed: creditsToCharge,
        creditsRemaining,
      });
    } catch (err) {
      logger.error({ err }, "podcast-dialogue: generation failed");
      await cleanup();
      await failWithRefund(
        502,
        "Dialogue generation failed — your Visual Bucs were refunded. Please try again.",
      );
    }
  },
);

export default router;
