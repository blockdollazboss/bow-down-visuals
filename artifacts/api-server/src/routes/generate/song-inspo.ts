import { Router } from "express";
import { z } from "zod";
import { eq, and, desc } from "drizzle-orm";
import { requireAuth } from "../../middlewares/require-auth";
import { getOpenAI, getTextModel } from "../../lib/ai-clients";
import { db, inspoVibePresetsTable } from "@workspace/db";
import { recordGenerationHistory, markGenerationHistoryCharged } from "../../lib/payment-record";
import { chargeCredits, refundCredits, OutOfCreditsError, LedgerWriteError } from "../../lib/credits";

const router = Router();

/* ─── Inspo Mode (Suno parity — playlist vibe → song) ───────────────────
   Two-step flow:
     1. POST /api/song-inspo/analyze  — FREE. AI reads a playlist link,
        artist/track names, or a plain vibe description and extracts the
        "style DNA" (genre, BPM, key, mood, vocal character,
        instrumentation). The client shows the DNA card for approval/edits.
     2. POST /api/song-inspo/generate — 200 Visual Bucs (analysis +
        generation bundled; the charge lands here only). Builds a full song
        package through the standard song pipeline sections so the hub
        spine, GenerationResult, and asset handoffs all work unchanged.
   Presets: GET/POST/DELETE /api/song-inspo/presets — "My Vibes",
   reusable style DNA cards applied to future songs. */

const INSPO_GENERATE_COST = 200;

/* ── Style DNA ── */
const styleDnaSchema = z.object({
  genre: z.string().trim().max(100).default(""),
  subGenre: z.string().trim().max(100).default(""),
  bpm: z.string().trim().max(40).default(""),
  key: z.string().trim().max(40).default(""),
  mood: z.array(z.string().trim().max(60)).max(8).default([]),
  vocalCharacter: z.string().trim().max(500).default(""),
  instrumentation: z.array(z.string().trim().max(80)).max(12).default([]),
  arrangementNotes: z.string().trim().max(1500).default(""),
  vibeSummary: z.string().trim().max(1000).default(""),
  eraReferences: z.string().trim().max(300).default(""),
  cleanOrExplicit: z.enum(["clean", "explicit"]).default("clean"),
});

export type StyleDna = z.infer<typeof styleDnaSchema>;

function cleanStr(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

function cleanStrArr(v: unknown, max: number, maxLen: number): string[] {
  return (Array.isArray(v) ? v : [])
    .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
    .map((s) => s.trim().slice(0, maxLen))
    .slice(0, max);
}

function sanitizeDna(raw: unknown): StyleDna {
  const o = (raw ?? {}) as Record<string, unknown>;
  return {
    genre: cleanStr(o["genre"], 100),
    subGenre: cleanStr(o["subGenre"], 100),
    bpm: cleanStr(o["bpm"], 40),
    key: cleanStr(o["key"], 40),
    mood: cleanStrArr(o["mood"], 8, 60),
    vocalCharacter: cleanStr(o["vocalCharacter"], 500),
    instrumentation: cleanStrArr(o["instrumentation"], 12, 80),
    arrangementNotes: cleanStr(o["arrangementNotes"], 1500),
    vibeSummary: cleanStr(o["vibeSummary"], 1000),
    eraReferences: cleanStr(o["eraReferences"], 300),
    cleanOrExplicit:
      o["cleanOrExplicit"] === "explicit" ? "explicit" : "clean",
  };
}

async function callJsonModel(prompt: string, maxTokens = 1500): Promise<string> {
  const model = getTextModel();
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env["OPENAI_API_KEY"]}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      temperature: 0.7,
      max_completion_tokens: maxTokens,
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) throw new Error("Vibe analysis failed — please try again.");
  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("Empty vibe analysis result.");
  return content;
}

const analyzeSchema = z.object({
  playlistInput: z.string().trim().min(3).max(5000),
  notes: z.string().trim().max(2000).optional().default(""),
});

/* ── STEP 1 — FREE vibe analysis → style DNA ── */
router.post("/song-inspo/analyze", requireAuth, async (req, res) => {
  if (!process.env["OPENAI_API_KEY"]) {
    res.status(503).json({
      error: "OPENAI_API_KEY is not configured — Inspo Mode is unavailable.",
    });
    return;
  }
  const parsed = analyzeSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid vibe request." });
    return;
  }
  const { playlistInput, notes } = parsed.data;

  try {
    const prompt =
      `You are a world-class music analyst and A&R ear. A creator describes the vibe they want by dropping ` +
      `playlist links, artist/track names, or a plain-language vibe description (or a mix).\n\n` +
      `INPUT:\n${playlistInput}\n` +
      (notes ? `CREATOR NOTES:\n${notes}\n` : "") +
      `\nExtract the STYLE DNA of this vibe — the concrete production fingerprint a producer would need to ` +
      `recreate it. Do NOT copy any real artist's lyrics or melodies; capture the STYLE only (genre feel, ` +
      `tempo, mood, vocal delivery character, instrumentation, arrangement patterns). If the input is a ` +
      `streaming link you cannot open, infer the DNA from the artist/track names, era, and genre context you ` +
      `know — say so in vibeSummary.\n\n` +
      `Return ONLY valid JSON in this shape:\n` +
      `{\n` +
      `  "genre": "<primary genre>",\n` +
      `  "subGenre": "<sub-genre or fusion, e.g. alt-R&B, drill-soul>",\n` +
      `  "bpm": "<tempo estimate, e.g. 92 or 90-96>",\n` +
      `  "key": "<key/tonality estimate, e.g. A minor — or 'flexible' if unclear>",\n` +
      `  "mood": ["<mood 1>", "<mood 2>", "<mood 3>"],\n` +
      `  "vocalCharacter": "<how the vocal should sound and perform: register, texture, delivery, ad-lib habits>",\n` +
      `  "instrumentation": ["<instrument/sound 1>", "<instrument/sound 2>", ...],\n` +
      `  "arrangementNotes": "<energy arc, drum pattern feel, drops/transitions, what makes it hit>",\n` +
      `  "vibeSummary": "<2-3 sentence plain-language read of the vibe>",\n` +
      `  "eraReferences": "<era/scene this sits in, e.g. late-2010s Toronto R&B>",\n` +
      `  "cleanOrExplicit": "clean or explicit — infer from the input; default clean"\n` +
      `}`;

    const content = await callJsonModel(prompt, 1500);
    let raw: unknown = {};
    try {
      raw = JSON.parse(content) as unknown;
    } catch {
      /* fall through with empty DNA — client fields stay editable */
    }
    const styleDna = sanitizeDna(raw);
    res.json({ styleDna });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Vibe analysis failed.";
    res.status(500).json({ error: message });
  }
});

const generateSchema = z.object({
  styleDna: z.unknown(),
  notes: z.string().trim().max(2000).optional().default(""),
  artistName: z.string().trim().max(200).optional().default(""),
  songTitle: z.string().trim().max(300).optional().default(""),
  artistVault: z.record(z.string(), z.string().nullable().optional()).nullable().optional(),
});

/* ── STEP 2 — 200 VB song generation from approved (edited) style DNA ── */
router.post("/song-inspo/generate", requireAuth, async (req, res) => {
  if (!process.env["OPENAI_API_KEY"]) {
    res.status(503).json({
      error: "OPENAI_API_KEY is not configured — Inspo Mode is unavailable.",
    });
    return;
  }
  const parsed = generateSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid inspo generation request." });
    return;
  }
  const { notes, artistName, songTitle } = parsed.data;
  const dna = sanitizeDna(parsed.data.styleDna);
  if (!dna.genre && !dna.vibeSummary) {
    res.status(400).json({ error: "Style DNA is empty — analyze a vibe first." });
    return;
  }

  const currentCredits = req.userCredits ?? 0;
  if (currentCredits < INSPO_GENERATE_COST) {
    res.status(402).json({
      error: "out_of_credits",
      message: "You are out of Visual Bucs. Join the waitlist or upgrade soon to keep creating.",
    });
    return;
  }

  let creditsAfter: number;
  try {
    creditsAfter = await chargeCredits(req.userId!, INSPO_GENERATE_COST, {
      action: "Inspo Mode Song",
    });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({
        error: "out_of_credits",
        message: "You are out of Visual Bucs. Join the waitlist or upgrade soon to keep creating.",
      });
      return;
    }
    if (err instanceof LedgerWriteError) {
      res.status(500).json({ error: "ledger_write_failed", message: "Credit ledger write failed — no Visual Bucs were charged. Please try again." });
      return;
    }
    throw err;
  }

  const isExplicit = dna.cleanOrExplicit === "explicit";
  const prompt =
    `Create a complete, premium, ORIGINAL song package built on the style DNA below. ` +
    `Everything must be original — no copied lyrics, melodies, or celebrity likenesses.\n\n` +
    `BOW DOWN VISUALS — INSPO MODE PACKAGE\n\n` +
    `Artist: ${artistName || "Unknown Artist"}\n` +
    `Song Title: "${songTitle || "Untitled"}"\n\n` +
    `STYLE DNA (follow this like a producer brief):\n` +
    `- Genre: ${dna.genre || "—"}${dna.subGenre ? ` / ${dna.subGenre}` : ""}\n` +
    `- Tempo: ${dna.bpm || "—"} BPM | Key: ${dna.key || "—"}\n` +
    `- Mood: ${dna.mood.length ? dna.mood.join(", ") : "—"}\n` +
    `- Vocal Character: ${dna.vocalCharacter || "—"}\n` +
    `- Instrumentation: ${dna.instrumentation.length ? dna.instrumentation.join(", ") : "—"}\n` +
    `- Arrangement: ${dna.arrangementNotes || "—"}\n` +
    `- Vibe: ${dna.vibeSummary || "—"}\n` +
    `- Era / Scene: ${dna.eraReferences || "—"}\n` +
    `Content Rating: ${isExplicit ? "Explicit — adult language allowed, no filter" : "Clean — absolutely no profanity or explicit content"}\n` +
    (notes ? `Creator Notes: ${notes}\n` : "") +
    `\nReturn the output using EXACTLY these ## section headers in this order. Write full, original, high-quality content for every section. Make the lyrics, hook, vocal direction, and beat direction honor the style DNA above.\n\n` +
    `## SONG CONCEPT\n` +
    `Describe the story, emotion, and creative vision behind this song. What is it really about? What feeling should it leave the listener with?\n\n` +
    `## BEST SONG TITLE\n` +
    `Suggest the strongest title for this release (may differ from or improve on the working title).\n\n` +
    `## ALTERNATE TITLE IDEAS\n` +
    `List 5 alternate title options with a one-line note on each.\n\n` +
    `## FULL LYRICS\n` +
    `Write complete, polished lyrics: intro (if any), verse 1, hook, verse 2, hook, bridge, hook, outro. Label each section clearly within the lyrics block.\n\n` +
    `## HOOK\n` +
    `Write the hook on its own — clean, punchy, and highly repeatable. This is what people remember.\n\n` +
    `## VERSE 1\n` +
    `Full verse 1 lyrics only.\n\n` +
    `## VERSE 2\n` +
    `Full verse 2 lyrics only.\n\n` +
    `## BRIDGE\n` +
    `Bridge lyrics — shift the energy or emotion here.\n\n` +
    `## OUTRO\n` +
    `Outro lines or ad libs to close the song.\n\n` +
    `## AI MUSIC PROMPT\n` +
    `Write a detailed prompt ready to paste into Suno, Udio, or similar AI music tools. Include: the exact style DNA (genre, sub-genre, tempo, key, mood), instrumentation, arrangement notes, vocal style, and mastering target (e.g. -14 LUFS streaming).\n\n` +
    `## BEAT DIRECTION\n` +
    `Describe the ideal beat in detail: drum pattern, bassline, melodic elements, samples or synths, energy arc, drops — all mapped to the style DNA.\n\n` +
    `## VOCAL DIRECTION\n` +
    `Describe how the artist should perform this, matching the style DNA's vocal character: delivery, flow, cadence, ad libs, where to go hard vs. soft.\n\n` +
    `## MIXING & MASTERING VIBE\n` +
    `Describe the sonic goal: frequency balance, vocal placement, reverb/delay character, loudness target (generic descriptions only, no copyrighted names).\n\n` +
    `## COVER ART PROMPT\n` +
    `Write a detailed AI image generation prompt for the cover art. Include: subject, composition, lighting, color palette, mood, style, and any text treatment.\n\n` +
    `## MUSIC VIDEO IDEA\n` +
    `Give a one-paragraph cinematic concept for the music video. Describe the setting, visual tone, key scenes, and overall feel.\n\n` +
    `## PROMO CAPTION IDEAS\n` +
    `Write 5 ready-to-post captions for social media — mix of hype, storytelling, and call-to-action styles.`;

  try {
    const completion = await getOpenAI().chat.completions.create({
      model: getTextModel(),
      messages: [
        {
          role: "system",
          content:
            "You are Bow Down Visuals, a premium AI creative director for music creators. " +
            "Write and produce like a Grammy-winning songwriter and producer: original, catchy, cinematic, " +
            "commercially usable. Never copy real artists' exact lyrics, songs, or melodies.",
        },
        { role: "user", content: prompt },
      ],
      max_completion_tokens: 4000,
    });
    const content = completion.choices[0]?.message?.content ?? "";

    // Step 1: history FIRST (throws → catch refunds, no net charge)
    const genHistoryId = await recordGenerationHistory({
      userId: req.userId!,
      generationType: "Inspo Mode Song",
      prompt: `${artistName || "Unknown"} — ${songTitle || "Untitled"} (inspo: ${dna.genre || dna.subGenre || "custom vibe"})`,
      content,
      artistName: artistName || undefined,
      songTitle: songTitle || undefined,
      creditsUsed: INSPO_GENERATE_COST,
    });

    // Step 2: mark charged (chargeCredits already logged the spend)
    markGenerationHistoryCharged(genHistoryId).catch(() => {});

    res.json({
      result: content,
      creditsRemaining: creditsAfter,
      genHistoryId,
      styleDna: dna,
    });
  } catch (err) {
    // Auto-refund: generation failed after charging — give the Visual Bucs back.
    try {
      await refundCredits(req.userId!, INSPO_GENERATE_COST, {
        action: "Inspo Mode Song — auto-refund (generation failed)",
      });
    } catch {
      /* best-effort; the original failure still reports below */
    }
    const message = err instanceof Error ? err.message : "Inspo song generation failed.";
    res.status(500).json({ error: message });
  }
});

/* ── "My Vibes" presets ── */
const presetSchema = z.object({
  name: z.string().trim().min(1).max(120),
  styleDna: z.unknown(),
});

router.get("/song-inspo/presets", requireAuth, async (req, res) => {
  try {
    const rows = await db
      .select()
      .from(inspoVibePresetsTable)
      .where(eq(inspoVibePresetsTable.user_id, req.userId!))
      .orderBy(desc(inspoVibePresetsTable.created_at))
      .limit(50);
    res.json({
      presets: rows.map((r) => ({
        id: r.id,
        name: r.name,
        styleDna: sanitizeDna(r.style_dna),
        createdAt: r.created_at,
      })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not load vibe presets.";
    res.status(500).json({ error: message });
  }
});

router.post("/song-inspo/presets", requireAuth, async (req, res) => {
  const parsed = presetSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid preset." });
    return;
  }
  try {
    const [row] = await db
      .insert(inspoVibePresetsTable)
      .values({
        user_id: req.userId!,
        name: parsed.data.name,
        style_dna: sanitizeDna(parsed.data.styleDna) as unknown as Record<string, unknown>,
      })
      .returning();
    res.json({
      preset: {
        id: row.id,
        name: row.name,
        styleDna: sanitizeDna(row.style_dna),
        createdAt: row.created_at,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not save vibe preset.";
    res.status(500).json({ error: message });
  }
});

router.delete("/song-inspo/presets/:id", requireAuth, async (req, res) => {
  try {
    await db
      .delete(inspoVibePresetsTable)
      .where(
        and(
          eq(inspoVibePresetsTable.id, req.params["id"] as string),
          eq(inspoVibePresetsTable.user_id, req.userId!),
        ),
      );
    res.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not delete vibe preset.";
    res.status(500).json({ error: message });
  }
});

export default router;
