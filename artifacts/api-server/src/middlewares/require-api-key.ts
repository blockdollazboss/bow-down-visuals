import type { Request, Response, NextFunction } from "express";
import {
  resolveApiKey,
  type ApiKeyScope,
  type ResolvedApiKey,
} from "../lib/api-keys";
import { getSupabaseAdmin } from "../lib/supabase-admin";
import { spendableBalance } from "../lib/credits";
import { logger } from "../lib/logger";

declare global {
  namespace Express {
    interface Request {
      apiKeyId?: string;
      apiKeyScopes?: ApiKeyScope[];
    }
  }
}

/* ─── API-key auth for the Public Creator API (/api/v1) ──────────────────
   FAILS CLOSED, always:
   - missing / malformed / unknown / revoked key        → 401
   - resolver throws (e.g. api_keys table not migrated)  → 401
   - key lacks the route's required scope                → 403
   A key resolves to its owner + scopes and NOTHING more: no admin
   surface, no other user's data — routes read req.userId from here and
   every query they run is scoped to it. */

type ApiKeyResolver = (plaintext: string) => Promise<ResolvedApiKey | null>;

async function loadBalance(userId: string): Promise<number> {
  try {
    const { data } = await getSupabaseAdmin()
      .from("profiles")
      .select("credits, bonus_credits, bonus_credits_expires_at")
      .eq("id", userId)
      .maybeSingle();
    /* THE spendable balance — the same composition requireAuth attaches
       for session requests and chargeCredits spends (bonus pool first):
       profiles.credits PLUS the live bonus pool. Reading `credits` alone
       understated every key-authed balance while a temporary bonus was
       live: /v1/balance disagreed with the site's own readout, and the
       bio pre-check 402'd members the charge rail would have served. */
    return spendableBalance(
      data as {
        credits?: number | null;
        bonus_credits?: number | null;
        bonus_credits_expires_at?: string | null;
      } | null,
    );
  } catch {
    return 0;
  }
}

export function createRequireApiKey(
  requiredScope: ApiKeyScope,
  resolver: ApiKeyResolver = resolveApiKey,
) {
  return async function requireApiKey(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    const fail = (status: number, error: string, message: string) => {
      res.status(status).json({ error, message });
    };

    const authHeader = req.headers["authorization"];
    if (!authHeader?.startsWith("Bearer ")) {
      fail(401, "invalid_api_key", "Missing API key. Send it as: Authorization: Bearer bdv_live_…");
      return;
    }
    const plaintext = authHeader.slice(7).trim();

    let resolved: ResolvedApiKey | null = null;
    try {
      resolved = await resolver(plaintext);
    } catch (err) {
      // Infrastructure failure (incl. the held migration) — fail closed.
      logger.error({ err }, "[api-keys] resolver failed; failing closed");
      fail(401, "invalid_api_key", "This API key could not be verified.");
      return;
    }
    if (!resolved) {
      fail(401, "invalid_api_key", "This API key is invalid or has been revoked.");
      return;
    }
    if (!resolved.scopes.includes(requiredScope)) {
      fail(
        403,
        "insufficient_scope",
        `This endpoint requires the "${requiredScope}" scope, which this key does not have.`,
      );
      return;
    }

    req.userId = resolved.userId;
    req.apiKeyId = resolved.keyId;
    req.apiKeyScopes = resolved.scopes;
    req.userCredits = await loadBalance(resolved.userId);
    next();
  };
}

/** Default middleware bound to the real DB resolver. */
export function requireApiKey(requiredScope: ApiKeyScope) {
  return createRequireApiKey(requiredScope);
}
