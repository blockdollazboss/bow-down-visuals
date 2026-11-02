import type { ReactNode } from "react";
import { useAuth } from "@/contexts/AuthContext";

/* ─── CoachPanelBits — the Coach panels' shared kit ───────────────
   The small vocabulary every Coach surface in the Promote Desk
   speaks: the auth header builder, the input/button class strings,
   and the sub-head / inner-block furniture. CoachPanels.tsx carried
   these first (parity P3); the Money Tracker's sub-views
   (CoachMoneySubViews.tsx, Ring 4 #6) speak the same kit, so it
   lives here instead of being copied per file. */

export function useCoachAuthHeaders() {
  const { getAccessToken } = useAuth();
  return async (): Promise<Record<string, string>> => {
    const token = await getAccessToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  };
}

export const inputCls = (isLight: boolean) =>
  `w-full rounded-xl border px-3 py-2 text-sm outline-none transition focus:border-[#d4af37] bdv-touch-target ${
    isLight
      ? "border-[#C9A84C]/40 bg-white/60 text-[#2a1e07] placeholder:text-[#6B5B36]/60"
      : "border-white/10 bg-white/5 text-white placeholder:text-white/35"
  }`;

export const goldBtn =
  "inline-flex items-center gap-2 rounded-full bg-[#d4af37] px-4 py-2 text-sm font-bold text-black transition hover:scale-105 disabled:opacity-50 bdv-touch-target disabled:hover:scale-100";

export const chipBtn = (isLight: boolean, active: boolean) =>
  `inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition bdv-touch-target ${
    active
      ? "border-[#d4af37] bg-[#d4af37] text-black"
      : isLight
        ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]"
        : "border-white/15 text-white/75 hover:text-white"
  }`;

export const smallBtn = (isLight: boolean) =>
  `inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-bold transition bdv-touch-target ${
    isLight
      ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]"
      : "border-white/15 text-white/70 hover:text-white"
  }`;

export function SubHead({ isLight, children }: { isLight: boolean; children: ReactNode }) {
  return (
    <p className={`text-[11px] font-black uppercase tracking-[0.14em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
      {children}
    </p>
  );
}

export function InnerBlock({ isLight, children }: { isLight: boolean; children: ReactNode }) {
  return (
    <div className={`rounded-xl border px-3 py-2.5 ${isLight ? "border-[#C9A84C]/30 bg-white/40" : "border-white/10 bg-white/[0.03]"}`}>
      {children}
    </div>
  );
}
