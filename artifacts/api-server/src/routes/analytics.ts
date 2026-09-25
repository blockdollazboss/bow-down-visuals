import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { eq, desc } from "drizzle-orm";
import { db, socialAccountsTable, socialStatSnapshotsTable } from "@workspace/db";
import { requireAuth } from "../middlewares/require-auth";
import { chargeCredits, OutOfCreditsError } from "../lib/credits";
import { recordCreditUsageStrict as recordCreditUsage } from "../lib/payment-record";
import { decryptToken, encryptToken } from "../lib/social-crypto";
import { refreshTikTokTokens, TikTokApiError } from "../lib/social-tiktok";
import { getOpenAI, getTextModel } from "../lib/ai-clients";
import { publicApiLimiter } from "../lib/rate-limit";
import { logger } from "../lib/logger";

const router = Router();

/* ── Analytics Dashboard v1 ──────────────────────────────────────────────
   GET  /api/analytics/overview    (authed, FREE)  → live per-platform stats
   POST /api/analytics/insights    (authed, 1cr)   → GPT-6 plain-English insights
   POST /api/analytics/suggestions (authed, 1cr)   → GPT-6 content suggestions

   Pricing: reading stats through the creator's own connected accounts is a
   plain integration (no AI compute), so the overview is FREE per the
   standing pricing rule. The AI insights/suggestions layer burns GPT-6
   tokens, so each costs 1 credit — same impulse price as Hook Studio and
   the Monetization Coach.

   Honesty rules: every stat is labeled with its source and recency; fields
   the provider doesn't return come back null (never fabricated); one
   platform's failure never fails the whole overview; expired tokens surface
   a reconnect prompt instead of crashing. */

/* 1 credit per AI call — env-overridable without a deploy. */
export const ANALYTICS_INSIGHTS_CREDITS = Number(process.env["ANALYTICS_INSIGHTS_CREDITS"]) || 1;
export const ANALYTICS_SUGGESTIONS_CREDITS = Number(process.env["ANALYTICS_SUGGESTIONS_CREDITS"]) || 1;

export type FetchImpl = (url: string, init?: RequestInit) => Promise<globalThis.Response>;

const defaultFetch: FetchImpl = (url, init) => fetch(url, init);

const IG_GRAPH = "https://graph.instagram.com/v21.0";
const FB_GRAPH = "https://graph.facebook.com/v21.0";
const TIKTOK_API = "https://open.tiktokapis.com/v2";

/** Provider failure that distinguishes "reconnect needed" from "try again". */
export class AnalyticsProviderError extends Error {
  readonly expired: boolean;
  constructor(message: string, expired = false) {
    super(message);
    this.name = "AnalyticsProviderError";
    this.expired = expired;
  }
}

export interface TopContentItem {
  id: string;
  caption: string;
  likes: number | null;
  comments: number | null;
  postedAt: string | null;
  url: string | null;
}

export interface PlatformStats {
  followers: number | null;
  following: number | null;
  mediaCount: number | null;
  totalLikes: number | null;
}

export interface PlatformOverview {
  platform: "instagram" | "tiktok" | "facebook";
  accountId: string;
  username: string | null;
  pageName: string | null;
  status: "ok" | "not_connected" | "expired" | "error";
  message: string | null;
  stats: PlatformStats | null;
  topContent: TopContentItem[];
  fetchedAt: string | null;
}

const emptyStats = (): PlatformStats => ({
  followers: null,
  following: null,
  mediaCount: null,
  totalLikes: null,
});

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

async function readJson(res: globalThis.Response): Promise<any> {
  try {
    return await res.json();
  } catch {
    return {};
  }
}

function isAuthFailure(status: number, body: any): boolean {
  if (status === 401 || status === 403) return true;
  const code = body?.error?.code ?? body?.data?.error?.code;
  return code === 190 || code === 100; // Meta OAuthException / invalid token
}

/* ── Instagram (Instagram Login API) ─────────────────────────────────────
   Business/Creator accounts expose followers_count + media_count on /me.
   Recent media with like/comment counts powers the "top content" list. */
export async function fetchInstagramStats(
  accessToken: string,
  fetchImpl: FetchImpl = defaultFetch,
): Promise<{ stats: PlatformStats; topContent: TopContentItem[] }> {
  const meRes = await fetchImpl(
    `${IG_GRAPH}/me?fields=followers_count,media_count&access_token=${encodeURIComponent(accessToken)}`,
  );
  const me = await readJson(meRes);
  if (!meRes.ok || me?.error) {
    throw new AnalyticsProviderError(
      me?.error?.message ?? `Instagram returned HTTP ${meRes.status}.`,
      isAuthFailure(meRes.status, me),
    );
  }
  const stats: PlatformStats = {
    ...emptyStats(),
    followers: num(me.followers_count),
    mediaCount: num(me.media_count),
  };

  const topContent: TopContentItem[] = [];
  try {
    const mediaRes = await fetchImpl(
      `${IG_GRAPH}/me/media?fields=id,caption,like_count,comments_count,timestamp,permalink&limit=10&access_token=${encodeURIComponent(accessToken)}`,
    );
    const media = await readJson(mediaRes);
    const items: any[] = Array.isArray(media?.data) ? media.data : [];
    items
      .sort((a, b) => (num(b.like_count) ?? 0) - (num(a.like_count) ?? 0))
      .slice(0, 5)
      .forEach((m) =>
        topContent.push({
          id: String(m.id ?? ""),
          caption: typeof m.caption === "string" ? m.caption.slice(0, 140) : "",
          likes: num(m.like_count),
          comments: num(m.comments_count),
          postedAt: typeof m.timestamp === "string" ? m.timestamp : null,
          url: typeof m.permalink === "string" ? m.permalink : null,
        }),
      );
  } catch (err) {
    /* Top content is a nice-to-have — a failure here must not fail stats. */
    logger.warn({ err }, "[analytics] instagram top media fetch failed");
  }
  return { stats, topContent };
}

/* ── TikTok (Login Kit) ──────────────────────────────────────────────────
   Basic user/info returns identity only; follower/like/video counts need
   the user.info.stats scope, which the app may not have been granted.
   We request the stats fields and tolerate their absence (null, not fake). */
export async function fetchTikTokStats(
  accessToken: string,
  fetchImpl: FetchImpl = defaultFetch,
): Promise<{ stats: PlatformStats; topContent: TopContentItem[] }> {
  const res = await fetchImpl(
    `${TIKTOK_API}/user/info/?fields=open_id,display_name,follower_count,following_count,likes_count,video_count`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  const body = await readJson(res);
  const errCode = body?.error?.code;
  if (!res.ok || errCode) {
    const msg =
      typeof body?.error?.message === "string"
        ? body.error.message
        : `TikTok returned HTTP ${res.status}.`;
    throw new AnalyticsProviderError(
      msg,
      res.status === 401 || errCode === "invalid_access_token",
    );
  }
  const user = body?.data?.user ?? {};
  return {
    stats: {
      followers: num(user.follower_count),
      following: num(user.following_count),
      mediaCount: num(user.video_count),
      totalLikes: num(user.likes_count),
    },
    /* Video list needs the video.list scope (separate grant); v1 reports
       profile-level stats only rather than pretending at per-video data. */
    topContent: [],
  };
}

/* ── Facebook Pages ──────────────────────────────────────────────────────
   Page access tokens (stored per connected Page) can read fan/follower
   counts and recent posts with engagement summaries. */
export async function fetchFacebookStats(
  pageAccessToken: string,
  pageId: string,
  fetchImpl: FetchImpl = defaultFetch,
): Promise<{ stats: PlatformStats; topContent: TopContentItem[] }> {
  const pageRes = await fetchImpl(
    `${FB_GRAPH}/${pageId}?fields=name,followers_count,fan_count&access_token=${encodeURIComponent(pageAccessToken)}`,
  );
  const page = await readJson(pageRes);
  if (!pageRes.ok || page?.error) {
    throw new AnalyticsProviderError(
      page?.error?.message ?? `Facebook returned HTTP ${pageRes.status}.`,
      isAuthFailure(pageRes.status, page),
    );
  }
  const stats: PlatformStats = {
    ...emptyStats(),
    followers: num(page.followers_count) ?? num(page.fan_count),
    mediaCount: null,
  };

  const topContent: TopContentItem[] = [];
  try {
    const postsRes = await fetchImpl(
      `${FB_GRAPH}/${pageId}/posts?fields=id,message,created_time,likes.summary(true),comments.summary(true),permalink_url&limit=10&access_token=${encodeURIComponent(pageAccessToken)}`,
    );
    const posts = await readJson(postsRes);
    const items: any[] = Array.isArray(posts?.data) ? posts.data : [];
    items
      .sort(
        (a, b) =>
          (num(b?.likes?.summary?.total_count) ?? 0) -
          (num(a?.likes?.summary?.total_count) ?? 0),
      )
      .slice(0, 5)
      .forEach((p) =>
        topContent.push({
          id: String(p.id ?? ""),
          caption: typeof p.message === "string" ? p.message.slice(0, 140) : "",
          likes: num(p?.likes?.summary?.total_count),
          comments: num(p?.comments?.summary?.total_count),
          postedAt: typeof p.created_time === "string" ? p.created_time : null,
          url: typeof p.permalink_url === "string" ? p.permalink_url : null,
        }),
      );
  } catch (err) {
    logger.warn({ err }, "[analytics] facebook top posts fetch failed");
  }
  return { stats, topContent };
}

/* Refresh a TikTok access token when it's expired, persisting the rotated
   pair — same pattern as the TikTok publish route. */
async function tiktokAccessToken(
  account: { id: string; access_token_encrypted: string | null; refresh_token_encrypted: string | null; token_expires_at: Date | null },
): Promise<string> {
  if (!account.access_token_encrypted) {
    throw new AnalyticsProviderError("That TikTok account isn't connected anymore.", true);
  }
  let accessToken = decryptToken(account.access_token_encrypted); // fail closed
  const expired =
    account.token_expires_at != null &&
    account.token_expires_at.getTime() < Date.now() + 60_000;
  if (!expired) return accessToken;
  if (!account.refresh_token_encrypted) {
    throw new AnalyticsProviderError("Your TikTok connection expired. Reconnect it in Settings → Connected Accounts.", true);
  }
  const clientKey = (process.env["TIKTOK_CLIENT_KEY"] ?? "").trim();
  const clientSecret = (process.env["TIKTOK_CLIENT_SECRET"] ?? "").trim();
  const redirectUri = (process.env["TIKTOK_REDIRECT_URI"] ?? "").trim();
  if (!clientKey || !clientSecret || !redirectUri) {
    throw new AnalyticsProviderError("TikTok isn't configured on this server.", false);
  }
  try {
    const refreshed = await refreshTikTokTokens(
      { clientKey, clientSecret, redirectUri },
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
      .where(eq(socialAccountsTable.id, account.id));
  } catch (err) {
    const msg =
      err instanceof TikTokApiError
        ? err.userMessage
        : "Your TikTok connection expired. Reconnect it in Settings → Connected Accounts.";
    throw new AnalyticsProviderError(msg, true);
  }
  return accessToken;
}

interface AccountRow {
  id: string;
  platform: string;
  username: string | null;
  page_name: string | null;
  page_id: string | null;
  access_token_encrypted: string | null;
  refresh_token_encrypted: string | null;
  token_expires_at: Date | null;
}

async function overviewForAccount(
  userId: string,
  account: AccountRow,
  fetchImpl: FetchImpl,
): Promise<PlatformOverview> {
  const base: PlatformOverview = {
    platform: account.platform as PlatformOverview["platform"],
    accountId: account.id,
    username: account.username,
    pageName: account.page_name,
    status: "error",
    message: null,
    stats: null,
    topContent: [],
    fetchedAt: null,
  };
  try {
    if (account.platform === "instagram") {
      if (!account.access_token_encrypted) {
        throw new AnalyticsProviderError("Instagram isn't connected.", true);
      }
      const token = decryptToken(account.access_token_encrypted); // fail closed
      const { stats, topContent } = await fetchInstagramStats(token, fetchImpl);
      return { ...base, status: "ok", stats, topContent, fetchedAt: new Date().toISOString() };
    }
    if (account.platform === "tiktok") {
      const token = await tiktokAccessToken(account);
      const { stats, topContent } = await fetchTikTokStats(token, fetchImpl);
      return { ...base, status: "ok", stats, topContent, fetchedAt: new Date().toISOString() };
    }
    if (account.platform === "facebook") {
      if (!account.access_token_encrypted || !account.page_id) {
        throw new AnalyticsProviderError("That Facebook Page isn't connected anymore.", true);
      }
      const token = decryptToken(account.access_token_encrypted); // fail closed
      const { stats, topContent } = await fetchFacebookStats(token, account.page_id, fetchImpl);
      return { ...base, status: "ok", stats, topContent, fetchedAt: new Date().toISOString() };
    }
    return { ...base, message: `Platform "${account.platform}" isn't supported by analytics yet.` };
  } catch (err) {
    if (err instanceof AnalyticsProviderError) {
      return { ...base, status: err.expired ? "expired" : "error", message: err.message };
    }
    logger.warn({ err, platform: account.platform }, "[analytics] overview platform failed");
    return { ...base, message: "Couldn't reach that platform right now. Try refreshing." };
  }
}

/* Best-effort snapshot insert — must never fail the overview request. */
async function recordSnapshot(
  userId: string,
  platform: string,
  accountId: string,
  stats: PlatformStats,
): Promise<void> {
  try {
    await db.insert(socialStatSnapshotsTable).values({
      user_id: userId,
      platform,
      account_id: accountId,
      followers: stats.followers,
      media_count: stats.mediaCount,
    });
  } catch (err) {
    logger.warn({ err }, "[analytics] snapshot insert failed (non-fatal)");
  }
}

/* GET /api/analytics/overview — free. Live stats per connected platform,
   plus recent follower snapshots for growth sparklines. */
router.get("/analytics/overview", requireAuth, async (req: Request, res: Response) => {
  const userId = req.userId!;
  const rows = await db
    .select({
      id: socialAccountsTable.id,
      platform: socialAccountsTable.platform,
      username: socialAccountsTable.username,
      page_name: socialAccountsTable.page_name,
      page_id: socialAccountsTable.page_id,
      access_token_encrypted: socialAccountsTable.access_token_encrypted,
      refresh_token_encrypted: socialAccountsTable.refresh_token_encrypted,
      token_expires_at: socialAccountsTable.token_expires_at,
    })
    .from(socialAccountsTable)
    .where(eq(socialAccountsTable.user_id, userId));

  const platforms = await Promise.all(
    rows.map((r) => overviewForAccount(userId, r, defaultFetch)),
  );

  /* Snapshots for the accounts that returned stats (fire-and-forget). */
  await Promise.all(
    platforms
      .filter((p) => p.status === "ok" && p.stats)
      .map((p) => recordSnapshot(userId, p.platform, p.accountId, p.stats!)),
  );

  const snapshots = await db
    .select({
      platform: socialStatSnapshotsTable.platform,
      followers: socialStatSnapshotsTable.followers,
      recordedAt: socialStatSnapshotsTable.recorded_at,
    })
    .from(socialStatSnapshotsTable)
    .where(eq(socialStatSnapshotsTable.user_id, userId))
    .orderBy(desc(socialStatSnapshotsTable.recorded_at))
    .limit(120);

  res.json({
    platforms,
    snapshots: snapshots.map((s) => ({
      platform: s.platform,
      followers: s.followers,
      recordedAt: s.recordedAt?.toISOString() ?? null,
    })),
    fetchedAt: new Date().toISOString(),
  });
});

/* ── AI layer ─────────────────────────────────────────────────────────────
   The raw overview is free; the AI layer is the headline feature and costs
   1 credit per generation (it burns GPT-6 tokens). The client sends the
   stats it already pulled — the server validates the shape with zod so a
   crafted body can't smuggle prompt-injection payloads past the schema. */

const platformStatsSchema = z.object({
  platform: z.enum(["instagram", "tiktok", "facebook"]),
  username: z.string().nullable().optional(),
  pageName: z.string().nullable().optional(),
  stats: z
    .object({
      followers: z.number().int().min(0).nullable(),
      following: z.number().int().min(0).nullable(),
      mediaCount: z.number().int().min(0).nullable(),
      totalLikes: z.number().int().min(0).nullable(),
    })
    .nullable(),
  topContent: z
    .array(
      z.object({
        caption: z.string().max(200),
        likes: z.number().int().min(0).nullable(),
        comments: z.number().int().min(0).nullable(),
      }),
    )
    .max(15)
    .default([]),
});

const aiBodySchema = z.object({
  platforms: z.array(platformStatsSchema).min(1).max(10),
  niche: z.string().max(80).optional().default(""),
});

/** Plain-text stats summary for the model prompt. Nulls stay null — the
    model is told what's missing so it never invents numbers. */
export function summarizeStatsForAI(
  platforms: z.infer<typeof platformStatsSchema>[],
): string {
  return platforms
    .map((p) => {
      const s = p.stats;
      const lines = [
        `- ${p.platform}${p.username ? ` (@${p.username})` : ""}${p.pageName ? ` (${p.pageName})` : ""}:`,
        `  followers: ${s?.followers ?? "unknown"}`,
        `  posts/videos: ${s?.mediaCount ?? "unknown"}`,
        `  total likes: ${s?.totalLikes ?? "unknown"}`,
      ];
      if (p.topContent.length > 0) {
        lines.push(
          `  top posts:`,
          ...p.topContent.slice(0, 5).map(
            (t) =>
              `    - "${t.caption.slice(0, 80)}" (${t.likes ?? "?"} likes, ${t.comments ?? "?"} comments)`,
          ),
        );
      }
      return lines.join("\n");
    })
    .join("\n");
}

async function chargeOr402(
  req: Request,
  res: Response,
  credits: number,
  action: string,
): Promise<number | null> {
  const balance = req.userCredits ?? 0;
  if (balance < credits) {
    res.status(402).json({
      error: "out_of_credits",
      message: "You're out of credits — top up to unlock AI insights.",
    });
    return null;
  }
  try {
    return await chargeCredits(req.userId!, credits, { action });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({
        error: "out_of_credits",
        message: "You're out of credits — top up to unlock AI insights.",
      });
      return null;
    }
    throw err;
  }
}

function parseModelJson(raw: string): any {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/* POST /api/analytics/insights { platforms[], niche? } → 1 credit.
   Plain-English read on what's working, what's slipping, best posting
   window, and 3 prioritized moves. */
router.post(
  "/analytics/insights",
  publicApiLimiter,
  requireAuth,
  async (req: Request, res: Response) => {
    const parsed = aiBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({
        error: "Invalid insights request.",
        details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
      });
      return;
    }
    const creditsRemaining = await chargeOr402(req, res, ANALYTICS_INSIGHTS_CREDITS, "Analytics AI Insights");
    if (creditsRemaining === null) return;

    const summary = summarizeStatsForAI(parsed.data.platforms);
    try {
      const completion = await getOpenAI().chat.completions.create({
        model: getTextModel(),
        response_format: { type: "json_object" },
        temperature: 0.5,
        max_completion_tokens: 1200,
        messages: [
          {
            role: "system",
            content:
              `You are Thy Cheat Code's analytics brain for independent creators. ` +
              `You get a snapshot of a creator's social stats (followers, post counts, top posts with like/comment counts). ` +
              `Some fields may be "unknown" — never invent numbers; say what's missing instead. ` +
              `Return ONLY JSON: {"headline": "<one-sentence read on their momentum>", ` +
              `"movers": [{"platform": "...", "observation": "...", "why": "..."}], ` +
              `"bestWindow": "<best posting window advice grounded in the data, or honest 'not enough data'>", ` +
              `"recommendations": ["<3 specific prioritized moves, each one sentence>"]}. ` +
              `Be concrete and creator-fluent. No vague "post consistently" fluff.`,
          },
          {
            role: "user",
            content:
              `Analyze my stats. My niche: ${parsed.data.niche || "not specified"}.\n\n${summary}`,
          },
        ],
      });
      const data = parseModelJson(completion.choices[0]?.message?.content ?? "");
      if (!data || typeof data !== "object") {
        throw new Error("Model returned malformed insights JSON");
      }
      try {
        await recordCreditUsage({ userId: req.userId!, action: "analytics-insights", creditsUsed: ANALYTICS_INSIGHTS_CREDITS });
      } catch (e) {
        logger.warn({ e }, "[analytics] insights usage record failed (non-fatal)");
      }
      res.json({
        insights: {
          headline: typeof data.headline === "string" ? data.headline : "",
          movers: Array.isArray(data.movers) ? data.movers : [],
          bestWindow: typeof data.bestWindow === "string" ? data.bestWindow : "",
          recommendations: Array.isArray(data.recommendations) ? data.recommendations : [],
        },
        creditsUsed: ANALYTICS_INSIGHTS_CREDITS,
        creditsRemaining,
      });
    } catch (err) {
      logger.error({ err }, "[analytics] insights generation failed");
      res.status(502).json({
        error: "insights_failed",
        message: "The AI couldn't analyze your stats right now. Your credit was still used — try again in a bit.",
      });
    }
  },
);

/* POST /api/analytics/suggestions { platforms[], niche? } → 1 credit.
   Content ideas modeled on the creator's top-performing posts. */
router.post(
  "/analytics/suggestions",
  publicApiLimiter,
  requireAuth,
  async (req: Request, res: Response) => {
    const parsed = aiBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({
        error: "Invalid suggestions request.",
        details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
      });
      return;
    }
    const creditsRemaining = await chargeOr402(req, res, ANALYTICS_SUGGESTIONS_CREDITS, "Analytics AI Suggestions");
    if (creditsRemaining === null) return;

    const summary = summarizeStatsForAI(parsed.data.platforms);
    try {
      const completion = await getOpenAI().chat.completions.create({
        model: getTextModel(),
        response_format: { type: "json_object" },
        temperature: 0.7,
        max_completion_tokens: 1200,
        messages: [
          {
            role: "system",
            content:
              `You are a content strategist for independent creators. Given a creator's ` +
              `stats and top-performing posts, suggest what to make next. ` +
              `Return ONLY JSON: {"suggestions": [{"title": "...", "format": "video|carousel|reel|live|post", ` +
              `"why": "<one sentence tying it to their data>", "hook": "<opening line/hook>"}]}. ` +
              `Exactly 5 suggestions, ordered by likely impact. Ground every "why" in the ` +
              `stats provided; if a field is "unknown", say so rather than inventing it.`,
          },
          {
            role: "user",
            content:
              `What should I make next? My niche: ${parsed.data.niche || "not specified"}.\n\n${summary}`,
          },
        ],
      });
      const data = parseModelJson(completion.choices[0]?.message?.content ?? "");
      if (!data || !Array.isArray(data.suggestions)) {
        throw new Error("Model returned malformed suggestions JSON");
      }
      try {
        await recordCreditUsage({ userId: req.userId!, action: "analytics-suggestions", creditsUsed: ANALYTICS_SUGGESTIONS_CREDITS });
      } catch (e) {
        logger.warn({ e }, "[analytics] suggestions usage record failed (non-fatal)");
      }
      res.json({
        suggestions: data.suggestions.slice(0, 5).map((s: any) => ({
          title: typeof s.title === "string" ? s.title : "",
          format: typeof s.format === "string" ? s.format : "video",
          why: typeof s.why === "string" ? s.why : "",
          hook: typeof s.hook === "string" ? s.hook : "",
        })),
        creditsUsed: ANALYTICS_SUGGESTIONS_CREDITS,
        creditsRemaining,
      });
    } catch (err) {
      logger.error({ err }, "[analytics] suggestions generation failed");
      res.status(502).json({
        error: "suggestions_failed",
        message: "The AI couldn't cook up ideas right now. Your credit was still used — try again in a bit.",
      });
    }
  },
);

export default router;

/* Named export for tests that need the zod schemas without the router. */
export { aiBodySchema, platformStatsSchema };
