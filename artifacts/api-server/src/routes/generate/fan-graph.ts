/**
 * One Fan Graph — GET /api/email-list/fan-graph (Stack-100 #3, #11).
 *
 * The unified fan view, docked in the audience desk (the email-list
 * area, PROMOTE). Read-only: one merged record per fan across the
 * creator's followers, email subscribers, fan-club members, and
 * buyers (store / digital / shop / live sales / stage tips).
 *
 * Privacy: the graph is built ONLY from the signed-in creator's own
 * rows — see loadFanGraph in lib/fan-graph, where every query is
 * scoped by the caller's profile ids, list ids, or user id. There is
 * no creator-id parameter to abuse: the fan graph you see is always
 * your own.
 */
import { Router, type IRouter } from "express";
import { z } from "zod";
import { requireAuth } from "../../middlewares/require-auth";
import { publicApiLimiter } from "../../lib/rate-limit";
import { FAN_GRAPH_SORTS, loadFanGraph, queryFanGraph } from "../../lib/fan-graph";

const router: IRouter = Router();

const querySchema = z.object({
  search: z.string().trim().max(120).optional(),
  sort: z.enum(FAN_GRAPH_SORTS).optional(),
  page: z.coerce.number().int().min(1).max(10_000).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
});

router.get("/email-list/fan-graph", publicApiLimiter, requireAuth, async (req, res) => {
  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid fan graph query." });
    return;
  }
  try {
    const { fans, summary } = await loadFanGraph(req.userId!);
    const page = queryFanGraph(fans, parsed.data);
    res.json({ ...page, summary });
  } catch (err) {
    req.log?.error({ err }, "fan graph load failed");
    res.status(500).json({ error: "Couldn't load your fan graph." });
  }
});

export default router;
