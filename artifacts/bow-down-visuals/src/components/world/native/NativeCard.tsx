import type { ReactNode } from "react";

/* ─── NativeCard — the palace card every native surface sits on ────
   The house panel ground in both themes: ivory card with a bronze
   hairline in light, a quiet white/5 slab with a white/10 edge in
   dark — the same ground the custom panels (Treasury, Kingdom
   Board) already use, factored out so the pattern lanes share it
   instead of re-inventing it per desk. */

export interface NativeCardProps {
  isLight: boolean;
  /** Optional card heading, in the house small-caps gold. */
  title?: string;
  children: ReactNode;
}

export function NativeCard({ isLight, title, children }: NativeCardProps) {
  return (
    <div
      data-testid="world-native-card"
      className={`rounded-2xl border px-4 py-3 ${
        isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"
      }`}
    >
      {title ? (
        <p
          className={`mb-2 text-xs font-black uppercase tracking-[0.14em] ${
            isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"
          }`}
        >
          {title}
        </p>
      ) : null}
      {children}
    </div>
  );
}
