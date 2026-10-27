/**
 * producer-tag-lifecycle.ts — Your Own Tag (#159 upgrade delta).
 *
 * The Producer Tag Maker (producer-tag.ts) made a spoken tag for 100 VB
 * and handed back a download — it stamped nothing and played nowhere.
 * This is the delta, docked onto that home:
 *
 *   (a) a MUSICAL form: a two-second sonic logo in the house palette
 *       (G minor — sliding 808 + triad plucks + triplet hat ticks, the
 *       signature-sounds program's drill palette at 142 BPM);
 *   (b) an APPROVE-BY-EAR gate: generation makes a free DRAFT the
 *       creator listens to; only approval makes it THE tag;
 *   (c) automatic STAMPING in the export flow, toggleable per creator
 *       (the stamp itself lives in export-video.ts, reading
 *       getActiveProducerTag from here);
 *   (d) the tag SOUNDS on the creator's public profile (the profile
 *       payload carries the active tag's URL);
 *   (e) ONE tag per creator as the house gift: the first approval is
 *       free; later replacements cost the standard tag price.
 *
 * The legacy one-off download flow in producer-tag.ts is untouched.
 */
import { Router } from "express";
import { z } from "zod";
import { execFile } from "child_process";
import { promisify } from "util";
import { readFile, mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";
import { requireAuth } from "../../middlewares/require-auth";
import { chargeCredits, refundCredits, OutOfCreditsError } from "../../lib/credits";
import {
  uploadMediaToSupabaseStorage,
  refreshSupabaseStorageUrl,
} from "../../lib/objectStorage";
import { db, producerTagsTable } from "@workspace/db";
import { eq, and, desc, isNotNull } from "drizzle-orm";
import {
  PRODUCER_TAG_COST,
  OPENAI_VOICES,
  PRESETS,
  findVaultVoice,
  renderSpokenTagFile,
} from "./producer-tag";

const router = Router();
const execFileAsync = promisify(execFile);

/* ── Pure: pricing (the house gift) ──────────────────────────────────── */

/** First approval is the house gift (0 VB); replacements pay the tag price. */
export function approvalPrice(priorApprovedCount: number): number {
  return priorApprovedCount > 0 ? PRODUCER_TAG_COST : 0;
}

/* ── Pure: the two-second sonic logo ─────────────────────────────────── */

export const SONIC_LOGO_SECONDS = 2;
/** G-minor triad plucks (G3, Bb3, D4) — the house key of the v7 palette. */
export const SONIC_LOGO_NOTES = [
  { atSec: 0, hz: 196.0 },
  { atSec: 0.45, hz: 233.08 },
  { atSec: 0.9, hz: 293.66 },
] as const;
/** Sliding 808: G2 (98 Hz) gliding down toward G1 (49 Hz). */
export const SONIC_LOGO_GLIDE = { fromHz: 98, toHz: 49 } as const;
/** Triplet hat ticks at 142 BPM: one tick per triplet eighth (~0.141 s). */
export const SONIC_LOGO_HAT_INTERVAL_SEC = 0.141;

/**
 * The melody as an ffmpeg aevalsrc expression (mono; duplicated to
 * stereo by the caller): the sliding 808 underneath G-minor triad plucks
 * with fast decays. Pure string building — unit-tested.
 */
export function sonicLogoMelodyExpr(): string {
  const { fromHz, toHz } = SONIC_LOGO_GLIDE;
  // Instantaneous frequency is the derivative of the phase term, so the
  // quadratic coefficient is half the (linear) glide slope.
  const phaseCoeff = ((fromHz - toHz) / SONIC_LOGO_SECONDS / 2).toFixed(4);
  const glide =
    `0.60*sin(2*PI*(${fromHz}*t-${phaseCoeff}*t*t))*(0.95-0.30*t)`;
  const plucks = SONIC_LOGO_NOTES.map(
    (n) =>
      `0.50*sin(2*PI*${n.hz}*(t-${n.atSec}))*exp(-6*(t-${n.atSec}))*if(gte(t,${n.atSec}),1,0)`,
  ).join("+");
  return `${glide}+${plucks}`;
}

/** Render the sonic logo to a file in workDir (ffmpeg lavfi synthesis). */
async function renderSonicLogoFile(
  workDir: string,
  format: "mp3" | "wav",
): Promise<string> {
  const ext = format === "wav" ? "wav" : "mp3";
  const outPath = join(workDir, `sonic-logo.${ext}`);
  const expr = sonicLogoMelodyExpr();
  const hatGate = `if(lt(mod(t,${SONIC_LOGO_HAT_INTERVAL_SEC}),0.02),0.16,0)`;
  const filter =
    `[1:a]highpass=f=7500,volume='${hatGate}':eval=frame[hats];` +
    `[0:a][hats]amix=inputs=2:duration=first:dropout_transition=0,` +
    `acompressor=threshold=-18dB:ratio=3,alimiter=limit=0.95,` +
    `atrim=0:${SONIC_LOGO_SECONDS},asetpts=PTS-STARTPTS[a]`;
  const codecArgs =
    format === "mp3" ? ["-c:a", "libmp3lame", "-b:a", "192k"] : ["-c:a", "pcm_s16le"];
  await execFileAsync(
    "ffmpeg",
    [
      "-y",
      "-f", "lavfi", "-i", `aevalsrc=exprs='${expr}|${expr}':d=${SONIC_LOGO_SECONDS}:sample_rate=44100:channel_layout=stereo`,
      "-f", "lavfi", "-i", `anoisesrc=d=${SONIC_LOGO_SECONDS}:color=white:sample_rate=44100`,
      "-filter_complex", filter,
      "-map", "[a]", "-ar", "44100", "-ac", "2",
      ...codecArgs,
      outPath,
    ],
    { timeout: 60_000 },
  );
  return outPath;
}

/* ── Shared lookups (export stamping + profile sounding read these) ──── */

export async function getActiveProducerTag(userId: string) {
  const [row] = await db
    .select()
    .from(producerTagsTable)
    .where(and(eq(producerTagsTable.userId, userId), eq(producerTagsTable.status, "active")))
    .limit(1);
  return row ?? null;
}

async function countPriorApprovals(userId: string): Promise<number> {
  const rows = await db
    .select({ id: producerTagsTable.id })
    .from(producerTagsTable)
    .where(and(eq(producerTagsTable.userId, userId), isNotNull(producerTagsTable.approvedAt)));
  return rows.length;
}

/* ── Draft generation ────────────────────────────────────────────────── */

const voiceIds = OPENAI_VOICES.map((v) => v.id) as unknown as [string, ...string[]];

const draftSchema = z.object({
  kind: z.enum(["spoken", "sonic"]).optional().default("spoken"),
  text: z.string().trim().max(120).optional(),
  voice: z.union([z.enum(voiceIds), z.literal("vault")]).optional().default("alloy"),
  vaultId: z.string().uuid().optional(),
  preset: z.enum(PRESETS).optional().default("dark"),
  format: z.enum(["mp3", "wav"]).optional().default("mp3"),
});

router.post("/producer-tag/draft", requireAuth, async (req, res) => {
  const parsed = draftSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }
  const { kind, text, voice, vaultId, preset, format } = parsed.data;

  if (kind === "spoken" && !text) {
    res.status(400).json({ error: "Tag text is required for a spoken tag." });
    return;
  }

  /* Resolve the voice backend BEFORE rendering (spoken only) — the same
     clean-failure semantics as the legacy route, minus any charge:
     drafts are free to audition. */
  let vaultVoice: { voiceId: string; voiceName: string } | null = null;
  if (kind === "spoken" && voice === "vault") {
    if (!process.env.ELEVENLABS_API_KEY) {
      res.status(503).json({ error: "Cloned-voice tags are not available right now." });
      return;
    }
    const vault = await findVaultVoice(req.userId!, vaultId).catch(() => null);
    if (!vault?.voice_id) {
      res.status(404).json({ error: "No cloned voice found in your Artist Vault." });
      return;
    }
    vaultVoice = { voiceId: vault.voice_id, voiceName: vault.voice_name ?? "My cloned voice" };
  } else if (kind === "spoken" && !process.env.OPENAI_API_KEY) {
    res.status(503).json({ error: "Producer Tag voice service is not configured." });
    return;
  }

  const workDir = await mkdtemp(join(tmpdir(), "producer-tag-draft-"));
  try {
    const outputPath =
      kind === "sonic"
        ? await renderSonicLogoFile(workDir, format)
        : await renderSpokenTagFile({ text: text!, voice, vaultVoice, preset, format, workDir });

    const buffer = await readFile(outputPath);
    const ext = format === "wav" ? "wav" : "mp3";
    const objectName = `producer-tags/${req.userId}/draft-${randomUUID()}.${ext}`;
    const storageRef = await uploadMediaToSupabaseStorage(
      objectName,
      buffer,
      format === "wav" ? "audio/wav" : "audio/mpeg",
    );
    const url = await refreshSupabaseStorageUrl(storageRef);

    const [row] = await db
      .insert(producerTagsTable)
      .values({
        userId: req.userId!,
        kind,
        text: kind === "spoken" ? text! : text ?? null,
        voice: kind === "spoken" ? voice : null,
        preset: kind === "spoken" ? preset : null,
        format,
        audioUrl: url,
        storageRef,
        status: "draft",
      })
      .returning();
    if (!row) throw new Error("Could not save the tag draft.");

    res.json({
      tag: row,
      previewUrl: url,
      priceToApprove: approvalPrice(await countPriorApprovals(req.userId!)),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Tag draft generation failed.";
    req.log.error({ err: message }, "[producer-tag] draft failed");
    res.status(500).json({ error: message });
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
});

/* ── Approve-by-ear: a draft becomes THE tag ─────────────────────────── */

const approveSchema = z.object({ tagId: z.string().uuid() });

router.post("/producer-tag/approve", requireAuth, async (req, res) => {
  const parsed = approveSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "A draft tag id is required." });
    return;
  }
  const { tagId } = parsed.data;

  const [draft] = await db
    .select()
    .from(producerTagsTable)
    .where(and(eq(producerTagsTable.id, tagId), eq(producerTagsTable.userId, req.userId!)))
    .limit(1);
  if (!draft) {
    res.status(404).json({ error: "Tag draft not found." });
    return;
  }
  if (draft.status !== "draft") {
    res.status(409).json({ error: "That tag is no longer a draft." });
    return;
  }

  const price = approvalPrice(await countPriorApprovals(req.userId!));

  const currentCredits = req.userCredits ?? 0;
  if (price > 0 && currentCredits < price) {
    res.status(402).json({
      error: "out_of_credits",
      message: "Not enough Visual Bucs. Buy more Visual Bucs to keep creating.",
    });
    return;
  }

  let creditsRemaining = currentCredits;
  if (price > 0) {
    try {
      creditsRemaining = await chargeCredits(req.userId!, price, { action: "Your Own Tag" });
    } catch (err) {
      if (err instanceof OutOfCreditsError) {
        res.status(402).json({ error: "out_of_credits", message: "Not enough Visual Bucs." });
        return;
      }
      throw err;
    }
  }

  try {
    /* One active tag per creator: demote the incumbent, inherit its
       stamp toggle so a replacement never silently changes the
       creator's export behavior. */
    const incumbent = await getActiveProducerTag(req.userId!);
    if (incumbent && incumbent.id !== draft.id) {
      await db
        .update(producerTagsTable)
        .set({ status: "replaced" })
        .where(eq(producerTagsTable.id, incumbent.id));
    }
    const [row] = await db
      .update(producerTagsTable)
      .set({
        status: "active",
        approvedAt: new Date(),
        priceCharged: price,
        stampEnabled: incumbent ? incumbent.stampEnabled : draft.stampEnabled,
      })
      .where(eq(producerTagsTable.id, draft.id))
      .returning();
    if (!row) throw new Error("Could not activate the tag.");

    res.json({
      tag: row,
      priceCharged: price,
      giftApplied: price === 0,
      creditsRemaining,
    });
  } catch (err) {
    if (price > 0) {
      await refundCredits(req.userId!, price, { action: "Your Own Tag — Refund" }).catch(() => {});
    }
    const message = err instanceof Error ? err.message : "Could not approve the tag.";
    req.log.error({ err: message }, "[producer-tag] approve failed");
    res.status(500).json({ error: message });
  }
});

/* ── Mine: active tag + drafts + gift/toggle state ───────────────────── */

router.get("/producer-tag/mine", requireAuth, async (req, res) => {
  try {
    const active = await getActiveProducerTag(req.userId!);
    const drafts = await db
      .select()
      .from(producerTagsTable)
      .where(and(eq(producerTagsTable.userId, req.userId!), eq(producerTagsTable.status, "draft")))
      .orderBy(desc(producerTagsTable.createdAt))
      .limit(10);
    const priorApprovals = await countPriorApprovals(req.userId!);
    res.json({
      active,
      drafts,
      stampEnabled: active ? active.stampEnabled : true,
      giftAvailable: priorApprovals === 0,
      price: PRODUCER_TAG_COST,
    });
  } catch (err) {
    req.log.error({ err }, "[producer-tag] mine lookup failed");
    res.status(500).json({ error: "Could not load your tag." });
  }
});

/* ── The export-stamp toggle ─────────────────────────────────────────── */

const settingsSchema = z.object({ stampEnabled: z.boolean() });

router.patch("/producer-tag/settings", requireAuth, async (req, res) => {
  const parsed = settingsSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "stampEnabled (boolean) is required." });
    return;
  }
  const active = await getActiveProducerTag(req.userId!);
  if (!active) {
    res.status(400).json({
      error: "Approve a tag first — the stamp toggle lives on your active tag.",
    });
    return;
  }
  const [row] = await db
    .update(producerTagsTable)
    .set({ stampEnabled: parsed.data.stampEnabled })
    .where(eq(producerTagsTable.id, active.id))
    .returning();
  res.json({ stampEnabled: row?.stampEnabled ?? parsed.data.stampEnabled, activeTagId: active.id });
});

export default router;
