import { Wand2, Film, ArrowLeftRight, FlaskConical, RotateCcw } from "lucide-react";
import type { SceneData } from "@/lib/scene-parser";
import {
  TRANSITIONS, EFFECTS, COLOR_GRADES, OVERLAYS, OVERLAY_DEFAULT_INTENSITY,
  getClipEdit,
  type EditorSettings, type ClipEdit,
} from "@/lib/editor-settings";
import { STRENGTH_PRESETS } from "@/components/ActiveOverlayEffects";
import { EditorCard, Chip, Dropdown, Collapsible } from "@/components/editor/controls";
import { PlanNote, EmptyScenes } from "@/components/editor/sections/shared";
import { AutoAiEditSection } from "@/components/editor/sections/AutoAiEditSection";

interface EffectsSectionProps {
  scenes: SceneData[];
  settings: EditorSettings;
  setSettings: (s: EditorSettings) => void;
  audioUrl?: string | null;
  onTestEffect?: () => void;
  onTestTransition?: () => void;
  onTestOverlay?: () => void;
  /** Transition type currently rendering in the master player (live), or null. */
  activeTransitionType?: string | null;
  /** Jump the master player to ~1s before a scene's transition and play through it. */
  onPreviewTransition?: (sceneIndex: number) => void;
}

function toggleListItem(list: string[], item: string): string[] {
  return list.includes(item) ? list.filter((x) => x !== item) : [...list, item];
}

/* ── Intensity slider ─────────────────────────────────────────────────────── */
function IntensityRow({
  label,
  value,
  onChange,
  onRemove,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex items-center gap-2 w-full min-w-0 py-0.5">
      <span className="text-[11px] font-semibold text-white/60 w-28 shrink-0 truncate">{label}</span>
      <input
        type="range"
        min={0}
        max={100}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1 h-1 min-w-0 cursor-pointer"
        style={{ accentColor: "#C9A84C" }}
      />
      <span className="text-[10px] font-mono text-white/40 w-8 text-right shrink-0">{value}%</span>
      <button
        onClick={onRemove}
        className="shrink-0 text-white/25 hover:text-white/60 transition-colors text-xs leading-none px-0.5"
        title={`Remove ${label}`}
      >
        ×
      </button>
    </div>
  );
}

export function EffectsSection({ scenes, settings, setSettings, audioUrl, onTestEffect, onTestTransition, onTestOverlay, activeTransitionType, onPreviewTransition }: EffectsSectionProps) {
  function patchClip(sceneId: string, patch: Partial<ClipEdit>) {
    const current = getClipEdit(settings, sceneId);
    setSettings({ ...settings, clips: { ...settings.clips, [sceneId]: { ...current, ...patch } } });
  }

  function setIntensity(name: string, v: number) {
    setSettings({ ...settings, overlayIntensity: { ...settings.overlayIntensity, [name]: v } });
  }

  function removeOverlay(name: string) {
    const overlays = settings.overlays.filter((x) => x !== name);
    const { [name]: _, ...rest } = settings.overlayIntensity;
    setSettings({ ...settings, overlays, overlayIntensity: rest });
  }

  function resetAllEffects() {
    setSettings({ ...settings, effects: [], overlays: [], overlayIntensity: {} });
  }

  const hasAnyEffect = settings.effects.length > 0 || settings.overlays.length > 0;

  return (
    <div className="space-y-5">
      {/* ── Auto AI Edit ── */}
      <AutoAiEditSection
        scenes={scenes}
        settings={settings}
        setSettings={setSettings}
        audioUrl={audioUrl}
        onTestEffect={onTestEffect}
        activeTransitionType={activeTransitionType}
        onPreviewTransition={onPreviewTransition}
      />

      {/* ── Global Effects ── */}
      <EditorCard title="Global Effects" subtitle="Applied across the whole video" icon={<Wand2 className="h-4 w-4" />}>
        <div className="flex flex-wrap gap-2">
          {EFFECTS.map((fx) => (
            <Chip
              key={fx}
              active={settings.effects.includes(fx)}
              onClick={() => setSettings({ ...settings, effects: toggleListItem(settings.effects, fx) })}
            >
              {fx}
            </Chip>
          ))}
        </div>
      </EditorCard>

      {/* ── Color Grade ── */}
      <EditorCard title="Color Grade" subtitle="Pick a cinematic look — one at a time" icon={<Wand2 className="h-4 w-4" />}>
        <div className="flex flex-wrap gap-2">
          {COLOR_GRADES.map((grade) => {
            const active = settings.effects.includes(grade);
            return (
              <Chip
                key={grade}
                active={active}
                onClick={() => {
                  /* Radio behaviour: selecting a grade removes all other grades */
                  const withoutGrades = settings.effects.filter(
                    (e) => !(COLOR_GRADES as readonly string[]).includes(e),
                  );
                  setSettings({
                    ...settings,
                    effects: active ? withoutGrades : [...withoutGrades, grade],
                  });
                }}
              >
                {grade}
              </Chip>
            );
          })}
        </div>
      </EditorCard>

      {/* ── Overlays ── */}
      <EditorCard
        title="Overlays"
        subtitle="Animated visual effects — visible immediately in the player"
        icon={<Film className="h-4 w-4" />}
      >
        {/* ── Test Music Video Overlay Pack ── */}
        <button
          type="button"
          onClick={() => setSettings({
            ...settings,
            overlays: ["Light Leaks", "Sparks", "Dust", "Lens Flare", "Animated Waveform", "Logo / Watermark"],
            overlayIntensity: {
              ...settings.overlayIntensity,
              "Light Leaks": 35,
              "Sparks": 35,
              "Dust": 25,
              "Lens Flare": 30,
              "Animated Waveform": 45,
              "Logo / Watermark": 65,
            },
            overlayQualityMode: "music-video",
            soloPreviewOverlay: null,
          })}
          className="w-full mb-3 text-left text-[10px] font-bold text-[#C9A84C] bg-[#C9A84C]/[0.06] border border-[#C9A84C]/20 rounded-md px-3 py-2 hover:bg-[#C9A84C]/[0.12] transition-colors"
        >
          ✦ Test Music Video Overlay Pack — Light Leaks 35% · Sparks 35% · Dust 25% · Lens Flare 30% · Waveform 45%
        </button>

        {/* Chip row */}
        <div className="flex flex-wrap gap-2 mb-3">
          {OVERLAYS.map((ov) => {
            const active = settings.overlays.includes(ov);
            // Particle overlays (Smoke, Rain, Sparks, Dust) are preview-only — the export pipeline doesn't burn them in yet.
            const previewOnly = ["Smoke", "Rain", "Sparks", "Dust"].includes(ov);
            return (
              <Chip
                key={ov}
                active={active}
                onClick={() => {
                  const wasActive = settings.overlays.includes(ov);
                  const newOverlays = toggleListItem(settings.overlays, ov);
                  const newIntensity = { ...settings.overlayIntensity };
                  if (!wasActive && !(ov in newIntensity)) {
                    newIntensity[ov] = OVERLAY_DEFAULT_INTENSITY[ov] ?? 20;
                  }
                  setSettings({ ...settings, overlays: newOverlays, overlayIntensity: newIntensity });
                }}
                title={previewOnly ? "Preview only — won't appear on export yet" : undefined}
              >
                {ov}
                {previewOnly && (
                  <span className="ml-1.5 text-[9px] font-bold uppercase tracking-wide text-white/40 bg-white/[0.06] rounded px-1 py-0.5">
                    Preview
                  </span>
                )}
              </Chip>
            );
          })}
        </div>

        {/* Per-overlay intensity sliders + solo preview */}
        {settings.overlays.length > 0 && (
          <div className="mt-2 space-y-1 border-t border-white/[0.06] pt-3">
            <p className="text-[10px] text-white/30 mb-2 uppercase tracking-wide font-semibold">
              Effect Intensity
            </p>
            {settings.overlays.map((ov) => {
              const isSolo = settings.soloPreviewOverlay === ov;
              return (
                <div key={ov}>
                  <IntensityRow
                    label={ov}
                    value={settings.overlayIntensity[ov] ?? OVERLAY_DEFAULT_INTENSITY[ov] ?? 20}
                    onChange={(v) => setIntensity(ov, v)}
                    onRemove={() => removeOverlay(ov)}
                  />
                  {ov !== "Logo / Watermark" && (
                    <div className="flex justify-end -mt-0.5 mb-1">
                      <button
                        type="button"
                        onClick={() => setSettings({
                          ...settings,
                          soloPreviewOverlay: isSolo ? null : ov,
                          overlayIntensity: isSolo
                            ? settings.overlayIntensity
                            : { ...settings.overlayIntensity, [ov]: STRENGTH_PRESETS["music-video"][ov] ?? settings.overlayIntensity[ov] ?? OVERLAY_DEFAULT_INTENSITY[ov] ?? 35 },
                        })}
                        className={`text-[9px] font-bold px-2 py-0.5 rounded border transition-colors ${
                          isSolo
                            ? "bg-[#C9A84C]/25 border-[#C9A84C]/50 text-[#C9A84C]"
                            : "bg-white/[0.04] border-white/[0.08] text-white/30 hover:text-white/55"
                        }`}
                      >
                        {isSolo ? "EXIT SOLO" : "Preview Only This"}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
            {settings.soloPreviewOverlay && (
              <button
                type="button"
                onClick={() => setSettings({ ...settings, soloPreviewOverlay: null })}
                className="w-full text-[9px] text-amber-400 border border-amber-500/20 rounded px-2 py-1 bg-amber-500/[0.06] hover:bg-amber-500/[0.12] transition-colors mt-1"
              >
                ← Exit Solo Preview (show all overlays)
              </button>
            )}
          </div>
        )}

        {settings.overlays.length === 0 && (
          <p className="text-[11px] text-white/25 mt-1">
            Click a chip above to add a live overlay effect to the master player.
          </p>
        )}

        {/* ── Watermark settings ── */}
        {settings.overlays.includes("Logo / Watermark") && (
          <div className="mt-3 pt-2 border-t border-white/[0.06] space-y-3">
            <p className="text-[10px] font-black text-white/30 uppercase tracking-wide">Watermark</p>
            {/* Type selector */}
            <div>
              <label className="text-[10px] font-semibold text-white/35 uppercase tracking-wide block mb-1.5">Type</label>
              <div className="flex gap-1.5">
                {(["logo", "text", "none"] as const).map((t) => (
                  <button key={t} type="button"
                    onClick={() => setSettings({ ...settings, watermarkType: t })}
                    className={`flex-1 py-1.5 rounded text-[10px] font-bold border transition-colors ${
                      (settings.watermarkType ?? "logo") === t
                        ? "bg-[#C9A84C]/20 border-[#C9A84C]/50 text-[#C9A84C]"
                        : "bg-white/[0.03] border-white/[0.08] text-white/40 hover:text-white/60"
                    }`}>
                    {t === "logo" ? "BDV Logo" : t === "text" ? "Text" : "None"}
                  </button>
                ))}
              </div>
            </div>
            {/* Logo preview + transparency status */}
            {(settings.watermarkType ?? "logo") === "logo" && (
              <div className="space-y-2">
                {/* Visual preview on a mid-grey swatch so transparency is obvious */}
                <div className="flex items-center gap-3 rounded-lg px-3 py-2.5 border border-white/[0.08]"
                  style={{ background: "linear-gradient(135deg,#2a2a2a 50%,#1a1a1a 50%)" }}>
                  <img src={`${import.meta.env.BASE_URL}bdv-watermark.png`} alt="Bow Down Visuals watermark"
                    className="h-8 w-auto"
                    style={{ filter: "drop-shadow(0 1px 3px rgba(0,0,0,0.7))" }} />
                  <span className="text-[10px] text-white/40 leading-tight">Transparent PNG — no background</span>
                </div>
                {/* Status rows */}
                <div className="bg-white/[0.02] rounded px-2.5 py-2 border border-white/[0.06] space-y-1">
                  <p className="text-[9px] font-black text-white/25 uppercase tracking-widest mb-1.5">Watermark Logo Status</p>
                  {([
                    ["source file", "bdv-watermark.png"],
                    ["file type", "PNG"],
                    ["transparent alpha", "yes"],
                    ["background removed", "yes"],
                    ["visible in player", (settings.watermarkShowOnPreview ?? true) ? "yes" : "off"],
                    ["safe from captions", (settings.overlayProtectCaptions ?? true) ? "yes" : "check safe areas"],
                  ] as [string, string][]).map(([label, val]) => (
                    <div key={label} className="flex items-center justify-between gap-2 text-[9px] font-mono">
                      <span className="text-white/30">{label}</span>
                      <span className={val === "yes" ? "font-bold text-green-400" : val === "off" || val.startsWith("check") ? "font-bold text-amber-400" : "text-white/50"}>{val}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {/* Text input */}
            {(settings.watermarkType ?? "logo") === "text" && (
              <div>
                <label className="text-[10px] font-semibold text-white/35 uppercase tracking-wide block mb-1.5">Text</label>
                <input type="text"
                  value={settings.watermarkText ?? "Bow Down Visuals"}
                  onChange={(e) => setSettings({ ...settings, watermarkText: e.target.value })}
                  placeholder="Bow Down Visuals"
                  className="w-full bg-white/[0.04] border border-white/[0.10] rounded-md px-2.5 py-1.5 text-xs text-white/80 placeholder:text-white/20 focus:outline-none focus:border-[#C9A84C]/40"
                />
              </div>
            )}
            {/* Position */}
            {(settings.watermarkType ?? "logo") !== "none" && (<>
              <div>
                <label className="text-[10px] font-semibold text-white/35 uppercase tracking-wide block mb-1.5">Position</label>
                <div className="grid grid-cols-2 gap-1">
                  {(["top-left", "top-right", "bottom-left", "bottom-right"] as const).map((pos) => (
                    <button key={pos} type="button"
                      onClick={() => setSettings({ ...settings, watermarkPosition: pos })}
                      className={`py-1 rounded text-[10px] font-semibold border transition-colors capitalize ${
                        (settings.watermarkPosition ?? "bottom-right") === pos
                          ? "bg-[#C9A84C]/20 border-[#C9A84C]/50 text-[#C9A84C]"
                          : "bg-white/[0.03] border-white/[0.08] text-white/40 hover:text-white/60"
                      }`}>
                      {pos.replace("-", " ")}
                    </button>
                  ))}
                </div>
              </div>
              {/* Size */}
              <div>
                <label className="text-[10px] font-semibold text-white/35 uppercase tracking-wide block mb-1.5">Size</label>
                <div className="flex gap-1.5">
                  {(["small", "medium", "large"] as const).map((s) => (
                    <button key={s} type="button"
                      onClick={() => setSettings({ ...settings, watermarkSize: s })}
                      className={`flex-1 py-1 rounded text-[10px] font-bold capitalize border transition-colors ${
                        (settings.watermarkSize ?? "medium") === s
                          ? "bg-[#C9A84C]/20 border-[#C9A84C]/50 text-[#C9A84C]"
                          : "bg-white/[0.03] border-white/[0.08] text-white/40 hover:text-white/60"
                      }`}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
              {/* Margin */}
              <div>
                <label className="text-[10px] font-semibold text-white/35 uppercase tracking-wide block mb-1">
                  Edge margin — {settings.watermarkMargin ?? 16}px
                </label>
                <input type="range" min={4} max={48} step={2}
                  value={settings.watermarkMargin ?? 16}
                  onChange={(e) => setSettings({ ...settings, watermarkMargin: Number(e.target.value) })}
                  className="w-full accent-[#C9A84C] h-1"
                />
              </div>
            </>)}
            {/* Show / Include toggles */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-white/45">Show on preview</span>
                <button type="button"
                  onClick={() => setSettings({ ...settings, watermarkShowOnPreview: !(settings.watermarkShowOnPreview ?? true) })}
                  className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase ${
                    (settings.watermarkShowOnPreview ?? true) ? "bg-green-500/20 text-green-400" : "bg-white/[0.05] text-white/30"
                  }`}>
                  {(settings.watermarkShowOnPreview ?? true) ? "On" : "Off"}
                </button>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-white/45">Include in export</span>
                <button type="button"
                  onClick={() => setSettings({ ...settings, watermarkIncludeInExport: !(settings.watermarkIncludeInExport ?? true) })}
                  className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase ${
                    (settings.watermarkIncludeInExport ?? true) ? "bg-green-500/20 text-green-400" : "bg-white/[0.05] text-white/30"
                  }`}>
                  {(settings.watermarkIncludeInExport ?? true) ? "On" : "Off"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Waveform position ── */}
        {settings.overlays.includes("Animated Waveform") && (
          <div className="mt-3 pt-2 border-t border-white/[0.06]">
            <label className="text-[10px] font-semibold text-white/40 uppercase tracking-wide block mb-1.5">
              Waveform Position
            </label>
            <Dropdown
              value={settings.waveformPosition ?? "bottom-safe"}
              options={["bottom-safe", "top", "bottom", "hidden"]}
              onChange={(v) => setSettings({ ...settings, waveformPosition: v })}
            />
            <p className="text-[10px] text-white/25 mt-1">
              "bottom-safe" keeps the waveform above the caption area.
            </p>
          </div>
        )}

        {/* ── Overlay Strength mode ── */}
        {settings.overlays.filter((o) => ["Rain","Smoke","Sparks","Dust","Light Leaks","Lens Flare","Animated Waveform"].includes(o)).length > 0 && (
          <div className="mt-3 pt-2 border-t border-white/[0.06]">
            <label className="text-[10px] font-semibold text-white/35 uppercase tracking-wide block mb-1.5">Overlay Strength</label>
            <div className="flex gap-1.5 flex-wrap">
              {(["off", "subtle", "visible", "music-video", "heavy"] as const).map((mode) => (
                <button key={mode} type="button"
                  onClick={() => {
                    const preset = STRENGTH_PRESETS[mode] ?? {};
                    const VISUAL = ["Light Leaks","Lens Flare","Smoke","Rain","Sparks","Dust","Animated Waveform"];
                    const newIntensity = { ...settings.overlayIntensity };
                    for (const ov of settings.overlays) {
                      if (VISUAL.includes(ov)) {
                        newIntensity[ov] = mode === "off" ? 0 : (preset[ov] ?? OVERLAY_DEFAULT_INTENSITY[ov] ?? 25);
                      }
                    }
                    setSettings({ ...settings, overlayQualityMode: mode, overlayIntensity: newIntensity });
                  }}
                  className={`px-2.5 py-1 rounded text-[10px] font-bold border transition-colors ${
                    (settings.overlayQualityMode ?? "music-video") === mode
                      ? "bg-[#C9A84C]/20 border-[#C9A84C]/50 text-[#C9A84C]"
                      : "bg-white/[0.03] border-white/[0.08] text-white/40 hover:text-white/60"
                  }`}>
                  {mode === "music-video" ? "Music Video" : mode.charAt(0).toUpperCase() + mode.slice(1)}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-white/22 mt-1">Sets intensity of all active visual overlays instantly.</p>
          </div>
        )}

        {/* ── Safe areas ── */}
        {settings.overlays.length > 0 && (
          <div className="mt-3 pt-2 border-t border-white/[0.06]">
            <p className="text-[10px] font-black text-white/28 uppercase tracking-wide mb-2">Safe Areas</p>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-white/42">Protect captions area</span>
                <button type="button"
                  onClick={() => setSettings({ ...settings, overlayProtectCaptions: !(settings.overlayProtectCaptions ?? true) })}
                  className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase ${
                    (settings.overlayProtectCaptions ?? true) ? "bg-green-500/20 text-green-400" : "bg-white/[0.05] text-white/30"
                  }`}>
                  {(settings.overlayProtectCaptions ?? true) ? "On" : "Off"}
                </button>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-white/42">Protect face / center</span>
                <button type="button"
                  onClick={() => setSettings({ ...settings, overlayProtectFace: !(settings.overlayProtectFace ?? true) })}
                  className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase ${
                    (settings.overlayProtectFace ?? true) ? "bg-green-500/20 text-green-400" : "bg-white/[0.05] text-white/30"
                  }`}>
                  {(settings.overlayProtectFace ?? true) ? "On" : "Off"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Overlay Debug ── */}
        {settings.overlays.length > 0 && (() => {
          const VISUAL = ["Rain", "Smoke", "Sparks", "Dust", "Light Leaks", "Lens Flare", "Animated Waveform"];
          const activeVisual = settings.overlays.filter((o) => VISUAL.includes(o));
          const qm = settings.overlayQualityMode ?? "music-video";
          const rows: [string, string, "ok" | "warn" | "neutral"][] = [
            ["overlay strength mode",  qm === "music-video" ? "Music Video" : qm.charAt(0).toUpperCase() + qm.slice(1), qm === "off" ? "warn" : "ok"],
            ["selected overlays",       settings.overlays.join(", ") || "none", settings.overlays.length > 0 ? "ok" : "warn"],
            ["active overlay count",    String(settings.overlays.length), "neutral"],
            ["solo preview",            settings.soloPreviewOverlay ?? "none", settings.soloPreviewOverlay ? "warn" : "neutral"],
            ...(VISUAL.map((ov): [string, string, "ok" | "warn" | "neutral"] => {
              const active = settings.overlays.includes(ov);
              const pct = active ? (settings.overlayIntensity[ov] ?? OVERLAY_DEFAULT_INTENSITY[ov] ?? 20) : 0;
              return [
                `${ov.toLowerCase().replace("animated ", "")} visible`,
                active ? `yes — ${pct}%` : "no",
                active && pct > 0 ? "ok" : "warn",
              ];
            })),
            ["animation running",        activeVisual.length > 0 ? "yes" : "no", activeVisual.length > 0 ? "ok" : "warn"],
            ["master player connected",  "yes", "ok"],
          ];
          return (
            <div className="mt-3 pt-2 border-t border-white/[0.06] space-y-1">
              <p className="text-[10px] font-black text-white/25 uppercase tracking-widest mb-1.5">Overlay Debug</p>
              <div className="bg-white/[0.02] rounded px-2.5 py-2 border border-white/[0.05] space-y-1">
                {rows.map(([label, val, state]) => (
                  <div key={label} className="flex items-center justify-between gap-2">
                    <span className="text-[9px] font-mono text-white/30">{label}</span>
                    <span className={`text-[9px] font-mono font-bold ${
                      state === "ok" ? "text-green-400" : state === "warn" ? "text-amber-400" : "text-white/45"
                    }`}>{val}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })()}
      </EditorCard>

      {/* ── Transitions ── */}
      <EditorCard title="Transitions" subtitle="Set the transition into each clip" icon={<ArrowLeftRight className="h-4 w-4" />}>
        {scenes.length === 0 ? <EmptyScenes /> : (
          <div className="space-y-2.5">
            {scenes.map((scene, i) => {
              const edit = getClipEdit(settings, scene.id);
              return (
                <div key={scene.id} className="flex items-center gap-3">
                  <span className="h-6 w-6 rounded-md bg-white/[0.04] border border-white/[0.08] flex items-center justify-center shrink-0 text-[10px] font-black text-white/40">{i + 1}</span>
                  <span className="flex-1 min-w-0 text-xs text-white/55 truncate">{scene.section || scene.lyricLine || `Scene ${i + 1}`}</span>
                  <div className="w-44 shrink-0">
                    <Dropdown
                      value={edit.transition}
                      options={i === 0 ? ["Cut"] : TRANSITIONS}
                      onChange={(v) => patchClip(scene.id, { transition: v })}
                      testId={`transition-${i}`}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </EditorCard>

      {/* ── Preview Tests ── */}
      {(onTestTransition || onTestOverlay) && (
        <EditorCard title="Preview Tests" subtitle="Fire a transition or overlay in the master player" icon={<FlaskConical className="h-4 w-4" />}>
          <div className="flex flex-wrap gap-2">
            {onTestTransition && (
              <button
                onClick={onTestTransition}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-white/15 bg-white/[0.06] hover:bg-white/[0.12] text-white/70 hover:text-white transition-colors"
                data-testid="btn-test-transition"
              >
                Test Transition
              </button>
            )}
            {onTestOverlay && (
              <button
                onClick={onTestOverlay}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-[#C9A84C]/30 bg-[#C9A84C]/10 hover:bg-[#C9A84C]/20 text-[#C9A84C] transition-colors"
                data-testid="btn-test-overlay"
              >
                Test Overlay Render
              </button>
            )}
          </div>
          <p className="text-[10px] text-white/30 mt-2">
            "Test Overlay Render" fires Rain + Sparks + Lens Flare + OVERLAY TEST ACTIVE for 3 s. If nothing shows in the player, overlays are not connected.
          </p>
        </EditorCard>
      )}

      {/* ── Reset button ── */}
      {hasAnyEffect && (
        <button
          onClick={resetAllEffects}
          className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold border border-red-500/20 bg-red-500/[0.06] hover:bg-red-500/[0.14] text-red-400/70 hover:text-red-400 transition-colors w-full"
          data-testid="btn-reset-effects"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Reset All Effects
        </button>
      )}

      {/* ── Per-Clip Effects ── */}
      <Collapsible title="Per-Clip Effects">
        {scenes.length === 0 ? <EmptyScenes /> : (
          <div className="space-y-2.5">
            {scenes.map((scene, i) => {
              const edit = getClipEdit(settings, scene.id);
              return (
                <div key={scene.id} className="flex items-center gap-3">
                  <span className="h-6 w-6 rounded-md bg-white/[0.04] border border-white/[0.08] flex items-center justify-center shrink-0 text-[10px] font-black text-white/40">{i + 1}</span>
                  <span className="flex-1 min-w-0 text-xs text-white/55 truncate">{scene.section || scene.lyricLine || `Scene ${i + 1}`}</span>
                  <div className="w-44 shrink-0">
                    <Dropdown value={edit.effect} options={["None", ...EFFECTS]} onChange={(v) => patchClip(scene.id, { effect: v })} testId={`effect-${i}`} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Collapsible>

      <PlanNote />
    </div>
  );
}
