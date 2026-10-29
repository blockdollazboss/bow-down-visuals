import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { isDeepHealthAuthorized, runDeepHealth } from "../lib/deep-health";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

/**
 * Deep health — the dependency truth behind the shallow probe above
 * (lib/deep-health.ts, stack800 lane 9): DB, storage, and the export
 * queue, each probed with its own timeout. 200 only when every check
 * is ok; 503 when any is down, with the failing check named.
 *
 * Gate-kept: the report says WHICH dependency is down, so the door
 * is shut to the public. Behind the staging gate, the gate middleware
 * has already authenticated the request; with the gate off, a
 * DEEP_HEALTH_TOKEN bearer is required; with neither configured the
 * endpoint answers 404 — it does not confirm it exists.
 */
router.get("/healthz/deep", async (req, res) => {
  if (!isDeepHealthAuthorized(req.headers, process.env)) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const report = await runDeepHealth();
  res.status(report.status === "ok" ? 200 : 503).json(report);
});

export default router;
