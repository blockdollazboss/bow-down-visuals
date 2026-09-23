import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Request, Response, NextFunction } from "express";

declare global {
  namespace Express {
    interface Request {
      userId?: string;
      userEmail?: string;
      accessToken?: string;
      userCredits?: number;
      userPlan?: string;
      userSupabase?: SupabaseClient;
    }
  }
}

const SUPABASE_URL = process.env["SUPABASE_URL"] ?? process.env["VITE_SUPABASE_URL"] ?? "";
const SUPABASE_ANON_KEY = process.env["SUPABASE_ANON_KEY"] ?? process.env["VITE_SUPABASE_ANON_KEY"] ?? "";

// Creates a Supabase client with the user's session active — mirrors exactly
// how the frontend SDK operates after signIn, which is required for the
// sb_publishable_* key format to reach PostgREST correctly.
export async function createSessionSupabase(accessToken: string): Promise<SupabaseClient> {
  // Use the verified browser JWT as the Authorization header for PostgREST.
  // Do not call auth.setSession() here: the API only receives an access token,
  // not a real refresh token, and fake refresh tokens can cause random auth
  // failures. This still lets Supabase RLS see auth.uid() correctly.
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers["authorization"];
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const token = authHeader.slice(7);

  // Validate token via auth.getUser (works regardless of key format).
  const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const { data: { user }, error } = await anonClient.auth.getUser(token);

  if (error || !user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  req.userId = user.id;
  req.userEmail = user.email;
  req.accessToken = token;

  // Build a properly-sessioned client and attach to req for use in routes.
  const userClient = await createSessionSupabase(token);
  req.userSupabase = userClient;

  // Fetch profile with credits and plan.
  const { data: profile, error: profileError } = await userClient
    .from("profiles")
    .select("id, credits, plan")
    .eq("id", user.id)
    .single();

  if (process.env["NODE_ENV"] === "development") {
    console.log(`[requireAuth] userId=${user.id} profileOk=${!!profile} profileError=${profileError?.message ?? "none"} credits=${profile?.credits} plan=${profile?.plan ?? "none"}`);
  }

  if (profile) {
    req.userCredits = profile.credits;
    req.userPlan = profile.plan ?? "free";
  } else {
    // Profile doesn't exist yet — create it.
    const { data: newProfile, error: insertError } = await userClient
      .from("profiles")
      .insert({
        id: user.id,
        email: user.email ?? "",
        display_name: (user.user_metadata as Record<string, unknown>)?.display_name ?? null,
        plan: "free",
        credits: 3,
      })
      .select("credits")
      .single();

    if (process.env["NODE_ENV"] === "development") {
      console.log(`[requireAuth] insert newProfile=${!!newProfile} insertError=${insertError?.message ?? "none"}`);
    }

    req.userCredits = newProfile?.credits ?? 3;
    req.userPlan = "free";
  }

  next();
}
