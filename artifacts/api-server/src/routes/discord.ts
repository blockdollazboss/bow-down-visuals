import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { eq, and, desc } from "drizzle-orm";
import { db, discordWebhooksTable, discordStreamsTable } from "@workspace/db";
import { requireAuth } from "../middlewares/require-auth";
import { encryptToken, decryptToken, isSocialTokenKeyConfigured } from "../lib/social-crypto";
import { logger } from "../lib/logger";

/* ── Discord Live integration (v1) ─────────────────────────────────────────
   The user streams on Discord via Go Live — it's their community hub. This
   router lets them paste a Discord channel webhook URL (Settings), then post
   rich "LIVE NOW" / "stream ended" / "new video" embeds to their server from
   the /go-live dashboard or after a video export.

   Security:
   - The webhook URL is a secret: AES-256-GCM encrypted at rest with
     SOCIAL_TOKEN_KEY (fail closed), never logged, never returned to the
     client. GET /discord/status only reports *whether* one is configured.
   - Webhook URLs are validated to the discord.com / discordapp.com
     /api/webhooks/ shape before storage — the server only ever POSTs to
     Discord, never to an arbitrary user-supplied host (SSRF guard).
   - Posting is pure integration (a single outbound HTTP call, no AI
     compute), so it is FREE under the pricing rule — no credit charge.

   Endpoints (all authed):
   GET    /discord/status            → { configured, channel_name, mention_everyone, crypto_ready }
   POST   /discord/webhook           → { webhook_url, channel_name?, mention_everyone? } → save (upsert)
   DELETE /discord/webhook           → remove
   POST   /discord/announce           → { kind: live|ended|video, title, game?, video_url?, vod_url?, mention_everyone? }
   GET    /discord/streams            → upcoming + recent streams
   POST   /discord/streams            → { title, game?, scheduled_for? } → schedule
   DELETE /discord/streams/:id        → cancel a scheduled stream */

const router = Router();

/* Discord gold — matches the site's luxury brand in embed form. */
const GOLD = 0xd4af37;

const DISCORD_WEBHOOK_RE =
  /^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\/\d+\/[\w-]+$/;

function isValidWebhookUrl(url: string): boolean {
  return DISCORD_WEBHOOK_RE.test(url.trim());
}

const webhookSchema = z.object({
  webhook_url: z.string().min(1, "Webhook URL is required"),
  channel_name: z.string().max(100).optional(),
  mention_everyone: z.boolean().optional(),
});

const announceSchema = z.object({
  kind: z.enum(["live", "ended", "video"]),
  title: z.string().min(1).max(200),
  game: z.string().max(100).optional(),
  video_url: z.string().url().max(2048).optional(),
  vod_url: z.string().url().max(2048).optional(),
  mention_everyone: z.boolean().optional(),
});

const scheduleSchema = z.object({
  title: z.string().min(1).max(200),
  game: z.string().max(100).optional(),
  scheduled_for: z.string().datetime({ offset: true }).optional(),
});

async function getWebhook(userId: string) {
  const rows = await db
    .select()
    .from(discordWebhooksTable)
    .where(eq(discordWebhooksTable.user_id, userId))
    .limit(1);
  return rows[0] ?? null;
}

function buildEmbed(input: z.infer<typeof announceSchema>) {
  const { kind, title, game, video_url, vod_url } = input;
  if (kind === "live") {
    return {
      title: `🔴 LIVE NOW — ${title}`,
      description: "The King Shark is live. Come through! 🦈",
      color: GOLD,
      fields: game ? [{ name: "Playing", value: game, inline: true }] : [],
      footer: { text: "Bow Down Visuals 🦈" },
      timestamp: new Date().toISOString(),
    };
  }
  if (kind === "ended") {
    return {
      title: `Stream ended — ${title}`,
      description: vod_url
        ? `Thanks for pulling up! Catch the replay here: ${vod_url}`
        : "Thanks for pulling up! 🦈",
      color: 0x2b2b2b,
      footer: { text: "Bow Down Visuals 🦈" },
      timestamp: new Date().toISOString(),
    };
  }
  return {
    title: `🎬 New video — ${title}`,
    description: "Fresh heat just dropped. Tap in! 🔥",
    color: GOLD,
    url: video_url,
    footer: { text: "Bow Down Visuals 🦈" },
    timestamp: new Date().toISOString(),
  };
}

/* ── Webhook config ─────────────────────────────────────────────────── */

router.get("/discord/status", requireAuth, async (req: Request, res: Response) => {
  const userId = req.userId!;
  try {
    const row = await getWebhook(userId);
    res.json({
      configured: !!row,
      channel_name: row?.channel_name ?? null,
      mention_everyone: row?.mention_everyone ?? false,
      crypto_ready: isSocialTokenKeyConfigured(),
    });
  } catch (err) {
    logger.error({ err }, "[discord] status failed");
    res.status(500).json({ error: "Could not read Discord settings." });
  }
});

router.post("/discord/webhook", requireAuth, async (req: Request, res: Response) => {
  const userId = req.userId!;
  const parsed = webhookSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid request." });
    return;
  }
  const { webhook_url, channel_name, mention_everyone } = parsed.data;
  if (!isValidWebhookUrl(webhook_url)) {
    res.status(400).json({
      error:
        "That doesn't look like a Discord webhook URL. In Discord: channel settings → Integrations → Webhooks → Copy Webhook URL.",
    });
    return;
  }
  if (!isSocialTokenKeyConfigured()) {
    res.status(503).json({
      error: "Secure storage isn't configured on the server yet (SOCIAL_TOKEN_KEY).",
    });
    return;
  }
  try {
    /* Never log the URL — encrypt immediately and only handle ciphertext. */
    const encrypted = encryptToken(webhook_url.trim());
    const existing = await getWebhook(userId);
    if (existing) {
      await db
        .update(discordWebhooksTable)
        .set({
          webhook_url_encrypted: encrypted,
          channel_name: channel_name ?? existing.channel_name,
          mention_everyone: mention_everyone ?? existing.mention_everyone,
          updated_at: new Date(),
        })
        .where(eq(discordWebhooksTable.user_id, userId));
    } else {
      await db.insert(discordWebhooksTable).values({
        user_id: userId,
        webhook_url_encrypted: encrypted,
        channel_name: channel_name ?? null,
        mention_everyone: mention_everyone ?? false,
      });
    }
    logger.info({ userId }, "[discord] webhook saved");
    res.json({ ok: true, configured: true });
  } catch (err) {
    logger.error({ err }, "[discord] webhook save failed");
    res.status(500).json({ error: "Could not save the webhook URL." });
  }
});

router.delete("/discord/webhook", requireAuth, async (req: Request, res: Response) => {
  const userId = req.userId!;
  try {
    await db.delete(discordWebhooksTable).where(eq(discordWebhooksTable.user_id, userId));
    logger.info({ userId }, "[discord] webhook removed");
    res.json({ ok: true, configured: false });
  } catch (err) {
    logger.error({ err }, "[discord] webhook delete failed");
    res.status(500).json({ error: "Could not remove the webhook." });
  }
});

/* ── Announce (free — pure integration, no AI compute) ─────────────── */

router.post("/discord/announce", requireAuth, async (req: Request, res: Response) => {
  const userId = req.userId!;
  const parsed = announceSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid request." });
    return;
  }
  const input = parsed.data;
  try {
    const row = await getWebhook(userId);
    if (!row) {
      res.status(400).json({
        error: "No Discord webhook configured. Add one in Settings first.",
      });
      return;
    }
    let webhookUrl: string;
    try {
      webhookUrl = decryptToken(row.webhook_url_encrypted);
    } catch {
      res.status(500).json({ error: "Could not read the stored webhook (encryption key mismatch)." });
      return;
    }
    /* Belt-and-braces: only ever POST to a real Discord webhook URL. */
    if (!isValidWebhookUrl(webhookUrl)) {
      logger.warn({ userId }, "[discord] stored webhook failed validation");
      res.status(500).json({ error: "The stored webhook URL is invalid. Please re-save it in Settings." });
      return;
    }

    const mention = input.mention_everyone ?? row.mention_everyone;
    const payload = {
      content: mention ? "@everyone" : undefined,
      embeds: [buildEmbed(input)],
    };

    const resp = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      logger.warn({ userId, status: resp.status }, "[discord] webhook post failed");
      res.status(502).json({
        error:
          resp.status === 404
            ? "Discord rejected the webhook (404) — it may have been deleted. Re-copy it from Discord and save again."
            : `Discord returned ${resp.status}. ${body.slice(0, 200)}`,
      });
      return;
    }

    /* Track stream lifecycle for the dashboard. */
    if (input.kind === "live") {
      await db.insert(discordStreamsTable).values({
        user_id: userId,
        title: input.title,
        game: input.game ?? null,
        status: "live",
        started_at: new Date(),
      });
    } else if (input.kind === "ended") {
      const live = await db
        .select()
        .from(discordStreamsTable)
        .where(and(eq(discordStreamsTable.user_id, userId), eq(discordStreamsTable.status, "live")))
        .orderBy(desc(discordStreamsTable.started_at))
        .limit(1);
      if (live[0]) {
        await db
          .update(discordStreamsTable)
          .set({ status: "ended", ended_at: new Date(), vod_url: input.vod_url ?? null, updated_at: new Date() })
          .where(eq(discordStreamsTable.id, live[0].id));
      } else {
        await db.insert(discordStreamsTable).values({
          user_id: userId,
          title: input.title,
          game: input.game ?? null,
          status: "ended",
          ended_at: new Date(),
          vod_url: input.vod_url ?? null,
        });
      }
    }

    logger.info({ userId, kind: input.kind }, "[discord] announcement posted");
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "[discord] announce failed");
    res.status(500).json({ error: "Could not post to Discord." });
  }
});

/* ── Scheduled / recent streams ────────────────────────────────────── */

router.get("/discord/streams", requireAuth, async (req: Request, res: Response) => {
  const userId = req.userId!;
  try {
    const rows = await db
      .select()
      .from(discordStreamsTable)
      .where(eq(discordStreamsTable.user_id, userId))
      .orderBy(desc(discordStreamsTable.created_at))
      .limit(20);
    res.json({
      streams: rows.map((r) => ({
        id: r.id,
        title: r.title,
        game: r.game,
        status: r.status,
        scheduled_for: r.scheduled_for,
        started_at: r.started_at,
        ended_at: r.ended_at,
        vod_url: r.vod_url,
      })),
    });
  } catch (err) {
    logger.error({ err }, "[discord] streams list failed");
    res.status(500).json({ error: "Could not load streams." });
  }
});

router.post("/discord/streams", requireAuth, async (req: Request, res: Response) => {
  const userId = req.userId!;
  const parsed = scheduleSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid request." });
    return;
  }
  try {
    const [row] = await db
      .insert(discordStreamsTable)
      .values({
        user_id: userId,
        title: parsed.data.title,
        game: parsed.data.game ?? null,
        status: "scheduled",
        scheduled_for: parsed.data.scheduled_for ? new Date(parsed.data.scheduled_for) : null,
      })
      .returning();
    res.json({ ok: true, stream: row });
  } catch (err) {
    logger.error({ err }, "[discord] schedule failed");
    res.status(500).json({ error: "Could not schedule the stream." });
  }
});

router.delete("/discord/streams/:id", requireAuth, async (req: Request, res: Response) => {
  const userId = req.userId!;
  const streamId = String(req.params["id"] ?? "");
  if (!streamId) {
    res.status(400).json({ error: "Missing stream id." });
    return;
  }
  try {
    const scope = and(
      eq(discordStreamsTable.id, streamId),
      eq(discordStreamsTable.user_id, userId),
    );
    await db.delete(discordStreamsTable).where(scope);
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "[discord] stream delete failed");
    res.status(500).json({ error: "Could not delete the stream." });
  }
});

export default router;
