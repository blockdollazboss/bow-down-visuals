import { Router } from "express";
import { z } from "zod";
import { randomBytes } from "crypto";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { publicApiLimiter } from "../lib/rate-limit";
import { logger } from "../lib/logger";

const router = Router();

/* QR Login flow:
   1. Desktop: POST /api/auth/qr-token -> { token, qrUrl }
   2. Desktop shows QR with qrUrl, polls GET /api/auth/qr-token/:token
   3. Mobile (logged in): scans QR -> POST /api/auth/qr-approve { token }
   4. Desktop poll returns { status: 'approved', userId } -> desktop creates session
   Tokens expire after 5 minutes.
*/

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

    const baseUrl = process.env.PUBLIC_URL ?? "https://bowdownvisuals.com";
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
      SELECT status, user_id, expires_at FROM qr_login_tokens WHERE token = ${token}
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
    res.json({ status: row.status, userId: row.user_id ?? null });
  } catch (err) {
    logger.error("QR token check failed");
    res.status(500).json({ error: "Failed to check token" });
  }
});

// Approve a token (called by logged-in mobile device)
const approveSchema = z.object({
  token: z.string().min(1),
});

router.post("/auth/qr-approve", publicApiLimiter, async (req, res) => {
  try {
    const parsed = approveSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "Token is required" });
      return;
    }

    // Get user from auth header (Supabase JWT)
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
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

    // TODO: Verify JWT and get user_id from Supabase
    // For now, the frontend will pass user_id after verifying the session
    const { userId } = req.body;
    if (!userId) {
      res.status(400).json({ error: "User ID required" });
      return;
    }

    await db.execute(sql`
      UPDATE qr_login_tokens
      SET status = 'approved', user_id = ${userId}, approved_at = NOW()
      WHERE token = ${parsed.data.token}
    `);

    res.json({ success: true });
  } catch (err) {
    logger.error("QR approve failed");
    res.status(500).json({ error: "Failed to approve" });
  }
});

// Mark token as consumed after desktop signs in
router.post("/auth/qr-consume", publicApiLimiter, async (req, res) => {
  try {
    const { token } = req.body ?? {};
    if (!token) {
      res.status(400).json({ error: "Token required" });
      return;
    }
    await db.execute(sql`
      UPDATE qr_login_tokens SET status = 'consumed' WHERE token = ${token} AND status = 'approved'
    `);
    res.json({ success: true });
  } catch (err) {
    logger.error("QR consume failed");
    res.status(500).json({ error: "Failed to consume token" });
  }
});

export default router;
