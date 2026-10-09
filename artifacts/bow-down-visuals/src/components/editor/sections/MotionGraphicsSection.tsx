/**
 * MotionGraphicsSection — template-based motion graphics studio panel.
 *
 * 12 data-driven templates across 5 categories:
 * - Animated titles (3): kinetic typography
 * - Lower thirds (3): name/title cards
 * - Subscribe animations (2): subscribe button + bell
 * - Transitions (2): whoosh/zoom
 * - Logo stings (2): animated logo reveals
 *
 * Each template: editable text, brand colors (from Creative Vault when
 * available), duration control, CSS-animated preview, one-click "Add to
 * Timeline" which creates an OverlayItem at the playhead.
 */
import { useMemo, useState } from "react";
import {
  Type, CreditCard, BellRing, Zap, Crown, Clapperboard,
  Plus, Play, Check,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { LucideIcon } from "lucide-react";
import type { OverlayItem, OverlayPosition, OverlayType } from "@/lib/editor-settings";
import type { ArtistVault } from "@/components/ArtistVaultSelector";

/* ─── Template model ─── */

type MotionCategory = "titles" | "lower-thirds" | "subscribe" | "transitions" | "logo-stings";

interface MotionTextField {
  key: string;
  labelKey: string;
  defaultValue: string;
}

interface MotionTemplate {
  id: string;
  category: MotionCategory;
  /** i18n key suffix under motionGraphics.templates.<id> */
  nameKey: string;
  descKey: string;
  icon: LucideIcon;
  overlayType: OverlayType;
  overlayPosition: OverlayPosition;
  /** CSS animation shorthand — used for preview AND playback (mg-* keyframes). */
  motionCss: string;
  textFields: MotionTextField[];
  defaultTextColor: string;
  defaultAccent: string;
  defaultDuration: number;
  defaultSize: number;
  /** Extra inline style hints for the preview renderer. */
  previewKind: "title" | "lower-third" | "subscribe" | "bell" | "transition-wipe" | "transition-zoom" | "logo";
}

const TEMPLATES: MotionTemplate[] = [
  /* ── Animated titles (3) ── */
  {
    id: "kinetic-slam",
    category: "titles",
    nameKey: "kineticSlam", descKey: "kineticSlamDesc",
    icon: Type,
    overlayType: "text", overlayPosition: "center",
    motionCss: "mg-kinetic-slam 1.1s cubic-bezier(.2,.9,.3,1.15) both",
    textFields: [{ key: "line1", labelKey: "textLine", defaultValue: "BOW DOWN" }],
    defaultTextColor: "#C9A84C", defaultAccent: "#C9A84C",
    defaultDuration: 3, defaultSize: 120, previewKind: "title",
  },
  {
    id: "typewriter",
    category: "titles",
    nameKey: "typewriter", descKey: "typewriterDesc",
    icon: Type,
    overlayType: "text", overlayPosition: "center",
    motionCss: "mg-fade-up 0.6s ease-out both",
    textFields: [{ key: "line1", labelKey: "textLine", defaultValue: "The story begins..." }],
    defaultTextColor: "#ffffff", defaultAccent: "#C9A84C",
    defaultDuration: 4, defaultSize: 90, previewKind: "title",
  },
  {
    id: "gold-reveal",
    category: "titles",
    nameKey: "goldReveal", descKey: "goldRevealDesc",
    icon: Crown,
    overlayType: "text", overlayPosition: "center",
    motionCss: "mg-gold-shimmer 2s linear both",
    textFields: [{ key: "line1", labelKey: "textLine", defaultValue: "PREMIERE" }],
    defaultTextColor: "#C9A84C", defaultAccent: "#f5d67b",
    defaultDuration: 3, defaultSize: 110, previewKind: "title",
  },
  /* ── Lower thirds (3) ── */
  {
    id: "classic-bar",
    category: "lower-thirds",
    nameKey: "classicBar", descKey: "classicBarDesc",
    icon: CreditCard,
    overlayType: "lower-third", overlayPosition: "bottom-left",
    motionCss: "mg-bar-slide 0.7s cubic-bezier(.2,.9,.25,1) both",
    textFields: [
      { key: "name", labelKey: "nameField", defaultValue: "THY CHEAT CODE" },
      { key: "title", labelKey: "titleField", defaultValue: "Content Creator" },
    ],
    defaultTextColor: "#ffffff", defaultAccent: "#C9A84C",
    defaultDuration: 4, defaultSize: 80, previewKind: "lower-third",
  },
  {
    id: "minimal-line",
    category: "lower-thirds",
    nameKey: "minimalLine", descKey: "minimalLineDesc",
    icon: CreditCard,
    overlayType: "lower-third", overlayPosition: "bottom-center",
    motionCss: "mg-fade-up 0.8s ease-out both",
    textFields: [
      { key: "name", labelKey: "nameField", defaultValue: "Jane Doe" },
      { key: "title", labelKey: "titleField", defaultValue: "Director" },
    ],
    defaultTextColor: "#ffffff", defaultAccent: "#ffffff",
    defaultDuration: 4, defaultSize: 70, previewKind: "lower-third",
  },
  {
    id: "bold-block",
    category: "lower-thirds",
    nameKey: "boldBlock", descKey: "boldBlockDesc",
    icon: CreditCard,
    overlayType: "lower-third", overlayPosition: "bottom-left",
    motionCss: "mg-slide-up 0.6s cubic-bezier(.2,.9,.3,1.2) both",
    textFields: [
      { key: "name", labelKey: "nameField", defaultValue: "GUEST ARTIST" },
      { key: "title", labelKey: "titleField", defaultValue: "New Single Out Now" },
    ],
    defaultTextColor: "#000000", defaultAccent: "#C9A84C",
    defaultDuration: 4, defaultSize: 80, previewKind: "lower-third",
  },
  /* ── Subscribe (2) ── */
  {
    id: "subscribe-btn",
    category: "subscribe",
    nameKey: "subscribeBtn", descKey: "subscribeBtnDesc",
    icon: BellRing,
    overlayType: "text", overlayPosition: "bottom-right",
    motionCss: "mg-sub-pulse 1.6s ease-in-out infinite",
    textFields: [{ key: "line1", labelKey: "textLine", defaultValue: "SUBSCRIBE" }],
    defaultTextColor: "#ffffff", defaultAccent: "#ff0000",
    defaultDuration: 5, defaultSize: 70, previewKind: "subscribe",
  },
  {
    id: "bell-ring",
    category: "subscribe",
    nameKey: "bellRing", descKey: "bellRingDesc",
    icon: BellRing,
    overlayType: "text", overlayPosition: "top-right",
    motionCss: "mg-bell-ring 1.8s ease-in-out infinite",
    textFields: [{ key: "line1", labelKey: "textLine", defaultValue: "🔔" }],
    defaultTextColor: "#C9A84C", defaultAccent: "#C9A84C",
    defaultDuration: 4, defaultSize: 90, previewKind: "bell",
  },
  /* ── Transitions (2) ── */
  {
    id: "whoosh-wipe",
    category: "transitions",
    nameKey: "whooshWipe", descKey: "whooshWipeDesc",
    icon: Zap,
    overlayType: "color", overlayPosition: "center",
    motionCss: "mg-whoosh-wipe 0.9s ease-in-out both",
    textFields: [],
    defaultTextColor: "#ffffff", defaultAccent: "#C9A84C",
    defaultDuration: 1, defaultSize: 100, previewKind: "transition-wipe",
  },
  {
    id: "zoom-flash",
    category: "transitions",
    nameKey: "zoomFlash", descKey: "zoomFlashDesc",
    icon: Zap,
    overlayType: "color", overlayPosition: "center",
    motionCss: "mg-zoom-flash 0.8s ease-out both",
    textFields: [],
    defaultTextColor: "#ffffff", defaultAccent: "#ffffff",
    defaultDuration: 1, defaultSize: 100, previewKind: "transition-zoom",
  },
  /* ── Logo stings (2) ── */
  {
    id: "crown-reveal",
    category: "logo-stings",
    nameKey: "crownReveal", descKey: "crownRevealDesc",
    icon: Crown,
    overlayType: "text", overlayPosition: "center",
    motionCss: "mg-crown-reveal 1.4s cubic-bezier(.2,.9,.3,1.2) both",
    textFields: [{ key: "line1", labelKey: "textLine", defaultValue: "👑" }],
    defaultTextColor: "#C9A84C", defaultAccent: "#C9A84C",
    defaultDuration: 3, defaultSize: 130, previewKind: "logo",
  },
  {
    id: "gold-sparkle",
    category: "logo-stings",
    nameKey: "goldSparkle", descKey: "goldSparkleDesc",
    icon: Clapperboard,
    overlayType: "text", overlayPosition: "center",
    motionCss: "mg-fade-up 1s ease-out both",
    textFields: [{ key: "line1", labelKey: "textLine", defaultValue: "BOW DOWN VISUALS" }],
    defaultTextColor: "#C9A84C", defaultAccent: "#f5d67b",
    defaultDuration: 3, defaultSize: 100, previewKind: "logo",
  },
];

const CATEGORY_ORDER: MotionCategory[] = ["titles", "lower-thirds", "subscribe", "transitions", "logo-stings"];
const CATEGORY_ICONS: Record<MotionCategory, LucideIcon> = {
  "titles": Type,
  "lower-thirds": CreditCard,
  "subscribe": BellRing,
  "transitions": Zap,
  "logo-stings": Crown,
};

/* ─── Props ─── */

interface MotionGraphicsSectionProps {
  /** Seconds at the playhead — new graphics are placed here. */
  playheadTimeSec: number;
  /** Called with the new overlay item to add to the timeline. */
  onAddToTimeline: (item: Omit<OverlayItem, "id">) => void;
  /** Active artist from Creative Vault (brand colors). */
  activeArtist?: ArtistVault | null;
}

/* ─── Preview renderer ─── */

function TemplatePreview({
  template,
  texts,
  textColor,
  accent,
}: {
  template: MotionTemplate;
  texts: Record<string, string>;
  textColor: string;
  accent: string;
}) {
  const line1 = texts["line1"] ?? "";
  const name = texts["name"] ?? "";
  const title = texts["title"] ?? "";
  const anim = { animation: template.motionCss } as const;

  switch (template.previewKind) {
    case "title":
      return (
        <div className="w-full h-full flex items-center justify-center bg-black/80 px-4">
          <div
            style={{ ...anim, color: textColor, fontWeight: 900, fontSize: "clamp(18px,4vw,34px)", textAlign: "center", textShadow: "2px 2px 8px rgba(0,0,0,0.9)", letterSpacing: "0.06em" }}
          >
            {line1}
          </div>
        </div>
      );
    case "lower-third":
      return (
        <div className="w-full h-full flex items-end justify-start bg-black/80 p-4">
          <div style={anim} className="max-w-full">
            <div style={{ borderLeft: `4px solid ${accent}`, paddingLeft: 12 }}>
              <div style={{ color: textColor, fontWeight: 900, fontSize: "clamp(14px,3vw,22px)" }}>{name}</div>
              <div style={{ color: `${textColor}99`, fontSize: "clamp(11px,2.4vw,15px)", marginTop: 2 }}>{title}</div>
            </div>
          </div>
        </div>
      );
    case "subscribe":
      return (
        <div className="w-full h-full flex items-end justify-end bg-black/80 p-4">
          <div
            style={{ ...anim, background: accent, color: "#fff", fontWeight: 900, fontSize: "clamp(13px,2.8vw,18px)", padding: "10px 22px", borderRadius: 999, letterSpacing: "0.08em" }}
          >
            {line1}
          </div>
        </div>
      );
    case "bell":
      return (
        <div className="w-full h-full flex items-start justify-end bg-black/80 p-4">
          <div style={{ ...anim, fontSize: "clamp(28px,6vw,48px)" }}>{line1}</div>
        </div>
      );
    case "transition-wipe":
      return (
        <div className="w-full h-full bg-black/80 overflow-hidden relative">
          <div
            style={{ ...anim, position: "absolute", top: "-20%", bottom: "-20%", width: "38%", background: `linear-gradient(105deg, transparent, ${accent}, transparent)` }}
          />
        </div>
      );
    case "transition-zoom":
      return (
        <div className="w-full h-full bg-black/80 flex items-center justify-center overflow-hidden">
          <div style={{ ...anim, width: 120, height: 120, borderRadius: "50%", background: `radial-gradient(circle, ${accent} 0%, transparent 70%)` }} />
        </div>
      );
    case "logo":
      return (
        <div className="w-full h-full flex items-center justify-center bg-black/80 px-4">
          <div
            style={{ ...anim, color: textColor, fontWeight: 900, fontSize: "clamp(20px,5vw,40px)", textAlign: "center", textShadow: `0 0 30px ${accent}88`, letterSpacing: "0.1em" }}
          >
            {line1}
          </div>
        </div>
      );
  }
}

/* ─── Main section ─── */

export function MotionGraphicsSection({ playheadTimeSec, onAddToTimeline, activeArtist }: MotionGraphicsSectionProps) {
  const { t } = useTranslation();
  const [selectedId, setSelectedId] = useState<string>(TEMPLATES[0]!.id);
  const [texts, setTexts] = useState<Record<string, Record<string, string>>>(() => {
    const init: Record<string, Record<string, string>> = {};
    for (const tpl of TEMPLATES) {
      init[tpl.id] = {};
      for (const f of tpl.textFields) init[tpl.id]![f.key] = f.defaultValue;
    }
    return init;
  });
  const [colors, setColors] = useState<Record<string, { text: string; accent: string }>>(() => {
    const init: Record<string, { text: string; accent: string }> = {};
    for (const tpl of TEMPLATES) init[tpl.id] = { text: tpl.defaultTextColor, accent: tpl.defaultAccent };
    return init;
  });
  const [durations, setDurations] = useState<Record<string, number>>(() => {
    const init: Record<string, number> = {};
    for (const tpl of TEMPLATES) init[tpl.id] = tpl.defaultDuration;
    return init;
  });
  const [addedId, setAddedId] = useState<string | null>(null);
  const [replayKey, setReplayKey] = useState(0);

  const template = useMemo(() => TEMPLATES.find((x) => x.id === selectedId)!, [selectedId]);
  const tplTexts = texts[selectedId] ?? {};
  const tplColors = colors[selectedId] ?? { text: template.defaultTextColor, accent: template.defaultAccent };
  const tplDuration = durations[selectedId] ?? template.defaultDuration;

  /* Brand colors from Creative Vault (comma-separated string). */
  const brandColors = useMemo(() => {
    const raw = activeArtist?.brand_colors ?? "";
    return raw.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 6);
  }, [activeArtist?.brand_colors]);

  function handleAdd() {
    const start = Math.max(0, playheadTimeSec);
    const item: Omit<OverlayItem, "id"> = {
      sceneId: null,
      startTime: start,
      endTime: start + tplDuration,
      type: template.overlayType,
      content: template.textFields.map((f) => tplTexts[f.key] ?? "").filter(Boolean).join("\n"),
      source: null,
      position: template.overlayPosition,
      size: template.defaultSize,
      opacity: 100,
      animation: "none",
      zIndex: 20,
      color: tplColors.accent,
      textColor: tplColors.text,
      motionCss: template.motionCss,
    };
    onAddToTimeline(item);
    setAddedId(template.id);
    setTimeout(() => setAddedId((cur) => (cur === template.id ? null : cur)), 1800);
  }

  return (
    <div className="space-y-4">
      {/* Category galleries */}
      {CATEGORY_ORDER.map((cat) => {
        const CatIcon = CATEGORY_ICONS[cat];
        const items = TEMPLATES.filter((x) => x.category === cat);
        return (
          <div key={cat}>
            <div className="flex items-center gap-2 mb-2">
              <CatIcon className="h-3.5 w-3.5 text-primary" />
              <h4 className="text-[11px] font-black uppercase tracking-widest text-white/60">
                {t(`motionGraphics.cat.${cat}`, { defaultValue: cat })}
              </h4>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {items.map((tpl) => {
                const Icon = tpl.icon;
                const active = tpl.id === selectedId;
                return (
                  <button
                    key={tpl.id}
                    type="button"
                    onClick={() => setSelectedId(tpl.id)}
                    className={`rounded-xl border p-3 text-left transition-all ${
                      active
                        ? "border-primary/60 bg-primary/10 shadow-[0_0_18px_rgba(212,175,55,0.25)]"
                        : "border-white/10 bg-white/[0.03] hover:border-white/25 hover:bg-white/[0.06]"
                    }`}
                  >
                    <Icon className={`h-4 w-4 mb-1.5 ${active ? "text-primary" : "text-white/50"}`} />
                    <div className="text-xs font-bold text-white leading-tight">
                      {t(`motionGraphics.templates.${tpl.nameKey}`, { defaultValue: tpl.id })}
                    </div>
                    <div className="text-[10px] text-white/35 mt-0.5 leading-tight line-clamp-2">
                      {t(`motionGraphics.templates.${tpl.descKey}`, { defaultValue: "" })}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}

      {/* ── Customizer ── */}
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 space-y-4">
        <h4 className="text-[11px] font-black uppercase tracking-widest text-white/60">
          {t("motionGraphics.customize", { defaultValue: "Customize" })}
        </h4>

        {/* Live preview */}
        <div className="rounded-lg overflow-hidden border border-white/10 aspect-video bg-black">
          <TemplatePreview
            key={`${selectedId}-${replayKey}-${JSON.stringify(tplTexts)}-${tplColors.text}-${tplColors.accent}`}
            template={template}
            texts={tplTexts}
            textColor={tplColors.text}
            accent={tplColors.accent}
          />
        </div>
        <button
          type="button"
          onClick={() => setReplayKey((k) => k + 1)}
          className="text-[11px] text-white/40 hover:text-white flex items-center gap-1"
        >
          <Play className="h-3 w-3" />
          {t("motionGraphics.replay", { defaultValue: "Replay preview" })}
        </button>

        {/* Text fields */}
        {template.textFields.map((f) => (
          <div key={f.key}>
            <label className="text-[11px] font-bold text-white/50 block mb-1">
              {t(`motionGraphics.${f.labelKey}`, { defaultValue: f.labelKey })}
            </label>
            <input
              type="text"
              value={tplTexts[f.key] ?? ""}
              onChange={(e) =>
                setTexts((prev) => ({ ...prev, [selectedId]: { ...prev[selectedId], [f.key]: e.target.value } }))
              }
              className="w-full rounded-lg border border-white/10 bg-black/60 px-3 py-2 text-sm text-white placeholder:text-white/25 focus:border-primary/60 focus:outline-none"
            />
          </div>
        ))}

        {/* Colors */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[11px] font-bold text-white/50 block mb-1">
              {t("motionGraphics.textColor", { defaultValue: "Text color" })}
            </label>
            <input
              type="color"
              value={tplColors.text}
              onChange={(e) => setColors((prev) => ({ ...prev, [selectedId]: { ...prev[selectedId]!, text: e.target.value } }))}
              className="w-full h-9 rounded-lg border border-white/10 bg-black/60 cursor-pointer"
            />
          </div>
          <div>
            <label className="text-[11px] font-bold text-white/50 block mb-1">
              {t("motionGraphics.accentColor", { defaultValue: "Accent color" })}
            </label>
            <input
              type="color"
              value={tplColors.accent}
              onChange={(e) => setColors((prev) => ({ ...prev, [selectedId]: { ...prev[selectedId]!, accent: e.target.value } }))}
              className="w-full h-9 rounded-lg border border-white/10 bg-black/60 cursor-pointer"
            />
          </div>
        </div>

        {/* Brand colors from Creative Vault */}
        {brandColors.length > 0 && (
          <div>
            <label className="text-[11px] font-bold text-white/50 block mb-1.5">
              {t("motionGraphics.brandColors", { defaultValue: "Creative Vault brand colors" })}
            </label>
            <div className="flex gap-2 flex-wrap">
              {brandColors.map((c) => (
                <button
                  key={c}
                  type="button"
                  title={c}
                  onClick={() => setColors((prev) => ({ ...prev, [selectedId]: { ...prev[selectedId]!, accent: c } }))}
                  className="h-8 w-8 rounded-full border-2 border-white/20 hover:border-primary hover:scale-110 transition-all"
                  style={{ background: c }}
                />
              ))}
            </div>
          </div>
        )}

        {/* Duration */}
        <div>
          <label className="text-[11px] font-bold text-white/50 block mb-1">
            {t("motionGraphics.duration", { defaultValue: "Duration" })} — {tplDuration}s
          </label>
          <input
            type="range"
            min={1}
            max={10}
            step={0.5}
            value={tplDuration}
            onChange={(e) => setDurations((prev) => ({ ...prev, [selectedId]: Number(e.target.value) }))}
            className="w-full accent-[#C9A84C]"
          />
        </div>

        {/* Add to timeline */}
        <button
          type="button"
          onClick={handleAdd}
          className={`w-full rounded-xl font-black text-sm py-3 flex items-center justify-center gap-2 transition-all ${
            addedId === template.id
              ? "bg-green-500/20 text-green-400 border border-green-500/40"
              : "bg-primary text-black hover:bg-primary/90 shadow-[0_0_18px_rgba(212,175,55,0.35)]"
          }`}
        >
          {addedId === template.id ? (
            <>
              <Check className="h-4 w-4" />
              {t("motionGraphics.added", { defaultValue: "Added to timeline!" })}
            </>
          ) : (
            <>
              <Plus className="h-4 w-4" />
              {t("motionGraphics.addToTimeline", { defaultValue: "Add to Timeline" })}
            </>
          )}
        </button>
        <p className="text-[10px] text-white/30 text-center">
          {t("motionGraphics.addHint", { defaultValue: "Placed at the playhead" })} — {playheadTimeSec.toFixed(1)}s
        </p>
      </div>
    </div>
  );
}
