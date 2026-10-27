import { Router, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import { db, liveStreamsTable, type StreamHighlightProposal } from "@workspace/db";
import { requireAuth } from "../middlewares/require-auth";
import { publicApiLimiter } from "../lib/rate-limit";
import { logger } from "../lib/logger";
import {
  ProposalError,
  decideHighlightProposal,
  drizzleAutoHighlightsStore,
  refreshHighlightProposal,
  streamerClipsCutRail,
} from "../lib/auto-highlights";

const router = Router();

/* ─── Auto-Highlights proposals (UPGRADE delta #172) ────────────────────
   GET  /api/live-streams/:id/highlights                 (auth, owner)
   POST /api/live-streams/:id/highlights/:pid/approve    (auth, owner)
   POST /api/live-streams/:id/highlights/:pid/dismiss    (auth, owner)
   POST /api/live-streams/:id/highlights/:pid/refresh    (auth, owner)

   The proposals on a stream are the creator's drafts — owner-only on
   every verb. Approving starts the cut on the Streamer Clips rail at
   that rail's per-clip price; nothing here ever publishes on its
   own. */

function proposalDto(p: StreamHighlightProposal) {
  return {
    id: p.id,
    stream_id: p.stream_id,
    start_sec: p.start_sec,
    end_sec: p.end_sec,
    title: p.title,
    reason: p.reason,
    signals: p.signals,
    score: p.score,
    status: p.status,
    cut_job_id: p.cut_job_id,
    output_url: p.output_url,
    created_at: new Date(p.created_at).toISOString(),
  };
}

async function loadOwnedStream(req: Request, res: Response) {
  const streamId = String(req.params["id"] ?? "");
  const rows = await db
    .select()
    .from(liveStreamsTable)
    .where(eq(liveStreamsTable.id, streamId))
    .limit(1);
  const stream = rows[0];
  if (!stream) {
    res.status(404).json({ error: "That stream doesn't exist." });
    return null;
  }
  if (stream.user_id !== req.userId) {
    res.status(403).json({ error: "That's not your stream." });
    return null;
  }
  return stream;
}

function fail(res: Response, err: unknown, what: string) {
  if (err instanceof ProposalError) {
    res.status(err.status).json({ error: err.message, code: err.code });
    return;
  }
  logger.error({ err }, `live-highlights ${what} failed`);
  res.status(500).json({ error: "Something went wrong with that highlight." });
}

router.get("/live-streams/:id/highlights", requireAuth, publicApiLimiter, async (req: Request, res: Response) => {
  try {
    const stream = await loadOwnedStream(req, res);
    if (!stream) return;
    const proposals = await drizzleAutoHighlightsStore.listProposals(stream.id);
    res.json({ proposals: proposals.map(proposalDto) });
  } catch (err) {
    fail(res, err, "list");
  }
});

for (const verb of ["approve", "dismiss", "refresh"] as const) {
  router.post(
    `/live-streams/:id/highlights/:proposalId/${verb}`,
    requireAuth,
    publicApiLimiter,
    async (req: Request, res: Response) => {
      try {
        const stream = await loadOwnedStream(req, res);
        if (!stream) return;
        const proposalId = String(req.params["proposalId"] ?? "");
        /* The proposal must belong to the stream in the URL — checked
           BEFORE any decision runs, so a mismatched id can never
           start a cut. (The lib also enforces creator ownership.) */
        const existing = await drizzleAutoHighlightsStore.getProposal(proposalId);
        if (!existing || existing.stream_id !== stream.id) {
          res.status(404).json({ error: "That highlight doesn't belong to this stream." });
          return;
        }
        const proposal =
          verb === "approve"
            ? await decideHighlightProposal(drizzleAutoHighlightsStore, streamerClipsCutRail, req.userId!, proposalId, "approved")
            : verb === "dismiss"
              ? await decideHighlightProposal(drizzleAutoHighlightsStore, streamerClipsCutRail, req.userId!, proposalId, "dismissed")
              : await refreshHighlightProposal(drizzleAutoHighlightsStore, streamerClipsCutRail, req.userId!, proposalId);
        res.json({ proposal: proposalDto(proposal) });
      } catch (err) {
        fail(res, err, verb);
      }
    },
  );
}

export default router;
