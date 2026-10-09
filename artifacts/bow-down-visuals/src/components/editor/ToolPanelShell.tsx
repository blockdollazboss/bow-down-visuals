import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Clapperboard,
  Mic2,
  Mic,
  Languages,
  Recycle,
  Sparkles,
  Wand2,
  Image as ImageIcon,
  Palette,
  MapPin,
  Fingerprint,
  Laugh,
  Timer,
  AudioWaveform,
  Captions,
  Crown,
  Film,
  Zap,
} from "lucide-react";
import { useTranslation } from "react-i18next";

/* ── Per-tool thematic identity. All inside the gold-black luxury family,
   each tool gets a signature accent so its panel feels designed for it. ── */

export type VisualVibesTool =
  | "promo-clips"
  | "lyric-video"
  | "translate"
  | "repurpose"
  | "upscale"
  | "cartoonize"
  | "thumbnails"
  | "vibes"
  | "locations"
  | "style-stealer"
  | "meme-machine"
  | "three-second-lab"
  | "beat-sync"
  | "captions"
  | "effects"
  | "motion"
  | "branding"
  | "lip-sync";

interface ToolTheme {
  /** Signature accent (glows, badge border, watermark tint). */
  accent: string;
  /** Soft accent at low alpha for the badge pill. */
  accentSoft: string;
  /** Primary radial glow color. */
  glow1: string;
  /** Secondary radial glow color. */
  glow2: string;
  /** Watermark icon. */
  icon: LucideIcon;
}

const TOOL_THEMES: Record<VisualVibesTool, ToolTheme> = {
  "promo-clips":   { accent: "#ff7a45", accentSoft: "rgba(255,122,69,0.12)",  glow1: "rgba(255,90,40,0.16)",  glow2: "rgba(255,160,60,0.08)",  icon: Clapperboard },
  "lyric-video":   { accent: "#a78bfa", accentSoft: "rgba(167,139,250,0.12)",  glow1: "rgba(139,92,246,0.16)",  glow2: "rgba(196,132,252,0.08)",  icon: Mic2 },
  "translate":     { accent: "#38bdf8", accentSoft: "rgba(56,189,248,0.12)",   glow1: "rgba(56,189,248,0.15)",  glow2: "rgba(125,211,252,0.07)",  icon: Languages },
  "repurpose":     { accent: "#2dd4bf", accentSoft: "rgba(45,212,191,0.12)",   glow1: "rgba(45,212,191,0.15)",  glow2: "rgba(94,234,212,0.07)",   icon: Recycle },
  "upscale":       { accent: "#22d3ee", accentSoft: "rgba(34,211,238,0.12)",   glow1: "rgba(34,211,238,0.15)",  glow2: "rgba(165,243,252,0.07)",  icon: Sparkles },
  "cartoonize":    { accent: "#e879f9", accentSoft: "rgba(232,121,249,0.12)",  glow1: "rgba(232,121,249,0.16)",  glow2: "rgba(240,171,252,0.08)",  icon: Wand2 },
  "thumbnails":    { accent: "#fbbf24", accentSoft: "rgba(251,191,36,0.12)",   glow1: "rgba(251,191,36,0.16)",  glow2: "rgba(253,224,71,0.08)",   icon: ImageIcon },
  "vibes":         { accent: "#d4a017", accentSoft: "rgba(212,160,23,0.14)",   glow1: "rgba(212,160,23,0.18)",  glow2: "rgba(234,179,8,0.08)",    icon: Palette },
  "locations":     { accent: "#34d399", accentSoft: "rgba(52,211,153,0.12)",   glow1: "rgba(52,211,153,0.15)",  glow2: "rgba(110,231,183,0.07)",  icon: MapPin },
  "style-stealer": { accent: "#8b5cf6", accentSoft: "rgba(139,92,246,0.12)",   glow1: "rgba(124,58,237,0.18)",  glow2: "rgba(167,139,250,0.08)",  icon: Fingerprint },
  "meme-machine":  { accent: "#a3e635", accentSoft: "rgba(163,230,53,0.12)",   glow1: "rgba(163,230,53,0.15)",  glow2: "rgba(190,242,100,0.07)",  icon: Laugh },
  "three-second-lab": { accent: "#fb923c", accentSoft: "rgba(251,146,60,0.12)", glow1: "rgba(251,146,60,0.16)", glow2: "rgba(253,186,116,0.08)",  icon: Timer },
  "beat-sync":    { accent: "#fb7185", accentSoft: "rgba(251,113,133,0.12)",   glow1: "rgba(251,113,133,0.16)", glow2: "rgba(253,164,175,0.08)",  icon: AudioWaveform },
  "captions":     { accent: "#fde047", accentSoft: "rgba(253,224,71,0.12)",    glow1: "rgba(253,224,71,0.16)",  glow2: "rgba(254,240,138,0.08)",  icon: Captions },
  "effects":      { accent: "#f472b6", accentSoft: "rgba(244,114,182,0.12)",   glow1: "rgba(244,114,182,0.16)",  glow2: "rgba(249,168,212,0.08)",  icon: Zap },
  "motion":       { accent: "#60a5fa", accentSoft: "rgba(96,165,250,0.12)",    glow1: "rgba(96,165,250,0.16)",   glow2: "rgba(147,197,253,0.08)",  icon: Film },
  "branding":     { accent: "#f59e0b", accentSoft: "rgba(245,158,11,0.12)",    glow1: "rgba(245,158,11,0.16)",   glow2: "rgba(252,211,77,0.08)",   icon: Crown },
  "lip-sync":     { accent: "#f9a8d4", accentSoft: "rgba(249,168,212,0.12)",   glow1: "rgba(249,168,212,0.16)",  glow2: "rgba(251,207,232,0.08)",  icon: Mic },
};

export function toolTheme(tool: VisualVibesTool): ToolTheme {
  return TOOL_THEMES[tool];
}

interface ToolPanelShellProps {
  tool: VisualVibesTool;
  /** Small uppercase kicker shown in the badge pill. */
  kicker: ReactNode;
  /** Big title (may include highlighted spans). */
  title: ReactNode;
  /** One-line description under the title. */
  subtitle?: ReactNode;
  /** Price pill, e.g. "200 VB". Omit when free. */
  price?: ReactNode;
  children: ReactNode;
}

/**
 * Unified shell for every Visual Vibes tool panel.
 * Gives each tool a designed, thematic backdrop (signature gradient +
 * radial glows + giant watermark icon) inside the gold-black luxury family,
 * with one consistent header structure: kicker badge, title, subtitle,
 * price pill, then the tool's interactive content.
 */
export function ToolPanelShell({ tool, kicker, title, subtitle, price, children }: ToolPanelShellProps) {
  const { t } = useTranslation();
  const theme = TOOL_THEMES[tool];
  const Watermark = theme.icon;

  return (
    <div className="relative min-h-full text-white overflow-hidden">
      {/* ── Thematic ambient background ── */}
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        {/* Base wash */}
        <div
          className="absolute inset-0"
          style={{
            background: `linear-gradient(165deg, ${theme.glow1} 0%, transparent 45%, transparent 60%, ${theme.glow2} 100%)`,
          }}
        />
        {/* Top glow */}
        <div
          className="absolute -top-24 left-1/2 h-64 w-[130%] -translate-x-1/2 rounded-full blur-[90px]"
          style={{ background: theme.glow1 }}
        />
        {/* Bottom glow */}
        <div
          className="absolute -bottom-28 -left-16 h-56 w-[120%] rounded-full blur-[100px]"
          style={{ background: theme.glow2 }}
        />
        {/* Giant watermark icon */}
        <Watermark
          className="absolute -right-8 top-16 h-44 w-44 rotate-[-8deg]"
          style={{ color: theme.accent, opacity: 0.07 }}
          strokeWidth={1}
        />
        {/* Fine gold hairline at the top */}
        <div
          className="absolute inset-x-0 top-0 h-px"
          style={{ background: `linear-gradient(90deg, transparent, ${theme.accent}55, transparent)` }}
        />
      </div>

      {/* ── Header ── */}
      <div className="relative px-4 pt-5 pb-1 sm:px-5">
        <div
          className="mb-3 inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em]"
          style={{ borderColor: `${theme.accent}55`, background: theme.accentSoft, color: theme.accent }}
        >
          <Watermark className="h-3 w-3" />
          {kicker}
        </div>
        <h2 className="text-[26px] leading-[1.08] font-black tracking-tight text-white">
          {title}
        </h2>
        {subtitle ? (
          <p className="mt-2 text-[13px] leading-relaxed text-white/55 max-w-md">{subtitle}</p>
        ) : null}
        {price ? (
          <div
            className="mt-3 inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-black"
            style={{ borderColor: `${theme.accent}44`, background: "rgba(0,0,0,0.45)", color: theme.accent }}
          >
            {price}
          </div>
        ) : null}
      </div>

      {/* ── Tool content ── */}
      <div className="relative px-4 pb-8 pt-3 sm:px-5">
        {children}
      </div>

      <span className="sr-only">
        {t("videoEditor.toolPanel", { defaultValue: "Tool panel" })}
      </span>
    </div>
  );
}
