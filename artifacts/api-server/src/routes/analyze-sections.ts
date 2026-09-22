import { Router } from "express";
import { getOpenAI } from "../lib/ai-clients";
import { requireAuth } from "../middlewares/require-auth";
import { z } from "zod";

const router = Router();

const Schema = z.object({
  lyrics: z.string().min(10),
});

router.post("/analyze-sections", requireAuth, async (req, res) => {
  const parsed = Schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Lyrics (min 10 chars) are required" });
    return;
  }

  const { lyrics } = parsed.data;

  const userPrompt = `Analyze the following song lyrics and return a JSON object with this EXACT structure. Only include sections that actually exist in the lyrics. If you detect extra sections (Pre-Hook, Verse 3, etc.) add them.

{
  "hasTimestamps": false,
  "sections": [
    { "name": "Intro", "lyrics": "brief excerpt or empty string", "notes": "tone, energy, director note" },
    { "name": "Hook / Chorus", "lyrics": "the hook lyrics", "notes": "energy level, emotional impact" },
    { "name": "Verse 1", "lyrics": "verse 1 excerpt", "notes": "flow, theme, delivery" },
    { "name": "Verse 2", "lyrics": "verse 2 excerpt", "notes": "flow, theme, shift from verse 1" },
    { "name": "Bridge", "lyrics": "bridge lyrics or empty string", "notes": "emotional shift" },
    { "name": "Outro", "lyrics": "outro lyrics or empty string", "notes": "how it closes" }
  ],
  "promo15": {
    "section": "name of the best single 15-second section for a promo clip",
    "reason": "why this 15 seconds has the most replay/hook value"
  },
  "promo30": {
    "section": "best 30-second section or range (e.g. 'Pre-Hook + Hook')",
    "reason": "why this 30 seconds builds and pays off best"
  },
  "videoPacing": "Describe the ideal scene pacing section by section — how fast/slow cuts should be, camera energy per section. 3-5 sentences.",
  "energyMap": "Describe the full emotional energy arc — where it starts, peaks, dips, and lands. Write as a flowing narrative. 3-4 sentences."
}

SONG LYRICS:
${lyrics}

Return ONLY valid JSON. No markdown, no code blocks, no explanation.`;

  try {
    const response = await getOpenAI().chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: "You are an expert music producer and music video director who analyzes song structure and pacing.",
        },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
      temperature: 0.3,
    });

    const jsonText = response.choices[0]?.message?.content ?? "{}";
    const analysis = JSON.parse(jsonText) as unknown;
    res.json(analysis);
  } catch (err) {
    req.log.error({ err }, "Section analysis failed");
    res.status(500).json({ error: "Analysis failed" });
  }
});

export default router;
