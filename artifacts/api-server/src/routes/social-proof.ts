/**
 * Live social-proof sync (competitor-study C5) — owner endpoints.
 *
 *   GET  /api/social-proof/me          cached figures + switches; refreshes
 *                                      first when the cache is stale (>6h)
 *   POST /api/social-proof/refresh     force a live re-fetch now
 *   PUT  /api/social-proof/visibility  per-figure show/hide (the off switch)
 *
 * FREE — no credits anywhere: reading a creator's own connected accounts
 * is a plain integration, same standing rule as the analytics overview.
 * All state is keyed by the CALLER's own creator profile (resolved from
 * req.userId), so an owner can only ever read or change their own proof.
 *
 * The numbers themselves come from the analytics lane's per-account
 * fetcher (overviewForAccount) — token handling, TikTok refresh, and
 * honest-null stats live in exactly one place.
 */
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { requireAuth } from "../middlewares/require-auth";
import { overviewForAccount, type FetchImpl } from "./analytics";
import {
  getOwnerProofState,
  refreshSocialProof,
  setProofHiddenKeys,
  KNOWN_FIGURE_KEYS,
  type ProofOverviewFetcher,
} from "../lib/social-proof";
import { logger } from "../lib/logger";
import { isMissingSchemaError } from "../lib/pg-errors";

const router = Router();

const defaultFetch: FetchImpl = (url, init) => fetch(url, init);

function fetcherFor(userId: string, fetchImpl: FetchImpl = defaultFetch): ProofOverviewFetcher {
  return (account) => overviewForAccount(userId, account, fetchImpl);
}

/** Shared with the public profile read (creator-platform.ts), which
    passes this into the lib's opportunistic background refresh. */
export function socialProofFetcher(userId: string): ProofOverviewFetcher {
  return fetcherFor(userId);
}

router.get("/social-proof/me", requireAuth, async (req: Request, res: Response) => {
  const userId = req.userId!;
  try {
    let state = await getOwnerProofState(userId);
    /* Sane cadence: an owner opening their settings sees numbers no
       older than the fresh window — refresh inline when stale, exactly
       like the analytics overview reads live. A refresh hiccup must
       never blank the page: fall back to the cached state. */
    if (state.hasProfile && state.stale) {
      const refreshed = await refreshSocialProof(userId, fetcherFor(userId)).catch((err) => {
        logger.warn({ err }, "[social-proof] /me refresh failed — serving cache");
        return null;
      });
      if (refreshed) state = refreshed;
    }
    res.json(state);
  } catch (err) {
    /* The owner state reads creator_profiles + creator_social_proof +
       social_accounts in parallel, so ONE missing table (social_accounts
       is a baseline-migration table — see migration 0241) killed the
       whole card even for users with no profile. Missing schema is the
       honest not-ready state, not a 500 error card. */
    if (isMissingSchemaError(err)) {
      res.status(503).json({
        error: "social_proof_not_ready",
        message: "Social proof isn't switched on for this server yet.",
      });
      return;
    }
    req.log.error({ err }, "social-proof/me error");
    res.status(500).json({ error: "Your social proof wouldn't load. Give it another shot." });
  }
});

router.post("/social-proof/refresh", requireAuth, async (req: Request, res: Response) => {
  const userId = req.userId!;
  try {
    const state = await refreshSocialProof(userId, fetcherFor(userId));
    if (!state) {
      res.status(404).json({ error: "Create your creator profile first — social proof lives on it." });
      return;
    }
    res.json(state);
  } catch (err) {
    req.log.error({ err }, "social-proof/refresh error");
    res.status(500).json({ error: "The refresh didn't go through. Give it another shot." });
  }
});

const visibilitySchema = z.object({
  hiddenKeys: z.array(z.string().min(1).max(64)).max(32),
});

router.put("/social-proof/visibility", requireAuth, async (req: Request, res: Response) => {
  const userId = req.userId!;
  const parsed = visibilitySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Send hiddenKeys as a list of figure keys." });
    return;
  }
  const unknown = parsed.data.hiddenKeys.filter((k) => !KNOWN_FIGURE_KEYS.has(k));
  if (unknown.length > 0) {
    res.status(400).json({ error: `Unknown figure key${unknown.length > 1 ? "s" : ""}: ${unknown.join(", ")}` });
    return;
  }
  try {
    const state = await setProofHiddenKeys(userId, parsed.data.hiddenKeys);
    if (!state) {
      res.status(404).json({ error: "Create your creator profile first — social proof lives on it." });
      return;
    }
    res.json(state);
  } catch (err) {
    req.log.error({ err }, "social-proof/visibility error");
    res.status(500).json({ error: "That switch didn't save. Give it another shot." });
  }
});

export default router;
