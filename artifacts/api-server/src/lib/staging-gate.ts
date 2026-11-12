/**
 * Staging password gate.
 *
 * When the STAGING_PASSWORD environment variable is set (staging only —
 * production never sets it), every request must present a valid staging
 * auth cookie. Unauthenticated browsers get a password form; API clients
 * get a 401 JSON response.
 *
 * Login: POST /__staging_login with form field `password`.
 * On success sets an HttpOnly signed cookie (HMAC of the password, so the
 * password itself never sits in the cookie) and redirects back to the
 * page the visitor originally asked for — the login form carries the
 * originally requested path+query in a hidden `next` field, sanitized to
 * a same-site path (see sanitizeReturnTo). Without that carry, a shared
 * deep link (/?ref=CODE, /?invite=…) lost its query at the gate and the
 * app's capture code never saw it. Falls back to / when there is no
 * valid return target.
 *
 * Render health checks hit the root path with no special headers; they will
 * get the login page (200). That keeps the service "healthy" while still
 * hiding the app.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { isPublicSubscribePost } from "./public-subscribe-door";

const COOKIE_NAME = "bdv_staging_auth";
const LOGIN_PATH = "/__staging_login";
const LOGOUT_PATH = "/__staging_logout";
/** Hidden form field that carries the post-login return target. */
const RETURN_FIELD = "next";

function expectedToken(): string | null {
  const pw = process.env["STAGING_PASSWORD"];
  if (!pw) return null;
  return createHmac("sha256", "bow-down-visuals-staging-gate").update(pw).digest("hex");
}

function getCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    if (part.slice(0, idx).trim() === name) {
      const raw = part.slice(idx + 1).trim();
      try {
        return decodeURIComponent(raw);
      } catch {
        /* A malformed %-sequence (a corrupted or foreign cookie value
           under this name) must not throw inside the gate — an
           un-decodable value simply isn't the token, so the raw value
           falls through to the comparison and the gate answers its
           normal 401 instead of wedging the browser on a 500. */
        return raw;
      }
    }
  }
  return undefined;
}

function tokensEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

function wantsJson(req: Request): boolean {
  if (req.path.startsWith("/api/")) return true;
  const accept = req.headers.accept ?? "";
  return accept.includes("application/json");
}

/**
 * Validate a post-login return target. Only a same-site absolute path
 * survives; everything else falls back to "/":
 * - exactly one leading slash (rejects absolute URLs and the
 *   protocol-relative "//host" form),
 * - no backslashes (some browsers treat "\" as "/") and no whitespace
 *   or control characters,
 * - never the gate's own endpoints (a return to the login path would
 *   loop; to the logout path would log the visitor straight back out),
 * - a sane length cap (real landing URLs are short).
 */
function sanitizeReturnTo(value: unknown): string {
  if (typeof value !== "string") return "/";
  const v = value.trim();
  if (v.length === 0 || v.length > 2048) return "/";
  if (!v.startsWith("/") || v.startsWith("//")) return "/";
  if (/[\s\\]/.test(v)) return "/";
  const pathOnly = v.split(/[?#]/, 1)[0] ?? v;
  if (pathOnly === LOGIN_PATH || pathOnly === LOGOUT_PATH) return "/";
  return v;
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function loginPage(error?: string, returnTo?: string): string {
  const target = returnTo && returnTo !== "/" ? returnTo : null;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Staging — Password Required</title>
<style>body{background:#0a0a0a;color:#f5c518;font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
.card{background:#141414;border:1px solid #f5c51833;border-radius:12px;padding:32px;max-width:360px;width:90%;text-align:center}
h1{font-size:20px;margin:0 0 8px}p{color:#999;font-size:14px;margin:0 0 20px}
input{width:100%;box-sizing:border-box;padding:12px;border-radius:8px;border:1px solid #333;background:#1e1e1e;color:#fff;font-size:16px;margin-bottom:12px}
button{width:100%;padding:12px;border-radius:8px;border:0;background:#f5c518;color:#000;font-weight:700;font-size:16px;cursor:pointer}
.err{color:#ff6b6b;font-size:13px;margin-bottom:12px}</style></head><body>
<div class="card"><h1>🦈 Staging Area</h1><p>This is a private staging build of Bow Down Visuals. Enter the password to continue.</p>
${error ? `<div class="err">${error}</div>` : ""}
<form method="POST" action="${LOGIN_PATH}"><input type="password" name="password" placeholder="Staging password" autofocus autocomplete="off">${target ? `<input type="hidden" name="${RETURN_FIELD}" value="${escapeAttr(target)}">` : ""}<button type="submit">Enter</button></form></div>
</body></html>`;
}

export function stagingGate(req: Request, res: Response, next: NextFunction): void {
  const expected = expectedToken();
  // Gate disabled when no password is configured (production).
  if (!expected) {
    next();
    return;
  }

  // Admin export endpoint bypasses the gate (has its own requireAuth + requireAdmin).
  // This allows production to pull the owner's data for syncing.
  if (req.path === "/api/admin/export-my-artists") {
    next();
    return;
  }

  // Public subscribe door (lib/public-subscribe-door.ts): the pre-launch
  // signup page at join.bowdownvisuals.com posts new subscribers to
  // POST /api/email-list/subscribe. That endpoint is unauthenticated and
  // rate-limited by design — it is the public join endpoint. ONLY this
  // exact method+path passes; GET and every other route stay gated.
  if (isPublicSubscribePost(req)) {
    next();
    return;
  }

  // Login / logout endpoints are always reachable.
  if (req.path === LOGIN_PATH) {
    if (req.method === "POST") {
      const body = req.body as Record<string, unknown> | undefined;
      const pw = body?.["password"];
      const returnTo = sanitizeReturnTo(body?.[RETURN_FIELD]);
      if (typeof pw === "string" && tokensEqual(createHmac("sha256", "bow-down-visuals-staging-gate").update(pw).digest("hex"), expected)) {
        res.cookie(COOKIE_NAME, expected, {
          httpOnly: true,
          sameSite: "lax",
          secure: req.secure || req.headers["x-forwarded-proto"] === "https",
          maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
          path: "/",
        });
        res.redirect(returnTo);
        return;
      }
      // Keep the return target in the re-rendered form so a retry still
      // lands on the page the visitor originally asked for.
      res.status(401).send(loginPage("Wrong password — try again.", returnTo));
      return;
    }
    const queryNext = (req.query as Record<string, unknown> | undefined)?.[RETURN_FIELD];
    res.send(loginPage(undefined, sanitizeReturnTo(queryNext)));
    return;
  }
  if (req.path === LOGOUT_PATH) {
    const secure = req.secure || req.headers["x-forwarded-proto"] === "https";
    res.clearCookie(COOKIE_NAME, { path: "/", httpOnly: true, sameSite: "lax", secure });
    res.redirect(LOGIN_PATH);
    return;
  }

  const token = getCookie(req, COOKIE_NAME);
  if (token && tokensEqual(token, expected)) {
    next();
    return;
  }

  if (wantsJson(req)) {
    res.status(401).json({ error: "staging_locked", message: "This staging build is password protected." });
    return;
  }
  // Carry the originally requested path+query into the login form so a
  // successful login lands back on it (deep links keep their query).
  res.status(401).send(loginPage(undefined, sanitizeReturnTo(req.originalUrl ?? req.url)));
}
