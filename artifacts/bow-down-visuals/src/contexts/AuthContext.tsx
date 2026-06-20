import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { User, SupabaseClient } from "@supabase/supabase-js";
import { initSupabase, getSupabase } from "@/lib/supabase";

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
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [supabase, setSupabase] = useState<SupabaseClient | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function bootstrap() {
      try {
        const res = await fetch("/api/config");
        const { supabaseUrl, supabaseAnonKey } = await res.json();
        const client = initSupabase(supabaseUrl, supabaseAnonKey);
        setSupabase(client);

        const { data: { session } } = await client.auth.getSession();
        setUser(session?.user ?? null);
        if (session?.user) await fetchProfile(client, session.user.id);

        client.auth.onAuthStateChange(async (_event, session) => {
          setUser(session?.user ?? null);
          if (session?.user) {
            await fetchProfile(client, session.user.id);
          } else {
            setProfile(null);
          }
        });
      } catch (err) {
        console.error("Failed to initialize Supabase", err);
      } finally {
        setLoading(false);
      }
    }
    bootstrap();
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
    <AuthContext.Provider value={{ user, profile, supabase, loading, signUp, signIn, signOut, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
