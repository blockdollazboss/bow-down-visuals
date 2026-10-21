import { Router, type Request } from "express";
import { z } from "zod";
import { randomBytes } from "crypto";
import {
  verifyRegistrationResponse,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";

/** Matches @simplewebauthn/types WebAuthnCredential. */
interface WebAuthnCredential {
  id: string;
  publicKey: Uint8Array;
  counter: number;
  transports?: any[];
}
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { publicApiLimiter } from "../lib/rate-limit";
import { logger } from "../lib/logger";
import { getSupabaseAdmin } from "../lib/supabase-admin";

const router = Router();

/* WebAuthn/Passkey support (production-ready).
   Registration: POST /api/auth/webauthn/register-options -> POST /api/auth/webauthn/register-verify
   Login: POST /api/auth/webauthn/login-options -> POST /api/auth/webauthn/login-verify

   Verification uses @simplewebauthn/server for full attestation and
   assertion checking (challenge, origin, RP ID, signature, counter).
   Successful login mints a Supabase magic link so the client can establish
   a real Supabase session via verifyOtp — same pattern as QR login.
*/

const RP_NAME = "Bow Down Visuals";

// RP ID derived from request host when available, fallback to env
function getRpId(req: any): string {
  const host = req.headers["x-forwarded-host"] ?? req.headers.host ?? "";
  if (host.includes("bowdownvisuals.com")) return "bowdownvisuals.com";
  if (host.includes("onrender.com")) return host.split(":")[0];
  return process.env.WEBAUTHN_RP_ID ?? "bowdownvisuals.com";
}

function getOrigin(req: any): string {
  const proto = req.headers["x-forwarded-proto"] ?? "https";
  const host = req.headers["x-forwarded-host"] ?? req.headers.host ?? "bowdownvisuals.com";
  return `${proto}://${host}`;
}

function bufferToBase64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

/** Verify the caller's Supabase JWT. Returns the user id or null. */
async function verifySupabaseJwt(req: Request): Promise<string | null> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) return null;
  const jwt = authHeader.slice("Bearer ".length).trim();
  if (!jwt) return null;
  try {
    const admin = getSupabaseAdmin();
    const { data, error } = await admin.auth.getUser(jwt);
    if (error || !data?.user) return null;
    return data.user.id;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

const registerOptionsSchema = z.object({
  email: z.string().email().max(320),
});

// Registration options — requires a logged-in user (JWT). The user id comes
// from the verified token, never from the request body.
router.post("/auth/webauthn/register-options", publicApiLimiter, async (req, res) => {
  try {
    const userId = await verifySupabaseJwt(req);
    if (!userId) {
      res.status(401).json({ error: "Must be logged in to register a passkey" });
      return;
    }
    const parsed = registerOptionsSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "Valid email required" });
      return;
    }
    const { email } = parsed.data;

    const challenge = bufferToBase64url(randomBytes(32));

    await db.execute(sql`
      INSERT INTO webauthn_challenges (challenge, user_id, type)
      VALUES (${challenge}, ${userId}, 'registration')
    `);

    // Exclude already-registered credentials so the authenticator doesn't
    // create duplicates.
    const existing = await db.execute(sql`
      SELECT credential_id FROM webauthn_credentials WHERE user_id = ${userId}
    `);
    const excludeCredentials = ((existing as any).rows ?? []).map((r: any) => ({
      type: "public-key" as const,
      id: r.credential_id,
    }));

    res.json({
      challenge,
      rp: { name: RP_NAME, id: getRpId(req) },
      user: {
        id: bufferToBase64url(Buffer.from(userId)),
        name: email,
        displayName: email,
      },
      pubKeyCredParams: [
        { type: "public-key", alg: -7 },   // ES256
        { type: "public-key", alg: -257 }, // RS256
      ],
      authenticatorSelection: {
        authenticatorAttachment: "platform",
        userVerification: "required",
        residentKey: "preferred",
      },
      timeout: 60000,
      attestation: "none",
      excludeCredentials,
    });
  } catch (err) {
    logger.error("WebAuthn register options failed");
    res.status(500).json({ error: "Failed to generate options" });
  }
});

// Verify registration — full attestation verification via SimpleWebAuthn.
const registerVerifySchema = z.object({
  credential: z.any(), // RegistrationResponseJSON
  deviceName: z.string().max(100).optional(),
});

router.post("/auth/webauthn/register-verify", publicApiLimiter, async (req, res) => {
  try {
    const userId = await verifySupabaseJwt(req);
    if (!userId) {
      res.status(401).json({ error: "Must be logged in to register a passkey" });
      return;
    }
    const parsed = registerVerifySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid data" });
      return;
    }
    const { credential, deviceName } = parsed.data;
    const regResponse = credential as any;

    // Find the challenge we issued for this registration ceremony.
    // SimpleWebAuthn expects the raw challenge; we look it up from clientData.
    const clientDataB64 = regResponse.response.clientDataJSON;
    const clientData = JSON.parse(
      Buffer.from(clientDataB64.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString()
    );
    const challengeRow = await db.execute(sql`
      SELECT id, challenge FROM webauthn_challenges
      WHERE challenge = ${clientData.challenge} AND user_id = ${userId}
        AND type = 'registration' AND expires_at > NOW()
    `);
    const challengeRows = ((challengeRow as any).rows ?? []);
    if (!challengeRows.length) {
      res.status(400).json({ error: "Invalid or expired challenge" });
      return;
    }
    const expectedChallenge = challengeRows[0].challenge;

    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response: regResponse,
        expectedChallenge,
        expectedOrigin: getOrigin(req),
        expectedRPID: getRpId(req),
      });
    } catch (err) {
      logger.warn("WebAuthn registration verification threw");
      res.status(400).json({ error: "Attestation verification failed" });
      return;
    }

    if (!verification.verified || !verification.registrationInfo) {
      res.status(400).json({ error: "Attestation verification failed" });
      return;
    }

    const { credentialID, credentialPublicKey, counter } = (() => {
      const c: WebAuthnCredential = verification.registrationInfo!.credential;
      return {
        credentialID: c.id,
        credentialPublicKey: c.publicKey,
        counter: c.counter,
      };
    })();

    // Store the real credential public key (base64url) — this is what
    // assertion verification needs. The credential ID from the response.
    await db.execute(sql`
      INSERT INTO webauthn_credentials (user_id, credential_id, public_key, counter, device_name)
      VALUES (
        ${userId},
        ${credentialID},
        ${bufferToBase64url(Buffer.from(credentialPublicKey))},
        ${counter},
        ${deviceName ?? "Passkey"}
      )
      ON CONFLICT (credential_id) DO UPDATE SET
        public_key = EXCLUDED.public_key,
        counter = EXCLUDED.counter,
        last_used_at = NOW()
    `);

    await db.execute(sql`
      DELETE FROM webauthn_challenges WHERE challenge = ${expectedChallenge}
    `);

    res.json({ success: true });
  } catch (err) {
    logger.error("WebAuthn register verify failed");
    res.status(500).json({ error: "Verification failed" });
  }
});

// ---------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------

const loginOptionsSchema = z.object({
  email: z.string().email().max(320).optional(),
});

router.post("/auth/webauthn/login-options", publicApiLimiter, async (req, res) => {
  try {
    const parsed = loginOptionsSchema.safeParse(req.body ?? {});
    const email = parsed.success ? parsed.data.email : undefined;
    const challenge = bufferToBase64url(randomBytes(32));

    await db.execute(sql`
      INSERT INTO webauthn_challenges (challenge, type)
      VALUES (${challenge}, 'authentication')
    `);

    // If email provided, scope the allow list to that user's credentials.
    // Look up the user id via Supabase Auth admin API (no direct auth.users
    // table access — Render Postgres has no auth schema).
    let allowCredentials: { type: "public-key"; id: string }[] = [];
    if (email) {
      try {
        const admin = getSupabaseAdmin();
        const { data } = await admin.auth.admin.listUsers();
        const user = data?.users?.find((u: any) => u.email?.toLowerCase() === email.toLowerCase());
        if (user) {
          const creds = await db.execute(sql`
            SELECT credential_id FROM webauthn_credentials WHERE user_id = ${user.id}
          `);
          allowCredentials = ((creds as any).rows ?? []).map((r: any) => ({
            type: "public-key" as const,
            id: r.credential_id,
          }));
        }
      } catch {
        // Non-fatal: fall back to an empty allow list (discoverable login).
      }
    }

    res.json({
      challenge,
      rpId: getRpId(req),
      timeout: 60000,
      userVerification: "required" as const,
      allowCredentials: allowCredentials.length ? allowCredentials : undefined,
    });
  } catch (err) {
    logger.error("WebAuthn login options failed");
    res.status(500).json({ error: "Failed to generate options" });
  }
});

// Verify login — full assertion/signature verification, then mint a Supabase
// magic link so the client can establish a real session via verifyOtp.
const loginVerifySchema = z.object({
  credential: z.any(), // AuthenticationResponseJSON
});

router.post("/auth/webauthn/login-verify", publicApiLimiter, async (req, res) => {
  try {
    const parsed = loginVerifySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid data" });
      return;
    }
    const authResponse = parsed.data.credential as any;

    // Look up the stored credential (public key + counter).
    const credRes = await db.execute(sql`
      SELECT user_id, public_key, counter FROM webauthn_credentials
      WHERE credential_id = ${authResponse.id}
    `);
    const cred = ((credRes as any).rows ?? [])[0];
    if (!cred) {
      res.status(400).json({ error: "Credential not found" });
      return;
    }

    // Find the challenge from clientData.
    const clientDataB64 = authResponse.response.clientDataJSON;
    const clientData = JSON.parse(
      Buffer.from(clientDataB64.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString()
    );
    const challengeRow = await db.execute(sql`
      SELECT challenge FROM webauthn_challenges
      WHERE challenge = ${clientData.challenge} AND type = 'authentication' AND expires_at > NOW()
    `);
    const challengeRows = ((challengeRow as any).rows ?? []);
    if (!challengeRows.length) {
      res.status(400).json({ error: "Invalid or expired challenge" });
      return;
    }
    const expectedChallenge = challengeRows[0].challenge;

    // Real signature verification.
    let verification;
    try {
      const credential: WebAuthnCredential = {
        id: authResponse.id,
        publicKey: new Uint8Array(
          Buffer.from(
            (cred.public_key as string).replace(/-/g, "+").replace(/_/g, "/"),
            "base64"
          )
        ),
        counter: Number(cred.counter ?? 0),
      };
      verification = await verifyAuthenticationResponse({
        response: authResponse,
        expectedChallenge,
        expectedOrigin: getOrigin(req),
        expectedRPID: getRpId(req),
        credential,
      });
    } catch (err) {
      logger.warn("WebAuthn assertion verification threw");
      res.status(400).json({ error: "Signature verification failed" });
      return;
    }

    if (!verification.verified) {
      res.status(400).json({ error: "Signature verification failed" });
      return;
    }

    // Replay protection: persist the new counter.
    await db.execute(sql`
      UPDATE webauthn_credentials
      SET last_used_at = NOW(), counter = ${verification.authenticationInfo.newCounter}
      WHERE credential_id = ${authResponse.id}
    `);
    await db.execute(sql`
      DELETE FROM webauthn_challenges WHERE challenge = ${expectedChallenge}
    `);

    // Mint a Supabase magic link so the client gets a real session.
    const admin = getSupabaseAdmin();
    const { data: userData, error: userError } = await admin.auth.admin.getUserById(cred.user_id);
    if (userError || !userData?.user?.email) {
      logger.error("WebAuthn login: could not resolve user email");
      res.status(500).json({ error: "Failed to complete sign-in" });
      return;
    }
    const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email: userData.user.email,
    });
    if (linkError || !linkData?.properties?.action_link) {
      logger.error("WebAuthn login: magic link generation failed");
      res.status(500).json({ error: "Failed to complete sign-in" });
      return;
    }

    res.json({ success: true, actionLink: linkData.properties.action_link });
  } catch (err) {
    logger.error("WebAuthn login verify failed");
    res.status(500).json({ error: "Verification failed" });
  }
});

// ---------------------------------------------------------------------------
// Credential management (logged-in user)
// ---------------------------------------------------------------------------

// List the current user's passkeys.
router.get("/auth/webauthn/credentials", publicApiLimiter, async (req, res) => {
  try {
    const userId = await verifySupabaseJwt(req);
    if (!userId) {
      res.status(401).json({ error: "Must be logged in" });
      return;
    }
    const result = await db.execute(sql`
      SELECT credential_id, device_name, created_at, last_used_at
      FROM webauthn_credentials WHERE user_id = ${userId}
      ORDER BY created_at DESC
    `);
    res.json({ credentials: ((result as any).rows ?? []) });
  } catch (err) {
    logger.error("WebAuthn list credentials failed");
    res.status(500).json({ error: "Failed to list credentials" });
  }
});

// Delete one of the current user's passkeys.
const deleteSchema = z.object({ credentialId: z.string().min(1).max(512) });

router.delete("/auth/webauthn/credentials", publicApiLimiter, async (req, res) => {
  try {
    const userId = await verifySupabaseJwt(req);
    if (!userId) {
      res.status(401).json({ error: "Must be logged in" });
      return;
    }
    const parsed = deleteSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "credentialId required" });
      return;
    }
    await db.execute(sql`
      DELETE FROM webauthn_credentials
      WHERE credential_id = ${parsed.data.credentialId} AND user_id = ${userId}
    `);
    res.json({ success: true });
  } catch (err) {
    logger.error("WebAuthn delete credential failed");
    res.status(500).json({ error: "Failed to delete credential" });
  }
});

export default router;
