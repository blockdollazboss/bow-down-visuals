import { createContext, useContext, useCallback, useEffect, useState, type ReactNode } from "react";
import type { User, SupabaseClient } from "@supabase/supabase-js";
import { supabase, getSupabase } from "@/lib/supabase";

interface Profile {
  id: string;
  email: string;
  display_name: string | null;
  plan: string;
  /** Plan tier 1–6. Tier N caps Creator Level at N stars. Defaults to 1. */
  plan_tier: number;
  credits: number;
  created_at: string;
}

interface AuthContextValue {
  user: User | null;
  profile: Profile | null;
  supabase: SupabaseClient | null;
  loading: boolean;
  signUp: (email: string, password: string, displayName: string) => Promise<{ error: string | null }>;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signInWithGoogle: () => Promise<{ error: string | null }>;
  signInWithProvider: (
    provider: "google" | "apple" | "instagram" | "facebook" | "tiktok",
  ) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  getAccessToken: () => Promise<string | null>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!supabase) {
      console.error(
        "[AuthContext] Supabase client is null. " +
        "Ensure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are set in Replit Secrets."
      );
      setLoading(false);
      return;
    }

    const client = supabase;

    async function bootstrap() {
      try {
        /* Never leave the app on an infinite spinner: if the session or
         * profile fetch hangs (flaky network, stalled request), time out and
         * treat the visitor as signed out — ProtectedRoute then sends them to
         * /login instead of hanging on a dead loading screen. */
        const timeout = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("auth bootstrap timeout")), 15000),
        );
        const work = (async () => {
          const { data: { session } } = await client.auth.getSession();
          setUser(session?.user ?? null);
          if (session?.user) await fetchProfile(client, session.user.id);
        })();
        await Promise.race([work, timeout]);
      } catch (err) {
        console.error("[AuthContext] Failed to get session", err);
      } finally {
        setLoading(false);
      }
    }

    bootstrap();

    const { data: { subscription } } = client.auth.onAuthStateChange(
      async (_event, session) => {
        setUser(session?.user ?? null);
        if (session?.user) {
          await fetchProfile(client, session.user.id);
        } else {
          setProfile(null);
        }
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  async function fetchProfile(client: SupabaseClient, userId: string) {
    const { data } = await client
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .single();
    if (data) {
      /* Admins always display at the highest tier, regardless of the
       * stored plan value. The admin check is server-side (ADMIN_EMAILS). */
      try {
        const { data: { session } } = await client.auth.getSession();
        if (session?.access_token) {
          const res = await fetch("/api/admin/status", {
            headers: { Authorization: `Bearer ${session.access_token}` },
          });
          if (res.ok) {
            const { isAdmin } = await res.json();
            if (isAdmin) data.plan = "studio";
          }
        }
      } catch {
        /* Non-fatal: fall back to the stored plan value. */
      }
    }
    setProfile(data ?? null);
  }

  async function refreshProfile() {
    if (!user) return;
    const client = getSupabase();
    await fetchProfile(client, user.id);
  }

  const getAccessToken = useCallback(async (): Promise<string | null> => {
    try {
      const client = getSupabase();
      const { data: { session } } = await client.auth.getSession();
      return session?.access_token ?? null;
    } catch {
      return null;
    }
  }, []);

  async function signUp(email: string, password: string, displayName: string) {
    const client = getSupabase();
    const { error } = await client.auth.signUp({
      email,
      password,
      options: { data: { display_name: displayName } },
    });
    return { error: error?.message ?? null };
  }

  async function signIn(email: string, password: string) {
    try {
      const client = getSupabase();
      const { data, error } = await client.auth.signInWithPassword({ email, password });

      if (error) {
        return { error: error.message || "Login failed" };
      }

      if (data.user) {
        setUser(data.user);
        await fetchProfile(client, data.user.id);
      }

      return { error: null };
    } catch (err) {
      return { error: err instanceof Error ? err.message : "Login failed" };
    }
  }

  /* Generic social OAuth via Supabase. On success the browser redirects
   * to the provider, so this only returns when something goes wrong
   * before the redirect. */
  async function signInWithProvider(
    provider: "google" | "apple" | "instagram" | "facebook" | "tiktok",
  ) {
    const pretty = provider[0].toUpperCase() + provider.slice(1);
    try {
      const client = getSupabase();
      const { error } = await client.auth.signInWithOAuth({
        // Supabase Provider type lags behind; instagram/tiktok are configured server-side
        provider: provider as "google",
        options: { redirectTo: `${window.location.origin}/choose-artist` },
      });
      return { error: error?.message ?? null };
    } catch (err) {
      return { error: err instanceof Error ? err.message : `${pretty} sign-in failed` };
    }
  }

  /* Google OAuth via Supabase. Kept for backwards compatibility. */
  async function signInWithGoogle() {
    return signInWithProvider("google");
  }

  async function signOut() {
    const supabaseUrl = String(import.meta.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");

    try {
      const projectRef = new URL(supabaseUrl).hostname.split(".")[0];
      localStorage.removeItem(`sb-${projectRef}-auth-token`);
    } catch {
      Object.keys(localStorage)
        .filter((key) => key.startsWith("sb-") && key.endsWith("-auth-token"))
        .forEach((key) => localStorage.removeItem(key));
    }

    setUser(null);
    setProfile(null);

    /* Staging gate: signing out of the app also drops the staging pass
       cookie, so the password is asked again on the next visit. Nobody
       but the owner should see the staging site. Best-effort — this
       endpoint only exists where the gate is deployed. */
    try {
      await fetch("/__staging_logout", { credentials: "same-origin" });
    } catch {
      /* ignore — no staging gate here */
    }

    window.history.pushState({}, "", "/");
    window.dispatchEvent(new PopStateEvent("popstate"));
  }

  /* One-time trial credits: covers email + social signups. The endpoint is
   * idempotent; localStorage gates the call so it only fires until the first
   * success (or confirmed already-claimed). Best-effort — it must never
   * break sign-in. */
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        if (localStorage.getItem("bdv_trial_claimed") === "1") return;
      } catch {
        return;
      }
      const token = await getAccessToken();
      if (cancelled || !token) return;
      try {
        const res = await fetch("/api/credits/claim-trial", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok || cancelled) return;
        try {
          localStorage.setItem("bdv_trial_claimed", "1");
        } catch { /* noop */ }
        // Show the new balance immediately.
        await refreshProfile();
      } catch { /* noop */ }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  return (
    <AuthContext.Provider value={{ user, profile, supabase, loading, signUp, signIn, signInWithGoogle, signInWithProvider, signOut, refreshProfile, getAccessToken }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
