import type { ReactNode } from "react";

/* ─── NativeBoard — the Palace Board pattern (NATIVE-PLAN §3.1) ────
   A titled board of rows with headline numbers and at most one
   primary action per row (the action slot). For read-mostly desks:
   Charts, My Studio, the Earnings Board. The board owns the frame
   and the row ground; each lane fills rows with its own data and
   its own one action. */

export interface NativeBoardProps {
  isLight: boolean;
  title: string;
  /** Headline strip above the rows (balances, totals) — optional. */
  headline?: ReactNode;
  children: ReactNode;
}

export function NativeBoard({ isLight, title, headline, children }: NativeBoardProps) {
  return (
    <div data-testid="world-native-board" className="space-y-1.5">
      <p
        className={`px-1 text-xs font-black uppercase tracking-[0.14em] ${
          isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"
        }`}
      >
        {title}
      </p>
      {headline}
      {children}
    </div>
  );
}

export interface NativeBoardRowProps {
  isLight: boolean;
  title: string;
  detail?: string;
  /** Right-aligned quiet fact (a rank, a count, a total). */
  meta?: string;
  /** The row's ONE primary action, if it has one. */
  action?: ReactNode;
  /** The row the walker is standing in / the entry that's live. */
  highlighted?: boolean;
}

export function NativeBoardRow({
  isLight,
  title,
  detail,
  meta,
  action,
  highlighted = false,
}: NativeBoardRowProps) {
  return (
    <div
      data-testid="world-native-board-row"
      className={`flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 ${
        highlighted
          ? "border-[#d4af37] bg-[#d4af37]/10"
          : isLight
            ? "border-[#C9A84C]/40 bg-white/50"
            : "border-white/10 bg-white/5"
      }`}
    >
      <span className="min-w-0">
        <span
          className={`block truncate text-sm font-bold ${
            isLight ? "text-[#2a1e07]" : "text-white"
          }`}
        >
          {title}
        </span>
        {detail ? (
          <span
            className={`block truncate text-xs ${
              isLight ? "text-[#6B5B36]" : "text-white/50"
            }`}
          >
            {detail}
          </span>
        ) : null}
      </span>
      {meta ? (
        <span
          className={`ml-auto text-xs font-semibold ${
            isLight ? "text-[#6B5B36]" : "text-white/50"
          }`}
        >
          {meta}
        </span>
      ) : null}
      {action}
    </div>
  );
}
