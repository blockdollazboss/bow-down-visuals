import type { Request, Response, NextFunction } from "express";
import { db, creatorProfilesTable, creatorSubscriptionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  CREATOR_TIERS,
  type CreatorTier,
  meetsTier,
  tierFromLegacyPlan,
  maxStarsForTier,
} from "../lib/platform-fees";
import { logger } from "../lib/logger";

/* ── Tier gating — Worker 12 ──────────────────────────────────────────────
   Canonical gate for creator-platform paid features. Usage:

     router.post("/creator-sites/:id/domain", requireAuth, requireTier("pro"), handler);

   GATE CONTRACT (never a dead end): a 403 always carries BOTH
     - upgradeUrl: /creator-pricing?returnTo=<where they were>  (the upgrade path)
     - backUrl:    where to go back to (Referer, else /dashboard) (the way back)
   Link-graph rule: every "pro required" moment links forward to pricing AND
   back to what the creator was doing.

   Effective tier = max(subscription tier, legacy main-site plan tier), so a
   creator who already pays for "Pro Artist"/"Studio"/"VIP"/"MVP" never loses
   access they bought. req.tier is set for downstream handlers.           */

declare global {
  namespace Express {
    interface Request {
      creatorTier?: CreatorTier;
      creatorProfileId?: string;
    }
  }
}

const ACTIVE_STATUSES = new Set(["active", "trialing"]);

/** Resolve the caller's effective creator tier. Never throws — falls back to free. */
export async function resolveCreatorTier(
  userId: string | undefined,
  legacyPlan?: string | null,
): Promise<{ tier: CreatorTier; profileId: string | null }> {
  const legacy = tierFromLegacyPlan(legacyPlan);
  if (!userId) return { tier: legacy, profileId: null };
  try {
    const [profile] = await db
      .select({ id: creatorProfilesTable.id })
      .from(creatorProfilesTable)
      .where(eq(creatorProfilesTable.userId, userId))
      .limit(1);
    if (!profile) return { tier: legacy, profileId: null };
    const [sub] = await db
      .select({ tier: creatorSubscriptionsTable.tier, status: creatorSubscriptionsTable.status })
      .from(creatorSubscriptionsTable)
      .where(eq(creatorSubscriptionsTable.profileId, profile.id))
      .limit(1);
    let subTier: CreatorTier = "free";
    if (sub && ACTIVE_STATUSES.has(sub.status) && (CREATOR_TIERS as readonly string[]).includes(sub.tier)) {
      subTier = sub.tier as CreatorTier;
    }
    const tier: CreatorTier = meetsTier(subTier, legacy) ? subTier : legacy;
    return { tier, profileId: profile.id };
  } catch (err) {
    logger.warn({ err, userId }, "resolveCreatorTier: DB lookup failed, falling back to free");
    return { tier: legacy, profileId: null };
  }
}

/** Is `stars` (1–6 creator level) allowed on `tier`? */
export function tierAllowsStars(tier: CreatorTier, stars: number): boolean {
  return stars <= maxStarsForTier(tier);
}

/**
 * Express middleware: require at least `required` tier.
 * Attaches req.creatorTier / req.creatorProfileId for the handler.
 */
export function requireTier(required: Exclude<CreatorTier, "free">) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const { tier, profileId } = await resolveCreatorTier(req.userId, req.userPlan);
    req.creatorTier = tier;
    req.creatorProfileId = profileId ?? undefined;
    if (meetsTier(tier, required)) {
      next();
      return;
    }
    const here = req.originalUrl || req.path;
    const backUrl =
      typeof req.headers.referer === "string" && req.headers.referer.startsWith("/")
        ? req.headers.referer
        : "/dashboard";
    res.status(403).json({
      error: "TIER_REQUIRED",
      requiredTier: required,
      currentTier: tier,
      message:
        required === "pro"
          ? "That's a Pro move. Upgrade to unlock it — or keep creating free, your earnings stay yours to see."
          : "That's an Elite move. Elite unlocks it — or keep creating, your earnings stay yours to see.",
      upgradeUrl: `/creator-pricing?returnTo=${encodeURIComponent(here)}`,
      backUrl,
    });
  };
}
