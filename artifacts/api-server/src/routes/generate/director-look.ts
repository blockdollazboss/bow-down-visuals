import { Router } from "express";
import OpenAI from "openai";
import { z } from "zod";
import { getOpenAI, getTextModel } from "../../lib/ai-clients";
import { requireAuth } from "../../middlewares/require-auth";
import { freeAiLimiter } from "../../lib/rate-limit";
import {
  LOOK_RAIL_OPTIONS,
  LOOK_RAIL_ORDER,
  isLookPick,
  sceneLookPicksSchema,
  type LookRail,
  type SceneLookPicks,
} from "../../lib/scene-look";

const router = Router();

const directorLookSchema = z.object({
  prompt: z.string().max(4000).optional(),
  action: z.string().max(1000).optional(),
  location: z.string().max(1000).optional(),
  cameraMovement: z.string().max(1000).optional(),
  lighting: z.string().max(1000).optional(),
  mood: z.string().max(1000).optional(),
  videoStyle: z.string().max(500).optional(),
  currentLook: sceneLookPicksSchema.optional(),
});

export interface DirectorProposal {
  picks: SceneLookPicks;
  reasons: Partial<Record<LookRail, string>>;
}

/** The vocabulary block the model must choose from — keys only ever come from here. */
export function directorVocabularyPrompt(): string {
  return LOOK_RAIL_ORDER.map((rail) => {
    const options = LOOK_RAIL_OPTIONS[rail]
      .map((o) => `${o.key} (${o.label})`)
      .join(", ");
    return `- ${rail}: ${options}`;
  }).join("\n");
}

/**
 * Parse + validate a model reply into a proposal. Defensive by design:
 * code fences are stripped, unknown rails/keys are dropped, reasons are
 * clipped to one line, and a reply with zero valid picks is not a proposal.
 */
export function parseDirectorProposal(raw: string): DirectorProposal | null {
  const cleaned = raw.replace(/```(?:json)?/gi, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const record = parsed as Record<string, unknown>;
  const rawPicks = (record.picks ?? record.look ?? {}) as Record<string, unknown>;
  const rawReasons = (record.reasons ?? {}) as Record<string, unknown>;

  const picks: SceneLookPicks = {};
  const reasons: Partial<Record<LookRail, string>> = {};
  for (const rail of LOOK_RAIL_ORDER) {
    const key = rawPicks[rail];
    if (isLookPick(rail, key)) {
      picks[rail] = key;
      const reason = rawReasons[rail];
      if (typeof reason === "string" && reason.trim()) {
        reasons[rail] = reason.trim().replace(/\s+/g, " ").slice(0, 200);
      }
    }
  }
  if (Object.keys(picks).length === 0) return null;
  return { picks, reasons };
}

/**
 * POST /api/director-look
 * The AI Director reads a scene and PROPOSES a Director's Look (one pick
 * per rail + a one-line reason each). It never applies anything: the
 * client holds the proposal until the creator accepts per-rail or
 * wholesale. Same free-AI rail as /improve-prompt (auth + rate limit,
 * no credit charge).
 */
router.post("/director-look", requireAuth, freeAiLimiter, async (req, res) => {
  const parsed = directorLookSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }
  const { prompt, action, location, cameraMovement, lighting, mood, videoStyle, currentLook } = parsed.data;

  const sceneLines: string[] = [];
  if (prompt?.trim()) sceneLines.push(`Scene prompt: ${prompt.trim()}`);
  if (action?.trim()) sceneLines.push(`Action: ${action.trim()}`);
  if (location?.trim()) sceneLines.push(`Location: ${location.trim()}`);
  if (cameraMovement?.trim()) sceneLines.push(`Camera: ${cameraMovement.trim()}`);
  if (lighting?.trim()) sceneLines.push(`Lighting (creator's own words — respect them): ${lighting.trim()}`);
  if (mood?.trim()) sceneLines.push(`Mood (creator's own words — respect them): ${mood.trim()}`);
  if (videoStyle?.trim()) sceneLines.push(`Music video style: ${videoStyle.trim()}`);
  if (currentLook && Object.keys(currentLook).length > 0) {
    sceneLines.push(`Current look picks: ${JSON.stringify(currentLook)}`);
  }
  if (sceneLines.length === 0) {
    res.status(400).json({ error: "Describe the scene first — the AI Director needs something to direct." });
    return;
  }

  const systemPrompt =
    "You are an AI music-video director choosing a structured look for ONE scene. " +
    "Pick exactly ONE option per rail from the vocabularies below — never invent keys. " +
    "Where the creator already wrote their own lighting or mood words, choose picks that agree with them, never fight them. " +
    "Return ONLY a JSON object, no prose, in exactly this shape:\n" +
    '{"picks":{"genre":"<key>","era":"<key>","lens":"<key>","lighting":"<key>","emotion":"<key>"},' +
    '"reasons":{"genre":"<one short line>","era":"<one short line>","lens":"<one short line>","lighting":"<one short line>","emotion":"<one short line>"}}\n' +
    "Each reason is one plain line a creator would understand, max 15 words.\n\n" +
    `Vocabularies:\n${directorVocabularyPrompt()}`;

  try {
    const completion = await getOpenAI().chat.completions.create({
      model: getTextModel(),
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: sceneLines.join("\n") },
      ],
      max_completion_tokens: 400,
      temperature: 0.6,
    });

    const raw = completion.choices[0]?.message?.content ?? "";
    const proposal = parseDirectorProposal(raw);
    if (!proposal) {
      res.status(502).json({ error: "The AI Director could not settle on a look for this scene — try again." });
      return;
    }
    res.json({ proposal });
  } catch (err) {
    req.log.error({ err }, "director-look: OpenAI request failed");
    if (err instanceof OpenAI.APIError && err.status === 429) {
      res.status(429).json({ error: "Rate limited by the AI provider — please wait a moment and try again." });
      return;
    }
    res.status(502).json({ error: "The AI Director is unavailable right now — try again in a moment." });
  }
});

export default router;
