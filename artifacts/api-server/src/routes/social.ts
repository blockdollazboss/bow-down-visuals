import { randomBytes } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { db, socialAccountsTable } from "@workspace/db";
import { requireAuth } from "../middlewares/require-auth";
import { deductCredits, OutOfCreditsError } from "../lib/credits";
import { addCreditsToProfile, getSupabaseAdmin } from "../lib/supabase-admin";
import { recordCreditUsage } from "../lib/payment-record";
import { encryptToken, decryptToken, isSocialTokenKeyConfigured } from "../lib/social-crypto";
import { refreshSupabaseStorageUrl } from "../lib/objectStorage";
import {
  buildAuthUrl,
  exchangeCodeForLongLivedToken,
  fetchInstagramProfile,
  publishReelToInstagram,
  MetaApiError,
  type MetaOAuthConfig,
} from "../lib/social-meta";
import {
  claimPublishAttempt,
  createDrizzleAttemptStore,
  type PublishAttemptResult,
} from "../lib/social-idempotency";
import { logger } from "../lib/logger";

/* ── Instagram auto-post MVP ─────────────────────────────────────────────
   GET  /social/instagram/auth-url   (authed)  → Meta OAuth authorize URL
   GET  /social/instagram/callback  (public)  → OAuth callback, stores account
   GET  /social/accounts            (authed)  → connected accounts (no tokens)
   DELETE /social/accounts/:id      (authed)  → disconnect
   POST /social/instagram/publish   (authed)  → 2 credits → publish reel

   Tokens are AES-256-GCM encrypted at rest (SOCIAL_TOKEN_KEY, fail closed).
   Publishing costs 2 credits, deducted BEFORE the Meta call and refunded
   when Meta fails — same pre-check + deduct + record pattern as chat and
   hook-studio. */

const router = Router();

/* 2 credits per Instagram post — env-overridable without a deploy. The Meta
   API itself is free, so this is pure margin at ~$1.00 retail per post. */
const INSTAGRAM_POST_CREDITS = Number(process.env["INSTAGRAM_POST_CREDITS"]) || 2;

function metaConfig(): MetaOAuthConfig {
  /* Instagram Login credentials: the Instagram app ID/secret from the Meta
     app's Instagram product (API setup with Instagram login) — NOT the
     Facebook app ID (META_APP_ID), which belongs to the legacy flow. */
  const appId = process.env["INSTAGRAM_APP_ID"] ?? "";
  const appSecret = process.env["INSTAGRAM_APP_SECRET"] ?? "";
  const redirectUri =
    process.env["META_REDIRECT_URI"] ??
    "https://bowdownvisuals.com/api/social/instagram/callback";
  if (!appId || !appSecret) {
    throw new MetaApiError(
      "Instagram auto-post isn't configured yet. The site owner needs to set INSTAGRAM_APP_ID and INSTAGRAM_APP_SECRET.",
    );
  }
  return { appId, appSecret, redirectUri };
}

/* OAuth `state` bound to the user, kept in memory with a 10-minute TTL.
   (Matches the codebase's in-memory job stores; a deploy invalidates
   in-flight logins, which is acceptable — the user just reconnects.) */
interface PendingLogin { userId: string; expiresAt: number }
const pendingLogins = new Map<string, PendingLogin>();
const STATE_TTL_MS = 10 * 60 * 1000;

function createLoginState(userId: string): string {
  const state = randomBytes(24).toString("hex");
  pendingLogins.set(state, { userId, expiresAt: Date.now() + STATE_TTL_MS });
  if (pendingLogins.size > 1000) {
    const now = Date.now();
    for (const [k, v] of pendingLogins) if (v.expiresAt < now) pendingLogins.delete(k);
  }
  return state;
}

function consumeLoginState(state: string): string | null {
  const entry = pendingLogins.get(state);
  pendingLogins.delete(state);
  if (!entry || entry.expiresAt < Date.now()) return null;
  return entry.userId;
}

function maskUsername(username: string | null): string | null {
  if (!username) return null;
  if (username.length <= 4) return `${username[0] ?? ""}•••`;
  return `${username.slice(0, 3)}•••${username.slice(-1)}`;
}

/* ── 1. OAuth authorize URL ───────────────────────────────────────────── */
router.get("/social/instagram/auth-url", requireAuth, (_req: Request, res: Response) => {
  try {
    const cfg = metaConfig();
    if (!isSocialTokenKeyConfigured()) {
      res.status(503).json({
        error: "not_configured",
        message: "Instagram auto-post isn't configured yet (missing token encryption key).",
      });
      return;
    }
    const state = createLoginState(_req.userId!);
    res.json({ authUrl: buildAuthUrl(cfg, state) });
  } catch (err) {
    const message = err instanceof MetaApiError ? err.userMessage : "Instagram auto-post isn't configured yet.";
    res.status(503).json({ error: "not_configured", message });
  }
});

/* ── 2. OAuth callback (public — validates `state`) ───────────────────── */
router.get("/social/instagram/callback", async (req: Request, res: Response) => {
  let siteOrigin = "https://bowdownvisuals.com";
  try {
    siteOrigin = new URL(
      process.env["META_REDIRECT_URI"] ?? "https://bowdownvisuals.com/api/social/instagram/callback",
    ).origin;
  } catch { /* keep default */ }
  const fail = (reason: string) =>
    res.redirect(`${siteOrigin}/settings?social=error&reason=${encodeURIComponent(reason)}`);

  const { code, state } = req.query as { code?: string; state?: string };
  if (typeof code !== "string" || typeof state !== "string") return fail("missing_params");
  const userId = consumeLoginState(state);
  if (!userId) return fail("bad_state");

  try {
    const cfg = metaConfig();
    const { accessToken, expiresInSec, igUserId } = await exchangeCodeForLongLivedToken(cfg, code);
    const profile = await fetchInstagramProfile(accessToken).catch(() => ({ igUserId, username: "" }));
    const username = profile.username || "";
    const encrypted = encryptToken(accessToken); // fail closed when SOCIAL_TOKEN_KEY unset
    const expiresAt = new Date(Date.now() + expiresInSec * 1000);

    await db
      .insert(socialAccountsTable)
      .values({
        user_id: userId,
        platform: "instagram",
        ig_user_id: igUserId,
        username: username || null,
        page_id: null,
        access_token_encrypted: encrypted,
        token_expires_at: expiresAt,
      })
      .onConflictDoUpdate({
        target: [socialAccountsTable.user_id, socialAccountsTable.platform, socialAccountsTable.ig_user_id],
        set: {
          username: username || null,
          page_id: null,
          access_token_encrypted: encrypted,
          token_expires_at: expiresAt,
          updated_at: new Date(),
        },
      });

    logger.info({ userId, igUserId }, "[social] Instagram account connected");
    res.redirect(`${siteOrigin}/settings?social=instagram_connected`);
  } catch (err) {
    const message = err instanceof MetaApiError ? err.userMessage : "Instagram connection failed. Try again.";
    logger.warn({ err: message }, "[social] Instagram OAuth callback failed");
    fail("oauth_failed");
  }
});

/* ── 3. List connected accounts (no tokens) ───────────────────────────── */
router.get("/social/accounts", requireAuth, async (req: Request, res: Response) => {
  const rows = await db
    .select({
      id: socialAccountsTable.id,
      platform: socialAccountsTable.platform,
      username: socialAccountsTable.username,
      token_expires_at: socialAccountsTable.token_expires_at,
      created_at: socialAccountsTable.created_at,
    })
    .from(socialAccountsTable)
    .where(eq(socialAccountsTable.user_id, req.userId!));
  res.json({
    accounts: rows.map((r) => ({
      id: r.id,
      platform: r.platform,
      username: r.username,
      usernameMasked: maskUsername(r.username),
      expired: r.token_expires_at ? r.token_expires_at.getTime() < Date.now() : false,
      connectedAt: r.created_at,
    })),
  });
});

/* ── 4. Disconnect ────────────────────────────────────────────────────── */
router.delete("/social/accounts/:id", requireAuth, async (req: Request, res: Response) => {
  const id = String(req.params["id"] ?? "");
  if (!z.string().uuid().safeParse(id).success) {
    res.status(400).json({ error: "Invalid account id." });
    return;
  }
  await db
    .delete(socialAccountsTable)
    .where(and(eq(socialAccountsTable.id, id), eq(socialAccountsTable.user_id, req.userId!)));
  res.json({ ok: true });
});

/* ── 5. Publish a reel (2 credits, idempotent) ────────────────────────────
   The client sends one idempotencyKey per publish intent (generated when the
   composer opens, reused across retries). The server claims a publish-attempt
   row for (user_id, idempotencyKey) BEFORE charging or calling Meta, so a
   double-click, two tabs, or a retry after a timeout can never post twice or
   charge twice: replays return the stored result, and a still-running first
   attempt answers 409 publish_in_progress instead of starting a duplicate. */
const publishSchema = z.object({
  accountId: z.string().uuid(),
  /* https URL, or a supabase:// storage ref from a completed export —
     storage refs are resolved to a fresh signed URL server-side. */
  videoUrl: z.string().min(1, "videoUrl is required.").max(2000),
  caption: z.string().max(2200, "Instagram captions cap at 2,200 characters.").default(""),
  /* Client-generated per publish intent; required so every publish is
     protected — an unkeyed request can never be deduplicated. */
  idempotencyKey: z.string().min(8, "idempotencyKey is required.").max(128),
});

/* Fresh balance read for the idempotency-reclaim path, where the original
   attempt already deducted and we must not deduct again. */
async function readCreditBalance(userId: string): Promise<number> {
  try {
    const { data } = await getSupabaseAdmin()
      .from("profiles")
      .select("credits")
      .eq("id", userId)
      .single();
    return (data as { credits?: number } | null)?.credits ?? 0;
  } catch {
    return 0;
  }
}

router.post("/social/instagram/publish", requireAuth, async (req: Request, res: Response) => {
  const parsed = publishSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid publish request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }
  const { accountId, caption, idempotencyKey } = parsed.data;
  let videoUrl: string = parsed.data.videoUrl;

  /* Completed exports persist a supabase:// storage ref; Meta needs a real
     URL, so resolve to a fresh signed URL before the credit deduction. */
  if (videoUrl.startsWith("supabase://")) {
    videoUrl = await refreshSupabaseStorageUrl(videoUrl);
  }
  if (!/^https:\/\//.test(videoUrl)) {
    res.status(400).json({
      error: "Invalid publish request.",
      details: [{ field: "videoUrl", message: "Couldn't resolve a public https URL for this video." }],
    });
    return;
  }

  /* Credit pre-check BEFORE claiming the attempt (chat/hook-studio pattern).
     deductCredits() re-checks against a fresh read, so this is just the
     fast 402 path. */
  const balance = req.userCredits ?? 0;
  if (balance < INSTAGRAM_POST_CREDITS) {
    res.status(402).json({
      error: "out_of_credits",
      message: `Posting to Instagram costs ${INSTAGRAM_POST_CREDITS} credits — top up to publish.`,
    });
    return;
  }

  /* Idempotency claim — before any charging or Meta call. */
  const attemptStore = createDrizzleAttemptStore();
  const claim = await claimPublishAttempt(attemptStore, {
    userId: req.userId!,
    platform: "instagram",
    idempotencyKey,
    accountId,
  });
  if (claim.outcome === "replay") {
    /* This key already published successfully: return the stored result
       without posting to Instagram or charging again. */
    res.json({ ...claim.result, deduped: true });
    return;
  }
  if (claim.outcome === "in_progress") {
    res.status(409).json({
      error: "publish_in_progress",
      message: "This post is already publishing. Give it a minute, then check your Instagram.",
    });
    return;
  }
  const attemptId = claim.attemptId;

  let creditsRemaining: number;
  if (claim.creditsAlreadyDeducted) {
    /* Reclaimed a stale processing attempt whose original run already
       charged: do NOT deduct again — just read the current balance for the
       response. */
    logger.info({ userId: req.userId }, "[social] reclaimed stale publish attempt, skipping duplicate charge");
    creditsRemaining = await readCreditBalance(req.userId!);
  } else {
    try {
      creditsRemaining = await deductCredits(req.userId!, INSTAGRAM_POST_CREDITS);
    } catch (err) {
      if (err instanceof OutOfCreditsError) {
        res.status(402).json({
          error: "out_of_credits",
          message: `Posting to Instagram costs ${INSTAGRAM_POST_CREDITS} credits — top up to publish.`,
        });
        return;
      }
      throw err;
    }
    /* Mark the deduction immediately so a reclaimed retry after a crash
       knows not to charge again. A failure here is logged, not fatal — the
       money is already taken, so the publish must proceed. */
    try {
      await attemptStore.markCreditsDeducted(attemptId);
    } catch (markErr) {
      logger.error({ userId: req.userId, err: markErr }, "[social] FAILED to mark publish attempt as charged");
    }
  }

  const failAttempt = async (message: string) => {
    try {
      await attemptStore.failAttempt(attemptId, message);
    } catch (err) {
      logger.error({ userId: req.userId, err }, "[social] FAILED to record publish attempt failure");
    }
  };

  const refund = async () => {
    try {
      await addCreditsToProfile(req.userId!, INSTAGRAM_POST_CREDITS);
      logger.info({ userId: req.userId }, "[social] refunded Instagram post credits after Meta failure");
    } catch (refundErr) {
      logger.error({ userId: req.userId, err: refundErr }, "[social] FAILED to refund Instagram post credits");
    }
  };

  try {
    const rows = await db
      .select()
      .from(socialAccountsTable)
      .where(
        and(
          eq(socialAccountsTable.id, accountId),
          eq(socialAccountsTable.user_id, req.userId!),
          eq(socialAccountsTable.platform, "instagram"),
        ),
      );
    const account = rows[0];
    if (!account?.access_token_encrypted) {
      await failAttempt("account_not_found");
      await refund();
      res.status(404).json({ error: "account_not_found", message: "That Instagram account isn't connected anymore." });
      return;
    }
    if (account.token_expires_at && account.token_expires_at.getTime() < Date.now()) {
      await failAttempt("token_expired");
      await refund();
      res.status(409).json({
        error: "token_expired",
        message: "Your Instagram connection expired. Reconnect it in Settings → Connected Accounts.",
      });
      return;
    }
    const accessToken = decryptToken(account.access_token_encrypted); // fail closed

    const { mediaId, permalink } = await publishReelToInstagram({
      igUserId: account.ig_user_id!,
      accessToken,
      videoUrl,
      caption,
    });

    const result: PublishAttemptResult = {
      mediaId,
      permalink,
      creditsUsed: INSTAGRAM_POST_CREDITS,
      creditsRemaining,
    };
    try {
      await attemptStore.completeAttempt(attemptId, result);
    } catch (err) {
      logger.error({ userId: req.userId, err }, "[social] FAILED to record publish attempt success");
    }
    recordCreditUsage({
      userId: req.userId!,
      action: "Instagram Auto-Post",
      creditsUsed: INSTAGRAM_POST_CREDITS,
    }).catch(() => {});
    res.json(result);
  } catch (err) {
    const message = err instanceof MetaApiError ? err.userMessage : "Couldn't publish to Instagram.";
    await failAttempt(message);
    await refund();
    if (err instanceof MetaApiError) {
      res.status(502).json({ error: "instagram_error", message: err.userMessage });
      return;
    }
    logger.error({ err, userId: req.userId }, "[social] Instagram publish failed");
    res.status(500).json({ error: "publish_failed", message: "Couldn't publish to Instagram. Your credits were refunded." });
  }
});

export default router;
