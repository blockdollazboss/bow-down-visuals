import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, discordBotConfigTable, discordLiveStateTable } from "@workspace/db";
import { requireAuth } from "../middlewares/require-auth";
import { requireAdmin } from "./admin";
import { logger } from "../lib/logger";

/* ── Discord Live Companion Bot — site-side API ──────────────────────────
   Pairs with the discord.js bot service in artifacts/discord-bot.

   The bot is a long-running process that watches the user's Discord server
   for Go Live (VOICE_STATE_UPDATE with self_stream) and reports transitions
   here. The site reads the live state to render the LIVE badge.

   Endpoints:
   GET    /discord-bot/live        → current live state (PUBLIC, cached by client)
   POST   /discord-bot/live        → bot reports a transition (bot-secret auth)
   GET    /discord-bot/config      → bot wiring config (admin)
   POST   /discord-bot/config      → save wiring config (admin)
   GET    /discord-bot/install-url → bot OAuth2 install URL (admin)

   Bot auth: the bot service sends header `x-bot-secret` matching the
   DISCORD_BOT_SHARED_SECRET env var. Fail closed: if the env var is unset,
   all bot writes are rejected. */

const router = Router();

function botSecretConfigured(): boolean {
  return (process.env["DISCORD_BOT_SHARED_SECRET"] ?? "").length >= 16;
}

function requireBotSecret(req: Request, res: Response): boolean {
  const expected = process.env["DISCORD_BOT_SHARED_SECRET"] ?? "";
  const provided = String(req.header("x-bot-secret") ?? "");
  if (!botSecretConfigured() || provided.length === 0 || provided !== expected) {
    res.status(401).json({ error: "Unauthorized" });
    return false;
  }
  return true;
}

/* The site has a single streamer: the site owner. Live state is keyed off
   the bot config row (created when the owner wires up the bot); GET is
   public so logged-out visitors see the badge. */
async function getStreamerUserId(): Promise<string | null> {
  const cfg = await db.select({ user_id: discordBotConfigTable.user_id }).from(discordBotConfigTable).limit(1);
  return cfg[0]?.user_id ?? null;
}

/* GET /discord-bot/live — public. The frontend polls this for the LIVE badge. */
router.get("/discord-bot/live", async (_req: Request, res: Response) => {
  try {
    const userId = await getStreamerUserId();
    if (!userId) {
      res.json({ is_live: false, configured: false });
      return;
    }
    const rows = await db
      .select()
      .from(discordLiveStateTable)
      .where(eq(discordLiveStateTable.user_id, userId))
      .limit(1);
    const state = rows[0];
    if (!state) {
      res.json({ is_live: false, configured: false });
      return;
    }
    // Stale guard: a stream "live" for > 12h with no heartbeat is dead.
    const stale =
      state.is_live &&
      state.updated_at &&
      Date.now() - new Date(state.updated_at).getTime() > 12 * 60 * 60 * 1000;
    res.json({
      is_live: stale ? false : state.is_live,
      configured: true,
      started_at: state.started_at,
      ended_at: state.ended_at,
      channel_name: state.channel_name,
      stream_title: state.stream_title,
    });
  } catch (err) {
    logger.error({ err }, "discord-bot live state read failed");
    res.status(500).json({ error: "Failed to read live state" });
  }
});

const liveUpdateSchema = z.object({
  is_live: z.boolean(),
  channel_id: z.string().max(64).optional(),
  channel_name: z.string().max(100).optional(),
  stream_title: z.string().max(200).optional(),
  streamer_discord_user_id: z.string().max(64).optional(),
  streamer_discord_username: z.string().max(100).optional(),
  announcement_message_id: z.string().max(64).optional(),
  thread_id: z.string().max(64).optional(),
});

/* POST /discord-bot/live — called by the bot service on every transition. */
router.post("/discord-bot/live", async (req: Request, res: Response) => {
  if (!requireBotSecret(req, res)) return;
  const parsed = liveUpdateSchema.safeParse(req.body);
  if (!parsed.success) {    res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
    return;
  }
  const body = parsed.data;
  try {
    // The bot is configured for exactly one streamer; resolve via config.
    const cfgRows = body.streamer_discord_user_id
      ? await db
          .select()
          .from(discordBotConfigTable)
          .where(eq(discordBotConfigTable.streamer_discord_user_id, body.streamer_discord_user_id))
          .limit(1)
      : await db.select().from(discordBotConfigTable).limit(1);
    const cfg = cfgRows[0];
    if (!cfg) {      res.status(404).json({ error: "No bot config found — configure /discord-bot first" });
      return;
    }
    const now = new Date();
    const existing = await db
      .select()
      .from(discordLiveStateTable)
      .where(eq(discordLiveStateTable.user_id, cfg.user_id))
      .limit(1);
    const patch = {
      is_live: body.is_live,
      channel_id: body.channel_id ?? existing[0]?.channel_id ?? null,
      channel_name: body.channel_name ?? existing[0]?.channel_name ?? null,
      stream_title: body.stream_title ?? existing[0]?.stream_title ?? null,
      announcement_message_id: body.announcement_message_id ?? existing[0]?.announcement_message_id ?? null,
      thread_id: body.thread_id ?? existing[0]?.thread_id ?? null,
      started_at: body.is_live ? existing[0]?.started_at ?? now : existing[0]?.started_at ?? null,
      ended_at: body.is_live ? null : now,
      updated_at: now,
    };
    if (body.is_live && (!existing[0] || !existing[0].is_live)) {
      patch.started_at = now; // fresh go-live resets the clock
    }
    if (existing[0]) {
      await db.update(discordLiveStateTable).set(patch).where(eq(discordLiveStateTable.id, existing[0].id));
    } else {
      await db.insert(discordLiveStateTable).values({ user_id: cfg.user_id, ...patch });
    }
    // Remember the streamer's Discord identity from the bot's sighting.
    if (body.streamer_discord_user_id || body.streamer_discord_username) {
      await db
        .update(discordBotConfigTable)
        .set({
          streamer_discord_user_id: body.streamer_discord_user_id ?? cfg.streamer_discord_user_id,
          streamer_discord_username: body.streamer_discord_username ?? cfg.streamer_discord_username,
          updated_at: now,
        })
        .where(eq(discordBotConfigTable.id, cfg.id));
    }
    res.json({ ok: true, is_live: body.is_live });
  } catch (err) {
    logger.error({ err }, "discord-bot live state write failed");
    res.status(500).json({ error: "Failed to write live state" });
  }
});

const configSchema = z.object({
  guild_id: z.string().max(64).optional(),
  announce_channel_id: z.string().max(64).optional(),
  announce_role_id: z.string().max(64).optional(),
  mention_everyone: z.boolean().optional(),
  streamer_discord_user_id: z.string().max(64).optional(),
  streamer_discord_username: z.string().max(100).optional(),
  enabled: z.boolean().optional(),
});

/* GET /discord-bot/config — admin: current wiring (no secrets). */
router.get("/discord-bot/config", requireAuth, requireAdmin, async (req: Request, res: Response) => {
  try {
    const userId = req.userId as string;
    const rows = await db
      .select()
      .from(discordBotConfigTable)
      .where(eq(discordBotConfigTable.user_id, userId))
      .limit(1);
    const clientId = process.env["DISCORD_CLIENT_ID"] ?? "";
    res.json({
      config: rows[0] ?? null,
      env: {
        client_id_set: clientId.length > 0,
        bot_token_set: (process.env["DISCORD_BOT_TOKEN"] ?? "").length > 0,
        shared_secret_set: botSecretConfigured(),
        guild_id_env: process.env["DISCORD_GUILD_ID"] ?? "",
        announce_channel_env: process.env["DISCORD_ANNOUNCE_CHANNEL_ID"] ?? "",
      },
    });
  } catch (err) {
    logger.error({ err }, "discord-bot config read failed");
    res.status(500).json({ error: "Failed to read bot config" });
  }
});

/* POST /discord-bot/config — admin: save wiring. */
router.post("/discord-bot/config", requireAuth, requireAdmin, async (req: Request, res: Response) => {
  const parsed = configSchema.safeParse(req.body);
  if (!parsed.success) {    res.status(400).json({ error: "Invalid config", details: parsed.error.flatten() });
    return;
  }
  try {
    const userId = req.userId as string;
    const existing = await db
      .select()
      .from(discordBotConfigTable)
      .where(eq(discordBotConfigTable.user_id, userId))
      .limit(1);
    const values = { user_id: userId, ...parsed.data, updated_at: new Date() };
    if (existing[0]) {
      await db.update(discordBotConfigTable).set(values).where(eq(discordBotConfigTable.id, existing[0].id));
    } else {
      await db.insert(discordBotConfigTable).values(values);
    }
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "discord-bot config write failed");
    res.status(500).json({ error: "Failed to save bot config" });
  }
});

/* GET /discord-bot/install-url — admin: one-click bot install link. */
router.get("/discord-bot/install-url", requireAuth, requireAdmin, (_req: Request, res: Response) => {
  const clientId = process.env["DISCORD_CLIENT_ID"] ?? "";
  if (!clientId) {    res.status(400).json({ error: "DISCORD_CLIENT_ID is not set on the server" });
    return;
  }
  // Scopes: bot + applications.commands (slash commands). Permissions:
  // Send Messages, Create Public Threads, Send Messages in Threads,
  // Manage Threads, Mention Everyone, Read Message History, View Channel.
  const permissions = "397284945728";
  const url =
    `https://discord.com/oauth2/authorize?client_id=${encodeURIComponent(clientId)}` +
    `&permissions=${permissions}&scope=${encodeURIComponent("bot applications.commands")}`;
  res.json({ install_url: url });
});

export default router;
