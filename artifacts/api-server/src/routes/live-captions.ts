import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, liveStreamsTable, type LiveStream } from "@workspace/db";
import { requireAuth } from "../middlewares/require-auth";
import { publicApiLimiter } from "../lib/rate-limit";
import { logger } from "../lib/logger";
import { RoomHub, verifyAccessToken, type LiveWsGateway, type WsClientSocket } from "../lib/live-ws";
import { isTicketed, canEnterStream, ticketDoorInfo, countActiveTickets } from "../lib/live-tickets";
import { getOpenAI, getTextModel } from "../lib/ai-clients";
import { effectiveStatus } from "./live-chat";
import {
  TARGET_LANGUAGES,
  LIVE_CAPTIONS_PRICING,
  LIVE_CAPTION_SOURCE_DEFAULT,
  liveCaptionStore,
  isSupportedSourceLanguage,
  isSupportedViewerLanguage,
  viewerLanguageLabel,
  languageLabel,
  MAX_CAPTION_CHARS,
  type CaptionTranslator,
  type LiveCaptionSegment,
  type TranslatedCaption,
} from "../lib/live-captions";

/* ── Live Captions, Every Language (Stack-200 #160) ────────────────────
   Real-time captions for LIVE streams, translated per viewer on the
   translator rail. Docked inside Go Live — these routes hang off the
   existing /live/:id surfaces next to chat, and the studio panel +
   watch-page overlay are the only UI. No standalone page.

   GET    /live-captions/languages        (public) rail languages + pricing state
   GET    /live/:id/captions/settings     (public) is the caption track on? + source language
   POST   /live/:id/captions/settings     (auth, owner) streamer opens/closes the track
   POST   /live/:id/captions/segments     (auth, owner) one spoken line in (the caption source)
   GET    /live/:id/captions?lang=&after= (public*) captions in THIS viewer's language
   WS     /live/:id/captions/ws?lang=&token=  per-viewer live delivery (poll is the fallback)

   * Ticketed streams: captions are part of the show — reads and the
   socket consult the same door as chat (canEnterStream). Free
   streams: guests may read/watch captions (the watch page is public).

   Smart law: captions exist only where the streamer opened the
   track, and reach only viewers who turned them on and picked a
   language — the socket a viewer opens names exactly one language,
   and a segment is translated only into languages with a viewer
   actually waiting for them (plus on-demand poll reads, cached).

   PRICING: gated OFF (see lib/live-captions) — nothing here charges.
   ──────────────────────────────────────────────────────────────────── */

const router = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SEGMENT_MIN_INTERVAL_MS = 400;
const BACKFILL_COUNT = 10;

/** Sockets subscribed to one (stream, language) caption room. */
export const liveCaptionsHub = new RoomHub();

export function captionRoom(streamId: string, language: string): string {
  return `captions:${streamId}:${language}`;
}

/* Which languages currently have a socket viewer, per stream — the
   fan-out translates ONLY into these (nobody waiting, no spend). */
const wsViewerLanguages = new Map<string, Map<string, number>>();

function noteWsViewer(streamId: string, language: string, delta: 1 | -1): void {
  let byLang = wsViewerLanguages.get(streamId);
  if (!byLang) {
    byLang = new Map();
    wsViewerLanguages.set(streamId, byLang);
  }
  const next = (byLang.get(language) ?? 0) + delta;
  if (next <= 0) byLang.delete(language);
  else byLang.set(language, next);
  if (byLang.size === 0) wsViewerLanguages.delete(streamId);
}

export function __resetCaptionViewerTracking(): void {
  wsViewerLanguages.clear();
}

/* ── The rail translator (production) ──────────────────────────────────
   The same model path the file translator uses (getOpenAI +
   getTextModel), prompted for ONE spoken line: keep it short,
   natural, caption-shaped. Tests inject a fake instead. */
export const railCaptionTranslator: CaptionTranslator = async (text, targetCode) => {
  const completion = await getOpenAI().chat.completions.create(
    {
      model: getTextModel(),
      max_completion_tokens: 200,
      messages: [
        {
          role: "system",
          content:
            "You translate live stream captions. Output ONLY the translated caption line — " +
            "short, natural, spoken. No quotes, no notes, no original text.",
        },
        { role: "user", content: `Translate into ${languageLabel(targetCode)}: ${text}` },
      ],
    },
    { signal: AbortSignal.timeout(15_000) },
  );
  return completion.choices[0]?.message?.content ?? "";
};

let activeTranslator: CaptionTranslator = railCaptionTranslator;
/** Test hook: swap the translator the routes serve with. */
export function __setCaptionTranslator(t: CaptionTranslator | null): void {
  activeTranslator = t ?? railCaptionTranslator;
}

/* ── Fan-out ───────────────────────────────────────────────────────────
   A stored segment is delivered to the source-language room as-is,
   and translated once per language that has a socket viewer waiting
   (the store caches it, so poll readers in that language reuse the
   same translation). Returns the languages delivered live. */
export async function publishCaptionSegment(
  seg: LiveCaptionSegment,
  translator: CaptionTranslator = activeTranslator,
): Promise<string[]> {
  const delivered: string[] = [];
  const original: TranslatedCaption = {
    seq: seg.seq,
    streamId: seg.streamId,
    text: seg.text,
    language: seg.sourceLanguage,
    sourceLanguage: seg.sourceLanguage,
    startMs: seg.startMs,
    endMs: seg.endMs,
    createdAt: seg.createdAt,
  };
  if (liveCaptionsHub.broadcast(captionRoom(seg.streamId, seg.sourceLanguage), { type: "caption", caption: original }) > 0) {
    delivered.push(seg.sourceLanguage);
  }
  const waiting = [...(wsViewerLanguages.get(seg.streamId)?.keys() ?? [])].filter(
    (lang) => lang !== seg.sourceLanguage,
  );
  await Promise.all(
    waiting.map(async (lang) => {
      const caption = await liveCaptionStore.translateSegment(seg, lang, translator);
      if (liveCaptionsHub.broadcast(captionRoom(seg.streamId, lang), { type: "caption", caption }) > 0) {
        delivered.push(lang);
      }
    }),
  );
  return delivered;
}

/* ── Helpers ─────────────────────────────────────────────────────────── */

function param(req: Request, name: string): string {
  const v = req.params[name];
  return Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
}

async function getStreamRow(id: string): Promise<LiveStream | null> {
  if (!UUID_RE.test(id)) return null;
  const rows = await db.select().from(liveStreamsTable).where(eq(liveStreamsTable.id, id)).limit(1);
  return rows[0] ?? null;
}

async function optionalViewerId(req: Request): Promise<string | null> {
  const header = req.headers["authorization"];
  if (!header?.startsWith("Bearer ")) return null;
  const verified = await verifyAccessToken(header.slice(7)).catch(() => null);
  return verified?.userId ?? null;
}

async function ticketRequiredBody(stream: LiveStream) {
  return {
    error: "This show is ticketed — your ticket opens the captions.",
    code: "TICKET_REQUIRED",
    ticket: ticketDoorInfo(stream, await countActiveTickets(stream.id)),
  };
}

/** Gate a caption READ behind the ticket door when the stream sells
 *  entry. Returns true when the read may proceed. */
async function mayReadCaptions(req: Request, res: Response, stream: LiveStream): Promise<boolean> {
  if (!isTicketed(stream)) return true;
  const viewerId = await optionalViewerId(req);
  if (await canEnterStream(stream, viewerId)) return true;
  res.status(402).json(await ticketRequiredBody(stream));
  return false;
}

function settingsBody(stream: LiveStream) {
  const settings = liveCaptionStore.getSettings(stream.id);
  return {
    streamId: stream.id,
    streamStatus: effectiveStatus(stream),
    captions: settings,
    languages: [
      { code: LIVE_CAPTION_SOURCE_DEFAULT, label: viewerLanguageLabel(LIVE_CAPTION_SOURCE_DEFAULT) },
      ...TARGET_LANGUAGES,
    ],
    pricing: LIVE_CAPTIONS_PRICING,
  };
}

/* ── Routes ──────────────────────────────────────────────────────────── */

router.get("/live-captions/languages", (_req: Request, res: Response) => {
  res.json({
    /** Viewer picks: English (original) + the translator rail's list,
     *  verbatim — if the rail doesn't support it, it isn't offered. */
    languages: [
      { code: LIVE_CAPTION_SOURCE_DEFAULT, label: viewerLanguageLabel(LIVE_CAPTION_SOURCE_DEFAULT) },
      ...TARGET_LANGUAGES,
    ],
    sourceLanguages: [
      { code: LIVE_CAPTION_SOURCE_DEFAULT, label: "English" },
      ...TARGET_LANGUAGES,
    ],
    pricing: LIVE_CAPTIONS_PRICING,
  });
});

router.get("/live/:id/captions/settings", publicApiLimiter, async (req: Request, res: Response) => {
  try {
    const stream = await getStreamRow(param(req, "id"));
    if (!stream) {
      res.status(404).json({ error: "That stream doesn't exist." });
      return;
    }
    res.json(settingsBody(stream));
  } catch (err) {
    logger.error({ err }, "live captions settings read failed");
    res.status(500).json({ error: "Caption settings couldn't load. Try again in a moment." });
  }
});

const settingsSchema = z.object({
  enabled: z.boolean().optional(),
  source_language: z.string().min(2).max(10).optional(),
});

router.post("/live/:id/captions/settings", requireAuth, async (req: Request, res: Response) => {
  try {
    const stream = await getStreamRow(param(req, "id"));
    if (!stream) {
      res.status(404).json({ error: "That stream doesn't exist." });
      return;
    }
    if (stream.user_id !== req.userId) {
      res.status(403).json({ error: "Only the streamer controls this stream's captions." });
      return;
    }
    const parsed = settingsSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "That caption setting isn't valid." });
      return;
    }
    if (parsed.data.source_language && !isSupportedSourceLanguage(parsed.data.source_language)) {
      res.status(400).json({
        error: `Captions can't start from ${parsed.data.source_language} — the translator doesn't support it.`,
        code: "UNSUPPORTED_LANGUAGE",
      });
      return;
    }
    liveCaptionStore.setSettings(stream.id, {
      enabled: parsed.data.enabled,
      sourceLanguage: parsed.data.source_language,
    });
    res.json(settingsBody(stream));
  } catch (err) {
    logger.error({ err }, "live captions settings write failed");
    res.status(500).json({ error: "Caption settings couldn't save. Try again in a moment." });
  }
});

/* Per-stream segment pacing (a caption source gone rogue must not
   flood translation): one line per SEGMENT_MIN_INTERVAL_MS. */
const lastSegmentAt = new Map<string, number>();
export function __resetCaptionPacing(): void {
  lastSegmentAt.clear();
}

const segmentSchema = z.object({
  text: z.string().trim().min(1).max(MAX_CAPTION_CHARS),
  start_ms: z.number().int().min(0).max(12 * 60 * 60 * 1000).optional(),
  end_ms: z.number().int().min(0).max(12 * 60 * 60 * 1000).optional(),
});

router.post("/live/:id/captions/segments", requireAuth, async (req: Request, res: Response) => {
  try {
    const stream = await getStreamRow(param(req, "id"));
    if (!stream) {
      res.status(404).json({ error: "That stream doesn't exist." });
      return;
    }
    if (stream.user_id !== req.userId) {
      res.status(403).json({ error: "Only the streamer sends captions for this stream." });
      return;
    }
    if (effectiveStatus(stream) !== "live") {
      res.status(409).json({ error: "Captions only run while the stream is live.", code: "STREAM_NOT_LIVE" });
      return;
    }
    const settings = liveCaptionStore.getSettings(stream.id);
    if (!settings.enabled) {
      res.status(409).json({
        error: "Live captions are off for this stream — turn them on first.",
        code: "CAPTIONS_OFF",
      });
      return;
    }
    const parsed = segmentSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: `Caption lines run 1–${MAX_CAPTION_CHARS} characters.`, code: "BAD_SEGMENT" });
      return;
    }
    const now = Date.now();
    const last = lastSegmentAt.get(stream.id) ?? 0;
    if (now - last < SEGMENT_MIN_INTERVAL_MS) {
      res.status(429).json({
        error: "Captions are arriving too fast — slow down a touch.",
        code: "RATE_LIMITED",
        retryAfterMs: SEGMENT_MIN_INTERVAL_MS - (now - last),
      });
      return;
    }
    const seg = liveCaptionStore.addSegment(stream.id, {
      text: parsed.data.text,
      startMs: parsed.data.start_ms ?? null,
      endMs: parsed.data.end_ms ?? null,
    }, now);
    if (!seg) {
      res.status(409).json({ error: "Live captions are off for this stream.", code: "CAPTIONS_OFF" });
      return;
    }
    lastSegmentAt.set(stream.id, now);
    // Deliver live to every waiting viewer's language room.
    void publishCaptionSegment(seg).catch((err) =>
      logger.error({ err }, "live captions fan-out failed"),
    );
    res.status(201).json({
      segment: {
        seq: seg.seq,
        text: seg.text,
        sourceLanguage: seg.sourceLanguage,
        startMs: seg.startMs,
        endMs: seg.endMs,
      },
    });
  } catch (err) {
    logger.error({ err }, "live captions segment post failed");
    res.status(500).json({ error: "That caption line didn't go through. Try again." });
  }
});

router.get("/live/:id/captions", publicApiLimiter, async (req: Request, res: Response) => {
  try {
    const stream = await getStreamRow(param(req, "id"));
    if (!stream) {
      res.status(404).json({ error: "That stream doesn't exist." });
      return;
    }
    if (!(await mayReadCaptions(req, res, stream))) return;
    const language = typeof req.query.lang === "string" ? req.query.lang : LIVE_CAPTION_SOURCE_DEFAULT;
    if (!isSupportedViewerLanguage(language)) {
      res.status(400).json({
        error: `Captions aren't available in ${language} — the translator doesn't support it.`,
        code: "UNSUPPORTED_LANGUAGE",
        languages: [
          { code: LIVE_CAPTION_SOURCE_DEFAULT, label: viewerLanguageLabel(LIVE_CAPTION_SOURCE_DEFAULT) },
          ...TARGET_LANGUAGES,
        ],
      });
      return;
    }
    const afterRaw = typeof req.query.after === "string" ? Number(req.query.after) : 0;
    const after = Number.isFinite(afterRaw) && afterRaw > 0 ? Math.floor(afterRaw) : 0;
    const captions = await liveCaptionStore.captionsFor(stream.id, language, after, activeTranslator);
    res.json({
      streamId: stream.id,
      streamStatus: effectiveStatus(stream),
      captionsEnabled: liveCaptionStore.getSettings(stream.id).enabled,
      language,
      captions,
      latestSeq: liveCaptionStore.latestSeq(stream.id),
    });
  } catch (err) {
    logger.error({ err }, "live captions read failed");
    res.status(500).json({ error: "Captions couldn't load. Try again in a moment." });
  }
});

/* ── WebSocket ─────────────────────────────────────────────────────────
   Per-viewer delivery: the socket names ONE language (?lang=) and
   joins only that room, so a viewer receives exactly their language
   and nothing else. Guests may join a FREE stream's captions (the
   watch page is public); a ticketed stream requires a session token
   whose holder may enter — same door as chat. Writes never travel
   the socket: segments arrive by POST, one validated write path. */
export function registerLiveCaptionsWs(
  gateway: LiveWsGateway,
  deps: { verifyToken?: typeof verifyAccessToken; translator?: CaptionTranslator } = {},
): void {
  const verifyToken = deps.verifyToken ?? verifyAccessToken;
  const translator = deps.translator ?? (() => activeTranslator);
  gateway.register("/api/live/:id/captions/ws", async ({ socket, params, query }) => {
    const language = query.get("lang") ?? LIVE_CAPTION_SOURCE_DEFAULT;
    if (!isSupportedViewerLanguage(language)) {
      socket.close(4400, "That caption language isn't supported");
      return;
    }
    const stream = await getStreamRow(params.id);
    if (!stream) {
      socket.close(4404, "That stream doesn't exist");
      return;
    }
    if (isTicketed(stream)) {
      const token = query.get("token") ?? "";
      const auth = token ? await verifyToken(token) : null;
      if (!auth) {
        socket.close(4401, "Sign in to watch this show's captions");
        return;
      }
      if (!(await canEnterStream(stream, auth.userId))) {
        socket.close(4403, "This show is ticketed — your ticket opens the captions");
        return;
      }
    }
    const client = socket as unknown as WsClientSocket;
    const room = captionRoom(stream.id, language);
    liveCaptionsHub.join(room, client);
    noteWsViewer(stream.id, language, 1);
    socket.on("close", () => {
      liveCaptionsHub.leave(room, client);
      noteWsViewer(stream.id, language, -1);
    });
    socket.send(
      JSON.stringify({
        type: "hello",
        streamId: stream.id,
        streamStatus: effectiveStatus(stream),
        language,
        captionsEnabled: liveCaptionStore.getSettings(stream.id).enabled,
      }),
    );
    // Backfill the last few lines so a viewer who turns captions on
    // mid-sentence isn't staring at a blank bar until the next line.
    const settings = liveCaptionStore.getSettings(stream.id);
    if (settings.enabled) {
      const latest = liveCaptionStore.latestSeq(stream.id);
      const backfill = await liveCaptionStore.captionsFor(
        stream.id,
        language,
        Math.max(0, latest - BACKFILL_COUNT),
        translator(),
        BACKFILL_COUNT,
      );
      if (backfill.length > 0) {
        socket.send(JSON.stringify({ type: "backfill", captions: backfill }));
      }
    }
  });
}

export default router;
