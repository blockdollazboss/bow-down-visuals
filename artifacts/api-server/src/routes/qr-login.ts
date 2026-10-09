import { Router, type Request } from "express";
import { z } from "zod";
import { randomBytes } from "crypto";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { publicApiLimiter } from "../lib/rate-limit";
import { logger } from "../lib/logger";
import { getSupabaseAdmin } from "../lib/supabase-admin";

const router = Router();

/* QR Login flow (hardened):
   1. Desktop: POST /api/auth/qr-token -> { token, qrUrl }
   2. Desktop shows QR with qrUrl, polls GET /api/auth/qr-token/:token
   3. Mobile (logged in): scans QR -> POST /api/auth/qr-approve { token }
      with Authorization: Bearer <Supabase JWT>. The JWT is VERIFIED
      server-side via the Supabase Auth API; the user id is derived from
      the verified token, never from the request body. Approval mints a
      single-use exchange code stored on the token row.
   4. Desktop poll returns { status: 'approved', exchangeCode }.
   5. Desktop: POST /api/auth/qr-exchange { token, exchangeCode } ->
      atomically consumes the exchange code and returns a Supabase
      magic-link action URL. Desktop extracts the token hash and calls
      supabase.auth.verifyOtp({ token_hash, type: 'email' }) to establish
      its own real Supabase session.
   Tokens expire after 5 minutes. Exchange codes are single-use.
*/

/** Verify the Supabase JWT from the Authorization header. Returns the user id or null. */
async function verifySupabaseJwt(req: Request): Promise<string | null> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) return null;
  const jwt = authHeader.slice("Bearer ".length).trim();
  if (!jwt) return null;
  try {
    const admin = getSupabaseAdmin();
    const { data, error } = await admin.auth.getUser(jwt);
    if (error || !data?.user) {
      return null;
    }
    return data.user.id;
  } catch (err) {
    logger.warn("QR login JWT verification failed");
    return null;
  }
}

/** Derive the public base URL for QR codes from the request, with an allowlist
 *  guard against Host header injection. Falls back to PUBLIC_URL. */
function getQrBaseUrl(req: Request): string {
  const forwardedHost = (req.headers["x-forwarded-host"] as string)?.split(",")[0]?.trim();
  const rawHost = forwardedHost || req.get("host") || "";
  const proto =
    (req.headers["x-forwarded-proto"] as string)?.split(",")[0]?.trim() ||
    req.protocol ||
    "https";
  const hostname = rawHost.split(":")[0].toLowerCase();

  const allowed = new Set([
    "bowdownvisuals.com",
    "www.bowdownvisuals.com",
    "bow-down-visuals-staging.onrender.com",
  ]);
  const isAllowed =
    hostname &&
    (allowed.has(hostname) || hostname === "localhost" || hostname === "127.0.0.1");

  if (isAllowed) {
    return `${proto}://${rawHost}`;
  }
  return process.env.PUBLIC_URL ?? "https://bowdownvisuals.com";
}

// Generate a new QR login token
router.post("/auth/qr-token", publicApiLimiter, async (req, res) => {
  try {
    const token = randomBytes(32).toString("hex");
    const ip: string = req.ip ?? req.headers["x-forwarded-for"]?.toString() ?? "";
    const ua: string = req.headers["user-agent"]?.toString() ?? "";

    await db.execute(sql`
      INSERT INTO qr_login_tokens (token, ip_address, user_agent)
      VALUES (${token}, ${ip}, ${ua})
    `);

    const baseUrl = getQrBaseUrl(req);
    res.json({
      token,
      qrUrl: `${baseUrl}/qr-login?token=${token}`,
      expiresIn: 300,
    });
  } catch (err) {
    logger.error("QR token generation failed");
    res.status(500).json({ error: "Failed to generate QR token" });
  }
});

// Check token status (polled by desktop)
router.get("/auth/qr-token/:token", publicApiLimiter, async (req, res) => {
  try {
    const { token } = req.params;
    const result = await db.execute(sql`
      SELECT status, expires_at, exchange_code FROM qr_login_tokens WHERE token = ${token}
    `);
    const row = (result as any).rows?.[0];
    if (!row) {
      res.status(404).json({ error: "Token not found" });
      return;
    }
    if (new Date(row.expires_at) < new Date() && row.status === "pending") {
      await db.execute(sql`UPDATE qr_login_tokens SET status = 'expired' WHERE token = ${token}`);
      res.json({ status: "expired" });
      return;
    }
    if (row.status === "approved") {
      // The exchange code is the second factor for the exchange step.
      // It is only ever exposed to the holder of the token (the desktop
      // that displayed the QR) and is single-use.
      res.json({ status: "approved", exchangeCode: row.exchange_code ?? null });
      return;
    }
    res.json({ status: row.status });
  } catch (err) {
    logger.error("QR token check failed");
    res.status(500).json({ error: "Failed to check token" });
  }
});

// Approve a token (called by logged-in mobile device)
const approveSchema = z.object({
  token: z.string().min(1).max(128),
});

router.post("/auth/qr-approve", publicApiLimiter, async (req, res) => {
  try {
    const parsed = approveSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "Token is required" });
      return;
    }

    // Verify the caller's Supabase JWT — the user id comes from the
    // verified token, never from the request body.
    const userId = await verifySupabaseJwt(req);
    if (!userId) {
      res.status(401).json({ error: "Must be logged in to approve" });
      return;
    }

    // Verify the token exists and is pending
    const result = await db.execute(sql`
      SELECT id, status, expires_at FROM qr_login_tokens WHERE token = ${parsed.data.token}
    `);
    const row = (result as any).rows?.[0];
    if (!row) {
      res.status(404).json({ error: "Token not found" });
      return;
    }
    if (row.status !== "pending") {
      res.status(400).json({ error: `Token is ${row.status}` });
      return;
    }
    if (new Date(row.expires_at) < new Date()) {
      await db.execute(sql`UPDATE qr_login_tokens SET status = 'expired' WHERE token = ${parsed.data.token}`);
      res.status(400).json({ error: "Token expired" });
      return;
    }

    // Mint a single-use exchange code for the desktop exchange step.
    const exchangeCode = randomBytes(32).toString("hex");

    await db.execute(sql`
      UPDATE qr_login_tokens
      SET status = 'approved', user_id = ${userId}, approved_at = NOW(), exchange_code = ${exchangeCode}
      WHERE token = ${parsed.data.token} AND status = 'pending'
    `);

    res.json({ success: true });
  } catch (err) {
    logger.error("QR approve failed");
    res.status(500).json({ error: "Failed to approve" });
  }
});

// Exchange an approved token for a Supabase sign-in link (called by desktop).
// Atomically consumes the single-use exchange code, then mints a magic
// link via the Supabase admin API so the desktop can establish its own
// real Supabase session with verifyOtp.
const exchangeSchema = z.object({
  token: z.string().min(1).max(128),
  exchangeCode: z.string().min(1).max(128),
});

router.post("/auth/qr-exchange", publicApiLimiter, async (req, res) => {
  try {
    const parsed = exchangeSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "Token and exchange code are required" });
      return;
    }

    // Atomic single-use consumption: only succeeds if the token is still
    // approved and the exchange code matches. A replayed or guessed code
    // yields no row.
    const consumed = await db.execute(sql`
      UPDATE qr_login_tokens
      SET status = 'consumed', exchange_code = NULL
      WHERE token = ${parsed.data.token}
        AND exchange_code = ${parsed.data.exchangeCode}
        AND status = 'approved'
      RETURNING user_id, expires_at
    `);
    const row = (consumed as any).rows?.[0];
    if (!row) {
      res.status(401).json({ error: "Invalid or already-used exchange code" });
      return;
    }
    if (new Date(row.expires_at) < new Date()) {
      res.status(400).json({ error: "Token expired" });
      return;
    }

    // Look up the approving user's email, then mint a magic link so the
    // desktop can create its own independent Supabase session.
    const admin = getSupabaseAdmin();
    const { data: userData, error: userError } = await admin.auth.admin.getUserById(row.user_id);
    if (userError || !userData?.user?.email) {
      logger.error("QR exchange: could not resolve user email");
      res.status(500).json({ error: "Failed to complete sign-in" });
      return;
    }

    const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email: userData.user.email,
    });
    if (linkError || !linkData?.properties?.action_link) {
      logger.error("QR exchange: magic link generation failed");
      res.status(500).json({ error: "Failed to complete sign-in" });
      return;
    }

    res.json({ actionLink: linkData.properties.action_link });
  } catch (err) {
    logger.error("QR exchange failed");
    res.status(500).json({ error: "Failed to complete sign-in" });
  }
});

export default router;
