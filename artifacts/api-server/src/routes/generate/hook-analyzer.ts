import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../../middlewares/require-auth";
import { chargeCredits, refundCredits, OutOfCreditsError } from "../../lib/credits";
import { getTextModel } from "../../lib/ai-clients";

const router = Router();

/* ─── AI video hook analyzer ───
   Scores the first 30 seconds of a video's transcript on curiosity gap,
   pattern interrupt, and clarity — then rewrites a stronger hook.
   Optional `mode: "viral"` engineers the rewrite for the viral loop:
   the creator looks good (authority + craft on display) and the viewer
   is left asking "how did you make that?".
   75 Visual Bucs per analysis. */

const HOOK_ANALYZE_COST = Number(process.env["HOOK_ANALYZER_CREDITS"]) || 75;

const analyzeHookSchema = z.object({
  /** First ~30 seconds transcript of the video (spoken words). */
  transcript: z.string().trim().min(10).max(3000),
  /** Platform the video is for — affects hook best practices. */
  platform: z.enum(["tiktok", "instagram", "youtube", "x"]).optional().default("tiktok"),
  /** Video niche/topic for context. */
  niche: z.string().trim().min(1).max(100).optional().default(""),
  /** "standard" scores the hook as-is; "viral" engineers the rewrite for the viral loop. */
  mode: z.enum(["standard", "viral"]).optional().default("standard"),
});

interface HookAnalysis {
  curiosityGap: number;
  patternInterrupt: number;
  clarity: number;
  overallScore: number;
  verdict: string;
  weaknesses: string[];
  rewrittenHook: string;
  rewriteNotes: string[];
  alternativeHooks: string[];
}

async function callJsonModel(prompt: string, temperature = 0.7): Promise<string> {
  const model = getTextModel();
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      temperature,
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) throw new Error("Hook analysis failed.");
  const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("Empty hook analysis result.");
  return content;
}

const clamp10 = (n: unknown, fallback: number) =>
  Math.min(10, Math.max(1, Math.round(Number(n) || fallback)));

router.post("/analyze-hook", requireAuth, async (req, res) => {
  const parsed = analyzeHookSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  const currentCredits = req.userCredits ?? 0;
  if (!process.env.OPENAI_API_KEY) {
    res.status(503).json({
      error: "OPENAI_API_KEY is not configured — this AI feature is unavailable.",
    });
    return;
  }
  if (currentCredits < HOOK_ANALYZE_COST) {
    res.status(402).json({
      error: "out_of_credits",
      message: "Not enough Visual Bucs. Buy more Visual Bucs to keep creating.",
    });
    return;
  }

  let creditsAfter: number;
  try {
    creditsAfter = await chargeCredits(req.userId!, HOOK_ANALYZE_COST, {
      action: "Hook Analysis",
    });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({ error: "out_of_credits", message: "Not enough Visual Bucs." });
      return;
    }
    throw err;
  }

  try {
    const { transcript, platform, niche, mode } = parsed.data;
    const viral = mode === "viral";

    const strategistLine = viral
      ? `You are a viral-loop hook strategist. Your rewrite must do two jobs at once: ` +
        `make the creator look good (authority, craft, and skill on display — the viewer thinks "this person is THAT good") ` +
        `AND open a process-curiosity gap that makes the viewer ask "how did you make that?" and keep watching to find out.\n\n`
      : `You are a viral video hook strategist. `;

    const rewriteLine = viral
      ? `Then write a rewritten, stronger version of the hook engineered for the viral loop: ` +
        `lead with the impressive result or transformation (so the creator looks elite), ` +
        `tease the process without giving it away (so the viewer must watch to learn "how did you make that?"), ` +
        `spoken-word style, under 15 seconds when read aloud. ` +
        `Plus 2 punchy alternative hooks built on the same viral-loop mechanics.\n\n`
      : `Then write a rewritten, stronger version of the hook (spoken-word style, under 15 seconds when read aloud), ` +
        `plus 2 punchy alternative hooks.\n\n`;

    const prompt =
      strategistLine +
      `Analyze the opening of this ${platform} video ` +
      `${niche ? `in the "${niche}" niche ` : ""}based on its first ~30 seconds of transcript.\n\n` +
      `Transcript:\n${transcript}\n\n` +
      `Score the hook on three axes (1-10 each):\n` +
      `- curiosityGap: does it open an unanswered question or knowledge gap the viewer must keep watching to close?\n` +
      `- patternInterrupt: does it break the scroll with something unexpected, bold, or visually/conceptually jarring?\n` +
      `- clarity: does the viewer instantly know what this video is about and why they should care?\n\n` +
      rewriteLine +
      `Return ONLY valid JSON in this shape:\n` +
      `{\n` +
      `  "curiosityGap": <1-10>,\n` +
      `  "patternInterrupt": <1-10>,\n` +
      `  "clarity": <1-10>,\n` +
      `  "overallScore": <1-10 average rounded>,\n` +
      `  "verdict": "<1 sentence overall judgment>",\n` +
      `  "weaknesses": ["<specific weakness>", ...2-4 items],\n` +
      `  "rewrittenHook": "<the improved hook, spoken-word style>",\n` +
      `  "rewriteNotes": ["<why the rewrite works>", ...2-3 items],\n` +
      `  "alternativeHooks": ["<alt hook 1>", "<alt hook 2>"]\n` +
      `}`;

    const content = await callJsonModel(prompt, 0.7);
    const analysis = JSON.parse(content) as HookAnalysis;

    const strArr = (v: unknown, max: number, len: number): string[] =>
      (Array.isArray(v) ? v : [])
        .filter((s) => typeof s === "string" && s.trim().length > 0)
        .map((s) => s.slice(0, len))
        .slice(0, max);

    res.json({
      analysis: {
        curiosityGap: clamp10(analysis.curiosityGap, 5),
        patternInterrupt: clamp10(analysis.patternInterrupt, 5),
        clarity: clamp10(analysis.clarity, 5),
        overallScore: clamp10(analysis.overallScore, 5),
        verdict: String(analysis.verdict ?? "").slice(0, 300),
        weaknesses: strArr(analysis.weaknesses, 4, 250),
        rewrittenHook: String(analysis.rewrittenHook ?? "").slice(0, 600),
        rewriteNotes: strArr(analysis.rewriteNotes, 3, 250),
        alternativeHooks: strArr(analysis.alternativeHooks, 2, 300),
      },
      platform,
      creditsRemaining: creditsAfter,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Hook analysis failed.";
    req.log.error({ err: message }, "[analyze-hook] failed");
    await refundCredits(req.userId!, HOOK_ANALYZE_COST, {
      action: "Hook Analysis — Refund",
    }).catch(() => {});
    res.status(500).json({ error: message });
  }
});

export default router;
