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

const StemSchema = z.object({
  name: z.string().optional().default(""),
  type: z.string().optional().default(""),
});

const Schema = z.object({
  preset: z.string().min(1),
  presetName: z.string().optional().default(""),
  vocalLoudness: z.enum(["low", "medium", "high"]).default("medium"),
  beatLoudness: z.enum(["low", "medium", "high"]).default("medium"),
  bassStrength: z.enum(["low", "medium", "high"]).default("medium"),
  vocalClarity: z.enum(["low", "medium", "high"]).default("medium"),
  reverbAmount: z.enum(["none", "light", "medium", "heavy"]).default("light"),
  autotuneStyle: z.enum(["off", "light", "modern", "heavy"]).default("light"),
  masterLoudness: z.enum(["demo", "streaming", "loud"]).default("streaming"),
  cleanRadioMode: z.boolean().optional().default(false),
  artistName: z.string().optional().default(""),
  songTitle: z.string().optional().default(""),
  genre: z.string().optional().default(""),
  stems: z.array(StemSchema).optional().default([]),
});

type Input = z.infer<typeof Schema>;

/** Strict shape the model output must conform to before we trust it. */
const PlanSchema = z.object({
  preset: z.string().min(1),
  summary: z.string().min(1),
  stemLevels: z.array(z.object({ name: z.string(), level: z.string() })).default([]),
  vocalChain: z.array(z.string()).min(1),
  beatChain: z.array(z.string()).default([]),
  masterChain: z.array(z.string()).default([]),
  loudnessTarget: z.string().min(1),
  exportRecommendation: z.string().min(1),
  notes: z.string().default(""),
});

const LOUDNESS_LABEL: Record<string, string> = {
  demo: "-14 LUFS (demo / dynamic)",
  streaming: "-9 LUFS (Spotify / Apple streaming)",
  loud: "-6 LUFS (max club loudness)",
};

const LEVEL_WORD: Record<string, string> = {
  low: "pulled back",
  medium: "balanced",
  high: "pushed up front",
};

/** Deterministic mix plan — always available even when the AI call fails. */
function buildFallbackPlan(input: Input): unknown {
  const stemLevels =
    input.stems.length > 0
      ? input.stems.map((s) => {
          const t = (s.type || s.name || "").toLowerCase();
          let level = "0 dB · balanced";
          if (t.includes("vocal") && !t.includes("back")) {
            level = `${LEVEL_WORD[input.vocalLoudness]} · lead vocal`;
          } else if (t.includes("back") || t.includes("ad-lib") || t.includes("adlib")) {
            level = "-4 dB · support";
          } else if (t.includes("808") || t.includes("bass")) {
            level = `${LEVEL_WORD[input.bassStrength]} · low end`;
          } else if (t.includes("beat") || t.includes("instrumental") || t.includes("drum")) {
            level = `${LEVEL_WORD[input.beatLoudness]} · beat`;
          }
          return { name: s.name || s.type || "Stem", level };
        })
      : [
          { name: "Lead Vocals", level: `${LEVEL_WORD[input.vocalLoudness]} · lead vocal` },
          { name: "Beat / Instrumental", level: `${LEVEL_WORD[input.beatLoudness]} · beat` },
          { name: "808 / Bass", level: `${LEVEL_WORD[input.bassStrength]} · low end` },
        ];

  const vocalChain: string[] = [];
  vocalChain.push("High-pass filter @ 90Hz to remove rumble");
  if (input.autotuneStyle !== "off") {
    vocalChain.push(`Autotune (${input.autotuneStyle}) tuned to song key`);
  }
  vocalChain.push("De-esser to tame harsh S sounds");
  vocalChain.push(
    `Compression ${input.vocalClarity === "high" ? "3:1 medium-fast" : "2:1 gentle"} for a steady vocal`,
  );
  vocalChain.push(
    input.vocalClarity === "high"
      ? "Presence EQ boost @ 3-5kHz for clarity"
      : "Subtle presence lift for clarity",
  );
  if (input.reverbAmount !== "none") {
    vocalChain.push(`${input.reverbAmount} reverb + slap delay for space`);
  }
  if (input.cleanRadioMode) vocalChain.push("Clean radio edit — mute/strip explicit words");

  const beatChain: string[] = [
    `Balance beat ${LEVEL_WORD[input.beatLoudness]} under the vocal`,
    input.bassStrength === "high"
      ? "Boost & control 808/bass with sidechain to the kick"
      : "Tighten 808/bass with light compression",
    "Carve 200-400Hz mud so vocals sit clearly",
  ];

  const masterChain: string[] = [
    `Master EQ — ${input.bassStrength === "high" ? "warm low-end" : "balanced"} tone`,
    "Glue bus compression (1-2 dB gain reduction)",
    "Stereo widening on music, mono-safe low end",
    `Limiter to ${LOUDNESS_LABEL[input.masterLoudness]}`,
  ];

  return {
    preset: input.presetName || input.preset,
    summary: `${input.presetName || input.preset} mix${input.songTitle ? ` for "${input.songTitle}"` : ""}${input.artistName ? ` by ${input.artistName}` : ""}. Vocals ${LEVEL_WORD[input.vocalLoudness]}, beat ${LEVEL_WORD[input.beatLoudness]}, low end ${LEVEL_WORD[input.bassStrength]}.`,
    stemLevels,
    vocalChain,
    beatChain,
    masterChain,
    loudnessTarget: LOUDNESS_LABEL[input.masterLoudness] ?? "-9 LUFS",
    exportRecommendation:
      input.masterLoudness === "demo"
        ? "Export a 24-bit WAV demo + MP3 reference."
        : "Export a streaming-ready WAV master + MP3, plus a clean/instrumental version.",
    notes:
      "Auto-generated mix plan (offline fallback). This describes the mix & master chain — rendered audio is coming soon.",
    fallback: true,
    generatedAt: new Date().toISOString(),
  };
}

router.post("/mix-plan", requireAuth, async (req, res) => {
  const parsed = Schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "A mix preset is required" });
    return;
  }
  const input = parsed.data;

  const stemLines =
    input.stems.length > 0
      ? input.stems.map((s, i) => `${i + 1}. ${s.name || "Stem"} (${s.type || "unknown"})`).join("\n")
      : "No stems uploaded — assume a standard vocal + beat + 808 layout.";

  const userPrompt = `You are a professional hip-hop / R&B mixing & mastering engineer. Build a structured MIX & MASTER PLAN as JSON.

PRESET: ${input.presetName || input.preset}
GENRE: ${input.genre}
ARTIST: ${input.artistName}
SONG: ${input.songTitle}

ENGINEER SETTINGS:
- Vocal loudness: ${input.vocalLoudness}
- Beat loudness: ${input.beatLoudness}
- Bass / 808 strength: ${input.bassStrength}
- Vocal clarity: ${input.vocalClarity}
- Reverb amount: ${input.reverbAmount}
- Autotune style: ${input.autotuneStyle}
- Master loudness target: ${input.masterLoudness}
- Clean radio mode: ${input.cleanRadioMode}

STEMS:
${stemLines}

Return ONLY valid JSON with this EXACT shape:
{
  "preset": "preset name",
  "summary": "1-2 sentence summary of the target sound",
  "stemLevels": [ { "name": "stem name", "level": "short level/role note" } ],
  "vocalChain": [ "ordered vocal processing steps" ],
  "beatChain": [ "ordered beat/instrumental processing steps" ],
  "masterChain": [ "ordered master bus steps" ],
  "loudnessTarget": "e.g. -9 LUFS (streaming)",
  "exportRecommendation": "what files to export",
  "notes": "1-2 sentences of advice"
}

Rules:
- Tailor every chain to the preset, genre and the engineer settings above.
- If clean radio mode is on, include stripping/muting explicit words in the vocal chain.
- Keep each list item short and practical (a real engineer instruction).
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
            "You are an expert mixing & mastering engineer who returns strict JSON mix plans.",
        },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
      temperature: 0.5,
    });

    const jsonText = response.choices[0]?.message?.content ?? "{}";
    const raw = JSON.parse(jsonText) as unknown;

    const validated = PlanSchema.safeParse(raw);
    if (!validated.success) {
      req.log.warn({ issues: validated.error.issues }, "Mix plan output failed validation; using fallback");
      res.json(buildFallbackPlan(input));
      return;
    }

    res.json({
      ...validated.data,
      fallback: false,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "Mix plan generation failed; using fallback");
    res.json(buildFallbackPlan(input));
  }
});

export default router;
