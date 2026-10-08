import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middlewares/require-auth";
import {
  chargeCredits,
  refundCredits,
  OutOfCreditsError,
  LedgerWriteError,
} from "../lib/credits";
import { logger } from "../lib/logger";

const router = Router();

/* ─── Pricing ─────────────────────────────────────────────────────────────
   Browsing/searching stock is free (cheap provider calls). Importing a
   stock file into a project costs 50 Visual Bucs. Env-overridable. */
export const STOCK_IMPORT_CREDIT_COST =
  Number(process.env["STOCK_IMPORT_CREDIT_COST"]) || 50;

const PEXELS_API_KEY = () => process.env["PEXELS_API_KEY"]?.trim() || "";

/* ─── Provider abstraction ────────────────────────────────────────────────
   StockProvider normalizes any stock source (Pexels today, others later)
   into one item shape the editor consumes. */

export type StockMediaType = "video" | "photo";

export interface StockSearchParams {
  q: string;
  type: StockMediaType;
  page: number;
  perPage: number;
}

export interface StockItem {
  id: string;
  type: StockMediaType;
  title: string;
  /** Thumbnail / poster image. */
  previewUrl: string;
  /** Direct file URL (MP4 for video, full-size image for photo). */
  fileUrl: string;
  /** Best URL for "Download" (highest-res available). */
  downloadUrl: string;
  width: number;
  height: number;
  durationSec?: number;
  photographer: string;
  photographerUrl: string;
  sourceUrl: string;
}

export interface StockSearchResult {
  items: StockItem[];
  totalResults: number;
  page: number;
  perPage: number;
  provider: string;
}

export interface StockProvider {
  readonly name: string;
  search(params: StockSearchParams): Promise<StockSearchResult>;
}

/* ─── Pexels provider ─────────────────────────────────────────────────────
   Docs: https://www.pexels.com/api/documentation/
   Video search: GET https://api.pexels.com/videos/search
   Photo search:  GET https://api.pexels.com/v1/search
   Auth: Authorization header with the API key. */

interface PexelsVideoFile {
  id: number;
  quality: string;
  file_type: string;
  width: number;
  height: number;
  link: string;
}

interface PexelsVideo {
  id: number;
  width: number;
  height: number;
  duration: number;
  image: string;
  url: string;
  user: { name: string; url: string };
  video_files: PexelsVideoFile[];
}

interface PexelsPhoto {
  id: number;
  width: number;
  height: number;
  alt: string;
  photographer: string;
  photographer_url: string;
  url: string;
  src: {
    original: string;
    large: string;
    medium: string;
    small: string;
  };
}

const PEXELS_BASE = "https://api.pexels.com";
const PEXELS_TIMEOUT_MS = 15000;

/** Pick the direct MP4 file for a video: prefer HD, then SD, then anything. */
export function pickPexelsVideoFile(
  files: PexelsVideoFile[],
): PexelsVideoFile | null {
  const mp4 = files.filter((f) => f.file_type === "video/mp4" && f.link);
  if (mp4.length === 0) return null;
  return (
    mp4.find((f) => f.quality === "hd") ??
    mp4.find((f) => f.quality === "sd") ??
    mp4[0] ??
    null
  );
}

export function normalizePexelsVideo(v: PexelsVideo): StockItem | null {
  const file = pickPexelsVideoFile(v.video_files ?? []);
  if (!file || !v.image) return null;
  const photographer = v.user?.name?.trim() || "Pexels";
  return {
    id: `pexels-video-${v.id}`,
    type: "video",
    title: `Stock video ${v.id}`,
    previewUrl: v.image,
    fileUrl: file.link,
    downloadUrl: file.link,
    width: v.width,
    height: v.height,
    durationSec: v.duration,
    photographer,
    photographerUrl: v.user?.url ?? "https://www.pexels.com",
    sourceUrl: v.url ?? "https://www.pexels.com",
  };
}

export function normalizePexelsPhoto(p: PexelsPhoto): StockItem | null {
  if (!p.src?.medium) return null;
  const photographer = p.photographer?.trim() || "Pexels";
  return {
    id: `pexels-photo-${p.id}`,
    type: "photo",
    title: p.alt?.trim() || `Stock photo ${p.id}`,
    previewUrl: p.src.medium,
    fileUrl: p.src.large || p.src.original,
    downloadUrl: p.src.original,
    width: p.width,
    height: p.height,
    photographer,
    photographerUrl: p.photographer_url ?? "https://www.pexels.com",
    sourceUrl: p.url ?? "https://www.pexels.com",
  };
}

async function pexelsFetch(
  path: string,
  params: Record<string, string | number>,
): Promise<unknown> {
  const apiKey = PEXELS_API_KEY();
  if (!apiKey) {
    const err = new Error("PEXELS_API_KEY is not configured") as Error & {
      code?: string;
    };
    err.code = "stock_not_configured";
    throw err;
  }
  const qs = new URLSearchParams(
    Object.entries(params).map(([k, v]) => [k, String(v)]),
  );
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PEXELS_TIMEOUT_MS);
  try {
    const res = await fetch(`${PEXELS_BASE}${path}?${qs.toString()}`, {
      headers: { Authorization: apiKey },
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `Pexels API error ${res.status}${body ? `: ${body.slice(0, 200)}` : ""}`,
      );
    }
    return (await res.json()) as unknown;
  } finally {
    clearTimeout(timer);
  }
}

class PexelsProvider implements StockProvider {
  readonly name = "pexels";

  async search(params: StockSearchParams): Promise<StockSearchResult> {
    if (params.type === "video") {
      const data = (await pexelsFetch("/videos/search", {
        query: params.q,
        per_page: params.perPage,
        page: params.page,
      })) as {
        videos?: PexelsVideo[];
        total_results?: number;
        page?: number;
        per_page?: number;
      };
      const items = (data.videos ?? [])
        .map(normalizePexelsVideo)
        .filter((i): i is StockItem => i !== null);
      return {
        items,
        totalResults: data.total_results ?? 0,
        page: data.page ?? params.page,
        perPage: data.per_page ?? params.perPage,
        provider: this.name,
      };
    }
    const data = (await pexelsFetch("/v1/search", {
      query: params.q,
      per_page: params.perPage,
      page: params.page,
    })) as {
      photos?: PexelsPhoto[];
      total_results?: number;
      page?: number;
      per_page?: number;
    };
    const items = (data.photos ?? [])
      .map(normalizePexelsPhoto)
      .filter((i): i is StockItem => i !== null);
    return {
      items,
      totalResults: data.total_results ?? 0,
      page: data.page ?? params.page,
      perPage: data.per_page ?? params.perPage,
      provider: this.name,
    };
  }
}

function getProvider(): StockProvider {
  return new PexelsProvider();
}

function isStockNotConfigured(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err as Error & { code?: string }).code === "stock_not_configured"
  );
}

/* Only URLs the server itself returned from a stock search may be imported —
   the import charge must never become a generic paid hotlink pipe. */
function isProviderFileUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return (
      host === "images.pexels.com" ||
      host === "videos.pexels.com" ||
      host.endsWith(".pexels.com")
    );
  } catch {
    return false;
  }
}

/* ─── Routes ────────────────────────────────────────────────────────────── */

const searchQuerySchema = z.object({
  q: z.string().trim().min(1).max(200),
  type: z.enum(["video", "photo"]).default("video"),
  page: z.coerce.number().int().min(1).max(50).default(1),
  per_page: z.coerce.number().int().min(1).max(30).default(12),
});

/**
 * GET /stock/search?q=&type=video|photo&page=&per_page=
 *
 * Free to browse — no credits charged. Authenticated so anonymous traffic
 * can't burn the provider quota. Fails cleanly (503) when no provider key
 * is configured.
 */
router.get("/stock/search", requireAuth, async (req, res) => {
  const parsed = searchQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Add a search term (q) to search stock media." });
    return;
  }
  const { q, type, page, per_page } = parsed.data;
  try {
    const result = await getProvider().search({
      q,
      type,
      page,
      perPage: per_page,
    });
    res.json({ ...result, configured: true });
  } catch (err) {
    if (isStockNotConfigured(err)) {
      res.status(503).json({
        error: "stock_not_configured",
        message:
          "Stock media isn't connected — set the PEXELS_API_KEY environment variable on the server.",
      });
      return;
    }
    logger.error({ err, q, type }, "[stock] search failed");
    res.status(502).json({ error: "Stock search failed. Please try again." });
  }
});

const importBodySchema = z.object({
  itemId: z.string().trim().min(1).max(120),
  type: z.enum(["video", "photo"]),
  title: z.string().trim().max(300).default(""),
  previewUrl: z.string().url().max(2048),
  fileUrl: z.string().url().max(2048),
  photographer: z.string().trim().max(200).default(""),
  photographerUrl: z.string().url().max(2048).optional().default(""),
  width: z.number().int().positive().max(16384).optional(),
  height: z.number().int().positive().max(16384).optional(),
  durationSec: z.number().positive().max(3600).optional(),
  projectId: z.string().trim().max(120).optional(),
});

/**
 * POST /stock/import
 *
 * Charges 50 Visual Bucs and hands the stock file URL back for the editor
 * to drop into the timeline. The client also writes the asset into the hub
 * project so captions/templates/export treat it like any other clip.
 * Auto-refunds if the import can't be completed after the charge.
 */
router.post("/stock/import", requireAuth, async (req, res) => {
  const parsed = importBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid stock item." });
    return;
  }
  const body = parsed.data;

  // 402 pre-check + charge happen atomically inside chargeCredits.
  let creditsRemaining: number;
  try {
    creditsRemaining = await chargeCredits(req.userId!, STOCK_IMPORT_CREDIT_COST, {
      action: "Stock Media Import",
      projectId: body.projectId ?? null,
    });
  } catch (chargeErr) {
    if (chargeErr instanceof OutOfCreditsError) {
      res.status(402).json({
        error: "out_of_credits",
        message: `Importing stock media costs ${STOCK_IMPORT_CREDIT_COST.toLocaleString("en-US")} Visual Bucs — top up to import.`,
        required: STOCK_IMPORT_CREDIT_COST,
      });
      return;
    }
    if (chargeErr instanceof LedgerWriteError) {
      res.status(500).json({ error: "Credit ledger write failed — no credits were taken." });
      return;
    }
    throw chargeErr;
  }

  try {
    // Refuse to complete the import for anything the provider didn't hand us.
    if (!isProviderFileUrl(body.fileUrl)) {
      throw new Error("file_url_not_from_stock_provider");
    }
    res.json({
      success: true,
      item: {
        id: body.itemId,
        type: body.type,
        title: body.title || body.itemId,
        fileUrl: body.fileUrl,
        previewUrl: body.previewUrl,
        width: body.width ?? null,
        height: body.height ?? null,
        durationSec: body.durationSec ?? null,
        photographer: body.photographer || "Pexels",
        photographerUrl: body.photographerUrl || "https://www.pexels.com",
      },
      creditsRemaining,
    });
  } catch (importErr) {
    // Import failed after the charge — refund so the user never pays for nothing.
    try {
      await refundCredits(req.userId!, STOCK_IMPORT_CREDIT_COST, {
        action: "Stock Media Import — refund (import failed)",
        projectId: body.projectId ?? null,
      });
    } catch (refundErr) {
      logger.error({ refundErr }, "[stock] import failed AND refund failed — needs manual reconciliation");
    }
    logger.error({ err: importErr }, "[stock] import failed after charge — refunded");
    res.status(500).json({ error: "Could not import that stock file. Your credits were refunded." });
  }
});

export default router;
