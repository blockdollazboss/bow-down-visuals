import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Site-wide Simple / Advanced mode.
 *
 * Simple mode = one-click AI-driven flow (dashboard hero + streamlined editor).
 * Advanced mode = today's full dashboard + full editor, unchanged.
 *
 * Persisted in localStorage, scoped per signed-in user (falls back to a shared
 * anonymous key before auth resolves). New users default to "simple".
 */
export type UserMode = "simple" | "advanced";

const ANON_KEY = "bdv_user_mode_anon";
const keyFor = (userId: string | null | undefined) => (userId ? `bdv_user_mode_${userId}` : ANON_KEY);

function readMode(userId: string | null | undefined): UserMode {
  try {
    const raw = localStorage.getItem(keyFor(userId));
    if (raw === "simple" || raw === "advanced") return raw;
  } catch { /* ignore */ }
  return "simple";
}

interface UserModeContextValue {
  mode: UserMode;
  setMode: (m: UserMode) => void;
  toggleMode: () => void;
  isSimple: boolean;
}

const UserModeContext = createContext<UserModeContextValue | null>(null);

export function UserModeProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [mode, setModeState] = useState<UserMode>(() => readMode(null));

  /* Re-read the persisted mode once we know who's signed in (auth resolves async). */
  useEffect(() => {
    setModeState(readMode(userId));
  }, [userId]);

  function setMode(m: UserMode) {
    setModeState(m);
    try {
      localStorage.setItem(keyFor(userId), m);
    } catch { /* ignore */ }
  }

  function toggleMode() {
    setMode(mode === "simple" ? "advanced" : "simple");
  }

  const value = useMemo(
    () => ({ mode, setMode, toggleMode, isSimple: mode === "simple" }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mode, userId],
  );

  return <UserModeContext.Provider value={value}>{children}</UserModeContext.Provider>;
}

export function useUserMode(): UserModeContextValue {
  const ctx = useContext(UserModeContext);
  if (!ctx) throw new Error("useUserMode must be used within a UserModeProvider");
  return ctx;
}
