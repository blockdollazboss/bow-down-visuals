import { createClient, SupabaseClient } from "@supabase/supabase-js";

let _client: SupabaseClient | null = null;

export function initSupabase(url: string, anonKey: string): SupabaseClient {
  if (!_client) {
    _client = createClient(url, anonKey);
  }
  return _client;
}

export function getSupabase(): SupabaseClient {
  if (!_client) throw new Error("Supabase not initialized");
  return _client;
}
