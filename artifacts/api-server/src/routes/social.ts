import { randomBytes } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { db, socialAccountsTable } from "@workspace/db";
import { requireAuth } from "../middlewares/require-auth";
import { chargeCredits, refundCredits, OutOfCreditsError, LedgerWriteError } from "../lib/credits";
import { getSupabaseAdmin } from "../lib/supabase-admin";
import { encryptToken, decryptToken, isSocialTokenKeyConfigured } from "../lib/social-crypto";
import { refreshSupabaseStorageUrl } from "../lib/objectStorage";
import {
  buildAuthUrl,
  buildFacebookAuthUrl,
  exchangeCodeForLongLivedToken,
  exchangeFacebookCodeForLongLivedToken,
  fetchInstagramProfile,
  listPages,
  publishReelToInstagram,
  publishVideoToPage,
  MetaApiError,
  type FacebookOAuthConfig,
  type MetaOAuthConfig,
  type PageConnection,
} from "../lib/social-meta";
import {
  claimPublishAttempt,
  createDrizzleAttemptStore,
  type PublishAttemptResult,
} from "../lib/social-idempotency";
import {
  buildTikTokAuthUrl,
  exchangeCodeForTikTokTokens,
  refreshTikTokTokens,
  fetchTikTokUserInfo,
  uploadDraftToTikTok,
  downloadVideoBytes,
  TikTokApiError,
  type TikTokOAuthConfig,
} from "../lib/social-tiktok";
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
const FACEBOOK_POST_CREDITS = Number(process.env["FACEBOOK_POST_CREDITS"]) || 2;

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

/* Facebook Pages uses the Facebook app ID/secret (META_APP_ID /
   META_APP_SECRET) -- a different product on the same Meta app than the
   Instagram credentials metaConfig() reads. Never derive this from
   metaConfig(): the Instagram Login token can't hit graph.facebook.com. */
function facebookConfig(): FacebookOAuthConfig {
  const appId = process.env["META_APP_ID"] ?? "";
  const appSecret = process.env["META_APP_SECRET"] ?? "";
  const redirectUri =
    process.env["META_FACEBOOK_REDIRECT_URI"] ??
    "https://bowdownvisuals.com/api/social/facebook/callback";
  if (!appId || !appSecret) {
    throw new MetaApiError(
      "Facebook auto-post isn't configured yet. The site owner needs to set META_APP_ID and META_APP_SECRET.",
    );
  }
  return { appId, appSecret, redirectUri };
}

/* OAuth `state` bound to the user, kept in memory with a 10-minute TTL.
   (Matches the codebase's in-memory job stores; a deploy invalidates
   in-flight logins, which is acceptable — the user just reconnects.)
   Shared by the Instagram and TikTok callbacks; the platform is checked on
   consume so a state minted for one platform can't be replayed on the other. */
interface PendingLogin { userId: string; platform: "instagram" | "tiktok" | "facebook"; expiresAt: number }
const pendingLogins = new Map<string, PendingLogin>();
const STATE_TTL_MS = 10 * 60 * 1000;

function createLoginState(userId: string, platform: "instagram" | "tiktok" | "facebook"): string {
  const state = randomBytes(24).toString("hex");
  pendingLogins.set(state, { userId, platform, expiresAt: Date.now() + STATE_TTL_MS });
  if (pendingLogins.size > 1000) {
    const now = Date.now();
    for (const [k, v] of pendingLogins) if (v.expiresAt < now) pendingLogins.delete(k);
  }
  return state;
}

function consumeLoginState(state: string, platform: "instagram" | "tiktok" | "facebook"): string | null {
  const entry = pendingLogins.get(state);
  pendingLogins.delete(state);
  if (!entry || entry.expiresAt < Date.now() || entry.platform !== platform) return null;
  return entry.userId;
}

function maskUsername(username: string | null): string | null {
  if (!username) return null;
  if (username.length <= 4) return `${username[0] ?? ""}•••`;
  return `${username.slice(0, 3)}•••${username.slice(-1)}`;
}

/* Stores one platform='facebook' row per Page (delete-then-insert keeps
   reconnects idempotent without depending on the partial unique index).
   Page tokens minted from a long-lived user token effectively never expire,
   so token_expires_at stays NULL — a dead token surfaces as Meta code 190
   at publish time, which tells the user to reconnect. */
async function upsertFacebookPages(
  userId: string,
  pages: PageConnection[],
  log: typeof logger,
): Promise<number> {
  let stored = 0;
  for (const page of pages) {
    const encrypted = encryptToken(page.pageAccessToken); // fail closed when SOCIAL_TOKEN_KEY unset
    await db
      .delete(socialAccountsTable)
      .where(
        and(
          eq(socialAccountsTable.user_id, userId),
          eq(socialAccountsTable.platform, "facebook"),
          eq(socialAccountsTable.page_id, page.pageId),
        ),
      );
    await db.insert(socialAccountsTable).values({
      user_id: userId,
      platform: "facebook",
      ig_user_id: null,
      username: page.pageName,
      page_id: page.pageId,
      page_name: page.pageName,
      access_token_encrypted: encrypted,
      token_expires_at: null,
    });
    stored++;
  }
  log.info({ userId, stored }, "[social] Facebook Pages connected");
  return stored;
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
    const state = createLoginState(_req.userId!, "instagram");
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
  const userId = consumeLoginState(state, "instagram");
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
        provider_user_id: igUserId,
        username: username || null,
        page_id: null,
        access_token_encrypted: encrypted,
        token_expires_at: expiresAt,
      })
      .onConflictDoUpdate({
        target: [socialAccountsTable.user_id, socialAccountsTable.platform, socialAccountsTable.ig_user_id],
        set: {
          provider_user_id: igUserId,
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

router.get("/social/facebook/auth-url", requireAuth, (_req: Request, res: Response) => {
  try {
    const cfg = facebookConfig();
    if (!isSocialTokenKeyConfigured()) {
      res.status(503).json({
        error: "not_configured",
        message: "Facebook auto-post isn't configured yet (missing token encryption key).",
      });
      return;
    }
    const state = createLoginState(_req.userId!, "facebook");
    res.json({ authUrl: buildFacebookAuthUrl(cfg, state) });
  } catch (err) {
    const message = err instanceof MetaApiError ? err.userMessage : "Facebook auto-post isn't configured yet.";
    res.status(503).json({ error: "not_configured", message });
  }
});

/* ── 2c. Facebook OAuth callback (public — validates `state`) ───────────
   For users without an Instagram Business account: connects every Page they
   admin as a publishable target. No Instagram permission is requested. */
router.get("/social/facebook/callback", async (req: Request, res: Response) => {
  let siteOrigin = "https://bowdownvisuals.com";
  try {
    siteOrigin = new URL(
      process.env["META_FACEBOOK_REDIRECT_URI"] ??
        "https://bowdownvisuals.com/api/social/facebook/callback",
    ).origin;
  } catch { /* keep default */ }
  const fail = (reason: string) =>
    res.redirect(`${siteOrigin}/settings?social=error&reason=${encodeURIComponent(reason)}`);

  const { code, state } = req.query as { code?: string; state?: string };
  if (typeof code !== "string" || typeof state !== "string") return fail("facebook_missing_params");
  const userId = consumeLoginState(state, "facebook");
  if (!userId) return fail("facebook_bad_state");

  try {
    const cfg = facebookConfig();
    const { accessToken } = await exchangeFacebookCodeForLongLivedToken(cfg, code);
    const stored = await upsertFacebookPages(userId, await listPages(accessToken), logger);
    if (stored === 0) {
      fail("facebook_no_pages");
      return;
    }
    res.redirect(`${siteOrigin}/settings?social=facebook_connected`);
  } catch (err) {
    const message = err instanceof MetaApiError ? err.userMessage : "Facebook connection failed. Try again.";
    logger.warn({ err: message }, "[social] Facebook OAuth callback failed");
    fail("facebook_oauth_failed");
  }
});

/* ── 3. List connected accounts (no tokens) ───────────────────────────── */
router.get("/social/accounts", requireAuth, async (req: Request, res: Response) => {
  const rows = await db
    .select({
      id: socialAccountsTable.id,
      platform: socialAccountsTable.platform,
      username: socialAccountsTable.username,
      page_name: socialAccountsTable.page_name,
      token_expires_at: socialAccountsTable.token_expires_at,
      refresh_token_encrypted: socialAccountsTable.refresh_token_encrypted,
      created_at: socialAccountsTable.created_at,
    })
    .from(socialAccountsTable)
    .where(eq(socialAccountsTable.user_id, req.userId!));
  res.json({
    accounts: rows.map((r) => {
      /* TikTok access tokens live ~24h but refresh silently server-side, so a
         TikTok row with a stored refresh token is never "expired" for UI
         purposes — the publish route refreshes it on demand. */
      const tokenExpired = r.token_expires_at ? r.token_expires_at.getTime() < Date.now() : false;
      const expired = r.platform === "tiktok" && r.refresh_token_encrypted ? false : tokenExpired;
      return {
        id: r.id,
        platform: r.platform,
        username: r.username,
        pageName: r.page_name,
        usernameMasked: maskUsername(r.username),
        expired,
        connectedAt: r.created_at,
      };
    }),
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
      creditsRemaining = await chargeCredits(req.userId!, INSTAGRAM_POST_CREDITS, { action: "Instagram Auto-Post" });
    } catch (err) {
      if (err instanceof OutOfCreditsError) {
        res.status(402).json({
          error: "out_of_credits",
          message: `Posting to Instagram costs ${INSTAGRAM_POST_CREDITS} credits — top up to publish.`,
        });
        return;
      }
      if (err instanceof LedgerWriteError) {
        res.status(500).json({ error: "ledger_write_failed", message: "Credit ledger write failed \u2014 no credits were charged. Please try again." });
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
      await refundCredits(req.userId!, INSTAGRAM_POST_CREDITS, { action: "Instagram Auto-Post \u2014 Refund" });
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
    /* Ledger entry written atomically by chargeCredits() above. */
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


/* ── TikTok (drafts tier) ────────────────────────────────────────────────────
   GET  /api/social/tiktok/auth-url   (authed)  — TikTok Login Kit URL
   GET  /api/social/tiktok/callback   (public)  — OAuth code exchange
   POST /api/social/tiktok/publish    (authed)  — upload video to TikTok inbox

   Drafts-tier honesty contract: the response says the video was SENT TO THE
   USER'S TIKTOK INBOX for them to finish publishing — never "published". */

function tiktokConfig(): TikTokOAuthConfig {
  const clientKey = (process.env.TIKTOK_CLIENT_KEY || "").trim();
  const clientSecret = (process.env.TIKTOK_CLIENT_SECRET || "").trim();
  const redirectUri = (process.env.TIKTOK_REDIRECT_URI || "").trim();
  if (!clientKey || !clientSecret || !redirectUri) {
    throw new TikTokApiError("TikTok isn't configured on this server yet (TIKTOK_CLIENT_KEY/SECRET/REDIRECT_URI).");
  }
  return { clientKey, clientSecret, redirectUri };
}

router.get("/social/tiktok/auth-url", requireAuth, (_req: Request, res: Response) => {
  try {
    const cfg = tiktokConfig();
    if (!isSocialTokenKeyConfigured()) {
      res.status(500).json({ error: "tiktok_not_configured", message: "TikTok auto-post isn't configured on this server yet." });
      return;
    }
    const state = createLoginState(_req.userId!, "tiktok");
    res.json({ authUrl: buildTikTokAuthUrl(cfg, state) });
  } catch (err) {
    logger.warn({ err }, "[social] tiktok auth-url failed");
    res.status(400).json({ error: "tiktok_not_configured", message: (err as Error).message });
  }
});

router.get("/social/tiktok/callback", async (req: Request, res: Response) => {
  let siteOrigin = "https://bowdownvisuals.com";
  try {
    siteOrigin = new URL(
      process.env["TIKTOK_REDIRECT_URI"] ?? "https://bowdownvisuals.com/api/social/tiktok/callback",
    ).origin;
  } catch { /* keep default */ }
  const fail = (reason: string) =>
    res.redirect(302, `${siteOrigin}/settings?social=tiktok_error&reason=${encodeURIComponent(reason)}`);

  try {
    const { code, state } = req.query as { code?: string; state?: string };
    if (typeof code !== "string" || typeof state !== "string") return fail("missing_params");
    const userId = consumeLoginState(state, "tiktok");
    if (!userId) return fail("bad_state");

    const cfg = tiktokConfig();
    const tokens = await exchangeCodeForTikTokTokens(cfg, code);
    const info = await fetchTikTokUserInfo(tokens.accessToken);
    const encryptedAccess = encryptToken(tokens.accessToken); // fail closed
    const encryptedRefresh = encryptToken(tokens.refreshToken);
    const expiresAt = new Date(Date.now() + tokens.expiresInSec * 1000);

    await db
      .insert(socialAccountsTable)
      .values({
        user_id: userId,
        platform: "tiktok",
        provider_user_id: info.openId,
        username: info.displayName || null,
        access_token_encrypted: encryptedAccess,
        refresh_token_encrypted: encryptedRefresh,
        token_expires_at: expiresAt,
      })
      .onConflictDoUpdate({
        target: [socialAccountsTable.user_id, socialAccountsTable.platform, socialAccountsTable.provider_user_id],
        set: {
          username: info.displayName || null,
          access_token_encrypted: encryptedAccess,
          refresh_token_encrypted: encryptedRefresh,
          token_expires_at: expiresAt,
          updated_at: new Date(),
        },
      });

    logger.info({ userId }, "[social] tiktok account connected");
    res.redirect(302, `${siteOrigin}/settings?social=tiktok_connected`);
  } catch (err) {
    logger.error({ err }, "[social] tiktok callback failed");
    return fail("tiktok_error");
  }
});

/* ── 6. Send to TikTok drafts (2 credits) ───────────────────────────────── */
const tiktokPublishSchema = z.object({
  accountId: z.string().uuid(),
  /* https URL, or a supabase:// storage ref from a completed export —
     storage refs are resolved to a fresh signed URL server-side. */
  videoUrl: z.string().min(1, "videoUrl is required.").max(2000),
  caption: z.string().max(2200, "TikTok captions cap at 2,200 characters.").default(""),
  /* Client-generated per upload intent; required so every upload is
     protected — an unkeyed request can never be deduplicated. */
  idempotencyKey: z.string().min(8, "idempotencyKey is required.").max(128),
});

/* 2 credits per TikTok draft — env-overridable without a deploy. TikTok's
   API itself is free, so this is pure margin at ~$1.00 retail per upload. */
const TIKTOK_POST_CREDITS = Number(process.env["TIKTOK_POST_CREDITS"]) || 2;

/* Hard server-side download cap (TikTok allows far more; our clips don't
   need it, and this keeps memory bounded on the 2GB box). */
const TIKTOK_MAX_BYTES = 128 * 1024 * 1024;

router.post("/social/tiktok/publish", requireAuth, async (req: Request, res: Response) => {
  const parsed = tiktokPublishSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid upload request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }
  const { accountId, idempotencyKey } = parsed.data;
  let videoUrl: string = parsed.data.videoUrl;

  /* Completed exports persist a supabase:// storage ref; resolve to a fresh
     signed URL before the credit deduction. */
  if (videoUrl.startsWith("supabase://")) {
    try {
      videoUrl = await refreshSupabaseStorageUrl(videoUrl);
    } catch (err) {
      logger.warn({ err }, "[social] tiktok publish: supabase url refresh failed, using raw url");
    }
  }
  if (!/^https:\/\//.test(videoUrl)) {
    res.status(400).json({
      error: "Invalid upload request.",
      details: [{ field: "videoUrl", message: "Couldn't resolve a public https URL for this video." }],
    });
    return;
  }

  /* Credit pre-check BEFORE claiming the attempt (chat/hook-studio pattern).
     deductCredits() re-checks against a fresh read, so this is just the
     fast 402 path. */
  const balance = req.userCredits ?? 0;
  if (balance < TIKTOK_POST_CREDITS) {
    res.status(402).json({
      error: "out_of_credits",
      message: `Sending to TikTok costs ${TIKTOK_POST_CREDITS} credits — top up to continue.`,
    });
    return;
  }

  /* Idempotency claim — before any charging or TikTok call. A double-click,
     two tabs, or a retry after a timeout can never upload twice or charge
     twice: replays return the stored result, and a still-running first
     attempt answers 409 instead of starting a duplicate. */
  const attemptStore = createDrizzleAttemptStore();
  const claim = await claimPublishAttempt(attemptStore, {
    userId: req.userId!,
    platform: "tiktok",
    idempotencyKey,
    accountId,
  });
  if (claim.outcome === "replay") {
    /* This key already delivered to the TikTok inbox: return the stored
       result without uploading or charging again. */
    res.json({ ...claim.result, deduped: true });
    return;
  }
  if (claim.outcome === "in_progress") {
    res.status(409).json({
      error: "publish_in_progress",
      message: "This video is already uploading. Give it a minute, then check your TikTok drafts.",
    });
    return;
  }
  const attemptId = claim.attemptId;

  let creditsRemaining: number;
  if (claim.creditsAlreadyDeducted) {
    /* Reclaimed a stale processing attempt whose original run already
       charged: do NOT deduct again — just read the current balance for the
       response. */
    logger.info({ userId: req.userId }, "[social] reclaimed stale tiktok attempt, skipping duplicate charge");
    creditsRemaining = await readCreditBalance(req.userId!);
  } else {
    try {
      creditsRemaining = await deductCredits(req.userId!, TIKTOK_POST_CREDITS);
    } catch (err) {
      if (err instanceof OutOfCreditsError) {
        res.status(402).json({
          error: "out_of_credits",
          message: `Sending to TikTok costs ${TIKTOK_POST_CREDITS} credits — top up to continue.`,
        });
        return;
      }
      throw err;
    }
    /* Mark the deduction immediately so a reclaimed retry after a crash
       knows not to charge again. A failure here is logged, not fatal — the
       money is already taken, so the upload must proceed. */
    try {
      await attemptStore.markCreditsDeducted(attemptId);
    } catch (markErr) {
      logger.error({ userId: req.userId, err: markErr }, "[social] FAILED to mark tiktok attempt as charged");
    }
  }

  const failAttempt = async (message: string) => {
    try {
      await attemptStore.failAttempt(attemptId, message);
    } catch (err) {
      logger.error({ userId: req.userId, err }, "[social] FAILED to record tiktok attempt failure");
    }
  };

  const refund = async () => {
    try {
      await addCreditsToProfile(req.userId!, TIKTOK_POST_CREDITS);
      logger.info({ userId: req.userId }, "[social] refunded TikTok draft credits after TikTok failure");
    } catch (refundErr) {
      logger.error({ userId: req.userId, err: refundErr }, "[social] FAILED to refund TikTok draft credits");
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
          eq(socialAccountsTable.platform, "tiktok"),
        ),
      );
    const account = rows[0];
    if (!account?.access_token_encrypted) {
      await failAttempt("account_not_found");
      await refund();
      res.status(404).json({ error: "account_not_found", message: "That TikTok account isn't connected anymore." });
      return;
    }
    let accessToken = decryptToken(account.access_token_encrypted); // fail closed

    /* TikTok user tokens live ~24h and the refresh token ROTATES — refresh
       when expired and persist both new values. */
    if (account.token_expires_at && account.token_expires_at.getTime() < Date.now() + 60_000) {
      if (!account.refresh_token_encrypted) {
        await failAttempt("token_expired");
        await refund();
        res.status(409).json({
          error: "token_expired",
          message: "Your TikTok connection expired. Reconnect it in Settings → Connected Accounts.",
        });
        return;
      }
      try {
        const refreshed = await refreshTikTokTokens(tiktokConfig(), decryptToken(account.refresh_token_encrypted));
        accessToken = refreshed.accessToken;
        await db
          .update(socialAccountsTable)
          .set({
            access_token_encrypted: encryptToken(refreshed.accessToken),
            refresh_token_encrypted: encryptToken(refreshed.refreshToken),
            token_expires_at: new Date(Date.now() + refreshed.expiresInSec * 1000),
            updated_at: new Date(),
          })
          .where(eq(socialAccountsTable.id, accountId));
      } catch (refreshErr) {
        logger.warn({ err: refreshErr }, "[social] tiktok token refresh failed");
        await failAttempt("token_expired");
        await refund();
        const msg =
          refreshErr instanceof TikTokApiError
            ? refreshErr.userMessage
            : "Your TikTok connection expired. Reconnect it in Settings → Connected Accounts.";
        res.status(409).json({ error: "token_expired", message: msg });
        return;
      }
    }

    /* Drafts-tier flow: download the export, upload to the TikTok inbox. */
    const videoBytes = await downloadVideoBytes(videoUrl, TIKTOK_MAX_BYTES);
    const { publishId } = await uploadDraftToTikTok({ accessToken, videoBytes });

    const result: PublishAttemptResult = {
      mediaId: publishId,
      permalink: null,
      creditsUsed: TIKTOK_POST_CREDITS,
      creditsRemaining,
    };
    try {
      await attemptStore.completeAttempt(attemptId, result);
    } catch (err) {
      logger.error({ userId: req.userId, err }, "[social] FAILED to record tiktok attempt success");
    }
    recordCreditUsage({
      userId: req.userId!,
      action: "TikTok Auto-Post",
      creditsUsed: TIKTOK_POST_CREDITS,
    }).catch(() => {});
    logger.info({ userId: req.userId }, "[social] tiktok draft delivered to inbox");
    res.json({
      publishId,
      status: "sent_to_tiktok_inbox",
      message: "Your video was sent to your TikTok drafts. Open TikTok to finish posting.",
      creditsUsed: TIKTOK_POST_CREDITS,
      creditsRemaining,
    });
  } catch (err) {
    const message = err instanceof TikTokApiError ? err.userMessage : "Couldn't send the video to TikTok.";
    await failAttempt(message);
    await refund();
    if (err instanceof TikTokApiError) {
      res.status(502).json({ error: "tiktok_error", message: err.userMessage });
      return;
    }
    logger.error({ err, userId: req.userId }, "[social] TikTok publish failed");
    res.status(500).json({ error: "publish_failed", message: "Couldn't send the video to TikTok. Your credits were refunded." });
  }
});

/* ── 6. Publish a video to a Facebook Page (2 credits, idempotent) ────
   POST /{page-id}/videos with file_url + description on graph-video.facebook.com.
   That POST *is* the publish (no second step like Instagram); we poll only
   until Meta finishes processing so the permalink is real. Since June 2025
   every Facebook video surfaces as a Reel — reflected in the copy.
   Idempotency mirrors the Instagram route: the client sends one idempotencyKey
   per publish intent, the server claims a publish-attempt row for
   (user_id, idempotencyKey) BEFORE charging or calling Meta, so a double-click,
   two tabs, or a retry after a timeout can never post twice or charge twice. */
const facebookPublishSchema = z.object({
  accountId: z.string().uuid(),
  videoUrl: z.string().min(1, "videoUrl is required.").max(2000),
  caption: z.string().max(5000, "Facebook descriptions cap at 5,000 characters.").default(""),
  /* Client-generated per publish intent; required so every publish is
     protected — an unkeyed request can never be deduplicated. */
  idempotencyKey: z.string().min(8, "idempotencyKey is required.").max(128),
});

router.post("/social/facebook/publish", requireAuth, async (req: Request, res: Response) => {
  const parsed = facebookPublishSchema.safeParse(req.body ?? {});
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
  if (balance < FACEBOOK_POST_CREDITS) {
    res.status(402).json({
      error: "out_of_credits",
      message: `Posting to Facebook costs ${FACEBOOK_POST_CREDITS} credits — top up to publish.`,
    });
    return;
  }

  /* Idempotency claim — before any charging or Meta call. */
  const attemptStore = createDrizzleAttemptStore();
  const claim = await claimPublishAttempt(attemptStore, {
    userId: req.userId!,
    platform: "facebook",
    idempotencyKey,
    accountId,
  });
  if (claim.outcome === "replay") {
    /* This key already published successfully: return the stored result
       without posting to Facebook or charging again. */
    const r = claim.result;
    res.json({ videoId: r.mediaId, permalink: r.permalink, creditsUsed: r.creditsUsed, creditsRemaining: r.creditsRemaining, deduped: true });
    return;
  }
  if (claim.outcome === "in_progress") {
    res.status(409).json({
      error: "publish_in_progress",
      message: "This post is already publishing. Give it a minute, then check your Facebook Page.",
    });
    return;
  }
  const attemptId = claim.attemptId;

  let creditsRemaining: number;
  if (claim.creditsAlreadyDeducted) {
    /* Reclaimed a stale processing attempt whose original run already
       charged: do NOT deduct again — just read the current balance for the
       response. */
    logger.info({ userId: req.userId }, "[social] reclaimed stale Facebook publish attempt, skipping duplicate charge");
    creditsRemaining = await readCreditBalance(req.userId!);
  } else {
    try {
      creditsRemaining = await deductCredits(req.userId!, FACEBOOK_POST_CREDITS);
    } catch (err) {
      if (err instanceof OutOfCreditsError) {
        res.status(402).json({
          error: "out_of_credits",
          message: `Posting to Facebook costs ${FACEBOOK_POST_CREDITS} credits — top up to publish.`,
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
      logger.error({ userId: req.userId, err: markErr }, "[social] FAILED to mark Facebook publish attempt as charged");
    }
  }

  const failAttempt = async (message: string) => {
    try {
      await attemptStore.failAttempt(attemptId, message);
    } catch (err) {
      logger.error({ userId: req.userId, err }, "[social] FAILED to record Facebook publish attempt failure");
    }
  };

  const refund = async () => {
    try {
      await addCreditsToProfile(req.userId!, FACEBOOK_POST_CREDITS);
      logger.info({ userId: req.userId }, "[social] refunded Facebook post credits after Meta failure");
    } catch (refundErr) {
      logger.error({ userId: req.userId, err: refundErr }, "[social] FAILED to refund Facebook post credits");
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
          eq(socialAccountsTable.platform, "facebook"),
        ),
      );
    const account = rows[0];
    if (!account?.access_token_encrypted || !account.page_id) {
      await failAttempt("account_not_found");
      await refund();
      res.status(404).json({ error: "account_not_found", message: "That Facebook Page isn't connected anymore." });
      return;
    }
    const accessToken = decryptToken(account.access_token_encrypted); // fail closed

    const { videoId, permalink } = await publishVideoToPage({
      pageId: account.page_id,
      accessToken,
      videoUrl,
      description: caption,
    });

    const result: PublishAttemptResult = {
      mediaId: videoId,
      permalink,
      creditsUsed: FACEBOOK_POST_CREDITS,
      creditsRemaining,
    };
    try {
      await attemptStore.completeAttempt(attemptId, result);
    } catch (err) {
      logger.error({ userId: req.userId, err }, "[social] FAILED to record Facebook publish attempt success");
    }
    recordCreditUsage({
      userId: req.userId!,
      action: "Facebook Auto-Post",
      creditsUsed: FACEBOOK_POST_CREDITS,
    }).catch(() => {});
    res.json({ videoId, permalink, creditsUsed: FACEBOOK_POST_CREDITS, creditsRemaining });
  } catch (err) {
    const message = err instanceof MetaApiError ? err.userMessage : "Couldn't publish to Facebook.";
    await failAttempt(message);
    await refund();
    if (err instanceof MetaApiError) {
      res.status(502).json({ error: "facebook_error", message: err.userMessage });
      return;
    }
    logger.error({ err, userId: req.userId }, "[social] Facebook publish failed");
    res.status(500).json({ error: "publish_failed", message: "Couldn't publish to Facebook. Your credits were refunded." });
  }
});

export default router;
