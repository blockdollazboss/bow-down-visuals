/**
 * The public subscribe door — the ONE narrow opening in the staging wall.
 *
 * The pre-launch signup page lives at https://join.bowdownvisuals.com
 * (a purely static page; the studio itself stays dark behind the gate).
 * Its form posts cross-origin to exactly one endpoint:
 *
 *   POST /api/email-list/subscribe
 *
 * That endpoint is the public join endpoint by design — unauthenticated
 * and rate-limited (publicApiLimiter) — so opening the wall for this
 * exact method+path grants nothing the endpoint doesn't already grant
 * to anyone who reaches it. Everything else stays gated: no other
 * method, no other path, no other origin.
 *
 * Two halves:
 *  - staging-gate.ts lets that exact POST through without the cookie
 *    (isPublicSubscribePost).
 *  - app.ts mounts publicSubscribeCors on that exact path, for that
 *    exact origin, BEFORE the global CORS middleware so this route's
 *    preflights are answered here. The global allowlist is untouched.
 */
import cors from "cors";
import type { Request } from "express";

export const PUBLIC_SUBSCRIBE_PATH = "/api/email-list/subscribe";
export const PUBLIC_JOIN_ORIGIN = "https://join.bowdownvisuals.com";

/** Exact method + exact path. GET, HEAD, every other route: still gated. */
export function isPublicSubscribePost(req: Request): boolean {
  return req.method === "POST" && req.path === PUBLIC_SUBSCRIBE_PATH;
}

/**
 * CORS for the subscribe route only (mounted path-scoped in app.ts).
 * The signup page sends a single JSON POST — Content-Type is the only
 * header it needs. No credentials: the endpoint is unauthenticated.
 *
 * The origin is a validator, NOT a static string: the cors package
 * stamps a static-string origin onto every response regardless of the
 * request's Origin, which would hand foreign sites an allow-origin
 * header naming us. The validator returns the origin ONLY for an exact
 * match — every other origin gets no allow-origin header at all.
 */
export const publicSubscribeCors = cors({
  origin: (origin, callback) => {
    callback(null, origin === PUBLIC_JOIN_ORIGIN ? PUBLIC_JOIN_ORIGIN : false);
  },
  methods: ["POST", "OPTIONS"],
  allowedHeaders: ["Content-Type"],
  maxAge: 600,
});
