import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const rawUrl     = import.meta.env.VITE_SUPABASE_URL     as string | undefined;
const rawAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

const url     = rawUrl?.trim()     || undefined;
const anonKey = rawAnonKey?.trim() || undefined;

function isValidHttpsUrl(s: string | undefined): s is string {
  if (!s) return false;
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

if (!url) {
  console.error(
    "[Supabase] Missing Replit Secret: VITE_SUPABASE_URL\n" +
    "The frontend needs this variable prefixed with VITE_ to be visible in the browser."
  );
} else if (!isValidHttpsUrl(url)) {
  console.error(
    `[Supabase] VITE_SUPABASE_URL is set but is not a valid HTTP/HTTPS URL: "${url}"\n` +
    "It should look like: https://xxxxxxxxxxxx.supabase.co"
  );
}

if (!anonKey) {
  console.error(
    "[Supabase] Missing Replit Secret: VITE_SUPABASE_ANON_KEY\n" +
    "The frontend needs this variable prefixed with VITE_ to be visible in the browser."
  );
}

export const supabase: SupabaseClient | null =
  isValidHttpsUrl(url) && anonKey ? createClient(url, anonKey) : null;

/** Returns the singleton client or throws with a clear message. */
export function getSupabase(): SupabaseClient {
  if (!supabase) {
    const issues: string[] = [];
    if (!url) issues.push("VITE_SUPABASE_URL is missing");
    else if (!isValidHttpsUrl(url)) issues.push(`VITE_SUPABASE_URL is not a valid URL ("${url}")`);
    if (!anonKey) issues.push("VITE_SUPABASE_ANON_KEY is missing");
    throw new Error(`Supabase is not initialized. ${issues.join("; ")}`);
  }
  return supabase;
}

