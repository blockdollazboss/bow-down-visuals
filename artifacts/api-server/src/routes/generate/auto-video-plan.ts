import { Router } from "express";
import OpenAI from "openai";
import { getOpenAI, getTextModel } from "../../lib/ai-clients";
import { requireAuth } from "../../middlewares/require-auth";
import { deductCredits, OutOfCreditsError } from "../../lib/credits";
import { recordCreditUsage, recordGenerationHistory, markGenerationHistoryCharged } from "../../lib/payment-record";

const router = Router();

const CREDIT_COST = 2;

/**
 * POST /api/generate/auto-video-plan
 *
 * The Auto Director: analyzes the song (transcript + section map + duration)
 * and returns a STRUCTURED, timeline-ready music video plan — scenes with exact
 * start/end seconds plus elite, Runway-engineered generation prompts.
 * Unlike /generate-video-plan (a markdown treatment doc), this output maps
 * 1:1 onto editor scenes and can be applied to the timeline directly.
 */

interface VaultInput {
  artistType?: string | null;
  artistDescription?: string | null;
  visualStyle?: string | null;
  hair?: string | null;
  tattoos?: string | null;
  jewelry?: string | null;
  clothingStyle?: string | null;
  brandColors?: string | null;
  doNotChangeRules?: string | null;
  consistencyPrompt?: string | null;
  referenceImageUrl?: string | null;
}

interface TranscriptLine {
  start?: number | null;
  end?: number | null;
  text?: string | null;
}

interface SongSectionIn {
  name?: string | null;
  startSec?: number | null;
  endSec?: number | null;
}

function buildVaultContext(vault: VaultInput | null | undefined): { text: string; hasIdentity: boolean } {
  if (!vault) return { text: "", hasIdentity: false };
  const fields: Array<[string, string | null | undefined]> = [
    ["Artist Type", vault.artistType],
    ["Artist Description / Personality", vault.artistDescription],
    ["Visual Style", vault.visualStyle],
    ["Hair", vault.hair],
    ["Tattoos", vault.tattoos],
    ["Jewelry", vault.jewelry],
    ["Clothing Style / Wardrobe", vault.clothingStyle],
    ["Brand Colors", vault.brandColors],
    ["Saved Consistency Prompt", vault.consistencyPrompt],
  ];
  const filled = fields.filter(([, v]) => v && String(v).trim().length > 0);
  if (vault.referenceImageUrl) filled.push(["Reference Image URL", vault.referenceImageUrl]);
  if (filled.length === 0) return { text: "", hasIdentity: false };
  const lines = [
    "",
    "ARTIST VAULT — THE STAR OF THIS VIDEO:",
    ...filled.map(([k, v]) => `${k}: ${v}`),
  ];
  if (vault.doNotChangeRules) {
    lines.push("", `DO NOT CHANGE RULES — NEVER VIOLATE THESE:\n${vault.doNotChangeRules}`);
  }
  return { text: lines.join("\n"), hasIdentity: true };
}

const DIRECTOR_SYSTEM_PROMPT = `You are the Auto Director — a world-class music video director AND an elite AI-video prompt engineer specializing in Runway Gen-4. You design complete, shoot-ready music video plans from songs, then write the generation prompts yourself to the highest professional standard.

Hold every frame to the standard of an Oscar-winning cinematographer and director: compositions built for the big screen, camera moves motivated by emotion, lighting that carries feeling. If a shot or prompt wouldn't hold up in a theater, rework it until it would.

YOUR TWO JOBS:
1. DIRECT: break the song into a scene-by-scene plan where every scene's timing, energy, and story serve the music.
2. WRITE PROMPTS: every scene gets a videoPrompt engineered for maximum Runway quality.

DIRECTING RULES:
- Scenes MUST tile the full song duration with no gaps and no overlaps. Scene 1 starts at 0.00.
- Scene boundaries MUST snap to song section boundaries (intro/hook/verse/etc.). Never cut a scene mid-section unless the section is very long — then split it into 2-3 varied shots.
- Map energy to the song: hooks = spectacle, scale, movement, crowd, lights. Verses = story, intimacy, close-ups, narrative. Bridges = shift — new location, new lighting, tension. Intro = establish the world and the artist. Outro = iconic final image.
- NEVER repeat the same shot type, camera move, or location in adjacent scenes. Vary relentlessly: wide establishing → close-up → tracking → aerial → detail/insert → performance.
- The artist is the star and MUST be clearly visible on screen in nearly every scene. No empty landscapes, no faceless crowds as the main subject.
- Ground every scene in the actual lyrics/transcript — the visuals should feel like they belong to THIS song, not any song.

PROMPT ENGINEERING RULES (this is what separates great AI video from slop):
- Each videoPrompt is ONE vivid paragraph, 60-120 words. Subject-first: name the artist and what they're doing in the opening clause.
- Concrete visual nouns only. Never "beautiful", "amazing", "high quality" — show it: fabrics, textures, light sources, architecture.
- Camera craft in every prompt: shot size (extreme close-up / close-up / medium / wide / aerial), lens feel (35mm, anamorphic), and ONE clear camera move (slow dolly push-in, handheld tracking, crane rise, orbit, whip pan).
- Light the scene: name the sources (neon signage, golden-hour sun, single practical lamp, volumetric stage beams) and the quality (soft, harsh, flickering, hazy).
- Choreograph motion: AI video needs movement described — hair, fabric, smoke, crowd, camera. A static description makes a static clip.
- Atmosphere and texture: film grain, haze, rain, dust in light beams, reflections on wet asphalt.
- Character consistency: describe the artist's face, hair, wardrobe, jewelry IDENTICALLY in every prompt (use the vault; if no vault is given, invent one striking, specific artist look and repeat it verbatim in every prompt).
- FORBIDDEN in frame: text, subtitles, captions, watermarks, logos, brand names, UI elements, extra fingers, deformed faces, morphing features. Put these in the negativePrompt too.
- negativePrompt per scene: short comma list — the scene-specific risks (e.g. "crowd faces deforming, extra limbs, text on signs, watermark") plus the universal bans.

JSON CONTRACT:
Return ONLY a JSON object (no markdown fences) with this exact shape:
{
  "treatment": "2-3 sentence director's vision",
  "colorPalette": ["#hex or name", ...],
  "visualStyle": "one-line aesthetic summary",
  "pacingNotes": "how the edit breathes across sections",
  "suggestedArtist": "If no artist vault was provided: one tight paragraph describing the invented artist's exact look (face, hair, wardrobe, jewelry) to reuse everywhere. If a vault WAS provided: empty string.",
  "scenes": [
    {
      "startSec": 0.0,
      "endSec": 17.0,
      "section": "Intro",
      "title": "short evocative scene title",
      "lyricCue": "the lyric or musical moment this scene covers",
      "location": "specific setting",
      "action": "what the artist does",
      "camera": "shot size + lens + movement",
      "lighting": "sources and quality",
      "mood": "emotional tone",
      "videoPrompt": "the engineered Runway prompt, one paragraph",
      "negativePrompt": "comma-separated bans"
    }
  ]
}`;

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

router.post("/auto-video-plan", requireAuth, async (req, res) => {
  const body = req.body as {
    songTitle?: string;
    artistName?: string;
    genre?: string;
    mood?: string;
    videoStyle?: string;
    durationSec?: number;
    transcript?: TranscriptLine[];
    sections?: SongSectionIn[];
    lyrics?: string;
    instructions?: string;
    artistVault?: VaultInput | null;
  };

  const durationSec = Number(body.durationSec) || 0;
  if (durationSec <= 0) {
    res.status(400).json({ error: "durationSec is required and must be positive" });
    return;
  }

  const currentCredits = req.userCredits ?? 0;
  if (currentCredits < CREDIT_COST) {
    res.status(402).json({
      error: "out_of_credits",
      message: "You are out of credits. Join the waitlist or upgrade soon to keep creating.",
    });
    return;
  }

  /* ── Build the song brief ── */
  const lines = Array.isArray(body.transcript) ? body.transcript : [];
  const transcriptText = lines
    .filter((l) => l && typeof l.text === "string" && l.text.trim())
    .map((l) => {
      const s = typeof l.start === "number" ? l.start.toFixed(1) : "?";
      const e = typeof l.end === "number" ? l.end.toFixed(1) : "?";
      return `[${s}-${e}] ${String(l.text).trim()}`;
    })
    .join("\n");

  const sections = Array.isArray(body.sections) ? body.sections : [];
  const sectionText = sections
    .filter((s) => s && s.name)
    .map((s) => {
      const range =
        typeof s.startSec === "number" && typeof s.endSec === "number"
          ? ` [${s.startSec.toFixed(1)}–${s.endSec.toFixed(1)}]`
          : "";
      return `• ${s.name}${range}`;
    })
    .join("\n");

  const { text: vaultText, hasIdentity } = buildVaultContext(body.artistVault);

  const userBrief = [
    `SONG: "${body.songTitle || "Untitled"}" by ${body.artistName || "Unknown Artist"}`,
    `Genre: ${body.genre || "Hip Hop"} | Mood: ${body.mood || "Dark"} | Video Style: ${body.videoStyle || "Cinematic"}`,
    `Total duration: ${durationSec.toFixed(1)} seconds. Your scenes MUST cover 0.00–${durationSec.toFixed(1)} exactly.`,
    sectionText ? `\nSONG SECTIONS (snap scene boundaries to these):\n${sectionText}` : "",
    transcriptText ? `\nTIMED TRANSCRIPT (ground visuals in these lyrics):\n${transcriptText}` : "",
    body.lyrics ? `\nFULL LYRICS:\n${body.lyrics}` : "",
    vaultText,
    !hasIdentity
      ? "\nNO ARTIST VAULT PROVIDED: invent one striking, specific artist look and describe it IDENTICALLY in every videoPrompt. Also return it in suggestedArtist."
      : "",
    body.instructions ? `\nDIRECTOR NOTES FROM THE ARTIST:\n${body.instructions}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const completion = await getOpenAI().chat.completions.create({
      model: getTextModel(),
      response_format: { type: "json_object" },
      temperature: 0.8,
      max_tokens: 6000,
      messages: [
        { role: "system", content: DIRECTOR_SYSTEM_PROMPT },
        { role: "user", content: userBrief },
      ],
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      throw new Error("The director returned an unreadable plan. Please try again.");
    }

    /* ── Sanitize scenes: clamp times, sort, enforce tiling ── */
    const rawScenes = Array.isArray(parsed["scenes"]) ? parsed["scenes"] : [];
    type LooseScene = Record<string, unknown>;
    type PlanScene = {
      startSec: number; endSec: number; section: string; title: string;
      lyricCue: string; location: string; action: string; camera: string;
      lighting: string; mood: string; videoPrompt: string; negativePrompt: string;
    };
    const scenes = (rawScenes as LooseScene[])
      .map((s): PlanScene => ({
        startSec: clamp(Number(s["startSec"]) || 0, 0, durationSec),
        endSec: clamp(Number(s["endSec"]) || 0, 0, durationSec),
        section: String(s["section"] ?? ""),
        title: String(s["title"] ?? "Untitled scene"),
        lyricCue: String(s["lyricCue"] ?? ""),
        location: String(s["location"] ?? ""),
        action: String(s["action"] ?? ""),
        camera: String(s["camera"] ?? ""),
        lighting: String(s["lighting"] ?? ""),
        mood: String(s["mood"] ?? ""),
        videoPrompt: String(s["videoPrompt"] ?? ""),
        negativePrompt: String(s["negativePrompt"] ?? ""),
      }))
      .filter((s) => s.endSec > s.startSec && s.videoPrompt.trim().length > 0)
      .sort((a, b) => a.startSec - b.startSec)
      // De-overlap: each scene starts where the previous ended; drop zero-length.
      .reduce<PlanScene[]>((acc, s) => {
        const prev = acc[acc.length - 1];
        const startSec = prev ? Math.max(s.startSec, prev.endSec) : 0;
        if (s.endSec > startSec) acc.push({ ...s, startSec });
        return acc;
      }, []);

    if (scenes.length === 0) {
      throw new Error("The director returned no usable scenes. Please try again.");
    }
    // Force exact coverage: first starts at 0, last ends at duration.
    scenes[0]!.startSec = 0;
    scenes[scenes.length - 1]!.endSec = durationSec;

    const plan = {
      treatment: String(parsed["treatment"] ?? ""),
      colorPalette: Array.isArray(parsed["colorPalette"])
        ? (parsed["colorPalette"] as unknown[]).map(String).slice(0, 8)
        : [],
      visualStyle: String(parsed["visualStyle"] ?? ""),
      pacingNotes: String(parsed["pacingNotes"] ?? ""),
      suggestedArtist: String(parsed["suggestedArtist"] ?? ""),
      scenes,
    };

    /* ── History first, then charge (same pattern as /generate-video-plan) ── */
    const genHistoryId = await recordGenerationHistory({
      userId: req.userId!,
      generationType: "Auto Director Plan",
      prompt: `${body.artistName || "Unknown"} — ${body.songTitle || "Untitled"} (${body.genre || "?"})`,
      content: JSON.stringify(plan).slice(0, 20000),
      artistName: body.artistName || undefined,
      songTitle: body.songTitle || undefined,
      creditsUsed: CREDIT_COST,
    });

    let creditsAfter: number;
    try {
      creditsAfter = await deductCredits(req.userId!, CREDIT_COST);
    } catch (deductErr) {
      if (deductErr instanceof OutOfCreditsError) {
        res.status(402).json({
          error: "out_of_credits",
          message: "You are out of credits. Join the waitlist or upgrade soon to keep creating.",
        });
        return;
      }
      throw deductErr;
    }

    markGenerationHistoryCharged(genHistoryId).catch(() => {});
    recordCreditUsage({ userId: req.userId!, action: "Auto Director Plan", creditsUsed: CREDIT_COST }).catch(() => {});

    res.json({ plan, creditsRemaining: creditsAfter, genHistoryId });
  } catch (err: unknown) {
    if (err instanceof OpenAI.APIError && err.status === 429) {
      res.status(429).json({ error: "Rate limited by the AI provider — please wait a moment and try again." });
      return;
    }
    const message = err instanceof Error ? err.message : "Plan generation failed";
    req.log?.error?.({ err }, "auto-video-plan failed");
    res.status(500).json({ error: message });
  }
});

export default router;
