import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../../middlewares/require-auth";
import { chargeCredits, OutOfCreditsError } from "../../lib/credits";
import { getTextModel } from "../../lib/ai-clients";

const router = Router();

/* ─── AI Copilot — timeline analysis ─────────────────────────────────────
   The expert editor looking over your shoulder. Takes a compact timeline
   snapshot and returns actionable suggestions: transitions, pacing, audio,
   captions, color, B-roll. Each suggestion carries a machine-readable
   `action` the frontend can apply with one click (and undo).

   50 Visual Bucs per analysis. Client-side heuristics (jarring cuts, dead
   spots) run free in the browser; this route is the LLM brain for the
   nuanced calls (mood → grade, pacing notes, transition taste). */

const COPILOT_COST = Number(process.env["AI_COPILOT_CREDITS"]) || 50;

const sceneSchema = z.object({
  id: z.string(),
  sceneNumber: z.number().int(),
  section: z.string().optional().default(""),
  lyricLine: z.string().optional().default(""),
  mood: z.string().optional().default(""),
  action: z.string().optional().default(""),
  cameraMovement: z.string().optional().default(""),
  durationSec: z.number().min(0).optional().default(0),
  hasClip: z.boolean().optional().default(false),
  transition: z.string().optional().default(""),
});

const analyzeSchema = z.object({
  scenes: z.array(sceneSchema).min(1).max(60),
  totalDurationSec: z.number().min(0).optional().default(0),
  songTitle: z.string().optional().default(""),
  artistName: z.string().optional().default(""),
  genre: z.string().optional().default(""),
  hasCaptions: z.boolean().optional().default(false),
  captionStyle: z.string().optional().default(""),
  currentGrade: z.string().optional().default(""),
  targetPlatform: z.string().optional().default(""),
  /** Client-side heuristic flags the browser already computed (free). */
  flags: z.object({
    jarringCuts: z.array(z.number().int()).optional().default([]),
    deadSpots: z.array(z.number().int()).optional().default([]),
    missingTransitions: z.array(z.number().int()).optional().default([]),
  }).optional(),
});

const suggestionSchema = z.object({
  /** short label shown in the copilot feed */
  title: z.string(),
  /** one-line explanation of why */
  reason: z.string(),
  /** severity drives sort order + badge color */
  severity: z.enum(["fix", "polish", "idea"]),
  /** machine-readable action the frontend applies */
  action: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("set-transition"), sceneIndex: z.number().int(), transition: z.string() }),
    z.object({ kind: z.literal("set-grade"), grade: z.string() }),
    z.object({ kind: z.literal("set-caption-style"), style: z.string() }),
    z.object({ kind: z.literal("split-scene"), sceneIndex: z.number().int(), atFraction: z.number().min(0).max(1) }),
    z.object({ kind: z.literal("suggest-broll"), sceneIndex: z.number().int(), prompt: z.string() }),
    z.object({ kind: z.literal("note"), text: z.string() }),
  ]),
  /** seconds into the timeline this applies to (for jump-to) */
  atSec: z.number().optional(),
});

const VALID_TRANSITIONS = [
  "Cut", "Crossfade", "Flash", "Glitch", "Whip Pan", "Zoom", "Light Leak",
  "Fade to Black", "Slide", "Spin", "Blur Dissolve", "Zoom Blur", "Film Burn",
  "RGB Split", "Morph", "Page Peel", "Cube Rotate", "Ripple", "Shatter",
  "Iris In", "Iris Out", "Cross Zoom",
];

const VALID_GRADES = [
  "Vibrant Pop", "Warm Grade", "Moody Desaturated", "Teal & Orange",
  "Cool Grade", "Noir", "Golden Hour", "Neon Night",
];

router.post("/analyze", requireAuth, async (req, res) => {
  const parsed = analyzeSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }
  const input = parsed.data;

  const currentCredits = req.userCredits ?? 0;
  if (currentCredits < COPILOT_COST) {
    res.status(402).json({
      error: "out_of_credits",
      message: "Not enough Visual Bucs. Buy more Visual Bucs to keep creating.",
    });
    return;
  }

  let openaiKey: string | undefined;
  try {
    const { getOpenAI } = await import("../../lib/ai-clients");
    getOpenAI(); // throws when key missing — fail before charging
    openaiKey = process.env["OPENAI_API_KEY"];
  } catch {
    res.status(503).json({ error: "ai_unavailable", message: "AI is not configured right now." });
    return;
  }

  try {
    await chargeCredits(req.userId!, COPILOT_COST, { action: "AI Copilot analysis" });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({ error: "out_of_credits", message: "Not enough Visual Bucs." });
      return;
    }
    throw err;
  }

  try {
    const model = getTextModel();
    const timelineDesc = input.scenes.map((s, i) => {
      const bits = [`#${i} "${s.section || "scene"}"`, `${s.durationSec.toFixed(1)}s`];
      if (s.mood) bits.push(`mood:${s.mood}`);
      if (s.action) bits.push(`action:${s.action.slice(0, 60)}`);
      if (s.transition) bits.push(`transition:${s.transition}`);
      if (!s.hasClip) bits.push("NO-CLIP");
      return bits.join(" ");
    }).join("\n");

    const flags = input.flags ?? { jarringCuts: [], deadSpots: [], missingTransitions: [] };
    const flagDesc = [
      flags.jarringCuts.length ? `Jarring quick cuts at scene indexes: ${flags.jarringCuts.join(",")}` : "",
      flags.deadSpots.length ? `Dead/slow spots at scene indexes: ${flags.deadSpots.join(",")}` : "",
      flags.missingTransitions.length ? `No transition set at scene indexes: ${flags.missingTransitions.join(",")}` : "",
    ].filter(Boolean).join("\n") || "No heuristic flags.";

    const prompt =
      `You are an expert video editor reviewing a music-video timeline. Return 4-8 concrete, actionable suggestions.\n\n` +
      `Project: "${input.songTitle}" by ${input.artistName || "unknown artist"}${input.genre ? ` (${input.genre})` : ""}\n` +
      `Total duration: ${input.totalDurationSec.toFixed(0)}s. Captions: ${input.hasCaptions ? `yes (${input.captionStyle || "default style"})` : "NO"}. ` +
      `Current color grade: ${input.currentGrade || "none"}. Target platform: ${input.targetPlatform || "unspecified"}.\n\n` +
      `Timeline:\n${timelineDesc}\n\nBrowser heuristics:\n${flagDesc}\n\n` +
      `Valid transitions: ${VALID_TRANSITIONS.join(", ")}.\n` +
      `Valid color grades: ${VALID_GRADES.join(", ")}.\n\n` +
      `Rules:\n` +
      `- Prioritize real problems (jarring cuts, dead spots, missing captions) over taste.\n` +
      `- severity "fix" = something wrong; "polish" = clear improvement; "idea" = creative option.\n` +
      `- For set-transition use ONLY a valid transition name and a real sceneIndex (0-based).\n` +
      `- For set-grade use ONLY a valid grade name.\n` +
      `- For split-scene use atFraction 0.3-0.7.\n` +
      `- Keep titles under 60 chars, reasons under 140 chars.\n` +
      `- Return ONLY valid JSON: {"suggestions": [{"title": "...", "reason": "...", "severity": "fix|polish|idea", "action": {"kind": "...", ...}, "atSec": 12.5}]}\n` +
      `Action kinds: set-transition {sceneIndex, transition}, set-grade {grade}, set-caption-style {style}, split-scene {sceneIndex, atFraction}, suggest-broll {sceneIndex, prompt}, note {text}.`;

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${openaiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
        temperature: 0.6,
        max_tokens: 2000,
      }),
      signal: AbortSignal.timeout(90_000),
    });

    if (!response.ok) throw new Error("Copilot analysis failed.");
    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error("Empty copilot analysis.");

    const parsedContent = JSON.parse(content) as { suggestions?: unknown[] };
    let suggestions = z.array(suggestionSchema).parse(parsedContent.suggestions ?? []);

    // Sanitize: clamp scene indexes, validate enums against the real lists.
    suggestions = suggestions.filter((s) => {
      const a = s.action;
      if (a.kind === "set-transition") {
        return a.sceneIndex >= 0 && a.sceneIndex < input.scenes.length &&
          VALID_TRANSITIONS.includes(a.transition);
      }
      if (a.kind === "set-grade") return VALID_GRADES.includes(a.grade);
      if (a.kind === "split-scene" || a.kind === "suggest-broll") {
        return a.sceneIndex >= 0 && a.sceneIndex < input.scenes.length;
      }
      return true;
    }).slice(0, 8);

    if (suggestions.length === 0) {
      suggestions = [{
        title: "Timeline looks solid",
        reason: "No major issues detected. Keep building — add B-roll or tighten pacing when ready.",
        severity: "idea",
        action: { kind: "note", text: "No action needed." },
      }];
    }

    res.json({ suggestions, creditsCharged: COPILOT_COST });
  } catch (err) {
    console.error("[ai-copilot] analyze failed:", err);
    res.status(500).json({ error: "analysis_failed", message: "Copilot analysis failed. Try again." });
  }
});

export default router;
