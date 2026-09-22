import { Router } from "express";
import { createClient } from "@supabase/supabase-js";
import { publicApiLimiter } from "../lib/rate-limit";

const router = Router();

const SUPABASE_URL = process.env["SUPABASE_URL"] ?? "";
const SUPABASE_ANON_KEY = process.env["SUPABASE_ANON_KEY"] ?? "";

router.post("/waitlist", publicApiLimiter, async (req, res) => {
  const { name, email, creatorName, artistType, wantToCreate, socialHandle, message } = req.body as Record<string, string>;

  if (!name || !email) {
    res.status(400).json({ error: "Name and email are required." });
    return;
  }
  if (!email.includes("@")) {
    res.status(400).json({ error: "Please enter a valid email address." });
    return;
  }

  // Prepend creator/artist name to message so it's visible in Supabase without a schema change
  const creatorNote = creatorName?.trim() ? `Creator/Artist Name: ${creatorName.trim()}\n\n` : "";
  const fullMessage = `${creatorNote}${message?.trim() ?? ""}`.trim() || null;

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false },
    });

    const { error } = await supabase.from("waitlist").insert({
      name: name.trim(),
      email: email.trim().toLowerCase(),
      artist_type: artistType ?? null,
      want_to_create: wantToCreate ?? null,
      social_handle: socialHandle?.trim() ?? null,
      message: fullMessage,
    });

    if (error) {
      if (error.code === "23505") {
        res.status(409).json({ error: "duplicate_email", message: "This email is already on the waitlist." });
        return;
      }
      throw error;
    }

    res.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to join waitlist";
    res.status(500).json({ error: message });
  }
});

export default router;
