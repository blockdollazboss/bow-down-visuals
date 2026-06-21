import { createClient } from "@supabase/supabase-js";
import type { Request, Response, NextFunction } from "express";

declare global {
  namespace Express {
    interface Request {
      userId?: string;
      userEmail?: string;
      accessToken?: string;
      userCredits?: number;
    }
  }
}

const SUPABASE_URL = process.env["SUPABASE_URL"] ?? "";
const SUPABASE_ANON_KEY = process.env["SUPABASE_ANON_KEY"] ?? "";

// Raw HTTP helper — bypasses the SDK's apikey header quirk with sb_publishable_* keys.
// Returns { data, error } where data is the first matching row (or null).
export async function supabaseRow<T = Record<string, unknown>>(
  token: string,
  table: string,
  query: string, // e.g. "id=eq.abc&select=credits"
): Promise<{ data: T | null; httpStatus: number; rawError: string | null }> {
  const url = `${SUPABASE_URL}/rest/v1/${table}?${query}`;
  let httpStatus = 0;
  let rawError: string | null = null;
  try {
    const res = await fetch(url, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    });
    httpStatus = res.status;
    if (!res.ok) {
      rawError = await res.text();
      return { data: null, httpStatus, rawError };
    }
    const json = (await res.json()) as T[];
    return { data: json[0] ?? null, httpStatus, rawError: null };
  } catch (err) {
    rawError = err instanceof Error ? err.message : String(err);
    return { data: null, httpStatus, rawError };
  }
}

// Mutate a row via PATCH or POST.
export async function supabaseMutate(
  token: string,
  method: "PATCH" | "POST",
  table: string,
  query: string,
  body: Record<string, unknown>,
): Promise<{ httpStatus: number; rawError: string | null }> {
  const url = `${SUPABASE_URL}/rest/v1/${table}${query ? `?${query}` : ""}`;
  let httpStatus = 0;
  let rawError: string | null = null;
  try {
    const res = await fetch(url, {
      method,
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Prefer: method === "POST" ? "return=minimal" : "return=minimal",
      },
      body: JSON.stringify(body),
    });
    httpStatus = res.status;
    if (!res.ok) {
      rawError = await res.text();
    }
    return { httpStatus, rawError };
  } catch (err) {
    rawError = err instanceof Error ? err.message : String(err);
    return { httpStatus, rawError };
  }
}

// Kept for backward compat in dev.ts only.
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

  // Validate the JWT via Supabase Auth (this always works regardless of key format).
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const { data: { user }, error } = await supabase.auth.getUser(token);

  if (error || !user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  req.userId = user.id;
  req.userEmail = user.email;
  req.accessToken = token;

  // Fetch the profile (credits) via raw HTTP so we bypass the SDK apikey quirk.
  const { data: profile, httpStatus, rawError } = await supabaseRow<{ id: string; credits: number }>(
    token,
    "profiles",
    `id=eq.${user.id}&select=id,credits`,
  );

  if (process.env["NODE_ENV"] === "development") {
    console.log(`[requireAuth] userId=${user.id} profileQuery httpStatus=${httpStatus} rawError=${rawError} credits=${profile?.credits}`);
  }

  if (profile) {
    req.userCredits = profile.credits;
  } else {
    // Profile doesn't exist yet — create it with 10 starter credits.
    const { httpStatus: insertStatus, rawError: insertError } = await supabaseMutate(
      token,
      "POST",
      "profiles",
      "",
      {
        id: user.id,
        email: user.email ?? "",
        display_name: (user.user_metadata as Record<string, unknown>)?.display_name ?? null,
        plan: "free",
        credits: 10,
      },
    );
    if (process.env["NODE_ENV"] === "development") {
      console.log(`[requireAuth] profile insert httpStatus=${insertStatus} rawError=${insertError}`);
    }
    req.userCredits = 10;
  }

  next();
}
