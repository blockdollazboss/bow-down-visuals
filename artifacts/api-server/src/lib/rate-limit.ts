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
