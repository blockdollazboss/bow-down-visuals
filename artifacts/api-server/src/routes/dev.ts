import { Router } from "express";
import { requireAuth } from "../middlewares/require-auth";
import { getSupabaseAdmin } from "../lib/supabase-admin";

const router = Router();

// Dev-only credit top-up. Hard-gated to development: in production this route
// does not exist, so authenticated users cannot mint free credits.
router.post("/dev/add-credits", requireAuth, async (req, res) => {
  if (process.env["NODE_ENV"] !== "development") {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const supabase = req.userSupabase!;

  const { data: profile, error: fetchError } = await supabase
    .from("profiles")
    .select("credits")
    .eq("id", req.userId!)
    .single();

  if (process.env["NODE_ENV"] === "development") {
    console.log(`[dev/add-credits] userId=${req.userId} credits=${profile?.credits} fetchError=${fetchError?.message ?? "none"}`);
  }

  if (!profile) {
    res.status(404).json({ error: "Profile not found", detail: fetchError?.message });
    return;
  }

  const newCredits = profile.credits + 10;

  /* profiles UPDATE via user-scoped client silently no-ops under broken RLS UPDATE policy — use service role. */
  const { error: updateError } = await getSupabaseAdmin()
    .from("profiles")
    .update({ credits: newCredits })
    .eq("id", req.userId!);

  if (updateError) {
    res.status(500).json({ error: updateError.message });
    return;
  }

  if (process.env["NODE_ENV"] === "development") {
    console.log(`[dev/add-credits] updated newCredits=${newCredits}`);
  }

  res.json({ credits: newCredits });
});

export default router;
