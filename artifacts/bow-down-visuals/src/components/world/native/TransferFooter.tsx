import { TRANSFER_BUTTON_LABEL } from "@/lib/world/station-panel";

/* ─── TransferFooter — the one quiet door out (NATIVE-PLAN §3.0) ────
   Every native panel's frame ends with this exact row: the
   station's one-line context on the left, and on the right ONE
   quiet gold-outline button — "Open on the website ↗" — a plain
   anchor to the station's website path, opened in a NEW TAB. It is
   never auto-clicked, never auto-focused, never a redirect; the
   palace tab stays exactly where it was. Uniform on purpose: a
   visitor learns it once and trusts it everywhere. Later pattern
   lanes render this as the last element of their panel body —
   they do not invent their own wording, placement, or styling. */

export interface TransferFooterProps {
  /** Left line: the station's one-line context (its tagline). */
  context: string;
  /** The transfer href — the station's exact former website path,
   *  deep links included (e.g. `/create?panel=song`). */
  websitePath: string;
  isLight: boolean;
}

export function TransferFooter({ context, websitePath, isLight }: TransferFooterProps) {
  return (
    <div
      data-testid="world-native-transfer-footer"
      className={`mt-3 flex flex-wrap items-center gap-2 border-t pt-3 ${
        isLight ? "border-[#C9A84C]/40" : "border-white/10"
      }`}
    >
      <span
        className={`min-w-0 flex-1 truncate text-[11px] font-semibold ${
          isLight ? "text-[#6B5B36]" : "text-white/40"
        }`}
      >
        {context}
      </span>
      <a
        data-testid="world-native-transfer-link"
        href={websitePath}
        target="_blank"
        rel="noopener noreferrer"
        className={`ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-full border border-[#d4af37]/50 px-3 py-1.5 text-xs font-bold transition ${
          isLight
            ? "text-[#7A5A12] hover:border-[#7A5A12] hover:text-[#2a1e07]"
            : "text-[#e8c86a] hover:border-[#d4af37] hover:text-white"
        }`}
      >
        {TRANSFER_BUTTON_LABEL}
      </a>
    </div>
  );
}
