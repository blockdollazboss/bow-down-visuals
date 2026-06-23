import { Router } from "express";
import OpenAI from "openai";
import { requireAuth } from "../../middlewares/require-auth";
import { z } from "zod";

const router = Router();

let openaiClient: OpenAI | null = null;
function getOpenAI(): OpenAI | null {
  const apiKey = process.env["OPENAI_API_KEY"];
  if (!apiKey) return null;
  if (!openaiClient) openaiClient = new OpenAI({ apiKey });
  return openaiClient;
}

const SceneSchema = z.object({
  id: z.string(),
  section: z.string().optional().default(""),
  lyricLine: z.string().optional().default(""),
  action: z.string().optional().default(""),
  location: z.string().optional().default(""),
  mood: z.string().optional().default(""),
  timestamp: z.string().optional().default(""),
  hasClip: z.boolean().optional().default(false),
});

const Schema = z.object({
  preset: z.string().min(1),
  presetName: z.string().optional().default(""),
  format: z.enum(["9:16", "16:9", "1:1"]).default("9:16"),
  captionStyle: z.string().optional().default("None"),
  intro: z.boolean().optional().default(true),
  outro: z.boolean().optional().default(true),
  watermark: z.boolean().optional().default(false),
  beatCutIntensity: z.enum(["low", "medium", "high"]).default("medium"),
  transitionIntensity: z.enum(["low", "medium", "high"]).default("medium"),
  artistName: z.string().optional().default(""),
  songTitle: z.string().optional().default(""),
  scenes: z.array(SceneSchema).min(1),
});

type Input = z.infer<typeof Schema>;

const TRANSITION_BY_INTENSITY: Record<string, string[]> = {
  low: ["Crossfade", "Fade to Black", "Slide"],
  medium: ["Cut", "Whip Pan", "Crossfade"],
  high: ["Zoom", "Flash", "Glitch", "Whip Pan"],
};

const DURATION_BY_INTENSITY: Record<string, number> = {
  low: 6,
  medium: 4,
  high: 2.5,
};

/** Deterministic edit plan — always available even if the AI call fails. */
function buildFallbackPlan(input: Input): unknown {
  const usable = input.scenes.filter((s) => s.hasClip);
  const source = usable.length > 0 ? usable : input.scenes;
  const transitions = TRANSITION_BY_INTENSITY[input.transitionIntensity]!;
  const perClip = DURATION_BY_INTENSITY[input.beatCutIntensity]!;

  const clips = source.map((s, i) => ({
    sceneId: s.id,
    order: i + 1,
    label: [s.section, s.lyricLine || s.action || s.location]
      .filter(Boolean)
      .join(" — ") || `Scene ${i + 1}`,
    transition: i === 0 ? "Cut" : transitions[i % transitions.length]!,
    effect: "None",
    captionTiming:
      input.captionStyle && input.captionStyle !== "None"
        ? `0:00–0:0${Math.round(perClip)}`
        : "—",
    durationSec: perClip,
  }));

  const total = Math.round(clips.length * perClip);
  const mm = Math.floor(total / 60);
  const ss = String(total % 60).padStart(2, "0");

  return {
    template: input.presetName || input.preset,
    format: input.format,
    estimatedDuration: `${mm}:${ss}`,
    introText: input.intro
      ? `${input.artistName || "Artist"} — ${input.songTitle || "Untitled"}`
      : "",
    outroText: input.outro ? "Out Now · Link in bio" : "",
    clips,
    notes:
      "Auto-generated edit plan (offline fallback). Transitions and effects are edit-plan only until final rendering is enabled.",
    fallback: true,
    generatedAt: new Date().toISOString(),
  };
}

router.post("/auto-edit", requireAuth, async (req, res) => {
  const parsed = Schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "preset and at least one scene are required" });
    return;
  }
  const input = parsed.data;

  const sceneLines = input.scenes
    .map(
      (s, i) =>
        `${i + 1}. id="${s.id}" | section="${s.section}" | lyric="${s.lyricLine}" | action="${s.action}" | mood="${s.mood}" | hasClip=${s.hasClip}`,
    )
    .join("\n");

  const userPrompt = `You are editing a music video. Build a structured AI EDIT PLAN as JSON.

PRESET: ${input.presetName || input.preset}
FORMAT: ${input.format}
CAPTION STYLE: ${input.captionStyle}
INTRO CARD: ${input.intro}
OUTRO CARD: ${input.outro}
WATERMARK: ${input.watermark}
BEAT-CUT INTENSITY: ${input.beatCutIntensity}
TRANSITION INTENSITY: ${input.transitionIntensity}
ARTIST: ${input.artistName}
SONG: ${input.songTitle}

SCENES (use the EXACT id values, keep clips with hasClip=true earlier when sensible):
${sceneLines}

Return ONLY valid JSON with this EXACT shape:
{
  "template": "preset name",
  "format": "${input.format}",
  "estimatedDuration": "M:SS",
  "introText": "intro card text or empty string",
  "outroText": "outro card text or empty string",
  "clips": [
    {
      "sceneId": "exact scene id from the list",
      "order": 1,
      "label": "short human label",
      "transition": "one of: Cut, Crossfade, Flash, Glitch, Whip Pan, Zoom, Light Leak, Fade to Black, Slide, Spin",
      "effect": "one of: None, Film Grain, Glow, Blur, Sharpen, Vignette, Black & White, Neon Glow, VHS, Cinematic Bars, Camera Shake, Slow Zoom, Speed Ramp",
      "captionTiming": "e.g. 0:00–0:03 or — if no captions",
      "durationSec": 3
    }
  ],
  "notes": "1-2 sentences on the cut feel and pacing for this preset"
}

Rules:
- Include EVERY scene from the list exactly once, ordered for the best edit.
- Match transition frequency/aggression to the intensity settings and preset vibe.
- First clip transition should be "Cut".
- durationSec should reflect beat-cut intensity (high = ~2-3s, medium = ~4s, low = ~6s).
- No markdown, no code fences, JSON only.`;

  const openai = getOpenAI();
  if (!openai) {
    res.json(buildFallbackPlan(input));
    return;
  }

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "You are an expert music-video editor who plans beat-synced edits and returns strict JSON.",
        },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
      temperature: 0.4,
    });

    const jsonText = response.choices[0]?.message?.content ?? "{}";
    const plan = JSON.parse(jsonText) as Record<string, unknown>;

    const clips = Array.isArray(plan["clips"]) ? plan["clips"] : [];
    if (clips.length === 0) {
      res.json({ ...(buildFallbackPlan(input) as object) });
      return;
    }

    res.json({
      ...plan,
      format: input.format,
      fallback: false,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "Auto-edit plan generation failed; using fallback");
    res.json(buildFallbackPlan(input));
  }
});

export default router;
