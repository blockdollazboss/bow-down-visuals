import { Router, type Request, type Response, type NextFunction } from "express";
import {
  ackJobNotification,
  listPendingNotifications,
} from "../lib/job-notifications";

const router = Router();

/* ── Relay auth ─────────────────────────────────────────────────────────
   These endpoints are for the notification relay (the assistant's scheduled
   check that pings the user in chat when a job finishes). They are NOT user
   auth — they use a shared secret so only the relay can read/ack the queue.
   Set JOB_NOTIFY_RELAY_TOKEN on the server; without it the relay is
   disabled and both endpoints answer 503.                              */
function requireRelayToken(req: Request, res: Response, next: NextFunction): void {
  const configured = process.env["JOB_NOTIFY_RELAY_TOKEN"];
  if (!configured) {
    res.status(503).json({
      error: "Notification relay is not configured (JOB_NOTIFY_RELAY_TOKEN).",
      code: "relay_not_configured",
    });
    return;
  }
  const presented = req.header("x-relay-token");
  if (!presented || presented !== configured) {
    res.status(401).json({ error: "Invalid relay token.", code: "unauthorized" });
    return;
  }
  next();
}

/* ──────────────────────────────────────────────────────────────────────────
   GET /api/job-notifications/pending
   Oldest undelivered job notifications for the relay. The relay pings the
   user (chat by default; Discord later — same relay, no server changes),
   then ACKs each delivered notification exactly once.
────────────────────────────────────────────────────────────────────────── */
router.get("/job-notifications/pending", requireRelayToken, async (req, res) => {
  const rawLimit = req.query["limit"];
  const limit = Math.max(1, Math.min(Number(Array.isArray(rawLimit) ? rawLimit[0] : rawLimit) || 20, 50));
  const notifications = await listPendingNotifications(limit);
  res.json({ notifications });
});

/* ──────────────────────────────────────────────────────────────────────────
   POST /api/job-notifications/:id/ack
   Body: { "channel": "chat" | "discord" }. Atomically marks the notification
   delivered — a second ACK for the same id is a no-op, so the user is never
   pinged twice even if two relays race.
────────────────────────────────────────────────────────────────────────── */
router.post("/job-notifications/:id/ack", requireRelayToken, async (req, res) => {
  const paramId = req.params["id"];
  const id = Array.isArray(paramId) ? (paramId[0] ?? "") : (paramId ?? "");
  const channel = String((req.body as { channel?: unknown } | null)?.channel ?? "chat");
  if (!id) {
    res.status(400).json({ error: "Notification id is required.", code: "missing_id" });
    return;
  }
  const ok = await ackJobNotification(id, channel);
  if (!ok) {
    res.status(404).json({
      error: "Notification not found or already delivered.",
      code: "already_delivered",
    });
    return;
  }
  res.json({ ok: true });
});

export default router;
