import { Router } from "express";
import { requireAuth, createUserSupabase } from "../middlewares/require-auth";

const router = Router();

router.post("/dev/add-credits", requireAuth, async (req, res) => {
  if (process.env["NODE_ENV"] === "production") {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const supabase = createUserSupabase(req.accessToken!);

  const { data: profile } = await supabase
    .from("profiles")
    .select("credits")
    .eq("id", req.userId)
    .single();

  if (!profile) {
    res.status(404).json({ error: "Profile not found" });
    return;
  }

  const newCredits = profile.credits + 10;

  const { error } = await supabase
    .from("profiles")
    .update({ credits: newCredits })
    .eq("id", req.userId);

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  res.json({ credits: newCredits });
});

export default router;
