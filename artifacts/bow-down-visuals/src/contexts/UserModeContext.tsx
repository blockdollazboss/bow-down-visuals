import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Site-wide Creator Level — GTA-style 6-star rank system.
 *
 * 1 star = Street Punk — one-click AI-driven flow, minimal UI.
 * 6 stars = Kingpin — full manual controls, everything exposed.
 *
 * Stars 1-3 map to "simple", stars 4-6 map to "advanced" for existing consumers.
 * Persisted in localStorage, scoped per signed-in user. New users default to 1 star.
 */
export type UserMode = "simple" | "advanced";
export type StarLevel = 1 | 2 | 3 | 4 | 5 | 6;

const ANON_KEY = "bdv_user_mode_anon";
const keyFor = (userId: string | null | undefined) => (userId ? `bdv_user_mode_${userId}` : ANON_KEY);

function readStars(userId: string | null | undefined): StarLevel {
  try {
    const raw = localStorage.getItem(keyFor(userId));
    // Migrate old binary values
    if (raw === "simple") return 1;
    if (raw === "advanced") return 6;
    const n = parseInt(raw ?? "", 10);
    if (n >= 1 && n <= 6) return n as StarLevel;
  } catch { /* ignore */ }
  return 1;
}

const starsToMode = (s: StarLevel): UserMode => (s <= 3 ? "simple" : "advanced");

interface UserModeContextValue {
  mode: UserMode;
  stars: StarLevel;
  /** Highest star level this account's plan allows. Admins always get 6. */
  maxStars: StarLevel;
  setStars: (s: StarLevel) => void;
  setMode: (m: UserMode) => void;
  toggleMode: () => void;
  isSimple: boolean;
}

const UserModeContext = createContext<UserModeContextValue | null>(null);

export function UserModeProvider({ children }: { children: ReactNode }) {
  const { user, profile } = useAuth();
  const userId = user?.id ?? null;
  const [stars, setStarsState] = useState<StarLevel>(() => readStars(null));

  /* Plan tier caps the stars: tier N = max N stars. Admins bypass the cap. */
  const isAdmin = profile?.plan === "studio";
  const maxStars = useMemo((): StarLevel => {
    if (isAdmin) return 6;
    const t = Math.floor(Number(profile?.plan_tier) || 1);
    return Math.min(6, Math.max(1, t)) as StarLevel;
  }, [isAdmin, profile?.plan_tier]);

  const mode = starsToMode(stars);

  /* Re-read the persisted level once we know who's signed in (auth resolves async),
     and clamp it to the plan tier. */
  useEffect(() => {
    const s = readStars(userId);
    setStarsState(s > maxStars ? maxStars : s);
  }, [userId, maxStars]);

  /* Reflect the mode + stars on the document root so CSS can show/hide UI site-wide. */
  useEffect(() => {
    document.documentElement.dataset.userMode = mode;
    document.documentElement.dataset.starLevel = String(stars);
  }, [mode, stars]);

  function setStars(s: StarLevel) {
    const clamped = Math.min(s, maxStars) as StarLevel;
    setStarsState(clamped);
    try {
      localStorage.setItem(keyFor(userId), String(clamped));
    } catch { /* ignore */ }
  }

  function setMode(m: UserMode) {
    setStars(m === "simple" ? 1 : 6);
  }

  function toggleMode() {
    setStars(mode === "simple" ? 6 : 1);
  }

  const value = useMemo(
    () => ({ mode, stars, maxStars, setStars, setMode, toggleMode, isSimple: mode === "simple" }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mode, stars, maxStars, userId],
  );

  return <UserModeContext.Provider value={value}>{children}</UserModeContext.Provider>;
}

export function useUserMode(): UserModeContextValue {
  const ctx = useContext(UserModeContext);
  if (!ctx) throw new Error("useUserMode must be used within a UserModeProvider");
  return ctx;
}
