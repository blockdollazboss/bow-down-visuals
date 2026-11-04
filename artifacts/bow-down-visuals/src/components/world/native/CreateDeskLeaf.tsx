import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

/* ─── Shared FORM bits for the Create Wing desks (NATIVE-PLAN §3.6) ──
   One shape for all six benches: the CreateDeskRunner prompt card,
   Advanced fields behind ONE expander, the result in-world, and
   next-step chips under it. Fetching follows the panel host's own
   pattern (the member's token via useAuth — the same useAuthHeaders
   the Treasury/Jukebox panels use); the price is shown by the
   runner before anything runs, so no second confirmation stands
   between the walker and the make.

   WORLD-PERF ROUND 3 — this module is a true leaf: the form bits
   every desk (and the StationPanel frame's PitchFixBoard) needs,
   importing nothing but react, icons and the auth context, so the
   bundler can home it in the small shared world-kit chunk instead
   of gluing it to the Create / Shop / Business family web. The
   result-side bits (picker, result renderers, quest chip, A/B
   player) live in CreateResultLeaf; the one shared piece that
   opens the Release / Scheduler desks — ResultChips — lives in
   CreateDeskShared. Keep desk imports out of all three leaf-side
   modules: a desk import here re-glues the family web to the
   frame. */

export function useDeskAuthHeaders() {
  const { getAccessToken } = useAuth();
  return async (): Promise<Record<string, string>> => {
    const token = await getAccessToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  };
}

export function deskInputCls(isLight: boolean): string {
  return `w-full rounded-xl border px-3 py-2 text-sm outline-none transition focus:border-[#d4af37] bdv-touch-target ${
    isLight
      ? "border-[#C9A84C]/40 bg-white/60 text-[#2a1e07] placeholder:text-[#6B5B36]/60"
      : "border-white/10 bg-white/5 text-white placeholder:text-white/35"
  }`;
}

export function DeskTextField({
  isLight,
  label,
  value,
  onChange,
  placeholder,
}: {
  isLight: boolean;
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className={`mb-1 block text-[11px] font-bold uppercase tracking-[0.12em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
        {label}
      </span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={deskInputCls(isLight)}
      />
    </label>
  );
}

export function DeskSelectField({
  isLight,
  label,
  value,
  onChange,
  options,
}: {
  isLight: boolean;
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: ReadonlyArray<{ value: string; label: string }>;
}) {
  return (
    <label className="block">
      <span className={`mb-1 block text-[11px] font-bold uppercase tracking-[0.12em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ colorScheme: isLight ? "light" : "dark" }}
        className={deskInputCls(isLight)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/** The ONE Advanced expander every desk folds its manual fields
 *  behind (Turbo is the desk's face; Advanced is one tap deeper). */
export function AdvancedExpander({
  isLight,
  children,
  defaultOpen = false,
}: {
  isLight: boolean;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`rounded-xl border ${isLight ? "border-[#C9A84C]/40" : "border-white/10"}`}>
      <button
        type="button"
        data-testid="world-create-advanced-toggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={`flex w-full items-center gap-2 px-3 py-2 text-xs font-black uppercase tracking-[0.14em] bdv-touch-target ${
          isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"
        }`}
      >
          {t("worldCreateDesk.advanced")}
        <ChevronDown className={`ml-auto h-4 w-4 transition ${open ? "rotate-180" : ""}`} />
      </button>
      {open ? <div className="space-y-3 px-3 pb-3">{children}</div> : null}
    </div>
  );
}

/** POST /api/generated-clips — the library save SceneStudio makes
 *  the moment a clip lands, shared by the Create desks: a finished
 *  desk clip lands in My Clips like any other. Best-effort like the
 *  page's (the clip already plays in the panel either way); the
 *  boolean lets the desk SAY whether the library copy landed. */
export async function saveGeneratedClipToLibrary(
  authHeaders: () => Promise<Record<string, string>>,
  payload: Record<string, unknown>,
): Promise<boolean> {
  try {
    const res = await fetch("/api/generated-clips", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await authHeaders()) },
      body: JSON.stringify(payload),
    });
    return res.ok;
  } catch {
    return false;
  }
}
