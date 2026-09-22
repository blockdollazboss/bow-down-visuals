import { Router } from "express";
import { z } from "zod";
import { db, contactMessagesTable } from "@workspace/db";
import { publicApiLimiter } from "../lib/rate-limit";
import { logger } from "../lib/logger";

const router = Router();

/* Contract with the /contact page frontend:
   POST /api/contact { name, email, message } → 200 { success: true }
   Storage only — no emails are sent. */
const contactSchema = z.object({
  name:    z.string().min(1, "Name is required.").max(200),
  email:   z.string().email("A valid email is required.").max(320),
  message: z.string().min(1, "Message is required.").max(5000, "Message is too long (max 5000 characters)."),
});

router.post("/contact", publicApiLimiter, async (req, res) => {
  const parsed = contactSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid contact form data.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  const { name, email, message } = parsed.data;

  try {
    await db.insert(contactMessagesTable).values({
      name: name.trim(),
      email: email.trim().toLowerCase(),
      message: message.trim(),
    });

    res.json({ success: true });
  } catch (err: unknown) {
    logger.error({ err }, "[contact] failed to store contact message");
    res.status(500).json({ error: "Could not save your message. Please try again later." });
  }
});

export default router;
