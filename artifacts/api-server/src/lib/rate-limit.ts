import rateLimit from "express-rate-limit";

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
    // Prefer authenticated user ID; fall back to IP
    const userId = (req as { userId?: string }).userId;
    return userId || req.ip || "unknown";
  },
  message: { error: "Too many generations. Please wait a minute and try again." },
});
