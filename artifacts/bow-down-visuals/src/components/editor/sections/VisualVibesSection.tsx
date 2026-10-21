import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Palette, RotateCcw, Sparkles } from "lucide-react";
import type { CaptionStylePreset, EditorSettings } from "@/lib/editor-settings";

/* ── Visual Vibes: one-click visual mood presets ──────────────────────────
 * Pure settings presets over EXISTING systems — FREE (no AI/compute, no
 * credit charge, no registry entry). Each vibe applies a curated bundle of:
 *   • settings.overlays + overlayIntensity (OVERLAYS catalog)
 *   • settings.effects (EFFECT_CSS_FILTERS keys — includes the COLOR_GRADES
 *     grade names; previewed live via CSS and burned true on export)
 *   • settings.captions.stylePreset
 * Lives ONLY in the video editor rail ("Vibes" tab) — not a page, not a
 * sidebar item. Reset restores the user's own pre-vibe settings snapshot. */

interface Vibe {
  id: string;
  overlays: string[];
  intensity: Record<string, number>;
  /** Effect keys incl. a color-grade name (global, export-safe). */
  effects: string[];
  captionStyle: CaptionStylePreset;
  /** Card preview gradient (gold-and-black theme accents). */
  gradient: string;
  /** Small accent dot color for the card. */
  accent: string;
}

const VIBES: Vibe[] = [
  {
    id: "dark-luxury",
    overlays: ["Dust", "Lens Flare"],
    intensity: { Dust: 40, "Lens Flare": 55 },
    effects: ["Luxury Gold", "Vignette", "Film Grain"],
    captionStyle: "gold-hiphop",
    gradient: "linear-gradient(135deg, #0a0a0a 0%, #3d2c05 55%, #d4af37 130%)",
    accent: "#d4af37",
  },
  {
    id: "vibrant-pop",
    overlays: ["Sparks"],
    intensity: { Sparks: 70 },
    effects: ["Vibrant Pop", "Glow"],
    captionStyle: "viral-shorts",
    gradient: "linear-gradient(135deg, #1a0533 0%, #7b2ff7 55%, #f107a3 130%)",
    accent: "#f107a3",
  },
  {
    id: "cinematic",
    overlays: ["Dust", "Light Leaks"],
    intensity: { Dust: 55, "Light Leaks": 45 },
    effects: ["Cinematic Contrast", "Cinematic Bars", "Film Grain"],
    captionStyle: "boxed",
    gradient: "linear-gradient(135deg, #050505 0%, #1c1c22 60%, #4a4a58 130%)",
    accent: "#9aa0b4",
  },
  {
    id: "noir",
    overlays: ["Smoke"],
    intensity: { Smoke: 60 },
    effects: ["Black & White", "Vignette", "Film Grain"],
    captionStyle: "minimal",
    gradient: "linear-gradient(135deg, #000000 0%, #2b2b2b 60%, #6b6b6b 130%)",
    accent: "#cfcfcf",
  },
  {
    id: "golden-hour",
    overlays: ["Light Leaks", "Lens Flare"],
    intensity: { "Light Leaks": 60, "Lens Flare": 50 },
    effects: ["Warm Grade", "Glow"],
    captionStyle: "gold-hiphop",
    gradient: "linear-gradient(135deg, #2b1200 0%, #c2570b 55%, #ffd97a 130%)",
    accent: "#ffb347",
  },
  {
    id: "neon-nights",
    overlays: ["Rain", "Sparks"],
    intensity: { Rain: 65, Sparks: 50 },
    effects: ["Street Night", "Neon Glow", "Vignette"],
    captionStyle: "neon-glow",
    gradient: "linear-gradient(135deg, #020617 0%, #1e1b4b 50%, #00f0ff 140%)",
    accent: "#00f0ff",
  },
  {
    id: "vintage-film",
    overlays: ["Dust", "Light Leaks"],
    intensity: { Dust: 75, "Light Leaks": 40 },
    effects: ["VHS", "Film Grain", "Vignette"],
    captionStyle: "karaoke",
    gradient: "linear-gradient(135deg, #1c1410 0%, #6b4a2f 55%, #d9b98c 130%)",
    accent: "#d9b98c",
  },
  {
    id: "dreamy",
    overlays: ["Smoke", "Light Leaks"],
    intensity: { Smoke: 45, "Light Leaks": 55 },
    effects: ["Cool Grade", "Glow"],
    captionStyle: "pill-pop",
    gradient: "linear-gradient(135deg, #0d1b2a 0%, #415a77 55%, #e0c3fc 130%)",
    accent: "#e0c3fc",
  },
  /* ── Decade Filter: era looks (free, same preset engine) ─────────── */
  {
    id: "90s",
    overlays: ["Dust", "Light Leaks"],
    intensity: { Dust: 70, "Light Leaks": 35 },
    effects: ["VHS", "Film Grain", "Warm Grade"],
    captionStyle: "karaoke",
    gradient: "linear-gradient(135deg, #1a0f2e 0%, #5b2a86 55%, #ff6ec7 130%)",
    accent: "#ff6ec7",
  },
  {
    id: "y2k",
    overlays: ["Sparks", "Lens Flare"],
    intensity: { Sparks: 60, "Lens Flare": 50 },
    effects: ["Vibrant Pop", "Glow"],
    captionStyle: "viral-shorts",
    gradient: "linear-gradient(135deg, #001a33 0%, #0066cc 50%, #00ffcc 130%)",
    accent: "#00ffcc",
  },
  {
    id: "80s",
    overlays: ["Light Leaks", "Dust"],
    intensity: { "Light Leaks": 65, Dust: 40 },
    effects: ["Warm Grade", "VHS", "Neon Glow"],
    captionStyle: "neon-glow",
    gradient: "linear-gradient(135deg, #2b0033 0%, #cc00ff 50%, #ff9900 130%)",
    accent: "#ff9900",
  },
  {
    id: "70s-film",
    overlays: ["Dust", "Smoke"],
    intensity: { Dust: 80, Smoke: 30 },
    effects: ["Warm Grade", "Film Grain", "Vignette"],
    captionStyle: "boxed",
    gradient: "linear-gradient(135deg, #2e1a0a 0%, #8b5a2b 55%, #e8c87a 130%)",
    accent: "#e8c87a",
  },
];

/** Vibe-relevant slice of settings, for active-vibe matching. */
function vibeFingerprint(s: EditorSettings) {
  return JSON.stringify({
    o: [...s.overlays].sort(),
    i: Object.fromEntries(Object.entries(s.overlayIntensity).sort()),
    e: [...s.effects].sort(),
    c: s.captions.stylePreset,
  });
}

function matchesVibe(s: EditorSettings, vibe: Vibe): boolean {
  const probe: EditorSettings = {
    ...s,
    overlays: [...vibe.overlays],
    overlayIntensity: { ...vibe.intensity },
    effects: [...vibe.effects],
    captions: { ...s.captions, stylePreset: vibe.captionStyle },
  };
  return vibeFingerprint(s) === vibeFingerprint(probe);
}

interface VisualVibesSectionProps {
  settings: EditorSettings;
  setSettings: (s: EditorSettings) => void;
  /** When true, skips the internal header (a shell provides it). */
  bare?: boolean;
}

export function VisualVibesSection({ settings, setSettings, bare }: VisualVibesSectionProps) {
  const { t } = useTranslation();
  /** Snapshot of the user's own settings before the first vibe apply (Reset target). */
  const [preVibeSettings, setPreVibeSettings] = useState<EditorSettings | null>(null);

  const activeVibe: Vibe | null = VIBES.find((v) => matchesVibe(settings, v)) ?? null;

  const applyVibe = (vibe: Vibe) => {
    if (!preVibeSettings) setPreVibeSettings(settings);
    setSettings({
      ...settings,
      overlays: [...vibe.overlays],
      overlayIntensity: { ...vibe.intensity },
      effects: [...vibe.effects],
      captions: { ...settings.captions, stylePreset: vibe.captionStyle },
    });
  };

  const resetVibes = () => {
    if (preVibeSettings) setSettings(preVibeSettings);
    setPreVibeSettings(null);
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      {!bare && (
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-black text-white flex items-center gap-2">
            <Palette className="h-4 w-4 text-primary" />
            {t("videoEditor.vibesTitle", { defaultValue: "Vibes" })}
          </h3>
          <p className="text-[11px] text-white/50 mt-1 leading-relaxed">
            {t("videoEditor.vibesDesc", {
              defaultValue: "One-tap mood presets. Each vibe styles your overlays, effects, color grade, and captions instantly — free, no Visual Bucs.",
            })}
          </p>
        </div>
      </div>
      )}

      {/* Active vibe banner + reset */}
      <div className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
        <div className="text-[11px] text-white/60">
          {activeVibe ? (
            <span className="flex items-center gap-1.5">
              <span
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ background: activeVibe.accent }}
              />
              <span className="text-white font-semibold">
                {t(`videoEditor.vibe_${activeVibe.id.replace(/-/g, "_")}`, {
                  defaultValue: activeVibe.id.split("-").map((w) => w[0].toUpperCase() + w.slice(1)).join(" "),
                })}
              </span>
              <span className="text-white/40">{t("videoEditor.vibesActive", { defaultValue: "active" })}</span>
            </span>
          ) : (
            <span>
              {preVibeSettings
                ? t("videoEditor.vibesCustom", { defaultValue: "Custom — tweaked after a vibe" })
                : t("videoEditor.vibesNone", { defaultValue: "No vibe applied — your own settings" })}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={resetVibes}
          disabled={!preVibeSettings}
          className="flex items-center gap-1.5 text-[11px] font-bold text-white/60 hover:text-white border border-white/15 hover:border-white/30 rounded-lg px-2.5 py-1.5 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          data-testid="vibes-reset"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          {t("videoEditor.vibesReset", { defaultValue: "Reset" })}
        </button>
      </div>

      {/* Vibe cards */}
      <div className="grid grid-cols-2 gap-2.5">
        {VIBES.map((vibe) => {
          const isActive = activeVibe?.id === vibe.id;
          return (
            <button
              key={vibe.id}
              type="button"
              onClick={() => applyVibe(vibe)}
              data-testid={`vibe-${vibe.id}`}
              className={`group relative overflow-hidden rounded-xl border text-left transition-all ${
                isActive
                  ? "border-primary ring-1 ring-primary/50"
                  : "border-white/10 hover:border-primary/50"
              }`}
            >
              {/* Mood preview */}
              <div className="h-20 w-full relative" style={{ background: vibe.gradient }}>
                <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
                {isActive && (
                  <div className="absolute top-1.5 right-1.5 h-5 w-5 rounded-full bg-primary flex items-center justify-center">
                    <Check className="h-3 w-3 text-black" strokeWidth={3} />
                  </div>
                )}
              </div>
              {/* Label */}
              <div className="px-2.5 py-2 bg-[#0d0d0d]">
                <div className="text-[11px] font-black text-white leading-tight">
                  {t(`videoEditor.vibe_${vibe.id.replace(/-/g, "_")}`, {
                    defaultValue: vibe.id.split("-").map((w) => w[0].toUpperCase() + w.slice(1)).join(" "),
                  })}
                </div>
                <div className="text-[9px] text-white/40 mt-0.5 leading-tight">
                  {t(`videoEditor.vibe_${vibe.id.replace(/-/g, "_")}_desc`, {
                    defaultValue: vibeDesc(vibe),
                  })}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Free note */}
      <p className="text-[10px] text-white/35 flex items-center gap-1.5">
        <Sparkles className="h-3 w-3 text-primary/70" />
        {t("videoEditor.vibesFree", {
          defaultValue: "Vibes are pure settings — no AI, no Visual Bucs charged. Undo works as normal.",
        })}
      </p>
    </div>
  );
}

/** Short human-readable summary of what a vibe applies (fallback when no i18n key). */
function vibeDesc(vibe: Vibe): string {
  const parts: string[] = [];
  if (vibe.effects.length > 0) parts.push(vibe.effects.slice(0, 2).join(" · "));
  if (vibe.overlays.length > 0) parts.push(vibe.overlays.join(" + "));
  return parts.join(" · ");
}
