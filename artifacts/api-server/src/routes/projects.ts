import { Router } from "express";
import { requireAuth, createUserSupabase } from "../middlewares/require-auth";

const router = Router();

router.get("/projects", requireAuth, async (req, res) => {
  const supabase = createUserSupabase(req.accessToken!);

  const { data: projects, error } = await supabase
    .from("projects")
    .select("id, title, type, content, credits_used, created_at")
    .eq("user_id", req.userId)
    .order("created_at", { ascending: false });

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  res.json({ projects: projects ?? [] });
});

router.delete("/projects/:id", requireAuth, async (req, res) => {
  const supabase = createUserSupabase(req.accessToken!);
  const { id } = req.params;

  const { error } = await supabase
    .from("projects")
    .delete()
    .eq("id", id)
    .eq("user_id", req.userId);

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  res.json({ success: true });
});

export default router;
