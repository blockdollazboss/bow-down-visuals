import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, pushSubscriptionsTable } from "@workspace/db";
import { requireAuth } from "../middlewares/require-auth";
import { logger } from "../lib/logger";
import { pushConfig } from "../lib/push";
import {
  PUSH_CATEGORIES,
  getPushPreferences,
  updatePushPreferences,
  type PushCategory,
} from "../lib/push-events";

/* ── Web-push subscriptions ──────────────────────────────────────────────
   GET    /push/config          (public) the VAPID public key, or
                                { configured: false } — the client
                                shows an honest "not switched on" state
                                instead of a dead subscribe button.
   POST   /push/subscriptions   (auth) register/replace this browser's
                                subscription (keyed by endpoint).
   DELETE /push/subscriptions   (auth) remove one by endpoint (the
                                browser unsubscribed or toggled off). */

const router = Router();

router.get("/push/config", (_req: Request, res: Response) => {
  const config = pushConfig();
  if (!config) {
    res.json({ configured: false, publicKey: null });
    return;
  }
  res.json({ configured: true, publicKey: config.publicKey });
});

const subscribeSchema = z.object({
  endpoint: z.string().url().max(2048),
  keys: z.object({
    p256dh: z.string().min(1).max(512),
    auth: z.string().min(1).max(512),
  }),
});

router.post("/push/subscriptions", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      res.status(401).json({ error: "Sign in to turn on alerts." });
      return;
    }
    const parsed = subscribeSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "That alert subscription didn't look right." });
      return;
    }
    const { endpoint, keys } = parsed.data;
    const existing = await db
      .select()
      .from(pushSubscriptionsTable)
      .where(eq(pushSubscriptionsTable.endpoint, endpoint))
      .limit(1);
    if (existing[0]) {
      // Same browser re-registering (possibly a different signed-in
      // user on a shared machine): the endpoint belongs to whoever
      // registered it most recently.
      await db
        .update(pushSubscriptionsTable)
        .set({ user_id: userId, p256dh: keys.p256dh, auth: keys.auth, updated_at: new Date() })
        .where(eq(pushSubscriptionsTable.id, existing[0].id));
      res.json({ ok: true, subscriptionId: existing[0].id });
      return;
    }
    const inserted = await db
      .insert(pushSubscriptionsTable)
      .values({ user_id: userId, endpoint, p256dh: keys.p256dh, auth: keys.auth })
      .returning();
    res.status(201).json({ ok: true, subscriptionId: inserted[0]?.id ?? null });
  } catch (err) {
    logger.error({ err }, "push subscribe failed");
    res.status(500).json({ error: "Alerts couldn't be turned on. Try again." });
  }
});

const unsubscribeSchema = z.object({ endpoint: z.string().url().max(2048) });

router.delete("/push/subscriptions", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      res.status(401).json({ error: "Sign in to do that." });
      return;
    }
    const parsed = unsubscribeSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "That alert subscription didn't look right." });
      return;
    }
    // Only ever remove your own subscription rows.
    const rows = await db
      .select()
      .from(pushSubscriptionsTable)
      .where(eq(pushSubscriptionsTable.endpoint, parsed.data.endpoint));
    for (const row of rows) {
      if (row.user_id === userId) {
        await db.delete(pushSubscriptionsTable).where(eq(pushSubscriptionsTable.id, row.id));
      }
    }
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "push unsubscribe failed");
    res.status(500).json({ error: "Alerts couldn't be turned off. Try again." });
  }
});

/* ── Per-user push preferences (migration 0299) ──────────────────────────
   GET /push/preferences   (auth) the resolved category map (defaults
                           materialized when the user has no row yet).
   PUT /push/preferences   (auth) upsert any subset of the categories;
                           returns the resolved map. These gate the
                           device ping only — the bell always lands. */

router.get("/push/preferences", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      res.status(401).json({ error: "Sign in to see your alert settings." });
      return;
    }
    const prefs = await getPushPreferences(userId);
    res.json({ preferences: prefs });
  } catch (err) {
    logger.error({ err }, "push preferences read failed");
    res.status(500).json({ error: "Alert settings couldn't load. Try again." });
  }
});

const preferencesSchema = z.object(
  Object.fromEntries(PUSH_CATEGORIES.map((c) => [c, z.boolean().optional()])) as Record<
    PushCategory,
    z.ZodOptional<z.ZodBoolean>
  >,
);

router.put("/push/preferences", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      res.status(401).json({ error: "Sign in to change your alert settings." });
      return;
    }
    const parsed = preferencesSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "That alert setting didn't look right." });
      return;
    }
    const prefs = await updatePushPreferences(userId, parsed.data);
    res.json({ preferences: prefs });
  } catch (err) {
    logger.error({ err }, "push preferences write failed");
    res.status(500).json({ error: "Alert settings couldn't save. Try again." });
  }
});

export default router;
