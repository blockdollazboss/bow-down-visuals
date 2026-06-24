import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { User, SupabaseClient } from "@supabase/supabase-js";
import { supabase, getSupabase } from "@/lib/supabase";

interface Profile {
  id: string;
  email: string;
  display_name: string | null;
  plan: string;
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
        const { data: { session } } = await client.auth.getSession();
        setUser(session?.user ?? null);
        if (session?.user) await fetchProfile(client, session.user.id);
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
    setProfile(data ?? null);
  }

  async function refreshProfile() {
    if (!user) return;
    const client = getSupabase();
    await fetchProfile(client, user.id);
  }

  async function getAccessToken(): Promise<string | null> {
    try {
      const client = getSupabase();
      const { data: { session } } = await client.auth.getSession();
      return session?.access_token ?? null;
    } catch {
      return null;
    }
  }

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
    const client = getSupabase();
    const { error } = await client.auth.signInWithPassword({ email, password });
    return { error: error?.message ?? null };
  }

  async function signOut() {
    const client = getSupabase();
    await client.auth.signOut();
  }

  return (
    <AuthContext.Provider value={{ user, profile, supabase, loading, signUp, signIn, signOut, refreshProfile, getAccessToken }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
