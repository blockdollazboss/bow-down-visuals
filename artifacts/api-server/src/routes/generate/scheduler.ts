/**
 * Stack 8 #1 — MERGED into the canonical scheduler surface.
 *
 * The legacy social-scheduler routes (POST /schedule-post,
 * GET /scheduled-posts, DELETE /scheduled-posts/:id) now live on the one
 * canonical router in routes/scheduler.ts, behavior preserved verbatim.
 * This module remains only as a delegation shim so existing imports keep
 * resolving; routes/index.ts no longer mounts it separately.
 */
import canonicalSchedulerRouter from "../scheduler";

export default canonicalSchedulerRouter;
