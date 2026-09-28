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
 * password itself never sits in the cookie) and redirects to /.
 *
 * Render health checks hit the root path with no special headers; they will
 * get the login page (200). That keeps the service "healthy" while still
 * hiding the app.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Request, Response, NextFunction } from "express";

const COOKIE_NAME = "bdv_staging_auth";
const LOGIN_PATH = "/__staging_login";
const LOGOUT_PATH = "/__staging_logout";

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
      return decodeURIComponent(part.slice(idx + 1).trim());
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

function loginPage(error?: string): string {
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
<form method="POST" action="${LOGIN_PATH}"><input type="password" name="password" placeholder="Staging password" autofocus autocomplete="off"><button type="submit">Enter</button></form></div>
</body></html>`;
}

export function stagingGate(req: Request, res: Response, next: NextFunction): void {
  const expected = expectedToken();
  // Gate disabled when no password is configured (production).
  if (!expected) {
    next();
    return;
  }

  // Login / logout endpoints are always reachable.
  if (req.path === LOGIN_PATH) {
    if (req.method === "POST") {
      const pw = (req.body as Record<string, unknown> | undefined)?.["password"];
      if (typeof pw === "string" && tokensEqual(createHmac("sha256", "bow-down-visuals-staging-gate").update(pw).digest("hex"), expected)) {
        res.cookie(COOKIE_NAME, expected, {
          httpOnly: true,
          sameSite: "lax",
          secure: req.secure || req.headers["x-forwarded-proto"] === "https",
          maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
          path: "/",
        });
        res.redirect("/");
        return;
      }
      res.status(401).send(loginPage("Wrong password — try again."));
      return;
    }
    res.send(loginPage());
    return;
  }
  if (req.path === LOGOUT_PATH) {
    res.clearCookie(COOKIE_NAME, { path: "/" });
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
  res.status(401).send(loginPage());
}
