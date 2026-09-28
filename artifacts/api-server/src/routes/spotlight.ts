import { Router } from "express";
import { z } from "zod";
import { db, spotlightInquiriesTable, SPOTLIGHT_OFFER } from "@workspace/db";
import { publicApiLimiter } from "../lib/rate-limit";
import { logger } from "../lib/logger";

const router = Router();

/* Contract with the SpotlightPromo frontend:
   GET  /api/spotlight/offer → 200 { offer }
   POST /api/spotlight/inquire { name, email, videoUrl, targetUrl? } → 200 { success: true }
   Storage only — no emails are sent and no charge is taken. */

router.get("/spotlight/offer", (_req, res) => {
  res.json({ offer: SPOTLIGHT_OFFER });
});

const inquireSchema = z.object({
  name:      z.string().min(1, "Name is required.").max(200),
  email:     z.string().email("A valid email is required.").max(320),
  videoUrl:  z.string().url("A valid video URL is required.").max(2000),
  targetUrl: z.string().url("That link doesn't look valid.").max(2000).optional().or(z.literal("")),
});

router.post("/spotlight/inquire", publicApiLimiter, async (req, res) => {
  const parsed = inquireSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid inquiry data.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  const { name, email, videoUrl, targetUrl } = parsed.data;

  try {
    await db.insert(spotlightInquiriesTable).values({
      name: name.trim(),
      email: email.trim().toLowerCase(),
      videoUrl: videoUrl.trim(),
      targetUrl: targetUrl?.trim() || null,
    });

    res.json({ success: true });
  } catch (err: unknown) {
    logger.error({ err }, "[spotlight] failed to store inquiry");
    res.status(500).json({ error: "Could not save your request. Please try again later." });
  }
});

export default router;
