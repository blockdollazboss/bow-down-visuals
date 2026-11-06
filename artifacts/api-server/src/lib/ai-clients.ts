import OpenAI from "openai";

/* Lazy OpenAI client — constructed on first use, not at import time.
   Several routes used to do `new OpenAI(...)` at module load, which throws
   when OPENAI_API_KEY is absent and crashes the entire server at boot.
   With this helper, a missing key only fails the routes that need it. */
let cached: OpenAI | null = null;

export function getOpenAI(): OpenAI {
  if (!cached) {
    const key = process.env["OPENAI_API_KEY"];
    if (!key) {
      throw new Error(
        "OPENAI_API_KEY is not configured — this AI feature is unavailable."
      );
    }
    cached = new OpenAI({ apiKey: key });
  }
  return cached;
}

/* Default OpenAI text model for every prompt-generation route — env-overridable.
   gpt-6.1-sol is the current price/performance pick ($2 input / $10 output per 1M
   tokens, cached input $0.10; released 2026-09-29 as the successor to gpt-6-sol
   at the same price). Override with OPENAI_TEXT_MODEL (e.g. gpt-6-astra for
   flagship, gpt-6-luna for the cheapest tier).
   PARAM RULES for the GPT-6.1 Sol family (OpenAI migration guide): sampling
   params are NOT supported — never send temperature, top_p, top_logprobs or
   logprobs; reasoning_effort "none"/"minimal" are invalid (low..max only);
   tool calling requires the Responses API (Chat Completions works only for
   tool-free requests). Call sites must follow these rules or the API 400s. */
export function getTextModel(): string {
  return process.env["OPENAI_TEXT_MODEL"] || "gpt-6.1-sol";
}

/* C-48 SAFETY PIN (owner ruling, Nov 6 2026 — "Merge it, with the safety
   pin"): GPT-6.1 Sol defaults to MEDIUM reasoning, and reasoning tokens bill
   as output (1¢ per 1,000), so an unpinned half-cent call can quietly become
   a two-cent call. Trivial routes — short-form, low-stakes generation where
   deep reasoning adds nothing (titles, bios, captions, tags, alt text,
   one-line helpers and their siblings) — spread this into their Chat
   Completions params to pin reasoning to "low", the weakest effort 6.1
   accepts ("none"/"minimal" are invalid on 6.1). Substantive routes — site
   chat, Coach, script writer, sponsor matching, translator, audits, plans,
   and anything where output quality IS the product — must NOT use this:
   they keep the model default. The pinned set is enumerated in the two
   registries below and enforced by
   lib/__tests__/text-model-safety-pin.test.ts: adding a text-model call to
   a registered file, or spreading this constant anywhere unregistered,
   fails that suite until the classification is updated here on purpose. */
export const LOW_REASONING_PARAMS = { reasoning_effort: "low" } as const;

/* Files (relative to artifacts/api-server/src) in which EVERY
   chat.completions.create call is a trivial-route call and must spread
   LOW_REASONING_PARAMS. */
export const TRIVIAL_TEXT_CALL_FILES: readonly string[] = [
  "lib/catalog-import.ts",
  "lib/move-home.ts",
  "routes/discord.ts",
  "routes/live-captions.ts",
  "routes/live-shopping.ts",
  "routes/social.ts",
  "routes/wave8-caption-styler.ts",
  "routes/wave8-hook-rewriter.ts",
  "routes/generate/alt-text.ts",
  "routes/generate/auto-chapters.ts",
  "routes/generate/auto-edit.ts",
  "routes/generate/beats.ts",
  "routes/generate/chapters.ts",
  "routes/generate/comment-replies.ts",
  "routes/generate/cta-generator.ts",
  "routes/generate/director-look.ts",
  "routes/generate/gamers.ts",
  "routes/generate/guest-questions.ts",
  "routes/generate/improve-prompt.ts",
  "routes/generate/improve-style.ts",
  "routes/generate/meme-machine.ts",
  "routes/generate/press-kit.ts",
  "routes/generate/promo-generator.ts",
  "routes/generate/quote-finder.ts",
  "routes/generate/randomizer.ts",
  "routes/generate/scene-effects.ts",
  "routes/generate/shops.ts",
  "routes/generate/shoutouts.ts",
  "routes/generate/title-studio.ts",
];

/* Mixed files: only SOME create calls are trivial. pinnedCreateCalls of
   totalCreateCalls spreads must carry the pin; the rest keep the model
   default. hook-studio: the "hooks" and "captions" modes are pinned, the
   "preflight" virality scorecard is a judgment product and is NOT.
   ai-page-designer: POST /bio is pinned, the page designer is NOT.
   ai-interview: POST /ai-interview/questions is pinned, the /package
   clip analysis is NOT. */
export const TRIVIAL_TEXT_CALL_SITES: readonly {
  file: string;
  totalCreateCalls: number;
  pinnedCreateCalls: number;
}[] = [
  { file: "routes/generate/hook-studio.ts", totalCreateCalls: 3, pinnedCreateCalls: 2 },
  { file: "routes/ai-page-designer.ts", totalCreateCalls: 2, pinnedCreateCalls: 1 },
  { file: "routes/generate/ai-interview.ts", totalCreateCalls: 2, pinnedCreateCalls: 1 },
];

/* Plain-transcription model — for call sites that consume ONLY the
   transcript text (no word/segment timestamps). gpt-transcribe is the
   whisper-1 successor for these uses (whisper-1 is removed from the
   API on 2027-02-26). The TIMED paths (captions, lyric alignment,
   dubbing, chapters, and the other timestamp consumers) do NOT belong
   here: gpt-transcribe returns no timestamps and rejects verbose_json,
   so they run through the shared timed seam in lib/transcription.ts
   (ElevenLabs Scribe, adapted to the verbose_json shape). */
export function getPlainTranscribeModel(): string {
  return process.env["OPENAI_TRANSCRIBE_MODEL"] || "gpt-transcribe";
}
