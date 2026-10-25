import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middlewares/require-auth";
import { requireApiKey } from "../middlewares/require-api-key";
import { apiKeyLimiter, apiKeyGenerationLimiter } from "../lib/rate-limit";
import {
  API_KEY_SCOPES,
  createApiKey,
  listApiKeys,
  normalizeScopes,
  revokeApiKey,
} from "../lib/api-keys";
import { getSupabaseAdmin } from "../lib/supabase-admin";
import { getCreditUsage, getGenerationHistory } from "../lib/payment-record";
import { OutOfCreditsError, CreditsDisabledError } from "../lib/credits";
import { bioSchema, generateBiosForUser, BIO_COST } from "./generate/bio-generator";
import * as earnings from "./earnings";
import { logger } from "../lib/logger";
import { isMissingSchemaError } from "../lib/pg-errors";
import {
  WEBHOOK_EVENT_TYPES,
  createWebhookEndpoint,
  normalizeEventTypes,
  toPublicEndpoint,
  drizzleWebhookStore,
} from "../lib/api-webhooks";

const router = Router();

/* ─── Public Creator API v1 (Stack-100 #3, feature #9) ───────────────────
   A SAFE SUBSET of the platform — deliberately NOT the operator's whole
   tool catalog (lib/operator-tools). v1 exposes only:
     GET  /api/v1/me               (profile:read)   own profile
     GET  /api/v1/content          (content:read)   own generation history
     GET  /api/v1/balance          (earnings:read)  own balance + earnings
     POST /api/v1/generate/bio     (generate:bio)   Bio Generator, charged
   Everything else — songs, video, lip-sync, publishing, store, payouts,
   social, admin — is NOT exposed in v1 (stated plainly in the Developer
   door in Settings).

   Charging invariants for the one charged action:
   - price = BIO_COST imported from the website rail's own module — the
     same constant the clicked rail charges; never client-supplied;
   - exactly one ledger row per completed generation, labelled
     "API: Bio Generator" so API spend is identifiable in the ledger;
   - failed generations refund in full ("API: Bio Generator — Refund"),
     exactly like the website rail;
   - a key can never spend past the owner's balance (chargeCredits
     refuses with OutOfCreditsError → 402 before any generation runs);
   - per-key rate limits on every route (apiKeyLimiter /
     apiKeyGenerationLimiter, applied after key auth). */

/* ═══ Key management — session-authed, docked in Settings → Developer ═══ */

const createKeySchema = z.object({
  name: z.string().trim().min(1).max(60),
  scopes: z.array(z.string()).min(1).max(API_KEY_SCOPES.length),
});

router.get("/api-keys", requireAuth, async (req, res) => {
  try {
    const keys = await listApiKeys(req.userId!);
    res.json({ keys, availableScopes: API_KEY_SCOPES });
  } catch (err) {
    /* Migration 0216 created api_keys in a shape the Drizzle schema
       never reads (jsonb scopes + status, no revoked_at), so this list
       failed with 42703 for every user until migration 0241 aligned
       the table. Any remaining missing-schema failure is the honest
       not-ready state, not a 500 error card. */
    if (isMissingSchemaError(err)) {
      res.status(503).json({
        error: "api_keys_not_ready",
        message: "API keys aren't switched on for this server yet.",
      });
      return;
    }
    req.log.error({ err }, "[api-keys] list failed");
    res.status(500).json({ error: "Failed to load API keys." });
  }
});

router.post("/api-keys", requireAuth, async (req, res) => {
  const parsed = createKeySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_request", message: "Give the key a name (max 60 characters) and pick at least one scope." });
    return;
  }
  const scopes = normalizeScopes(parsed.data.scopes);
  if (!scopes) {
    res.status(400).json({
      error: "invalid_scope",
      message: `Scopes must come from: ${API_KEY_SCOPES.join(", ")}.`,
    });
    return;
  }
  try {
    const { key, plaintext } = await createApiKey(req.userId!, parsed.data.name, scopes);
    // The plaintext rides this ONE response and is never stored or
    // returned again — the Developer door shows it once, with that warning.
    res.status(201).json({ key, plaintext });
  } catch (err) {
    req.log.error({ err }, "[api-keys] create failed");
    res.status(500).json({ error: "Failed to create API key." });
  }
});

router.delete("/api-keys/:id", requireAuth, async (req, res) => {
  try {
    // Owner-scoped in the query itself: a creator can only ever revoke
    // their OWN keys — another user's key id reads as "not found".
    const revoked = await revokeApiKey(req.userId!, String(req.params.id));
    if (!revoked) {
      res.status(404).json({ error: "not_found", message: "No active API key with that id belongs to you." });
      return;
    }
    res.json({ revoked: true });
  } catch (err) {
    req.log.error({ err }, "[api-keys] revoke failed");
    res.status(500).json({ error: "Failed to revoke API key." });
  }
});

/* ═══ Webhook management — session-authed, docked in Settings → Developer
   (Stack-100 #3 wave 3, lane 20). Same ownership model as the API keys:
   every query is scoped to req.userId, so another creator's endpoint id
   reads as "not found". The signing secret rides the create response
   EXACTLY ONCE and is never stored or returned again. Until the webhook
   migration lands these routes fail honestly (500 on create/list) and
   event emission fails closed — nothing fires, nothing pretends to. ═══ */

const createWebhookSchema = z.object({
  url: z.string().trim().min(1).max(2048),
  events: z.array(z.string()).min(1).max(WEBHOOK_EVENT_TYPES.length),
});

router.get("/api-webhooks", requireAuth, async (req, res) => {
  try {
    const rows = await drizzleWebhookStore.listEndpoints(req.userId!);
    res.json({ webhooks: rows.map(toPublicEndpoint), availableEventTypes: WEBHOOK_EVENT_TYPES });
  } catch (err) {
    req.log.error({ err }, "[api-webhooks] list failed");
    res.status(500).json({ error: "Failed to load webhooks." });
  }
});

router.post("/api-webhooks", requireAuth, async (req, res) => {
  const parsed = createWebhookSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_request", message: "Give the endpoint an https URL and pick at least one event type." });
    return;
  }
  const events = normalizeEventTypes(parsed.data.events);
  if (!events) {
    res.status(400).json({
      error: "invalid_event_type",
      message: `Event types must come from: ${WEBHOOK_EVENT_TYPES.join(", ")}.`,
    });
    return;
  }
  try {
    const result = await createWebhookEndpoint(req.userId!, parsed.data.url, events);
    if (!result.ok) {
      res.status(400).json({ error: "invalid_url", message: `That endpoint URL can't be used (${result.reason}). Webhook URLs must be https and resolve to a public address.` });
      return;
    }
    // The secret rides this ONE response — never stored, never returned again.
    res.status(201).json({ webhook: result.endpoint, secret: result.secret });
  } catch (err) {
    req.log.error({ err }, "[api-webhooks] create failed");
    res.status(500).json({ error: "Failed to create webhook." });
  }
});

router.patch("/api-webhooks/:id", requireAuth, async (req, res) => {
  const status = (req.body as { status?: unknown } | undefined)?.status;
  if (status !== "paused" && status !== "active") {
    res.status(400).json({ error: "invalid_request", message: "Status must be \"paused\" or \"active\"." });
    return;
  }
  try {
    // Resume also clears the failure counter + disabled stamp: a creator
    // who revives an auto-disabled endpoint starts from a clean slate.
    const patch =
      status === "active"
        ? { status, consecutiveFailures: 0, disabledAt: null }
        : { status };
    const updated = await drizzleWebhookStore.updateEndpoint(req.userId!, String(req.params.id), patch);
    if (!updated) {
      res.status(404).json({ error: "not_found", message: "No webhook with that id belongs to you." });
      return;
    }
    res.json({ updated: true, status });
  } catch (err) {
    req.log.error({ err }, "[api-webhooks] update failed");
    res.status(500).json({ error: "Failed to update webhook." });
  }
});

router.delete("/api-webhooks/:id", requireAuth, async (req, res) => {
  try {
    const deleted = await drizzleWebhookStore.deleteEndpoint(req.userId!, String(req.params.id));
    if (!deleted) {
      res.status(404).json({ error: "not_found", message: "No webhook with that id belongs to you." });
      return;
    }
    res.json({ deleted: true });
  } catch (err) {
    req.log.error({ err }, "[api-webhooks] delete failed");
    res.status(500).json({ error: "Failed to delete webhook." });
  }
});

router.get("/api-webhooks/:id/deliveries", requireAuth, async (req, res) => {
  try {
    const owned = await drizzleWebhookStore.getEndpoint(req.userId!, String(req.params.id));
    if (!owned) {
      res.status(404).json({ error: "not_found", message: "No webhook with that id belongs to you." });
      return;
    }
    const deliveries = await drizzleWebhookStore.listDeliveries(req.userId!, owned.id, 50);
    res.json({ deliveries });
  } catch (err) {
    req.log.error({ err }, "[api-webhooks] deliveries failed");
    res.status(500).json({ error: "Failed to load delivery history." });
  }
});

/* ═══ /api/v1 — key-authed surface ═══ */

router.get("/v1/me", requireApiKey("profile:read"), apiKeyLimiter, async (req, res) => {
  try {
    const { data } = await getSupabaseAdmin()
      .from("profiles")
      .select("id, email, display_name, plan, plan_tier, credits")
      .eq("id", req.userId!)
      .maybeSingle();
    if (!data) {
      res.status(404).json({ error: "not_found", message: "Profile not found." });
      return;
    }
    const p = data as {
      id: string; email?: string; display_name?: string | null;
      plan?: string | null; plan_tier?: number | null; credits?: number;
    };
    res.json({
      id: p.id,
      email: p.email ?? null,
      displayName: p.display_name ?? null,
      plan: p.plan ?? "free",
      planTier: p.plan_tier ?? null,
    });
  } catch (err) {
    req.log.error({ err }, "[public-api] /v1/me failed");
    res.status(500).json({ error: "server_error", message: "Failed to load profile." });
  }
});

router.get("/v1/content", requireApiKey("content:read"), apiKeyLimiter, async (req, res) => {
  try {
    const rows = await getGenerationHistory(req.userId!);
    res.json({
      content: rows.slice(0, 50).map((r) => ({
        id: r.id,
        type: r.generationType,
        creditsUsed: r.creditsUsed,
        refunded: r.refunded,
        createdAt: r.createdAt,
      })),
    });
  } catch (err) {
    req.log.error({ err }, "[public-api] /v1/content failed");
    res.status(500).json({ error: "server_error", message: "Failed to load content." });
  }
});

router.get("/v1/balance", requireApiKey("earnings:read"), apiKeyLimiter, async (req, res) => {
  try {
    const userId = req.userId!;
    // Balance: the same profiles.credits the auth middleware and every
    // charge path read. Earnings: the SAME four exported readers the
    // /api/earnings route and the operator's Tier-0 tool use, with the
    // same per-source settle discipline (a failed source reads null,
    // never a fake 0).
    const settle = async <T,>(fn: () => Promise<T>): Promise<T | null> => {
      try {
        return await fn();
      } catch (err) {
        logger.error({ err, userId }, "[public-api] earnings source failed");
        return null;
      }
    };
    const [store, memb, deals, tip, usage] = await Promise.all([
      settle(() => earnings.storeSales(userId)),
      settle(() => earnings.memberships(userId)),
      settle(() => earnings.brandDeals(userId)),
      settle(() => earnings.tips(userId)),
      settle(() => getCreditUsage(userId)),
    ]);
    const totalEarnedCents =
      (store?.totalCents ?? 0) + (memb?.totalCents ?? 0) + (deals?.totalCents ?? 0);
    const totalSpentVb = (usage ?? []).reduce((sum, u) => sum + (u.creditsUsed ?? 0), 0);
    res.json({
      balanceVb: req.userCredits ?? 0,
      earnings: {
        currency: "USD",
        totalCents: totalEarnedCents,
        tipsVb: tip?.streamTipsVb ?? null,
        partial: !store || !memb || !deals || !tip,
      },
      lifetimeSpentVb: usage ? totalSpentVb : null,
    });
  } catch (err) {
    req.log.error({ err }, "[public-api] /v1/balance failed");
    res.status(500).json({ error: "server_error", message: "Failed to load balance." });
  }
});

router.post(
  "/v1/generate/bio",
  requireApiKey("generate:bio"),
  apiKeyGenerationLimiter,
  async (req, res) => {
    const parsed = bioSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({
        error: "invalid_request",
        message: "Invalid bio request.",
        details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
      });
      return;
    }
    // Balance pre-check mirrors the website rail's 402 shape; the hard
    // guarantee is inside chargeCredits (it re-reads and refuses).
    if ((req.userCredits ?? 0) < BIO_COST) {
      res.status(402).json({
        error: "out_of_credits",
        message: "Not enough Visual Bucs for this generation.",
        costVb: BIO_COST,
      });
      return;
    }
    try {
      const idem = req.headers["idempotency-key"];
      const { bios, creditsRemaining } = await generateBiosForUser(req.userId!, parsed.data, {
        action: "API: Bio Generator",
        idempotencyKey: typeof idem === "string" && idem.trim() ? `api:${req.apiKeyId}:${idem.trim()}` : null,
      });
      res.json({ bios, niche: parsed.data.niche, costVb: BIO_COST, creditsRemaining });
    } catch (err) {
      if (err instanceof OutOfCreditsError) {
        res.status(402).json({ error: "out_of_credits", message: "Not enough Visual Bucs.", costVb: BIO_COST });
        return;
      }
      if (err instanceof CreditsDisabledError) {
        res.status(403).json({ error: "credits_disabled", message: "Credit spending is currently disabled for this account." });
        return;
      }
      const message = err instanceof Error ? err.message : "Bio generation failed.";
      req.log.error({ err: message }, "[public-api] /v1/generate/bio failed (refunded)");
      res.status(500).json({ error: "generation_failed", message });
    }
  },
);

export default router;
