import rateLimit, { ipKeyGenerator } from "express-rate-limit";

/**
 * Shared rate limiter for abuse-prone public endpoints.
 * 30 requests per minute per IP — generous enough for real users,
 * tight enough to stop quota-burn / spam floods.
 */
export const publicApiLimiter = rateLimit({
  windowMs: 60_000,
  limit: 30,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many requests. Please try again in a minute." },
});

/**
 * Per-user rate limiter for expensive AI generation endpoints.
 * 20 generations per minute per user — prevents a single compromised
 * account from burning through shared provider quota at full speed.
 * Uses userId from auth (falls back to IP if unauthenticated).
 */
export const generationLimiter = rateLimit({
  windowMs: 60_000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req) => {
    // Prefer authenticated user ID; fall back to IP (IPv6-safe helper)
    const userId = (req as { userId?: string }).userId;
    return userId || (req.ip ? ipKeyGenerator(req.ip) : "unknown");
  },
  message: { error: "Too many generations. Please wait a minute and try again." },
});

/**
 * Per-user hourly limiter for FREE AI endpoints that still call paid
 * provider models (prompt/style enhancers, section analysis, edit
 * plans, transcription). These endpoints charge no credits, so
 * without a cap one account can burn shared provider quota on a
 * loop. 30 requests per hour per user — generous for humans,
 * useless for scripts. Keys on userId, same as generationLimiter.
 */
export const freeAiLimiter = rateLimit({
  windowMs: 60 * 60_000,
  limit: 30,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req) => {
    // Prefer authenticated user ID; fall back to IP (IPv6-safe helper)
    const userId = (req as { userId?: string }).userId;
    return userId || (req.ip ? ipKeyGenerator(req.ip) : "unknown");
  },
  message: {
    error: "You've hit the hourly limit for this free AI tool. Please try again later.",
  },
});

/**
 * Tighter per-user hourly limiter for FREE endpoints whose provider
 * calls are expensive per request (video generation, lip-sync job
 * creation, voice cloning). 5 requests per hour per user still lets
 * a human experiment freely while capping scripted abuse at a
 * handful of paid provider calls. Keys on userId, same as above.
 */
export const freeExpensiveAiLimiter = rateLimit({
  windowMs: 60 * 60_000,
  limit: 5,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req) => {
    // Prefer authenticated user ID; fall back to IP (IPv6-safe helper)
    const userId = (req as { userId?: string }).userId;
    return userId || (req.ip ? ipKeyGenerator(req.ip) : "unknown");
  },
  message: {
    error: "You've hit the hourly limit for this free AI tool. Please try again later.",
  },
});

/**
 * Per-user limiter for filing content reports (POST /api/reports).
 * Reporting is a low-frequency human act — 30 filings per 15 minutes
 * per user is generous for a person working through a thread and
 * useless for a script trying to flood the moderation queue. Keys on
 * userId, same as generationLimiter (the route is auth-only, so the
 * IP fallback is just belt-and-braces).
 */
export const reportWriteLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 30,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req) => {
    const userId = (req as { userId?: string }).userId;
    return userId || (req.ip ? ipKeyGenerator(req.ip) : "unknown");
  },
  message: { error: "Too many reports in a short window. Please wait a bit and try again." },
});

/**
 * Per-API-KEY limiter for the Public Creator API reads (/api/v1).
 * Runs AFTER requireApiKey, so it keys on the key id — one leaked key
 * cannot burn more than its own bucket, and buckets don't collide
 * across creators. 120 requests per minute per key.
 */
export const apiKeyLimiter = rateLimit({
  windowMs: 60_000,
  limit: 120,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req) => {
    const keyId = (req as { apiKeyId?: string }).apiKeyId;
    return keyId || (req.ip ? ipKeyGenerator(req.ip) : "unknown");
  },
  message: { error: "rate_limited", message: "Too many API requests for this key. Please wait a minute." },
});

/**
 * Per-API-KEY limiter for CHARGED API generation (POST /api/v1/generate/*).
 * 10 per minute per key — far above human/agent workflows, far below a
 * runaway loop draining a balance. The owner's balance is the second,
 * harder wall (charges refuse past it).
 */
export const apiKeyGenerationLimiter = rateLimit({
  windowMs: 60_000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req) => {
    const keyId = (req as { apiKeyId?: string }).apiKeyId;
    const userId = (req as { userId?: string }).userId;
    return keyId || userId || (req.ip ? ipKeyGenerator(req.ip) : "unknown");
  },
  message: { error: "rate_limited", message: "Too many generation requests for this key. Please wait a minute." },
});

/**
 * Static World assets — the fixture bodies, guard mattes, idle
 * loops and hall textures under /world/ — are inert files shipped
 * in the app bundle and mirrored to the media CDN; the origin
 * copies are the loader's FALLBACK when the CDN leg fails. They
 * must never burn the global limiter's bucket: a World entry fires
 * its whole texture program first and the fixture bodies load
 * last, so a burst peak could shed the one asset class the palace
 * figures depend on and strand them on their stand-ins for the
 * whole session (World figures diagnosis, Oct 25-26 2026). No API
 * surface lives under /world/ (every API route is /api/*), and the
 * SPA page itself — /world, no asset extension — stays metered.
 */
const WORLD_STATIC_ASSET_EXT = /\.(?:glb|gltf|png|jpe?g|webp|mp4|webm)$/i;

export function isWorldStaticAssetPath(path: string): boolean {
  return path.startsWith("/world/") && WORLD_STATIC_ASSET_EXT.test(path);
}

/** express-rate-limit `skip` predicate for the global limiter. */
export function skipWorldStaticAssets(req: { method: string; path: string }): boolean {
  return (req.method === "GET" || req.method === "HEAD") && isWorldStaticAssetPath(req.path);
}
