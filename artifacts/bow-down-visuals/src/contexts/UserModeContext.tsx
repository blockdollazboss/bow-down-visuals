import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { gateStarsFor, type CreatorRankDto } from "@/lib/creator-level";

/**
 * Site-wide Creator Level — EARNED RANK (owner ruling, 2026-10-17).
 *
 * `stars` is the creator's earned rank, computed on the server from
 * recorded work (lib/creator-rank.ts on the API; read here from
 * GET /api/retention/rank). It is never read from localStorage and
 * never settable from the client: there is no dial anymore.
 *
 * Two things the old dial fused are now separate, honestly:
 * - RANK (stars): earned, server-owned, displayed in the sidebar, the
 *   World nameplate, and the level-up celebrations.
 * - CONTROL EXPOSURE (gateStars): what data-min-stars CSS and
 *   useMinStars evaluate. gateStars = max(earned, your saved pre-rank
 *   dial level) — the grandfather rule, so nobody lost a control the
 *   day earned rank shipped. The saved dial value (bdv_user_mode_*)
 *   is read once as that floor and never written again.
 * - MODE (mode/isSimple): the Turbo/Advanced display preference. The
 *   user still picks it (editor/sidebar switch); it persists on its
 *   own key (bdv_ui_mode_*) and defaults from gate stars (1–3 Turbo,
 *   4–6 Advanced) until the user picks explicitly.
 */
export type UserMode = "simple" | "advanced";
export type StarLevel = 1 | 2 | 3 | 4 | 5 | 6;

const ANON_KEY = "bdv_user_mode_anon";
const keyFor = (userId: string | null | undefined) => (userId ? `bdv_user_mode_${userId}` : ANON_KEY);
const modeKeyFor = (userId: string | null | undefined) =>
  userId ? `bdv_ui_mode_${userId}` : "bdv_ui_mode_anon";

/** The pre-earned-rank saved dial value, now only a grandfather floor
 *  for control exposure. Migrates the old binary values. */
function readLegacyFloor(userId: string | null | undefined): StarLevel {
  try {
    const raw = localStorage.getItem(keyFor(userId));
    if (raw === "simple") return 1;
    if (raw === "advanced") return 6;
    const n = parseInt(raw ?? "", 10);
    if (n >= 1 && n <= 6) return n as StarLevel;
  } catch { /* ignore */ }
  return 1;
}

function readModePref(userId: string | null | undefined): UserMode | null {
  try {
    const raw = localStorage.getItem(modeKeyFor(userId));
    if (raw === "simple" || raw === "advanced") return raw;
  } catch { /* ignore */ }
  return null;
}

const starsToMode = (s: StarLevel): UserMode => (s <= 3 ? "simple" : "advanced");

interface UserModeContextValue {
  mode: UserMode;
  /** EARNED rank stars (server-computed). 1 for guests / until the rank read lands. */
  stars: StarLevel;
  /** Exposure gate stars: max(earned, grandfather floor). */
  gateStars: StarLevel;
  /** Rank can no longer be capped by a plan — it can't be bought. Always 6. */
  maxStars: StarLevel;
  /** The full earned-rank DTO (points, breakdown, next-star requirements). */
  rank: CreatorRankDto | null;
  setMode: (m: UserMode) => void;
  toggleMode: () => void;
  isSimple: boolean;
  /** Re-read the earned rank from the server. */
  refreshRank: () => void;
}

const UserModeContext = createContext<UserModeContextValue | null>(null);

export function UserModeProvider({ children }: { children: ReactNode }) {
  const { user, getAccessToken } = useAuth();
  const userId = user?.id ?? null;
  const [rank, setRank] = useState<CreatorRankDto | null>(null);
  const [legacyFloor, setLegacyFloor] = useState<StarLevel>(() => readLegacyFloor(null));
  const [modePref, setModePref] = useState<UserMode | null>(() => readModePref(null));

  /* The floor + mode preference are per-user keys; re-read them when
     the signed-in user resolves (auth is async). */
  useEffect(() => {
    setLegacyFloor(readLegacyFloor(userId));
    setModePref(readModePref(userId));
    setRank(null);
  }, [userId]);

  const refreshRank = useCallback(async () => {
    if (!userId) {
      setRank(null);
      return;
    }
    try {
      const token = await getAccessToken();
      const res = await fetch("/api/retention/rank", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) return;
      const data = (await res.json().catch(() => ({}))) as { rank?: CreatorRankDto };
      if (data.rank && typeof data.rank.stars === "number") setRank(data.rank);
    } catch {
      /* Rank is a display truth, not a gate on the app: a failed read
         leaves the last known rank (or the ★1 starting rank) in place. */
    }
  }, [userId, getAccessToken]);

  useEffect(() => {
    void refreshRank();
  }, [refreshRank]);

  const earnedStars = (rank?.stars ?? 1) as StarLevel;
  const gateStars = gateStarsFor(earnedStars, legacyFloor);
  const mode: UserMode = modePref ?? starsToMode(gateStars);

  /* Reflect mode + gate stars on the document root: CSS exposure gates
     (data-min-stars) follow GATE stars (the grandfather rule), while
     rank displays read `stars` from this context. */
  useEffect(() => {
    document.documentElement.dataset.userMode = mode;
    document.documentElement.dataset.starLevel = String(gateStars);
  }, [mode, gateStars]);

  const setMode = useCallback(
    (m: UserMode) => {
      setModePref(m);
      try {
        localStorage.setItem(modeKeyFor(userId), m);
      } catch { /* ignore */ }
    },
    [userId],
  );

  const toggleMode = useCallback(() => {
    setMode(mode === "simple" ? "advanced" : "simple");
  }, [mode, setMode]);

  const value = useMemo<UserModeContextValue>(
    () => ({
      mode,
      stars: earnedStars,
      gateStars,
      maxStars: 6,
      rank,
      setMode,
      toggleMode,
      isSimple: mode === "simple",
      refreshRank,
    }),
    [mode, earnedStars, gateStars, rank, setMode, toggleMode, refreshRank],
  );

  return <UserModeContext.Provider value={value}>{children}</UserModeContext.Provider>;
}

export function useUserMode(): UserModeContextValue {
  const ctx = useContext(UserModeContext);
  if (!ctx) throw new Error("useUserMode must be used within a UserModeProvider");
  return ctx;
}
