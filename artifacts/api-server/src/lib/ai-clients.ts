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

/* ── Newest-model policy ──────────────────────────────────────────────
   Standing directive: every AI feature runs on the newest available model.
   Model choice lives here in ONE place so the next upgrade is a one-line
   default change (or a Render env var — no redeploy of code needed). */

export const OPENAI_TEXT_MODEL =
  process.env["OPENAI_TEXT_MODEL"] ?? "gpt-5.4-mini";
export const OPENAI_IMAGE_MODEL =
  process.env["OPENAI_IMAGE_MODEL"] ?? "gpt-image-1.5";

/* Chat completion that stays compatible across model generations.
   GPT-5-family models reject non-default temperature/top_p and expect
   max_completion_tokens instead of max_tokens, so those params are
   adapted automatically based on the model in use. */
export function chatCompletion(
  args: Omit<
    OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
    "model"
  > & { model?: string },
): Promise<OpenAI.Chat.Completions.ChatCompletion> {
  const model = args.model ?? OPENAI_TEXT_MODEL;
  const isGpt5 = /^gpt-5/i.test(model);
  const { temperature, top_p, max_tokens, ...rest } = args as Record<
    string,
    unknown
  >;
  const params: Record<string, unknown> = { ...rest, model };
  if (isGpt5) {
    // GPT-5 family: sampling params must stay at defaults; token budget
    // uses max_completion_tokens.
    if (max_tokens !== undefined) params["max_completion_tokens"] = max_tokens;
  } else {
    if (temperature !== undefined) params["temperature"] = temperature;
    if (top_p !== undefined) params["top_p"] = top_p;
    if (max_tokens !== undefined) params["max_tokens"] = max_tokens;
  }
  return getOpenAI().chat.completions.create(
    params as unknown as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
  );
}
