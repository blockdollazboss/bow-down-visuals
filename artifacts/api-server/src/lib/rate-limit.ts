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
