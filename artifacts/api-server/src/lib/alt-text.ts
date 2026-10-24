/* ─── AI alt-text & accessibility descriptions (#29) ──────────────────────
   One shared brain for every publish door that carries an image:
   feed posts, shorts/video cover frames, shop product shots and
   storefront product media.

   HARD RULES (product law, not suggestions):
   - Describe the SCENE: objects, setting, visible text, colors, mood.
   - NEVER identify or name a person. Never guess who someone is, never
     use a name, never state a real-world identity. "A performer on a
     stage" is right; a person's name is always wrong.
   - Generation is a SUGGESTION: the creator can edit or clear it before
     anything ships, and every door keeps working with a hand-written
     description when generation is unavailable.
   - FREE: no credit price exists in the tree for alt-text and none is
     invented here — the route never charges.

   The vision call itself lives in routes/generate/alt-text.ts and uses
   the stack's existing OpenAI client (lib/ai-clients getOpenAI /
   getTextModel) in the same image_url shape as the CTR predictor —
   no new provider. */

/** Alt text is read aloud by screen readers: one or two sentences.
 *  400 chars is generous headroom, still short enough to stay useful. */
export const ALT_TEXT_MAX_CHARS = 400;

export const ALT_TEXT_SYSTEM_PROMPT = `You write alt text for images posted by music creators, so fans who use screen readers can experience every post.

Rules — follow them exactly:
- Describe what is IN the image: the scene, setting, objects, clothing, colors, lighting, visible text (quote it), and the mood.
- Write 1-2 plain sentences, at most 280 characters. No preamble, no "Image of", no "Alt text:" label — output ONLY the description.
- NEVER identify or name any person. Never guess who someone is, never use anyone's name, never mention a celebrity or a real-world identity — even if you think you recognize someone. Refer to people only by what is visible: "a performer", "two dancers", "a person in a gold jacket".
- Do not invent details that are not visible. If text is unreadable, say there is text without guessing the words.
- Plain, vivid language a fan would enjoy hearing. No hashtags, no emojis, no marketing copy.`;

export function buildAltTextUserPrompt(context?: string | null): string {
  const base =
    "Write the alt text for this image, following the rules exactly. Describe the scene, objects, any visible text, and the mood — never name or identify any person.";
  const ctx = typeof context === "string" ? context.trim().slice(0, 200) : "";
  return ctx ? `${base}\nCreator's context for this image (may help, but describe only what is visible): ${ctx}` : base;
}

/** Sanitize ANY alt text (AI-suggested or hand-written) before it is
 *  stored or rendered: plain single-line text, capped length. Returns
 *  "" for anything unusable — callers store undefined/null for "". */
export function sanitizeAltText(input: unknown): string {
  if (typeof input !== "string") return "";
  return input
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, ALT_TEXT_MAX_CHARS)
    .trim();
}

/** Parse a vision model's raw reply into a storable alt text. Models
 *  sometimes wrap the answer in quotes or a label despite instructions;
 *  strip the common wrappers, then sanitize. "" = nothing usable. */
export function parseAltTextResponse(raw: unknown): string {
  if (typeof raw !== "string") return "";
  let text = raw.trim();
  if (
    (text.startsWith('"') && text.endsWith('"') && text.length >= 2) ||
    (text.startsWith("'") && text.endsWith("'") && text.length >= 2)
  ) {
    text = text.slice(1, -1).trim();
  }
  text = text.replace(/^(alt text|description|image description)\s*:\s*/i, "");
  return sanitizeAltText(text);
}

/** Sanitize the `alt` member of every attachment in a list, in place
 *  shape (returns new objects). Attachments whose sanitized alt is
 *  empty lose the key entirely, so stored JSONB never carries "" alts.
 *  Used by the post doors where alt rides inside media_urls JSONB —
 *  no schema migration is needed for those doors. */
export function sanitizeAttachmentAlts<T extends Record<string, unknown>>(atts: T[]): T[] {
  return atts.map((att) => {
    if (!("alt" in att)) return att;
    const alt = sanitizeAltText(att["alt"]);
    const out: Record<string, unknown> = { ...att };
    if (alt) out["alt"] = alt;
    else delete out["alt"];
    return out as T;
  });
}

/** Sanitize a parallel alt-text array (storefront media_alt_texts:
 *  index-aligned with media_urls). Non-strings become "", entries are
 *  capped, and trailing empties are trimmed. */
export function sanitizeAltTextList(input: unknown, maxItems = 10): string[] {
  if (!Array.isArray(input)) return [];
  const out = input.slice(0, maxItems).map((v) => sanitizeAltText(v));
  while (out.length > 0 && out[out.length - 1] === "") out.pop();
  return out;
}
