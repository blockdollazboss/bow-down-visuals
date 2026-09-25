/**
 * Pure pricing/plan resolution for branded Intros & Outros.
 * Kept dependency-free so it can be unit-tested without the server.
 */

export type IntroOutroType = "intro" | "outro";

/** Intros/outros are always 5 seconds — the standard sting length. */
export const INTRO_OUTRO_DURATION_SEC = 5;
/** Landscape 16:9 — intros play on YouTube/stream overlays. */
export const INTRO_OUTRO_RATIO = "1280:720" as const;

/**
 * Site credits charged per second of Seedance video for intros/outros.
 * Mirrors the Seedance site rate (env-overridable in the route).
 */
export const INTRO_OUTRO_CREDITS_PER_SEC_FALLBACK = 1.5;

export function resolveIntroOutroCost(creditsPerSec?: number): number {
  const rate = Number(creditsPerSec) || INTRO_OUTRO_CREDITS_PER_SEC_FALLBACK;
  return Math.ceil(INTRO_OUTRO_DURATION_SEC * rate);
}

/**
 * Pure helper: validates + resolves the plan for an intro/outro request.
 * No HTTP, no Runway — safe for unit tests.
 */
export function resolveIntroOutroRequest(body: {
  channelName?: string;
  type?: string;
  tagline?: string;
  referenceImageUrl?: string | null;
}): { ok: true; channelName: string; type: IntroOutroType; tagline?: string; refImage?: string; creditCost: number }
  | { ok: false; status: number; error: string } {
  const channelName = body.channelName?.trim();
  if (!channelName) return { ok: false, status: 400, error: "channelName is required" };
  const type = body.type === "outro" ? "outro" : body.type === "intro" ? "intro" : null;
  if (!type) return { ok: false, status: 400, error: 'type must be "intro" or "outro"' };
  const ref = body.referenceImageUrl?.trim();
  const refImage = ref && /^https:\/\//i.test(ref) ? ref : undefined;
  return {
    ok: true,
    channelName: channelName.slice(0, 60),
    type,
    tagline: body.tagline?.trim().slice(0, 80) || undefined,
    refImage,
    creditCost: resolveIntroOutroCost(),
  };
}

/**
 * Builds the Seedance text-to-video prompt for a branded intro or outro.
 * Keeps the channel name as on-screen typography direction and bakes in
 * the gold/black luxury house style.
 */
export function buildIntroOutroPrompt(
  channelName: string,
  type: IntroOutroType,
  tagline?: string,
): string {
  const name = channelName.trim().slice(0, 60);
  const tag = tagline?.trim().slice(0, 80);
  const isIntro = type === "intro";

  const beats = isIntro
    ? "dramatic reveal: darkness parts with a sweep of golden light, the channel name materializes in bold gold typography, " +
      "camera pushes in with rising energy, particles of gold dust swirl"
    : "emotional closing: the channel name glows in gold typography at center frame, " +
      "camera pulls back slowly, golden light dims to black, gentle fade-out energy";

  const parts = [
    `Branded ${isIntro ? "video intro sting" : "video outro sting"} for the channel "${name}".`,
    `Cinematic motion graphics style: ${beats}.`,
    "Luxury black and gold color palette, premium broadcast quality, " +
      "smooth professional animation, no jitter.",
  ];
  if (tag) parts.push(`Tagline "${tag}" appears in elegant smaller type beneath the channel name.`);
  parts.push(
    "On-screen text must read exactly as given. No other text, no watermark, " +
      "no people, no real-world footage — pure branded motion graphics.",
  );
  return parts.join(" ");
}
