import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { requireAuth } from "../middlewares/require-auth";
import { publicApiLimiter } from "../lib/rate-limit";
import { logger } from "../lib/logger";
import {
  drizzleProxyStore,
  ffmpegProxyGenerator,
  previewSourceFor,
  requestProxy,
  resolveExportSources,
  runProxyGeneration,
} from "../lib/proxy-editing";

const router = Router();

/* ─── Proxy editing (Stack-200 board item 184) ────────────────────────
   Docked inside the Visual Vibes editor (ProxyEditingCard) — no
   standalone surface.
   GET  /api/proxy-editing?project_id=  — prefs + this project's rows,
                                          each with its honest preview
                                          source (proxy vs original)
   POST /api/proxy-editing/request      — on-demand ONLY: creates +
                                          generates a proxy for a clip
                                          that is actually heavy; light
                                          clips are refused with the
                                          verdict (no row, no file)
   POST /api/proxy-editing/prefs        — per-account on/off (default on)
   POST /api/proxy-editing/relink-check — what export WOULD render:
                                          every known proxy URL swapped
                                          back to its original
   Export itself relinks inside the export kickoff — this endpoint is
   the editor's pre-flight honesty check, not the guarantee. */

router.get("/proxy-editing", requireAuth, publicApiLimiter, async (req: Request, res: Response) => {
  try {
    const projectId = typeof req.query["project_id"] === "string" ? req.query["project_id"] : null;
    const enabled = await drizzleProxyStore.getPrefsEnabled(req.userId!);
    const rows = await drizzleProxyStore.listByUser(req.userId!, projectId);
    res.json({
      enabled,
      proxies: rows.map((row) => ({ ...row, preview: previewSourceFor(row, row.original_url, enabled) })),
    });
  } catch (err) {
    logger.error({ err, userId: req.userId }, "[proxy-editing] list failed");
    res.status(500).json({ error: "Could not load proxies" });
  }
});

const requestSchema = z.object({
  original_url: z.string().url(),
  project_id: z.string().nullish(),
  width: z.number().int().positive().nullish(),
  height: z.number().int().positive().nullish(),
  bytes: z.number().nonnegative().nullish(),
  duration_sec: z.number().nonnegative().nullish(),
  codec: z.string().max(32).nullish(),
});

router.post("/proxy-editing/request", requireAuth, publicApiLimiter, async (req: Request, res: Response) => {
  const parsed = requestSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid request" }); return; }
  const d = parsed.data;
  try {
    const result = await requestProxy(drizzleProxyStore, req.userId!, {
      originalUrl: d.original_url, projectId: d.project_id ?? null,
      width: d.width ?? null, height: d.height ?? null, bytes: d.bytes ?? null,
      durationSec: d.duration_sec ?? null, codec: d.codec ?? null,
    });
    if (result.outcome === "disabled") {
      res.status(409).json({ error: "proxy_disabled", message: "Proxy editing is off for this account. Turn it on in the editor's Proxy panel first." });
      return;
    }
    if (result.outcome === "not_heavy") {
      res.json({ outcome: "not_heavy", is_heavy: false, reasons: result.verdict.reasons, message: "This clip is light enough to edit from the original — no proxy needed." });
      return;
    }
    // Queued rows generate in the background; the card polls GET.
    if (result.outcome === "queued") {
      void runProxyGeneration(drizzleProxyStore, req.userId!, result.row.id, ffmpegProxyGenerator)
        .catch((err) => logger.error({ err }, "[proxy-editing] generation crashed"));
    }
    res.json({ outcome: result.outcome, proxy: result.row });
  } catch (err) {
    logger.error({ err, userId: req.userId }, "[proxy-editing] request failed");
    res.status(500).json({ error: "Could not request a proxy" });
  }
});

router.post("/proxy-editing/prefs", requireAuth, publicApiLimiter, async (req: Request, res: Response) => {
  const parsed = z.object({ enabled: z.boolean() }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid request" }); return; }
  try {
    await drizzleProxyStore.setPrefsEnabled(req.userId!, parsed.data.enabled);
    res.json({ enabled: parsed.data.enabled });
  } catch (err) {
    logger.error({ err, userId: req.userId }, "[proxy-editing] prefs failed");
    res.status(500).json({ error: "Could not save proxy preference" });
  }
});

router.post("/proxy-editing/relink-check", requireAuth, publicApiLimiter, async (req: Request, res: Response) => {
  const parsed = z.object({ clip_urls: z.array(z.string()).max(500) }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid request" }); return; }
  try {
    const { urls, relinked } = await resolveExportSources(drizzleProxyStore, req.userId!, parsed.data.clip_urls);
    res.json({ export_urls: urls, relinked, renders_from_originals: true });
  } catch (err) {
    logger.error({ err, userId: req.userId }, "[proxy-editing] relink-check failed");
    res.status(500).json({ error: "Could not check export sources" });
  }
});

export default router;
