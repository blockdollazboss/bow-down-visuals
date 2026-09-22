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
