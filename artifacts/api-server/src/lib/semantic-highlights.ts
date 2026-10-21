import { randomUUID } from "crypto";
import { getOpenAI, getTextModel } from "./ai-clients";

/* ─── Semantic highlight detection (shared) ──────────────────────────────
   Generalized from the streamer-clips rail (routes/generate/streamer-clips.ts),
   whose detectHighlights() only answers three fixed vibe presets for stream
   VODs and carries no per-clip score. This module is the general form used
   by the long-form → shorts rail (routes/generate/video-to-shorts.ts):

   - direction is a free-text moment description from the creator
     ("find the part where I explain pricing"), a vibe preset, or the
     built-in "most clip-worthy moments" direction;
   - every candidate carries a model-assessed score (0–100) AND a one-line
     reason. Scores are honest by construction: the value is whatever the
     model returned, clamped to 0–100; a missing/unusable score stays
     null — it is never synthesized from energy or position.

   The streamer rail keeps its own vibe-only detector; the transcription
   machinery both rails use (transcribeVideoFile) lives there and is
   imported, not duplicated. */

export interface SemanticHighlight {
  id: string;
  startSec: number;
  endSec: number;
  title: string;
  reason: string;
  quote: string;
  /** Model-assessed clip strength, 0–100. null when the model gave no
   *  usable score — callers must show it only when present. */
  score: number | null;
}

export const SEMANTIC_VIBES = ["funny", "hype", "wholesome"] as const;
export type SemanticVibe = (typeof SEMANTIC_VIBES)[number];

/* Same direction text the streamer rail uses for its presets — ported so
   a vibe means the same thing on both rails. */
export const SEMANTIC_VIBE_DIRECTION: Record<SemanticVibe, string> = {
  funny:
    "the funniest moments — jokes that land, fails, unexpected chaos, genuine laugh-out-loud reactions",
  hype:
    "the highest-energy moments — clutch plays, big wins, celebrations, crowd-pumping reactions, goosebump peaks",
  wholesome:
    "the most heartwarming moments — kindness, gratitude, sweet interactions, feel-good wins, genuine smiles",
};

const DEFAULT_DIRECTION =
  "the most clip-worthy moments — strong hooks in the first seconds, punchlines, surprising claims, emotional peaks, quotable lines, and clear payoffs a viewer would share";

export type SemanticModelCall = (
  messages: Array<{ role: string; content: string }>,
) => Promise<string>;

/** Clamp a model-supplied score to an honest 0–100 integer; anything that
 *  is not a finite number stays null (never fabricated). */
export function parseSemanticScore(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, Math.round(value)));
}

/**
 * Parse the model's JSON into highlights — the streamer rail's window
 * normalization (snap to the requested clip length, clamp to the video,
 * drop near-duplicate starts), plus score parsing and BEST-FIRST ranking
 * (highest score first; unscored candidates last; ties by timeline).
 * Pure — exported for tests.
 */
export function parseSemanticHighlights(
  raw: string,
  opts: { clipLength: number; maxClips: number; durationSec: number },
): SemanticHighlight[] {
  let arr: unknown[] = [];
  try {
    const parsed = JSON.parse(raw) as { highlights?: unknown };
    if (Array.isArray(parsed.highlights)) arr = parsed.highlights;
  } catch {
    return [];
  }
  const out: SemanticHighlight[] = [];
  for (const h of arr) {
    if (!h || typeof h !== "object") continue;
    const o = h as Record<string, unknown>;
    const startSec = typeof o["startSec"] === "number" ? o["startSec"] : NaN;
    let endSec = typeof o["endSec"] === "number" ? o["endSec"] : NaN;
    const title = typeof o["title"] === "string" ? o["title"].trim().slice(0, 120) : "";
    const reason = typeof o["reason"] === "string" ? o["reason"].trim().slice(0, 300) : "";
    const quote = typeof o["quote"] === "string" ? o["quote"].trim().slice(0, 200) : "";
    if (!Number.isFinite(startSec) || startSec < 0 || !title) continue;
    // Normalize the window to the requested clip length.
    if (!Number.isFinite(endSec) || endSec <= startSec) {
      endSec = startSec + opts.clipLength;
    }
    const want = opts.clipLength;
    const got = endSec - startSec;
    if (Math.abs(got - want) > 12) {
      endSec = startSec + want;
    }
    if (opts.durationSec > 0 && endSec > opts.durationSec) {
      endSec = opts.durationSec;
      if (endSec - startSec < 5) continue;
    }
    // Dedupe against near-identical starts.
    if (out.some((e) => Math.abs(e.startSec - startSec) < 5)) continue;
    out.push({
      id: randomUUID(),
      startSec: Math.round(startSec * 10) / 10,
      endSec: Math.round(endSec * 10) / 10,
      title,
      reason,
      quote,
      score: parseSemanticScore(o["score"]),
    });
    if (out.length >= opts.maxClips) break;
  }
  // Ranked best-first: scored before unscored, higher score first,
  // timeline order breaks ties.
  return out.sort((a, b) => {
    if (a.score != null && b.score != null && a.score !== b.score) return b.score - a.score;
    if (a.score != null && b.score == null) return -1;
    if (a.score == null && b.score != null) return 1;
    return a.startSec - b.startSec;
  });
}

/**
 * Ask the text model for the best moments in a timestamped transcript.
 * `query` (free text from the creator) wins over `vibe`; with neither,
 * the general clip-worthy direction is used. The model call is injected
 * for tests, mirroring streamer-clips' detectHighlights.
 */
export async function detectSemanticHighlights(
  transcript: string,
  opts: {
    clipLength: number;
    maxClips: number;
    durationSec: number;
    query?: string;
    vibe?: SemanticVibe;
  },
  modelCall?: SemanticModelCall,
): Promise<SemanticHighlight[]> {
  const direction = opts.query
    ? `moments that match this description from the creator: "${opts.query}". ` +
      `Only return moments that genuinely match the description — if nothing in the transcript matches, return an empty list rather than forcing picks`
    : opts.vibe
      ? SEMANTIC_VIBE_DIRECTION[opts.vibe]
      : DEFAULT_DIRECTION;
  const call: SemanticModelCall =
    modelCall ??
    (async (messages) => {
      const completion = await getOpenAI().chat.completions.create({
        model: getTextModel(),
        messages: messages as Array<{ role: "system" | "user"; content: string }>,
        response_format: { type: "json_object" },
        max_completion_tokens: 2000,
        temperature: 0.6,
      });
      return completion.choices[0]?.message?.content ?? "{}";
    });
  const raw = await call([
    {
      role: "system",
      content:
        `You are an expert short-form video editor. ` +
        `Given a timestamped transcript of a long video, find ${direction}. ` +
        `Each highlight should be a self-contained moment about ${opts.clipLength} seconds long ` +
        `(set endSec ≈ startSec + ${opts.clipLength}). Prefer moments with a clear payoff inside ` +
        `the window — reaction, punchline, or result. Never invent moments that are not in the ` +
        `transcript; base startSec on the [mm:ss] markers. Return at most ${opts.maxClips} highlights, ` +
        `ranked best-first. For each highlight give "score": your honest 0–100 assessment of how ` +
        `strong the moment is as a standalone short clip (100 = unmissable). ` +
        `Return ONLY JSON: {"highlights": [{"startSec": <number>, "endSec": <number>, ` +
        `"score": <number 0-100>, "title": "<punchy clip title>", "reason": "<one line: why this moment works>", ` +
        `"quote": "<short memorable line from the moment>"}]}`,
    },
    { role: "user", content: `Find the best moments in this transcript:\n\n${transcript}` },
  ]);
  return parseSemanticHighlights(raw, opts);
}
