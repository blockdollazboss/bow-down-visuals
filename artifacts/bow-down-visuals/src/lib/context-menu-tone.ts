/**
 * context-menu-tone.ts — the ClipContextMenu panel treatments.
 *
 * dark = the original gold-on-black marble (the protected editor
 * treatment). light = the house light panel recipe (ivory gradient,
 * bronze ink) for theme-adaptive surfaces: the dark panel's
 * text-white classes are repainted to bronze by the light theme's
 * global remaps while its arbitrary-value black background is not,
 * which made menu labels dark-on-black there (Lane V4 item 3).
 */
export interface MenuToneClasses {
  panel: string;
  sheen: string;
  divider: string;
  row: string;
  rowHover: string;
  rowDisabled: string;
  rowDanger: string;
  icon: string;
  iconDisabled: string;
  check: string;
  chevron: string;
}

export function menuToneClasses(tone: "dark" | "light"): MenuToneClasses {
  if (tone === "light") {
    return {
      panel:
        "border-[#C9A84C]/60 bg-gradient-to-b from-[#FCF7EA] to-[#F4E7C3] shadow-[0_12px_40px_rgba(122,90,18,0.35),0_0_18px_rgba(201,168,76,0.15)]",
      sheen: "bg-gradient-to-br from-white/50 via-transparent to-[#C9A84C]/10",
      divider: "bg-gradient-to-r from-transparent via-[#C9A84C]/50 to-transparent",
      row: "text-[#2A1E07]",
      rowHover: "hover:bg-[#C9A84C]/20 hover:text-[#7A5A12]",
      rowDisabled: "text-[#6B5B36]/45 cursor-not-allowed",
      rowDanger: "text-red-700 hover:bg-red-500/10 hover:text-red-800 cursor-pointer",
      icon: "text-[#7A5A12]/80",
      iconDisabled: "text-[#6B5B36]/40",
      check: "text-[#7A5A12]",
      chevron: "text-[#7A5A12]/60",
    };
  }
  return {
    panel:
      "border-[#C9A84C]/40 bg-[#0a0a0a]/[0.98] shadow-[0_12px_40px_rgba(0,0,0,0.8),0_0_18px_rgba(201,168,76,0.12)]",
    sheen: "bg-gradient-to-br from-white/[0.05] via-transparent to-[#C9A84C]/[0.05]",
    divider: "bg-gradient-to-r from-transparent via-[#C9A84C]/30 to-transparent",
    row: "text-white/85",
    rowHover: "hover:bg-[#C9A84C]/15 hover:text-[#f3d98b]",
    rowDisabled: "text-white/25 cursor-not-allowed",
    rowDanger: "text-red-300/90 hover:bg-red-500/10 hover:text-red-200 cursor-pointer",
    icon: "text-[#C9A84C]/70",
    iconDisabled: "text-white/20",
    check: "text-[#C9A84C]",
    chevron: "text-[#C9A84C]/60",
  };
}

