/**
 * catalog-import.ts — Back-Catalog Migration Assistant over REST (0200):
 *
 *   GET  /api/catalog-import                  state: connected accounts
 *                                             with honest capability
 *                                             verdicts + all import items
 *   POST /api/catalog-import/scan             { accountId } — list one of
 *                                             the caller's OWN connected
 *                                             accounts' catalogs; TikTok
 *                                             answers PROVIDER_BLOCKED
 *   POST /api/catalog-import/fetch            { itemIds[] } — bring the
 *                                             picked files home, per-item
 *                                             results (blocked items park
 *                                             with their reason, never
 *                                             scraped around)
 *   POST /api/catalog-import/uploads          register bulk uploads the
 *                                             browser already put in the
 *                                             caller's own R2 prefix
 *   POST /api/catalog-import/items/:id/fetch  one item
 *   POST /api/catalog-import/items/:id/rebuild
 *                                             the AI rebuild draft
 *   POST /api/catalog-import/items/:id/approve
 *                                             THE door onto the real
 *                                             rails (profile video /
 *                                             song library); optional
 *                                             creator edits ride along
 *   POST /api/catalog-import/approve          { itemIds[] } batch approve
 *   POST /api/catalog-import/items/:id/dismiss
 *
 * All rules live in lib/catalog-import; this file is the HTTP shape
 * only. Members-only throughout (requireAuth) — a catalog is personal.
 * The flow is free: no route here touches credits.
 */
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { requireAuth } from "../middlewares/require-auth";
import { publicApiLimiter } from "../lib/rate-limit";
import { logger } from "../lib/logger";
import {
  CatalogImportError,
  getCatalogState,
  scanAccount,
  fetchItem,
  fetchSelected,
  registerUploads,
  rebuildItem,
  approveItem,
  approveBatch,
  dismissItem,
} from "../lib/catalog-import";

const router = Router();

function handleError(res: Response, err: unknown, what: string): void {
  if (err instanceof CatalogImportError) {
    res.status(err.status).json({ error: err.message, code: err.code });
    return;
  }
  logger.error({ err }, `[catalog-import] ${what} failed`);
  res.status(500).json({ error: "The catalog move stumbled. Try again." });
}

const idParam = z.string().uuid();

function parseId(req: Request, res: Response): string | null {
  const parsed = idParam.safeParse(req.params.id);
  if (!parsed.success) {
    res.status(400).json({ error: "That item id doesn't look right.", code: "BAD_ID" });
    return null;
  }
  return parsed.data;
}

const accountScanSchema = z.object({ accountId: z.string().uuid() }).strict();
const itemIdsSchema = z.object({ itemIds: z.array(z.string().uuid()).min(1).max(100) }).strict();
const uploadsSchema = z
  .object({
    files: z
      .array(
        z
          .object({
            key: z.string().min(1).max(500),
            filename: z.string().min(1).max(300),
            kind: z.enum(["video", "audio"]),
            contentType: z.string().max(100).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(200),
  })
  .strict();
const approveSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().max(2000).optional(),
    tags: z.array(z.string().trim().min(1).max(40)).max(8).optional(),
    series: z
      .object({
        name: z.string().trim().min(1).max(120),
        season: z.number().int().min(0).max(99),
        episode: z.number().int().min(0).max(999),
      })
      .nullable()
      .optional(),
  })
  .strict();

router.get("/catalog-import", requireAuth, publicApiLimiter, async (req: Request, res: Response) => {
  try {
    res.json(await getCatalogState(req.userId!));
  } catch (err) {
    handleError(res, err, "state read");
  }
});

router.post("/catalog-import/scan", requireAuth, publicApiLimiter, async (req: Request, res: Response) => {
  const parsed = accountScanSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Pick one of your connected accounts to scan.", code: "BAD_ACCOUNT" });
    return;
  }
  try {
    res.json(await scanAccount(req.userId!, parsed.data.accountId));
  } catch (err) {
    handleError(res, err, "scan");
  }
});

router.post("/catalog-import/fetch", requireAuth, publicApiLimiter, async (req: Request, res: Response) => {
  const parsed = itemIdsSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Pick at least one item to bring home.", code: "BAD_ITEMS" });
    return;
  }
  try {
    res.json(await fetchSelected(req.userId!, parsed.data.itemIds));
  } catch (err) {
    handleError(res, err, "fetch batch");
  }
});

router.post("/catalog-import/uploads", requireAuth, publicApiLimiter, async (req: Request, res: Response) => {
  const parsed = uploadsSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Those uploads didn't pass the check.", code: "BAD_UPLOADS" });
    return;
  }
  try {
    const items = await registerUploads(req.userId!, parsed.data.files);
    res.json({ items });
  } catch (err) {
    handleError(res, err, "upload registration");
  }
});

router.post("/catalog-import/items/:id/fetch", requireAuth, publicApiLimiter, async (req: Request, res: Response) => {
  const id = parseId(req, res);
  if (!id) return;
  try {
    res.json({ item: await fetchItem(req.userId!, id) });
  } catch (err) {
    handleError(res, err, "fetch one");
  }
});

router.post("/catalog-import/items/:id/rebuild", requireAuth, publicApiLimiter, async (req: Request, res: Response) => {
  const id = parseId(req, res);
  if (!id) return;
  try {
    res.json({ item: await rebuildItem(req.userId!, id) });
  } catch (err) {
    handleError(res, err, "rebuild");
  }
});

router.post("/catalog-import/items/:id/approve", requireAuth, publicApiLimiter, async (req: Request, res: Response) => {
  const id = parseId(req, res);
  if (!id) return;
  const parsed = approveSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Those edits didn't pass the check.", code: "BAD_APPROVAL" });
    return;
  }
  try {
    res.json({ item: await approveItem(req.userId!, id, parsed.data) });
  } catch (err) {
    handleError(res, err, "approve");
  }
});

router.post("/catalog-import/approve", requireAuth, publicApiLimiter, async (req: Request, res: Response) => {
  const parsed = itemIdsSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Pick at least one item to approve.", code: "BAD_ITEMS" });
    return;
  }
  try {
    res.json(await approveBatch(req.userId!, parsed.data.itemIds));
  } catch (err) {
    handleError(res, err, "approve batch");
  }
});

router.post("/catalog-import/items/:id/dismiss", requireAuth, publicApiLimiter, async (req: Request, res: Response) => {
  const id = parseId(req, res);
  if (!id) return;
  try {
    res.json({ item: await dismissItem(req.userId!, id) });
  } catch (err) {
    handleError(res, err, "dismiss");
  }
});

export default router;
