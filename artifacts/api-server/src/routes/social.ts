import { randomBytes } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import rateLimit from "express-rate-limit";
import { eq, and, desc, sql, gt, lt, or, inArray, ilike, isNull, lte } from "drizzle-orm";
import {
  db,
  socialAccountsTable,
  storiesTable,
  storyHighlightsTable,
  postsTable,
  reactionsTable,
  savesTable,
  pollOptionsTable,
  pollVotesTable,
  creatorProfilesTable,
  followsTable,
  notificationsTable,
  profileTracksTable,
  profileVideosTable,
  conversationsTable,
  messagesTable,
  type Attachment,
} from "@workspace/db";
import { requireAuth } from "../middlewares/require-auth";
import { getOpenAI, getTextModel } from "../lib/ai-clients";
import { chargeCredits, refundCredits, deductCredits, OutOfCreditsError, LedgerWriteError } from "../lib/credits";
import { getSupabaseAdmin, addCreditsToProfile } from "../lib/supabase-admin";
import { recordCreditUsageStrict as recordCreditUsage } from "../lib/payment-record";
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
const INSTAGRAM_POST_CREDITS = Number(process.env["INSTAGRAM_POST_CREDITS"]) || 100;
const FACEBOOK_POST_CREDITS = Number(process.env["FACEBOOK_POST_CREDITS"]) || 100;

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
      message: `Posting to Instagram costs ${INSTAGRAM_POST_CREDITS.toLocaleString("en-US")} Visual Bucs — top up to publish.`,
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
          message: `Posting to Instagram costs ${INSTAGRAM_POST_CREDITS.toLocaleString("en-US")} Visual Bucs — top up to publish.`,
        });
        return;
      }
      if (err instanceof LedgerWriteError) {
        res.status(500).json({ error: "ledger_write_failed", message: "Credit ledger write failed \u2014 no Visual Bucs were charged. Please try again." });
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
    res.status(500).json({ error: "publish_failed", message: "Couldn't publish to Instagram. Your Visual Bucs were refunded." });
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
const TIKTOK_POST_CREDITS = Number(process.env["TIKTOK_POST_CREDITS"]) || 100;

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
    res.status(500).json({ error: "publish_failed", message: "Couldn't send the video to TikTok. Your Visual Bucs were refunded." });
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
    res.status(500).json({ error: "publish_failed", message: "Couldn't publish to Facebook. Your Visual Bucs were refunded." });
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
   WORKER 8 — Creator Streaming Platform: STORIES / POSTS / REACTIONS / SAVES
   ───────────────────────────────────────────────────────────────────────────
   The best of Instagram + Twitter/X, in gold/black luxury — docked on the
   same router (routes/index.ts untouched; every path here is absolute under
   /api, exactly like the Meta auto-post routes above).

   Stories:  POST   /api/stories              (auth) 24h expiry
             GET    /api/stories/feed         (auth) followed creators, newest first
             POST   /api/stories/:id/view     (auth) bump view_count
             POST   /api/stories/:id/reply    (auth) reply → DM (conversations/messages)
             GET/POST/PUT/DELETE /api/stories/highlights (+/:id/stories)
   Posts:    POST   /api/posts                (auth) ≤500 chars, kind post|quote
             GET    /api/feed?mode=chrono|foryou (auth)
             GET    /api/posts/:id            (public) single post + thread context
             GET    /api/posts/:id/replies    (public) thread
             POST   /api/posts/:id/reply|repost|quote (auth)
             DELETE /api/posts/:id            (auth, own)
             GET    /api/posts/:id/analytics  (auth, own) engagement + earning hint
             POST   /api/posts/assist         (auth, 1 credit) AI "write it for me"
             POST   /api/posts/:id/poll/vote  (auth)
   React:    POST   /api/react  DELETE /api/react  (auth)
             emoji ∈ {like, love, fire, clap, mindblown}; like is the default.
             Reactions live in their own table — they NEVER write to Worker 1's
             `likes` table (avoids double-counting with the media like buttons).
   Saves:    POST   /api/saves  DELETE /api/saves/:kind/:targetId  (auth)
             GET    /api/saves/mine (auth)
   Discover: GET    /api/trending/topics       hashtag velocity, 24h
             GET    /api/hashtag/:tag          posts for a hashtag

   Link-graph rule (standing): @mentions → /artist/:slug, avatars → profiles,
   story viewer header → creator profile, track attachments → /track/:id,
   video attachments → /watch/:id, product attachments → /store/buy/:kind/:id
   (REJECTED at write time if they can't resolve — a product mention with no
   link is a bug), event attachments → /shows, #hashtags → /hashtag/:tag.

   Expiry: every story read filters expires_at > now(). No cron — the
   migration also purges week-old corpses; scheduled posts appear when their
   time comes via the same time-filter trick (scheduled_for <= now()).
   ═══════════════════════════════════════════════════════════════════════════ */

const w8WriteLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 120,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req) => req.userId ?? req.ip ?? "unknown",
  message: { error: "Easy, shark — slow down a little. 🦈" },
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function myProfile(userId: string) {
  const [p] = await db
    .select()
    .from(creatorProfilesTable)
    .where(eq(creatorProfilesTable.userId, userId))
    .limit(1);
  return p ?? null;
}

function pickProfile(p: typeof creatorProfilesTable.$inferSelect | undefined) {
  if (!p) return null;
  return {
    id: p.id,
    slug: p.slug,
    display_name: p.displayName,
    avatar_url: p.avatarUrl,
    is_verified: p.isVerified,
  };
}

function extractHashtags(body: string): string[] {
  const out = new Set<string>();
  const re = /(^|[\s(])#([A-Za-z0-9_]{2,40})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) out.add(m[2].toLowerCase());
  return [...out];
}

function extractMentions(body: string): string[] {
  const out = new Set<string>();
  const re = /(^|[\s(])@([a-z0-9][a-z0-9-]{1,38}[a-z0-9])/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) out.add(m[2].toLowerCase());
  return [...out];
}

async function notifyUser(userId: string, kind: string, title: string, body: string, link: string) {
  try {
    await db.insert(notificationsTable).values({ userId, kind, title, body, link });
  } catch {
    /* best-effort — never break the write path over a notification */
  }
}

/* ── Link-graph guard: attachments that promise a destination must deliver ── */
const attachmentSchema = z
  .object({
    kind: z.string(),
    url: z.string().max(2000).optional(),
    id: z.string().max(100).optional(),
    title: z.string().max(200).optional(),
    thumb: z.string().max(2000).optional(),
    artwork: z.string().max(2000).optional(),
    image: z.string().max(2000).optional(),
    artistSlug: z.string().max(60).optional(),
    kindSlug: z.string().max(60).optional(),
    storeSlug: z.string().max(60).optional(),
    date: z.string().max(60).optional(),
    venue: z.string().max(200).optional(),
  })
  .passthrough();

function assertLinkable(att: z.infer<typeof attachmentSchema>) {
  /* A post with a product mention that doesn't link to the product is a bug —
     reject it at write time. Same for sounds and events. */
  if (att.kind === "product" && !(att.id && att.kindSlug)) {
    throw new Error("Product attachments must include id + kindSlug so they link to /store/buy/:kind/:id.");
  }
  if ((att.kind === "track" || att.kind === "video") && !att.id) {
    throw new Error("Sound/video attachments must include the media id so they link to /track/:id or /watch/:id.");
  }
  if (att.kind === "event" && !att.id) {
    throw new Error("Event attachments must include the event id so they link to /shows.");
  }
}

const createPostSchema = z.object({
  body: z.string().trim().min(1).max(500),
  media_urls: z.array(attachmentSchema).max(10).optional().default([]),
  kind: z.enum(["post", "quote"]).optional().default("post"),
  reply_to: z.string().uuid().optional().nullable(),
  quote_of: z.string().uuid().optional().nullable(),
  group_id: z.string().uuid().optional().nullable(),
  scheduled_for: z.string().datetime().optional().nullable(),
  audience: z.enum(["public", "followers"]).optional().default("public"),
  poll: z.array(z.string().trim().min(1).max(80)).min(2).max(4).optional(),
});

type EnrichedPost = Record<string, unknown> & {
  author: ReturnType<typeof pickProfile>;
  viewer_emoji: string | null;
  viewer_saved: boolean;
  reaction_counts: Record<string, number>;
  quoted: EnrichedPost | null;
  poll: { options: Array<{ id: string; option_text: string; vote_count: number }>; viewer_option_id: string | null } | null;
};

async function enrichPosts(
  rows: Array<typeof postsTable.$inferSelect>,
  viewerUserId: string | null,
): Promise<EnrichedPost[]> {
  if (rows.length === 0) return [];
  const postIds = rows.map((p) => p.id);
  const profileIds = [...new Set(rows.map((p) => p.profileId))];

  const [profiles, reactions, saves, quotes, pollOpts] = await Promise.all([
    db.select().from(creatorProfilesTable).where(inArray(creatorProfilesTable.id, profileIds)),
    db.select().from(reactionsTable).where(
      and(eq(reactionsTable.targetKind, "post"), inArray(reactionsTable.targetId, postIds)),
    ),
    viewerUserId
      ? db.select().from(savesTable).where(
          and(eq(savesTable.userId, viewerUserId), eq(savesTable.kind, "post"), inArray(savesTable.targetId, postIds)),
        )
      : Promise.resolve([]),
    (async () => {
      const qids = [...new Set(rows.map((p) => p.quoteOf).filter((x): x is string => !!x))];
      if (qids.length === 0) return [];
      const qp = await db.select().from(postsTable).where(inArray(postsTable.id, qids));
      return enrichPosts(qp, viewerUserId);
    })(),
    db.select().from(pollOptionsTable).where(inArray(pollOptionsTable.postId, postIds)).orderBy(pollOptionsTable.position),
  ]);

  const pmap = new Map(profiles.map((p) => [p.id, p]));
  const qmap = new Map(quotes.map((q) => [String(q.id), q]));
  const countMap = new Map<string, Record<string, number>>();
  const viewerEmoji = new Map<string, string>();
  for (const r of reactions) {
    const c = countMap.get(r.targetId) ?? {};
    c[r.emoji] = (c[r.emoji] ?? 0) + 1;
    countMap.set(r.targetId, c);
    if (viewerUserId && r.userId === viewerUserId) viewerEmoji.set(r.targetId, r.emoji);
  }
  const savedSet = new Set(saves.map((s) => s.targetId));
  const pollMap = new Map<string, Array<typeof pollOptionsTable.$inferSelect>>();
  for (const o of pollOpts) {
    const arr = pollMap.get(o.postId) ?? [];
    arr.push(o);
    pollMap.set(o.postId, arr);
  }
  let viewerVotes = new Map<string, string>();
  if (viewerUserId) {
    const vv = await db.select().from(pollVotesTable).where(
      and(eq(pollVotesTable.userId, viewerUserId), inArray(pollVotesTable.postId, postIds)),
    );
    viewerVotes = new Map(vv.map((v) => [v.postId, v.optionId]));
  }

  return rows.map((p) => ({
    ...p,
    author: pickProfile(pmap.get(p.profileId)),
    viewer_emoji: viewerEmoji.get(p.id) ?? null,
    viewer_saved: savedSet.has(p.id),
    reaction_counts: countMap.get(p.id) ?? {},
    quoted: p.quoteOf ? (qmap.get(p.quoteOf) ?? null) : null,
    poll: pollMap.has(p.id)
      ? {
          options: (pollMap.get(p.id) ?? []).map((o) => ({ id: o.id, option_text: o.optionText, vote_count: o.voteCount })),
          viewer_option_id: viewerVotes.get(p.id) ?? null,
        }
      : null,
  })) as EnrichedPost[];
}

function publishedOnly() {
  return or(isNull(postsTable.scheduledFor), lte(postsTable.scheduledFor, new Date()));
}

/* ════════════════ STORIES ════════════════ */

const createStorySchema = z.object({
  media_url: z.string().url().max(2000),
  media_kind: z.enum(["image", "video"]).optional().default("image"),
  caption: z.string().max(280).optional().default(""),
});

router.post("/api/stories", requireAuth, w8WriteLimiter, async (req: Request, res: Response) => {
  try {
    const me = await myProfile(req.userId!);
    if (!me) return res.status(403).json({ error: "no_profile", message: "Create your creator profile first — then your stories live there for 24 hours." });
    const parsed = createStorySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "invalid", details: parsed.error.issues });
    const [story] = await db.insert(storiesTable).values({
      profileId: me.id,
      mediaUrl: parsed.data.media_url,
      mediaKind: parsed.data.media_kind,
      caption: parsed.data.caption,
      expiresAt: new Date(Date.now() + 24 * 3600_000),
    }).returning();
    return res.status(201).json({ story });
  } catch (err) {
    return res.status(500).json({ error: "story_failed", message: "Couldn't post that story." });
  }
});

router.get("/api/stories/feed", requireAuth, async (req: Request, res: Response) => {
  try {
    const me = await myProfile(req.userId!);
    const followed = await db.select({ profileId: followsTable.profileId })
      .from(followsTable).where(eq(followsTable.followerUserId, req.userId!));
    const ids = new Set(followed.map((f) => f.profileId));
    if (me) ids.add(me.id);
    if (ids.size === 0) return res.json({ stories: [] });
    /* Opportunistic corpse purge — expiry itself needs no cron. */
    db.delete(storiesTable).where(lt(storiesTable.expiresAt, new Date(Date.now() - 7 * 86400_000))).catch(() => {});
    const idArr = [...ids];
    const [rows, profiles] = await Promise.all([
      db.select().from(storiesTable)
        .where(and(inArray(storiesTable.profileId, idArr), gt(storiesTable.expiresAt, new Date())))
        .orderBy(desc(storiesTable.createdAt)).limit(200),
      db.select().from(creatorProfilesTable).where(inArray(creatorProfilesTable.id, idArr)),
    ]);
    const pmap = new Map(profiles.map((p) => [p.id, p]));
    return res.json({
      stories: rows.map((s) => ({ ...s, author: pickProfile(pmap.get(s.profileId)) })),
    });
  } catch (err) {
    return res.status(500).json({ error: "stories_feed_failed" });
  }
});

router.post("/api/stories/:id/view", requireAuth, async (req: Request, res: Response) => {
  try {
    const id = String(req.params["id"]);
    if (!UUID_RE.test(id)) return res.status(400).json({ error: "invalid_id" });
    await db.update(storiesTable)
      .set({ viewCount: sql`${storiesTable.viewCount} + 1` })
      .where(eq(storiesTable.id, id));
    return res.json({ ok: true });
  } catch {
    return res.status(500).json({ error: "view_failed" });
  }
});

/* Story reply → DM: opens (or reuses) the canonical conversation with the
   story owner and drops the reply in as a message. */
const storyReplySchema = z.object({ body: z.string().trim().min(1).max(500) });

router.post("/api/stories/:id/reply", requireAuth, w8WriteLimiter, async (req: Request, res: Response) => {
  try {
    const id = String(req.params["id"]);
    if (!UUID_RE.test(id)) return res.status(400).json({ error: "invalid_id" });
    const parsed = storyReplySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "invalid", details: parsed.error.issues });
    const [story] = await db.select().from(storiesTable).where(eq(storiesTable.id, id)).limit(1);
    if (!story) return res.status(404).json({ error: "not_found" });
    const [owner] = await db.select().from(creatorProfilesTable).where(eq(creatorProfilesTable.id, story.profileId)).limit(1);
    if (!owner) return res.status(404).json({ error: "not_found" });
    if (owner.userId === req.userId) return res.status(400).json({ error: "own_story", message: "That's your own story — no need to DM yourself. 🦈" });
    const [a, b] = [req.userId!, owner.userId].sort();
    let [conv] = await db.select().from(conversationsTable)
      .where(and(eq(conversationsTable.participantA, a), eq(conversationsTable.participantB, b))).limit(1);
    if (!conv) {
      [conv] = await db.insert(conversationsTable)
        .values({ participantA: a, participantB: b, requestedBy: req.userId! })
        .returning();
    }
    const [msg] = await db.insert(messagesTable).values({
      conversationId: conv.id,
      senderUserId: req.userId!,
      body: `↩️ Story reply: ${parsed.data.body}`,
    }).returning();
    await db.update(conversationsTable).set({ lastMessageAt: new Date() }).where(eq(conversationsTable.id, conv.id));
    await notifyUser(owner.userId, "story_reply", "New story reply 💬",
      `${parsed.data.body.slice(0, 120)}`, `/artist/${owner.slug}`);
    return res.status(201).json({ message: msg, conversation_id: conv.id });
  } catch (err) {
    return res.status(500).json({ error: "reply_failed", message: "Couldn't send that reply." });
  }
});

/* ── Highlights CRUD (owner-only) ── */

router.get("/api/stories/highlights", requireAuth, async (req: Request, res: Response) => {
  try {
    const me = await myProfile(req.userId!);
    if (!me) return res.json({ highlights: [] });
    const rows = await db.select().from(storyHighlightsTable)
      .where(eq(storyHighlightsTable.profileId, me.id))
      .orderBy(desc(storyHighlightsTable.createdAt));
    return res.json({ highlights: rows });
  } catch {
    return res.status(500).json({ error: "highlights_failed" });
  }
});

const highlightSchema = z.object({
  title: z.string().trim().min(1).max(60),
  cover_url: z.string().url().max(2000).optional().nullable(),
  story_ids: z.array(z.string().uuid()).max(100).optional().default([]),
});

router.post("/api/stories/highlights", requireAuth, w8WriteLimiter, async (req: Request, res: Response) => {
  try {
    const me = await myProfile(req.userId!);
    if (!me) return res.status(403).json({ error: "no_profile" });
    const parsed = highlightSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "invalid", details: parsed.error.issues });
    const [h] = await db.insert(storyHighlightsTable).values({
      profileId: me.id,
      title: parsed.data.title,
      coverUrl: parsed.data.cover_url ?? null,
      storyIds: parsed.data.story_ids,
    }).returning();
    return res.status(201).json({ highlight: h });
  } catch {
    return res.status(500).json({ error: "highlight_failed" });
  }
});

async function ownHighlight(req: Request) {
  const me = await myProfile(req.userId!);
  if (!me) return null;
  const [h] = await db.select().from(storyHighlightsTable)
    .where(and(eq(storyHighlightsTable.id, String(req.params["id"])), eq(storyHighlightsTable.profileId, me.id)))
    .limit(1);
  return h ?? null;
}

router.put("/api/stories/highlights/:id", requireAuth, w8WriteLimiter, async (req: Request, res: Response) => {
  try {
    const h = await ownHighlight(req);
    if (!h) return res.status(404).json({ error: "not_found" });
    const parsed = highlightSchema.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "invalid", details: parsed.error.issues });
    const [updated] = await db.update(storyHighlightsTable).set({
      ...(parsed.data.title !== undefined ? { title: parsed.data.title } : {}),
      ...(parsed.data.cover_url !== undefined ? { coverUrl: parsed.data.cover_url } : {}),
      ...(parsed.data.story_ids !== undefined ? { storyIds: parsed.data.story_ids } : {}),
    }).where(eq(storyHighlightsTable.id, h.id)).returning();
    return res.json({ highlight: updated });
  } catch {
    return res.status(500).json({ error: "highlight_failed" });
  }
});

router.delete("/api/stories/highlights/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const h = await ownHighlight(req);
    if (!h) return res.status(404).json({ error: "not_found" });
    await db.delete(storyHighlightsTable).where(eq(storyHighlightsTable.id, h.id));
    return res.json({ ok: true });
  } catch {
    return res.status(500).json({ error: "highlight_failed" });
  }
});

router.post("/api/stories/highlights/:id/stories", requireAuth, w8WriteLimiter, async (req: Request, res: Response) => {
  try {
    const h = await ownHighlight(req);
    if (!h) return res.status(404).json({ error: "not_found" });
    const parsed = z.object({ story_ids: z.array(z.string().uuid()).min(1).max(100) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "invalid", details: parsed.error.issues });
    const merged = [...new Set([...(h.storyIds ?? []), ...parsed.data.story_ids])].slice(0, 100);
    const [updated] = await db.update(storyHighlightsTable)
      .set({ storyIds: merged })
      .where(eq(storyHighlightsTable.id, h.id)).returning();
    return res.json({ highlight: updated });
  } catch {
    return res.status(500).json({ error: "highlight_failed" });
  }
});

/* ════════════════ POSTS ════════════════ */

router.post("/api/posts", requireAuth, w8WriteLimiter, async (req: Request, res: Response) => {
  try {
    const me = await myProfile(req.userId!);
    if (!me) return res.status(403).json({ error: "no_profile", message: "Create your creator profile first — posting is free, the profile is your stage." });
    const parsed = createPostSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "invalid", details: parsed.error.issues });
    const d = parsed.data;
    try {
      d.media_urls.forEach(assertLinkable);
    } catch (e) {
      return res.status(400).json({ error: "unlinked_attachment", message: (e as Error).message });
    }

    let kind: string = d.kind;
    if (d.reply_to) {
      const [parent] = await db.select({ id: postsTable.id }).from(postsTable).where(eq(postsTable.id, d.reply_to)).limit(1);
      if (!parent) return res.status(404).json({ error: "reply_target_missing" });
      kind = "thread_reply";
    }
    let quoteTarget: typeof postsTable.$inferSelect | null = null;
    if (d.quote_of) {
      const [q] = await db.select().from(postsTable).where(eq(postsTable.id, d.quote_of)).limit(1);
      if (!q) return res.status(404).json({ error: "quote_target_missing" });
      quoteTarget = q;
      kind = "quote";
    }
    const scheduledFor = d.scheduled_for ? new Date(d.scheduled_for) : null;
    if (scheduledFor && scheduledFor.getTime() <= Date.now()) {
      return res.status(400).json({ error: "bad_schedule", message: "Schedule it in the future — the cheat code can't time-travel. 🦈" });
    }

    const [post] = await db.insert(postsTable).values({
      profileId: me.id,
      body: d.body,
      mediaUrls: d.media_urls as unknown as Attachment[],
      kind,
      replyTo: d.reply_to ?? null,
      quoteOf: d.quote_of ?? null,
      groupId: d.group_id ?? null,
      scheduledFor,
      audience: d.audience,
    }).returning();

    if (d.poll && d.poll.length >= 2 && !scheduledFor) {
      await db.insert(pollOptionsTable).values(
        d.poll.map((text, i) => ({ postId: post.id, optionText: text, position: i })),
      );
    }
    if (d.reply_to) {
      await db.update(postsTable)
        .set({ replyCount: sql`${postsTable.replyCount} + 1` })
        .where(eq(postsTable.id, d.reply_to));
    }

    /* @mentions → notify the mentioned creators (their handle links to /artist/:slug). */
    const mentions = extractMentions(d.body);
    if (mentions.length > 0) {
      const mentioned = await db.select().from(creatorProfilesTable).where(inArray(creatorProfilesTable.slug, mentions));
      for (const m of mentioned) {
        if (m.userId !== req.userId) {
          await notifyUser(m.userId, "mention", `${me.displayName} mentioned you 📣`,
            d.body.slice(0, 120), `/home`);
        }
      }
    }
    if (d.reply_to) {
      const [parent] = await db.select().from(postsTable).where(eq(postsTable.id, d.reply_to)).limit(1);
      if (parent) {
        const [pa] = await db.select().from(creatorProfilesTable).where(eq(creatorProfilesTable.id, parent.profileId)).limit(1);
        if (pa && pa.userId !== req.userId) {
          await notifyUser(pa.userId, "post_reply", `${me.displayName} replied to you 💬`, d.body.slice(0, 120), `/home`);
        }
      }
    }
    if (quoteTarget) {
      const [qa] = await db.select().from(creatorProfilesTable).where(eq(creatorProfilesTable.id, quoteTarget.profileId)).limit(1);
      if (qa && qa.userId !== req.userId) {
        await notifyUser(qa.userId, "post_quote", `${me.displayName} quoted your post 🔁`, d.body.slice(0, 120), `/home`);
      }
    }

    const [enriched] = await enrichPosts([post], req.userId!);
    return res.status(201).json({ post: enriched });
  } catch (err) {
    return res.status(500).json({ error: "post_failed", message: "Couldn't publish that post." });
  }
});

/* Feed: ?mode=chrono (default — your timeline, no algorithm overlords 🦈)
   |foryou (followed + high-engagement + your own creators get a boost).
   ?before=ISO for pagination, ?limit. */
router.get("/api/feed", requireAuth, async (req: Request, res: Response) => {
  try {
    const mode = req.query["mode"] === "foryou" ? "foryou" : "chrono";
    const limit = Math.min(Math.max(Number(req.query["limit"]) || 30, 1), 100);
    const beforeRaw = String(req.query["before"] ?? "");
    const before = beforeRaw ? new Date(beforeRaw) : null;
    const me = await myProfile(req.userId!);
    const followed = await db.select({ profileId: followsTable.profileId })
      .from(followsTable).where(eq(followsTable.followerUserId, req.userId!));
    const followedIds = new Set(followed.map((f) => f.profileId));

    const conds = [publishedOnly(), sql`${postsTable.kind} != 'thread_reply'`];
    if (before && !isNaN(before.getTime())) conds.push(lt(postsTable.createdAt, before));

    if (mode === "chrono") {
      const rows = await db.select().from(postsTable)
        .where(and(...conds))
        .orderBy(desc(postsTable.createdAt)).limit(limit);
      const visible = rows.filter((p) =>
        p.audience !== "followers" || (me && (p.profileId === me.id || followedIds.has(p.profileId))),
      );
      const enriched = await enrichPosts(visible, req.userId!);
      return res.json({ mode, posts: enriched });
    }

    /* for-you: score = follow boost + own-creator boost + engagement − age decay. */
    const rows = await db.select().from(postsTable)
      .where(and(...conds))
      .orderBy(desc(postsTable.createdAt)).limit(150);
    const now = Date.now();
    const scored = rows
      .filter((p) => p.audience !== "followers" || (me && (p.profileId === me.id || followedIds.has(p.profileId))))
      .map((p) => {
        const ageH = Math.max(0, (now - new Date(p.createdAt).getTime()) / 3600_000);
        const engagement = (p.likeCount ?? 0) + (p.repostCount ?? 0) * 3 + (p.replyCount ?? 0) * 2;
        const score =
          (followedIds.has(p.profileId) ? 100 : 0) +
          (me && p.profileId === me.id ? 60 : 0) +
          engagement * 0.4 -
          ageH * 1.5 +
          (((p.mediaUrls as unknown[]) ?? []).length > 0 ? 8 : 0);
        return { p, score };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((s) => s.p);
    const enriched = await enrichPosts(scored, req.userId!);
    return res.json({ mode, posts: enriched });
  } catch (err) {
    return res.status(500).json({ error: "feed_failed" });
  }
});

router.get("/api/posts/:id", async (req: Request, res: Response) => {
  try {
    const id = String(req.params["id"]);
    if (!UUID_RE.test(id)) return res.status(400).json({ error: "invalid_id" });
    const [post] = await db.select().from(postsTable).where(eq(postsTable.id, id)).limit(1);
    if (!post) return res.status(404).json({ error: "not_found" });
    const viewer = (req as Request & { userId?: string }).userId ?? null;
    const [enriched] = await enrichPosts([post], viewer);
    return res.json({ post: enriched });
  } catch {
    return res.status(500).json({ error: "post_failed" });
  }
});

router.get("/api/posts/:id/replies", async (req: Request, res: Response) => {
  try {
    const id = String(req.params["id"]);
    if (!UUID_RE.test(id)) return res.status(400).json({ error: "invalid_id" });
    const rows = await db.select().from(postsTable)
      .where(and(eq(postsTable.replyTo, id), publishedOnly()))
      .orderBy(postsTable.createdAt).limit(100);
    const viewer = (req as Request & { userId?: string }).userId ?? null;
    return res.json({ replies: await enrichPosts(rows, viewer) });
  } catch {
    return res.status(500).json({ error: "replies_failed" });
  }
});

const replySchema = z.object({ body: z.string().trim().min(1).max(500) });

router.post("/api/posts/:id/reply", requireAuth, w8WriteLimiter, async (req: Request, res: Response) => {
  try {
    const me = await myProfile(req.userId!);
    if (!me) return res.status(403).json({ error: "no_profile" });
    const id = String(req.params["id"]);
    if (!UUID_RE.test(id)) return res.status(400).json({ error: "invalid_id" });
    const parsed = replySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "invalid", details: parsed.error.issues });
    const [parent] = await db.select().from(postsTable).where(eq(postsTable.id, id)).limit(1);
    if (!parent) return res.status(404).json({ error: "not_found" });
    const [post] = await db.insert(postsTable).values({
      profileId: me.id,
      body: parsed.data.body,
      mediaUrls: [],
      kind: "thread_reply",
      replyTo: id,
    }).returning();
    await db.update(postsTable)
      .set({ replyCount: sql`${postsTable.replyCount} + 1` })
      .where(eq(postsTable.id, id));
    const [pa] = await db.select().from(creatorProfilesTable).where(eq(creatorProfilesTable.id, parent.profileId)).limit(1);
    if (pa && pa.userId !== req.userId) {
      await notifyUser(pa.userId, "post_reply", `${me.displayName} replied to you 💬`,
        parsed.data.body.slice(0, 120), `/home`);
    }
    const [enriched] = await enrichPosts([post], req.userId!);
    return res.status(201).json({ post: enriched });
  } catch {
    return res.status(500).json({ error: "reply_failed" });
  }
});

router.post("/api/posts/:id/repost", requireAuth, w8WriteLimiter, async (req: Request, res: Response) => {
  try {
    const me = await myProfile(req.userId!);
    if (!me) return res.status(403).json({ error: "no_profile" });
    const id = String(req.params["id"]);
    if (!UUID_RE.test(id)) return res.status(400).json({ error: "invalid_id" });
    const [orig] = await db.select().from(postsTable).where(eq(postsTable.id, id)).limit(1);
    if (!orig) return res.status(404).json({ error: "not_found" });
    const [existing] = await db.select({ id: postsTable.id }).from(postsTable)
      .where(and(eq(postsTable.profileId, me.id), eq(postsTable.repostOf, id))).limit(1);
    if (existing) return res.status(409).json({ error: "already_reposted", post_id: existing.id });
    const [post] = await db.insert(postsTable).values({
      profileId: me.id,
      body: "",
      mediaUrls: [],
      kind: "repost",
      repostOf: id,
    }).returning();
    await db.update(postsTable)
      .set({ repostCount: sql`${postsTable.repostCount} + 1` })
      .where(eq(postsTable.id, id));
    const [oa] = await db.select().from(creatorProfilesTable).where(eq(creatorProfilesTable.id, orig.profileId)).limit(1);
    if (oa && oa.userId !== req.userId) {
      await notifyUser(oa.userId, "post_repost", `${me.displayName} reposted you 🔁`, "", `/home`);
    }
    return res.status(201).json({ post });
  } catch {
    return res.status(500).json({ error: "repost_failed" });
  }
});

const quoteSchema = z.object({
  body: z.string().trim().min(1).max(500),
  media_urls: z.array(attachmentSchema).max(10).optional().default([]),
});

router.post("/api/posts/:id/quote", requireAuth, w8WriteLimiter, async (req: Request, res: Response) => {
  try {
    const me = await myProfile(req.userId!);
    if (!me) return res.status(403).json({ error: "no_profile" });
    const id = String(req.params["id"]);
    if (!UUID_RE.test(id)) return res.status(400).json({ error: "invalid_id" });
    const parsed = quoteSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "invalid", details: parsed.error.issues });
    try {
      parsed.data.media_urls.forEach(assertLinkable);
    } catch (e) {
      return res.status(400).json({ error: "unlinked_attachment", message: (e as Error).message });
    }
    const [orig] = await db.select().from(postsTable).where(eq(postsTable.id, id)).limit(1);
    if (!orig) return res.status(404).json({ error: "not_found" });
    const [post] = await db.insert(postsTable).values({
      profileId: me.id,
      body: parsed.data.body,
      mediaUrls: parsed.data.media_urls as unknown as Attachment[],
      kind: "quote",
      quoteOf: id,
    }).returning();
    const [oa] = await db.select().from(creatorProfilesTable).where(eq(creatorProfilesTable.id, orig.profileId)).limit(1);
    if (oa && oa.userId !== req.userId) {
      await notifyUser(oa.userId, "post_quote", `${me.displayName} quoted your post 🔁`,
        parsed.data.body.slice(0, 120), `/home`);
    }
    const [enriched] = await enrichPosts([post], req.userId!);
    return res.status(201).json({ post: enriched });
  } catch {
    return res.status(500).json({ error: "quote_failed" });
  }
});

router.delete("/api/posts/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const me = await myProfile(req.userId!);
    if (!me) return res.status(403).json({ error: "no_profile" });
    const id = String(req.params["id"]);
    if (!UUID_RE.test(id)) return res.status(400).json({ error: "invalid_id" });
    const [post] = await db.select().from(postsTable)
      .where(and(eq(postsTable.id, id), eq(postsTable.profileId, me.id))).limit(1);
    if (!post) return res.status(404).json({ error: "not_found", message: "Only your own posts can be deleted." });
    /* The thread dies with its parent; quotes keep a null quoted ref ("unavailable"). */
    await db.delete(postsTable).where(eq(postsTable.replyTo, id));
    await db.delete(postsTable).where(eq(postsTable.id, id));
    return res.json({ ok: true });
  } catch {
    return res.status(500).json({ error: "delete_failed" });
  }
});

/* Post analytics (own posts): engagement breakdown + the money hint. */
router.get("/api/posts/:id/analytics", requireAuth, async (req: Request, res: Response) => {
  try {
    const me = await myProfile(req.userId!);
    const id = String(req.params["id"]);
    if (!UUID_RE.test(id)) return res.status(400).json({ error: "invalid_id" });
    const [post] = await db.select().from(postsTable).where(eq(postsTable.id, id)).limit(1);
    if (!post) return res.status(404).json({ error: "not_found" });
    if (!me || post.profileId !== me.id) return res.status(403).json({ error: "forbidden" });
    const reactions = await db.select({ emoji: reactionsTable.emoji })
      .from(reactionsTable)
      .where(and(eq(reactionsTable.targetKind, "post"), eq(reactionsTable.targetId, id)));
    const byEmoji: Record<string, number> = {};
    for (const r of reactions) byEmoji[r.emoji] = (byEmoji[r.emoji] ?? 0) + 1;
    const media = (post.mediaUrls as Array<{ kind?: string }>) ?? [];
    const hasProduct = media.some((m) => m.kind === "product");
    const hasSound = media.some((m) => m.kind === "track" || m.kind === "video");
    const engagement = (post.likeCount ?? 0) + (post.repostCount ?? 0) * 3 + (post.replyCount ?? 0) * 2;
    return res.json({
      analytics: {
        likes: post.likeCount ?? 0,
        reposts: post.repostCount ?? 0,
        replies: post.replyCount ?? 0,
        reactions: byEmoji,
        engagement_score: engagement,
        /* Guide them to the money: earning posts get the nudge inline. */
        earning_hint: hasProduct
          ? "This post links your drop — buyers can tap straight through. Posts with a buy link earn; posts without one just entertain. 🦈"
          : hasSound
            ? "This post pushes your sound. Attach your drop or merch next and turn the streams into sales — \"link your drop\" is one tap in the composer."
            : engagement >= 10
              ? "This one's moving — strike while it's hot: repost it with your product attached and let the engagement do the selling."
              : "Quiet so far. Posts that sell attach a product with a buy link — the composer suggests it when your words sound like money.",
      },
    });
  } catch {
    return res.status(500).json({ error: "analytics_failed" });
  }
});

/* AI "write it for me" (1 star): 1 credit, returns a draft. Never auto-posts. */
const assistSchema = z.object({
  prompt: z.string().trim().min(3).max(300),
  tone: z.enum(["hype", "chill", "professional", "funny"]).optional().default("hype"),
});

router.post("/api/posts/assist", requireAuth, w8WriteLimiter, async (req: Request, res: Response) => {
  try {
    const parsed = assistSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "invalid", details: parsed.error.issues });
    try {
      await chargeCredits(req.userId!, 1, { action: "post_assist" });
    } catch (e) {
      if (e instanceof OutOfCreditsError) {
        return res.status(402).json({ error: "out_of_credits", message: "That draft costs 1 Visual Buc — top up to keep the cheat code writing." });
      }
      throw e;
    }
    const openai = getOpenAI();
    const completion = await openai.chat.completions.create({
      model: getTextModel(),
      max_tokens: 220,
      messages: [
        {
          role: "system",
          content: "You write short social posts for creators on Bow Down Visuals (\"the content creation cheat code\"). Max 500 characters, one post, no hashtags unless asked. Voice: confident, gold-luxury, creator-to-fans. Never mention being an AI.",
        },
        { role: "user", content: `Tone: ${parsed.data.tone}. Topic: ${parsed.data.prompt}` },
      ],
    });
    const draft = completion.choices[0]?.message?.content?.trim().slice(0, 500) ?? "";
    return res.json({ draft });
  } catch (err) {
    return res.status(500).json({ error: "assist_failed", message: "The cheat code's pen ran dry — try again." });
  }
});

/* Poll voting (one vote per user per post). */
const voteSchema = z.object({ option_id: z.string().uuid() });

router.post("/api/posts/:id/poll/vote", requireAuth, w8WriteLimiter, async (req: Request, res: Response) => {
  try {
    const id = String(req.params["id"]);
    if (!UUID_RE.test(id)) return res.status(400).json({ error: "invalid_id" });
    const parsed = voteSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "invalid", details: parsed.error.issues });
    const [opt] = await db.select().from(pollOptionsTable)
      .where(and(eq(pollOptionsTable.id, parsed.data.option_id), eq(pollOptionsTable.postId, id))).limit(1);
    if (!opt) return res.status(404).json({ error: "option_not_found" });
    const [existing] = await db.select().from(pollVotesTable)
      .where(and(eq(pollVotesTable.userId, req.userId!), eq(pollVotesTable.postId, id))).limit(1);
    if (existing) return res.status(409).json({ error: "already_voted" });
    await db.insert(pollVotesTable).values({ userId: req.userId!, postId: id, optionId: opt.id });
    await db.update(pollOptionsTable)
      .set({ voteCount: sql`${pollOptionsTable.voteCount} + 1` })
      .where(eq(pollOptionsTable.id, opt.id));
    const options = await db.select().from(pollOptionsTable)
      .where(eq(pollOptionsTable.postId, id)).orderBy(pollOptionsTable.position);
    return res.json({
      poll: {
        options: options.map((o) => ({ id: o.id, option_text: o.optionText, vote_count: o.voteCount })),
        viewer_option_id: opt.id,
      },
    });
  } catch {
    return res.status(500).json({ error: "vote_failed" });
  }
});

/* ════════════════ REACTIONS ════════════════ */

const reactSchema = z.object({
  target_kind: z.enum(["post", "track", "video", "profile"]),
  target_id: z.string().uuid(),
  emoji: z.enum(["like", "love", "fire", "clap", "mindblown"]),
});

router.post("/api/react", requireAuth, w8WriteLimiter, async (req: Request, res: Response) => {
  try {
    const parsed = reactSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "invalid", details: parsed.error.issues });
    const { target_kind, target_id, emoji } = parsed.data;
    const [existing] = await db.select().from(reactionsTable).where(
      and(
        eq(reactionsTable.userId, req.userId!),
        eq(reactionsTable.targetKind, target_kind),
        eq(reactionsTable.targetId, target_id),
      ),
    ).limit(1);
    if (existing?.emoji === emoji) return res.json({ ok: true, unchanged: true });
    const wasLike = existing?.emoji === "like";
    await db.insert(reactionsTable)
      .values({ userId: req.userId!, targetKind: target_kind, targetId: target_id, emoji })
      .onConflictDoUpdate({
        target: [reactionsTable.userId, reactionsTable.targetKind, reactionsTable.targetId],
        set: { emoji, createdAt: new Date() },
      });
    if (target_kind === "post") {
      const delta = (emoji === "like" ? 1 : 0) - (wasLike ? 1 : 0);
      if (delta !== 0) {
        await db.update(postsTable)
          .set({ likeCount: sql`${postsTable.likeCount} + ${delta}` })
          .where(eq(postsTable.id, target_id));
      }
    }
    return res.json({ ok: true, emoji });
  } catch {
    return res.status(500).json({ error: "react_failed" });
  }
});

router.delete("/api/react", requireAuth, async (req: Request, res: Response) => {
  try {
    const parsed = reactSchema.omit({ emoji: true }).safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: "invalid", details: parsed.error.issues });
    const { target_kind, target_id } = parsed.data;
    const [existing] = await db.select().from(reactionsTable).where(
      and(
        eq(reactionsTable.userId, req.userId!),
        eq(reactionsTable.targetKind, target_kind),
        eq(reactionsTable.targetId, target_id),
      ),
    ).limit(1);
    if (!existing) return res.json({ ok: true });
    await db.delete(reactionsTable).where(
      and(
        eq(reactionsTable.userId, req.userId!),
        eq(reactionsTable.targetKind, target_kind),
        eq(reactionsTable.targetId, target_id),
      ),
    );
    if (target_kind === "post" && existing.emoji === "like") {
      await db.update(postsTable)
        .set({ likeCount: sql`GREATEST(${postsTable.likeCount} - 1, 0)` })
        .where(eq(postsTable.id, target_id));
    }
    return res.json({ ok: true });
  } catch {
    return res.status(500).json({ error: "react_failed" });
  }
});

/* ════════════════ SAVES (bookmarks) ════════════════ */

const saveSchema = z.object({
  kind: z.enum(["post", "track", "video", "profile"]),
  target_id: z.string().uuid(),
});

router.post("/api/saves", requireAuth, w8WriteLimiter, async (req: Request, res: Response) => {
  try {
    const parsed = saveSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "invalid", details: parsed.error.issues });
    await db.insert(savesTable)
      .values({ userId: req.userId!, kind: parsed.data.kind, targetId: parsed.data.target_id })
      .onConflictDoNothing();
    return res.status(201).json({ ok: true });
  } catch {
    return res.status(500).json({ error: "save_failed" });
  }
});

router.delete("/api/saves/:kind/:targetId", requireAuth, async (req: Request, res: Response) => {
  try {
    const kind = String(req.params["kind"]);
    const targetId = String(req.params["targetId"]);
    if (!["post", "track", "video", "profile"].includes(kind) || !UUID_RE.test(targetId)) {
      return res.status(400).json({ error: "invalid" });
    }
    await db.delete(savesTable).where(
      and(eq(savesTable.userId, req.userId!), eq(savesTable.kind, kind), eq(savesTable.targetId, targetId)),
    );
    return res.json({ ok: true });
  } catch {
    return res.status(500).json({ error: "save_failed" });
  }
});

router.get("/api/saves/mine", requireAuth, async (req: Request, res: Response) => {
  try {
    const rows = await db.select().from(savesTable)
      .where(eq(savesTable.userId, req.userId!))
      .orderBy(desc(savesTable.createdAt)).limit(100);
    const byKind = new Map<string, string[]>();
    for (const r of rows) {
      const arr = byKind.get(r.kind) ?? [];
      arr.push(r.targetId);
      byKind.set(r.kind, arr);
    }
    const postRows = byKind.has("post")
      ? await db.select().from(postsTable).where(inArray(postsTable.id, byKind.get("post")!))
      : [];
    const posts: EnrichedPost[] = await enrichPosts(postRows, req.userId!);
    const profiles: Array<typeof creatorProfilesTable.$inferSelect> = byKind.has("profile")
      ? await db.select().from(creatorProfilesTable).where(inArray(creatorProfilesTable.id, byKind.get("profile")!))
      : [];
    const tracks: Array<typeof profileTracksTable.$inferSelect> = byKind.has("track")
      ? await db.select().from(profileTracksTable).where(inArray(profileTracksTable.id, byKind.get("track")!))
      : [];
    const videos: Array<typeof profileVideosTable.$inferSelect> = byKind.has("video")
      ? await db.select().from(profileVideosTable).where(inArray(profileVideosTable.id, byKind.get("video")!))
      : [];
    const savedAt = new Map(rows.map((r) => [`${r.kind}:${r.targetId}`, r.createdAt]));
    return res.json({
      saves: rows.map((r) => {
        const key = `${r.kind}:${r.targetId}`;
        const base = { kind: r.kind, target_id: r.targetId, saved_at: savedAt.get(key) };
        if (r.kind === "post") {
          const p = posts.find((x) => String(x.id) === r.targetId);
          return { ...base, post: p ?? null };
        }
        if (r.kind === "profile") {
          const p = profiles.find((x) => x.id === r.targetId);
          return { ...base, profile: pickProfile(p) };
        }
        if (r.kind === "track") {
          const t = tracks.find((x) => x.id === r.targetId);
          return { ...base, track: t ? { id: t.id, title: t.title, artwork_url: t.artworkUrl, profile_id: t.profileId } : null };
        }
        const v = videos.find((x) => x.id === r.targetId);
        return { ...base, video: v ? { id: v.id, title: v.title, thumbnail_url: v.thumbnailUrl, profile_id: v.profileId } : null };
      }),
    });
  } catch {
    return res.status(500).json({ error: "saves_failed" });
  }
});

/* ════════════════ DISCOVERY ════════════════ */

/* Hashtag velocity over the last 24h: post bodies + video tags. */
router.get("/api/trending/topics", async (_req: Request, res: Response) => {
  try {
    const since = new Date(Date.now() - 24 * 3600_000);
    const [posts, videos] = await Promise.all([
      db.select({ body: postsTable.body }).from(postsTable)
        .where(and(gt(postsTable.createdAt, since), publishedOnly())).limit(2000),
      db.select({ tags: profileVideosTable.tags }).from(profileVideosTable)
        .where(gt(profileVideosTable.createdAt, since)).limit(2000),
    ]);
    const counts = new Map<string, { posts: number; videos: number }>();
    for (const p of posts) {
      for (const t of extractHashtags(p.body)) {
        const c = counts.get(t) ?? { posts: 0, videos: 0 };
        c.posts += 1;
        counts.set(t, c);
      }
    }
    for (const v of videos) {
      for (const raw of v.tags ?? []) {
        const t = raw.replace(/^#/, "").toLowerCase();
        if (!t) continue;
        const c = counts.get(t) ?? { posts: 0, videos: 0 };
        c.videos += 1;
        counts.set(t, c);
      }
    }
    const topics = [...counts.entries()]
      .map(([tag, c]) => ({ tag, posts: c.posts, videos: c.videos, velocity: c.posts * 2 + c.videos }))
      .sort((a, b) => b.velocity - a.velocity)
      .slice(0, 20);
    return res.json({ topics });
  } catch {
    return res.status(500).json({ error: "trending_failed" });
  }
});

/* Every trending topic links somewhere real: /hashtag/:tag. */
router.get("/api/hashtag/:tag", async (req: Request, res: Response) => {
  try {
    const tag = String(req.params["tag"]).replace(/^#/, "").toLowerCase();
    if (!/^[a-z0-9_]{2,40}$/.test(tag)) return res.status(400).json({ error: "invalid_tag" });
    const rows = await db.select().from(postsTable)
      .where(and(ilike(postsTable.body, `%#${tag}%`), publishedOnly()))
      .orderBy(desc(postsTable.createdAt)).limit(50);
    const boundary = new RegExp(`(^|[\\s(])#${tag}([\\s).,!?;:]|$)`, "i");
    const matched = rows.filter((p) => boundary.test(p.body));
    const viewer = (req as Request & { userId?: string }).userId ?? null;
    return res.json({ tag, posts: await enrichPosts(matched, viewer) });
  } catch {
    return res.status(500).json({ error: "hashtag_failed" });
  }
});

export default router;
