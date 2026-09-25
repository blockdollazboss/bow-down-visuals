import { sql, eq, and } from "drizzle-orm";
import {
  db as defaultDb,
  scheduledPostsTable,
  socialAccountsTable,
  type ScheduledPost,
  type SchedulerPlatform,
  type ScheduledPlatformResult,
} from "@workspace/db";
import { logger } from "./logger";
import { decryptToken, encryptToken } from "./social-crypto";
import {
  claimPublishAttempt,
  createDrizzleAttemptStore,
  type AttemptStore,
} from "./social-idempotency";
import {
  publishReelToInstagram,
  publishVideoToPage,
  MetaApiError,
} from "./social-meta";
import {
  uploadDraftToTikTok,
  downloadVideoBytes,
  refreshTikTokTokens,
  TikTokApiError,
  type TikTokOAuthConfig,
} from "./social-tiktok";
import { refreshSupabaseStorageUrl } from "./objectStorage";
import { refundCredits } from "./credits";

/**
 * Server-owned Content Scheduler worker.
 *
 * DB-backed and restart-safe: the job-poller tick calls
 * publishDueScheduledPosts(), which atomically claims due rows
 * (status='scheduled' AND scheduled_at <= now) with a single
 * UPDATE … WHERE — never in-memory state, so a deploy or restart can
 * neither lose nor double-fire a scheduled post.
 *
 * Money: scheduling reserves 1 credit per scheduled post up front
 * (regardless of platform count). The worker publishes through the EXISTING
 * provider helpers (publishReelToInstagram / uploadDraftToTikTok /
 * publishVideoToPage) and marks each idempotency attempt as
 * credits-deducted — never charging twice. A completely failed post gets
 * its credit refunded automatically; a partial success (≥1 platform posted)
 * is not refunded.
 *
 * Exactly-once per platform comes from the shared publish-attempt ledger:
 * the idempotency key is deterministic (`sched:<postId>:<platform>`), so a
 * crash between "provider accepted" and "row updated" replays the stored
 * result instead of posting twice.
 */

export const SCHEDULER_CLAIM_LIMIT = 10;
export const SCHEDULER_MAX_ATTEMPTS = 3;
const TIKTOK_MAX_BYTES = 256 * 1024 * 1024;

function tiktokConfig(): TikTokOAuthConfig {
  const clientKey = (process.env.TIKTOK_CLIENT_KEY || "").trim();
  const clientSecret = (process.env.TIKTOK_CLIENT_SECRET || "").trim();
  const redirectUri = (process.env.TIKTOK_REDIRECT_URI || "").trim();
  if (!clientKey || !clientSecret || !redirectUri) {
    throw new TikTokApiError(
      "TikTok isn't configured on this server yet (TIKTOK_CLIENT_KEY/SECRET/REDIRECT_URI).",
    );
  }
  return { clientKey, clientSecret, redirectUri };
}

/* ── Dependency injection seams (tests stub these; production uses the
      real provider helpers). Mirrors the __testHooks pattern in job-poller. */

export interface SchedulerPublishers {
  instagram: (input: {
    igUserId: string;
    accessToken: string;
    videoUrl: string;
    caption: string;
  }) => Promise<{ mediaId: string; permalink: string | null }>;
  tiktok: (input: {
    accessToken: string;
    videoBytes: Buffer;
  }) => Promise<{ publishId: string }>;
  facebook: (input: {
    pageId: string;
    accessToken: string;
    videoUrl: string;
    description: string;
  }) => Promise<{ videoId: string; permalink: string }>;
}

export interface LoadedAccount {
  accessToken: string;
  igUserId: string | null;
  pageId: string | null;
}export interface SchedulerDeps {
  db?: typeof defaultDb;
  attemptStore?: AttemptStore;
  publishers?: Partial<SchedulerPublishers>;
  now?: () => Date;
  /** Overrides the atomic due-claim (tests inject a fake; production SQL below). */
  claimDue?: (limit: number) => Promise<ScheduledPost[]>;
  /** Overrides the terminal row update (tests inject a fake). */
  updatePost?: (id: string, patch: Partial<ScheduledPost>) => Promise<void>;
  refund?: (userId: string, amount: number, action: string) => Promise<void>;
  /** Overrides the connected-account lookup + token refresh (tests inject a fake). */
  loadAccount?: (userId: string, platform: SchedulerPlatform, accountId: string) => Promise<LoadedAccount>;
  /** Overrides the media download (tests inject a fake; avoids network). */
  downloadVideo?: (url: string) => Promise<Buffer>;
}

const defaultPublishers: SchedulerPublishers = {
  instagram: (input) => publishReelToInstagram(input),
  tiktok: async (input) => uploadDraftToTikTok(input),
  facebook: (input) => publishVideoToPage(input),
};

function resolveDeps(deps: SchedulerDeps = {}): Required<
  Pick<SchedulerDeps, "db" | "attemptStore" | "now" | "refund" | "loadAccount" | "downloadVideo">
> & {
  publishers: SchedulerPublishers;
  claimDue: (limit: number) => Promise<ScheduledPost[]>;
  updatePost: (id: string, patch: Partial<ScheduledPost>) => Promise<void>;
} {
  const db = deps.db ?? defaultDb;
  const now = deps.now ?? (() => new Date());
  return {
    db,
    attemptStore: deps.attemptStore ?? createDrizzleAttemptStore(),
    publishers: { ...defaultPublishers, ...(deps.publishers ?? {}) },
    now,
    loadAccount:
      deps.loadAccount ??
      ((userId: string, platform: SchedulerPlatform, accountId: string) =>
        loadPlatformAccount(db, userId, platform, accountId)),
    downloadVideo: deps.downloadVideo ?? ((url: string) => downloadVideoBytes(url, TIKTOK_MAX_BYTES)),
    claimDue:
      deps.claimDue ??
      (async (limit: number) => {
        const rows = await db.execute(sql`
          UPDATE scheduled_posts
          SET status = 'publishing',
              attempts = attempts + 1,
              updated_at = NOW()
          WHERE id IN (
            SELECT id FROM scheduled_posts
            WHERE status = 'scheduled' AND scheduled_at <= NOW()
            ORDER BY scheduled_at ASC
            LIMIT ${limit}
          )
          RETURNING *;
        `);
        return (rows.rows as ScheduledPost[]).map(normalizePost);
      }),
    updatePost:
      deps.updatePost ??
      (async (id: string, patch: Partial<ScheduledPost>) => {
        await db
          .update(scheduledPostsTable)
          .set({ ...patch, updated_at: new Date() })
          .where(eq(scheduledPostsTable.id, id));
      }),
    refund:
      deps.refund ??
      (async (userId: string, amount: number, action: string) => {
        await refundCredits(userId, amount, { action });
      }),
  };
}

/* pg's jsonb comes back parsed; pg-mem/raw paths may hand strings. */
function normalizePost(row: ScheduledPost): ScheduledPost {
  const asArray = (v: unknown) =>
    typeof v === "string" ? JSON.parse(v) : (v ?? []);
  const asObj = (v: unknown) =>
    typeof v === "string" ? JSON.parse(v) : (v ?? {});
  return {
    ...row,
    platforms: asArray(row.platforms) as ScheduledPost["platforms"],
    account_ids: asObj(row.account_ids) as ScheduledPost["account_ids"],
    results: asArray(row.results) as ScheduledPost["results"],
  };
}

function fullCaption(post: ScheduledPost): string {
  const tags = (post.hashtags || "").trim();
  const cap = (post.caption || "").trim();
  return [cap, tags].filter(Boolean).join("\n");
}

async function resolveMediaUrl(mediaUrl: string): Promise<string> {
  let url = mediaUrl;
  if (url.startsWith("supabase://")) {
    url = await refreshSupabaseStorageUrl(url);
  }
  if (!/^https:\/\//.test(url)) {
    throw new Error("Couldn't resolve a public https URL for the scheduled media.");
  }
  return url;
}

async function loadPlatformAccount(
  db: typeof defaultDb,
  userId: string,
  platform: SchedulerPlatform,
  accountId: string,
): Promise<LoadedAccount> {
  const rows = await db
    .select()
    .from(socialAccountsTable)
    .where(
      and(
        eq(socialAccountsTable.id, accountId),
        eq(socialAccountsTable.user_id, userId),
        eq(socialAccountsTable.platform, platform),
      ),
    );
  const account = rows[0];
  if (!account?.access_token_encrypted) {
    throw new Error(`The connected ${platform} account is no longer available.`);
  }
  let accessToken = decryptToken(account.access_token_encrypted); // fail closed

  /* TikTok user tokens live ~24h and the refresh token ROTATES — refresh
     when expired and persist both new values (same as the live route). */
  if (
    platform === "tiktok" &&
    account.token_expires_at &&
    account.token_expires_at.getTime() < Date.now() + 60_000
  ) {
    if (!account.refresh_token_encrypted) {
      throw new Error("The TikTok connection expired. Reconnect it in Settings → Connected Accounts.");
    }
    const refreshed = await refreshTikTokTokens(
      tiktokConfig(),
      decryptToken(account.refresh_token_encrypted),
    );
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
  }

  return {
    accessToken,
    igUserId: account.ig_user_id ?? null,
    pageId: account.page_id ?? null,
  };
}

/** Publish one platform for a claimed post. Returns the per-platform result. */
async function firePlatform(
  post: ScheduledPost,
  platform: SchedulerPlatform,
  mediaUrl: string,
  r: ReturnType<typeof resolveDeps>,
): Promise<ScheduledPlatformResult> {
  const accountId = post.account_ids[platform];
  if (!accountId) {
    return { platform, status: "skipped", error: "No connected account selected for this platform." };
  }
  const idempotencyKey = `sched:${post.id}:${platform}`;
  const claim = await claimPublishAttempt(r.attemptStore, {
    userId: post.user_id,
    platform,
    idempotencyKey,
    accountId,
  });

  if (claim.outcome === "replay") {
    /* A previous worker pass already posted this platform (crash between
       provider-accept and row update). Never post twice. */
    logger.info({ postId: post.id, platform }, "[scheduler] replaying already-posted platform");
    return {
      platform,
      status: "posted",
      mediaId: claim.result.mediaId,
      permalink: claim.result.permalink,
    };
  }
  if (claim.outcome === "in_progress") {
    return { platform, status: "skipped", error: "Another worker pass is already publishing this platform." };
  }
  const attemptId = claim.attemptId;

  /* Credits were reserved at schedule time — mark the attempt so a
     reclaimed retry never charges again. */
  try {
    await r.attemptStore.markCreditsDeducted(attemptId);
  } catch (err) {
    logger.error({ postId: post.id, err }, "[scheduler] FAILED to mark attempt as charged");
  }

  const failAttempt = async (message: string) => {
    try {
      await r.attemptStore.failAttempt(attemptId, message);
    } catch (err) {
      logger.error({ postId: post.id, err }, "[scheduler] FAILED to record attempt failure");
    }
  };

  try {
    const account = await r.loadAccount(post.user_id, platform, accountId);
    const caption = fullCaption(post);

    if (platform === "instagram") {
      if (!account.igUserId) throw new Error("The Instagram account is missing its IG user id.");
      const { mediaId, permalink } = await r.publishers.instagram({
        igUserId: account.igUserId,
        accessToken: account.accessToken,
        videoUrl: mediaUrl,
        caption,
      });
      await r.attemptStore.completeAttempt(attemptId, {
        mediaId,
        permalink,
        creditsUsed: 1,
        creditsRemaining: 0,
      });
      return { platform, status: "posted", mediaId, permalink };
    }

    if (platform === "tiktok") {
      const videoBytes = await r.downloadVideo(mediaUrl);
      const { publishId } = await r.publishers.tiktok({
        accessToken: account.accessToken,
        videoBytes,
      });
      await r.attemptStore.completeAttempt(attemptId, {
        mediaId: publishId,
        permalink: null,
        creditsUsed: 1,
        creditsRemaining: 0,
      });
      return { platform, status: "posted", mediaId: publishId, permalink: null };
    }

    /* facebook */
    if (!account.pageId) throw new Error("The Facebook connection is missing its Page id.");
    const { videoId, permalink } = await r.publishers.facebook({
      pageId: account.pageId,
      accessToken: account.accessToken,
      videoUrl: mediaUrl,
      description: caption,
    });
    await r.attemptStore.completeAttempt(attemptId, {
      mediaId: videoId,
      permalink,
      creditsUsed: 1,
      creditsRemaining: 0,
    });
    return { platform, status: "posted", mediaId: videoId, permalink };
  } catch (err) {
    const message =
      err instanceof MetaApiError || err instanceof TikTokApiError
        ? err.userMessage
        : err instanceof Error
          ? err.message
          : "Couldn't publish to this platform.";
    await failAttempt(message);
    logger.warn({ postId: post.id, platform, err: message }, "[scheduler] platform publish failed");
    return { platform, status: "failed", error: message };
  }
}

/** Fire one claimed post across its platforms, then settle the row. */
export async function fireScheduledPost(
  rawPost: ScheduledPost,
  deps: SchedulerDeps = {},
): Promise<ScheduledPost> {
  const r = resolveDeps(deps);
  const post = normalizePost(rawPost);
  const results: ScheduledPlatformResult[] = [];

  let mediaUrl: string;
  try {
    mediaUrl = await resolveMediaUrl(post.media_url);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Couldn't load the scheduled media.";
    await r.updatePost(post.id, { status: "failed", last_error: message, results });
    await refundReservation(r, post);
    return { ...post, status: "failed", last_error: message, results };
  }

  for (const platform of post.platforms) {
    results.push(await firePlatform(post, platform, mediaUrl, r));
  }

  const posted = results.filter((x) => x.status === "posted");
  const failed = results.filter((x) => x.status === "failed");
  const failedCount = failed.length;

  if (failedCount > 0 && post.attempts < SCHEDULER_MAX_ATTEMPTS) {
    /* Transient failure — back to `scheduled` so the next tick retries the
       failed platforms (posted ones replay safely via idempotency). */
    const retryAt = new Date(r.now().getTime() + 5 * 60 * 1000);
    await r.updatePost(post.id, {
      status: "scheduled",
      scheduled_at: retryAt,
      last_error: failed.map((f) => `${f.platform}: ${f.error}`).join(" | "),
      results,
    });
    logger.info(
      { postId: post.id, attempt: post.attempts },
      "[scheduler] post will retry failed platforms on the next tick",
    );
    return { ...post, status: "scheduled", results };
  }

  /* Terminal: if NOTHING posted, refund the 1-credit reservation. A partial
     success (at least one platform posted) is not refunded — the scheduled
     post delivered. */
  if (failedCount > 0 && posted.length === 0) {
    await refundReservation(r, post);
  }
  const status: ScheduledPost["status"] = posted.length > 0 ? "posted" : "failed";
  const patch: Partial<ScheduledPost> = {
    status,
    results,
    last_error: failedCount > 0 ? failed.map((f) => `${f.platform}: ${f.error}`).join(" | ") : null,
  };
  if (status === "posted") patch.posted_at = r.now();
  await r.updatePost(post.id, patch);
  logger.info({ postId: post.id, status, posted: posted.length, failed: failedCount }, "[scheduler] post settled");
  return { ...post, ...patch };
}

async function refundReservation(
  r: ReturnType<typeof resolveDeps>,
  post: ScheduledPost,
): Promise<void> {
  /* The reservation is 1 credit per scheduled post, taken up front. A
     completely failed post refunds it; a post that delivered to at least
     one platform is not refunded. credits_refunded guards against
     double refunds. */
  if (post.credits_refunded || post.credits_charged <= 0) return;
  const amount = post.credits_charged;
  try {
    await r.refund(post.user_id, amount, "Content Scheduler — Refund (post failed)");
    await r.updatePost(post.id, { credits_refunded: true });
    logger.info({ postId: post.id, amount }, "[scheduler] refunded reservation");
  } catch (err) {
    logger.error({ postId: post.id, err }, "[scheduler] FAILED to refund reservation");
  }
}

/** One worker pass: claim due posts and fire them. Called from the job-poller tick. */
export async function publishDueScheduledPosts(deps: SchedulerDeps = {}): Promise<number> {
  const r = resolveDeps(deps);
  let due: ScheduledPost[];
  try {
    due = await r.claimDue(SCHEDULER_CLAIM_LIMIT);
  } catch (err) {
    logger.error({ err }, "[scheduler] due-claim failed");
    return 0;
  }
  for (const post of due) {
    try {
      await fireScheduledPost(post, deps);
    } catch (err) {
      logger.error({ postId: post.id, err }, "[scheduler] fire failed");
      try {
        await r.updatePost(post.id, {
          status: "failed",
          last_error: "Scheduler error — your reserved credits were refunded.",
          results: [],
        });
        await refundReservation(r, normalizePost(post));
      } catch {
        /* best effort */
      }
    }
  }
  return due.length;
}

/* Test seam — mirrors job-poller's __testHooks. */
export const __testHooks = {
  fireScheduledPost,
  publishDueScheduledPosts,
  normalizePost,
  fullCaption,
};
