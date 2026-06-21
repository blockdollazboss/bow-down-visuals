import { createClient } from "@supabase/supabase-js";
import type { Request, Response, NextFunction } from "express";

declare global {
  namespace Express {
    interface Request {
      userId?: string;
      userEmail?: string;
      accessToken?: string;
    }
  }
}

const SUPABASE_URL = process.env["SUPABASE_URL"] ?? "";
const SUPABASE_ANON_KEY = process.env["SUPABASE_ANON_KEY"] ?? "";

export function createUserSupabase(accessToken: string) {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false },
  });
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers["authorization"];
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const token = authHeader.slice(7);

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const { data: { user }, error } = await supabase.auth.getUser(token);

  if (error || !user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const userSupabase = createUserSupabase(token);

  const { data: profile } = await userSupabase
    .from("profiles")
    .select("id")
    .eq("id", user.id)
    .single();

  if (!profile) {
    await userSupabase.from("profiles").insert({
      id: user.id,
      email: user.email ?? "",
      display_name: (user.user_metadata as Record<string, unknown>)?.display_name ?? null,
      plan: "free",
      credits: 3,
    });
  }

  req.userId = user.id;
  req.userEmail = user.email;
  req.accessToken = token;
  next();
}
