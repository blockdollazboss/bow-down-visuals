import { Router } from "express";

const router = Router();

router.get("/config", (_req, res) => {
  const url = process.env["SUPABASE_URL"];
  const anonKey = process.env["SUPABASE_ANON_KEY"];

  if (!url) {
    res.status(500).json({ error: "Missing server secret: SUPABASE_URL" });
    return;
  }
  if (!anonKey) {
    res.status(500).json({ error: "Missing server secret: SUPABASE_ANON_KEY" });
    return;
  }

  res.json({ supabaseUrl: url, supabaseAnonKey: anonKey });
});

export default router;
