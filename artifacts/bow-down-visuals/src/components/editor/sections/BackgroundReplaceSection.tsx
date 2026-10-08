import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ImageIcon, Loader2, AlertTriangle, Sparkles, Info } from "lucide-react";
import type { SceneData } from "@/lib/scene-parser";
import type { EditorSettings } from "@/lib/editor-settings";
import { EditorCard } from "@/components/editor/controls";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { useToast } from "@/hooks/use-toast";
import { OutOfCredits } from "@/components/OutOfCredits";

/* ── AI Background Replace ───────────────────────────────────────────────
 * For talking-head clips shot WITHOUT a green screen: pick an AI
 * background preset and swap the real background for it.
 *
 * HONEST CAPABILITY STATE (2026-10-08): no subject-segmentation provider
 * is wired in the api-server, so POST /api/wave9b/bg/replace returns 503
 * and NEVER charges. This UI therefore shows the preset gallery + the
 * before/after toggle shell, and reports the unavailable state plainly —
 * it never fakes a result. When a provider is connected, resultUrl fills
 * and the toggle compares before/after on the timeline.
 *
 * NOT a duplicate of Pro Tools Chroma Key: chroma key needs actual
 * green-screen footage; this is for plain backgrounds (bedroom, office,
 * street) via AI subject segmentation.
 *
 * DOCK: video-editor.tsx — "pro-tools" or "clips" tab area.
 */

const CREDIT_COST = 200;

interface BgPreset {
  id: "studio" | "stage" | "city-night" | "abstract-gold" | "custom";
  nameKey: string;
  descKey: string;
  /** CSS gradient swatch standing in for the preset until AI previews exist. */
  swatch: string;
}

const BG_PRESETS: BgPreset[] = [
  {
    id: "studio",
    nameKey: "wave9.bgReplace.presetStudio",
    descKey: "wave9.bgReplace.presetStudioDesc",
    swatch: "linear-gradient(135deg, #1a1a1a 0%, #3a2f18 60%, #C9A84C33 100%)",
  },
  {
    id: "stage",
    nameKey: "wave9.bgReplace.presetStage",
    descKey: "wave9.bgReplace.presetStageDesc",
    swatch: "linear-gradient(135deg, #0d0d12 0%, #2a1f3d 50%, #C9A84C55 100%)",
  },
  {
    id: "city-night",
    nameKey: "wave9.bgReplace.presetCityNight",
    descKey: "wave9.bgReplace.presetCityNightDesc",
    swatch: "linear-gradient(135deg, #05070f 0%, #0f1e3a 55%, #8a6f2e66 100%)",
  },
  {
    id: "abstract-gold",
    nameKey: "wave9.bgReplace.presetAbstractGold",
    descKey: "wave9.bgReplace.presetAbstractGoldDesc",
    swatch: "linear-gradient(135deg, #000000 0%, #4a3a12 55%, #e8c96a 130%)",
  },
  {
    id: "custom",
    nameKey: "wave9.bgReplace.presetCustom",
    descKey: "wave9.bgReplace.presetCustomDesc",
    swatch: "linear-gradient(135deg, #141414 0%, #333333 100%)",
  },
];

interface BackgroundReplaceSectionProps {
  scene: SceneData | null;
  settings: EditorSettings;
  setSettings: (s: EditorSettings) => void;
  /** Swaps the scene's clip video when a result lands. */
  onReplaceClipVideo?: (sceneId: string, url: string) => void;
}

export function BackgroundReplaceSection({
  scene,
  settings,
  setSettings: _setSettings,
  onReplaceClipVideo,
}: BackgroundReplaceSectionProps) {
  const { t } = useTranslation();
  const ns = "wave9.bgReplace";
  const { confirmedFetch } = useConfirmedApi();
  const { toast } = useToast();

  const [presetId, setPresetId] = useState<BgPreset["id"]>("studio");
  const [customPrompt, setCustomPrompt] = useState("");
  const [phase, setPhase] = useState<"idle" | "working" | "done" | "unavailable">("idle");
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [showAfter, setShowAfter] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);

  void _setSettings;
  void settings;

  const mediaUrl = scene?.demoClipUrl ?? null;
  const preset = BG_PRESETS.find((p) => p.id === presetId) ?? BG_PRESETS[0];

  async function replaceBackground() {
    if (!mediaUrl || phase === "working") return;
    setMessage(null);
    setOutOfCredits(false);
    if (presetId === "custom" && !customPrompt.trim()) {
      setMessage(t(`${ns}.customNeeded`));
      return;
    }
    setPhase("working");
    try {
      const res = await confirmedFetch("/api/wave9b/bg/replace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mediaUrl,
          preset: presetId,
          customPrompt: presetId === "custom" ? customPrompt.trim() : "",
        }),
      });
      if (!res) {
        setPhase("idle"); // user cancelled the credit confirmation
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (res.status === 402) {
        setOutOfCredits(true);
        setPhase("idle");
        return;
      }
      if (res.status === 503) {
        // Honest path: no segmentation provider wired. Nothing charged.
        setPhase("unavailable");
        setMessage(
          typeof data.message === "string"
            ? data.message
            : t(`${ns}.unavailable`)
        );
        return;
      }
      if (!res.ok || !data.outputUrl) {
        throw new Error(typeof data.error === "string" ? data.error : t(`${ns}.errorGeneric`));
      }
      setResultUrl(data.outputUrl as string);
      setShowAfter(true);
      setPhase("done");
      onReplaceClipVideo?.(scene!.id, data.outputUrl as string);
      toast({
        title: t(`${ns}.replacedTitle`),
        description: t(`${ns}.doneToast`, { preset: t(preset.nameKey) }),
      });
    } catch (err) {
      setPhase("idle");
      setMessage(err instanceof Error ? err.message : t(`${ns}.errorGeneric`));
    }
  }

  const previewSrc = showAfter && resultUrl ? resultUrl : mediaUrl;

  return (
    <EditorCard
      title={t(`${ns}.title`)}
      subtitle={t(`${ns}.subtitle`, { cost: CREDIT_COST })}
      icon={<ImageIcon className="h-4 w-4" />}
      data-testid="wave9b-bgreplace"
    >
      <div className="space-y-4">
        {outOfCredits && <OutOfCredits />}

        {!scene || !mediaUrl ? (
          <p className="text-sm text-white/40">
            {t(`${ns}.noClip`)}
          </p>
        ) : (
          <>
            {/* ── Preset gallery ── */}
            <div>
              <p className="text-[11px] font-black text-white/40 uppercase tracking-widest mb-2">
                {t(`${ns}.presetLabel`)}
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                {BG_PRESETS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => { setPresetId(p.id); setPhase("idle"); }}
                    className={`rounded-xl border overflow-hidden text-left transition-all ${
                      presetId === p.id
                        ? "border-[#C9A84C]/60 ring-1 ring-[#C9A84C]/30"
                        : "border-white/[0.08] hover:border-white/25"
                    }`}
                    data-testid={`wave9b-bgpreset-${p.id}`}
                  >
                    <div className="h-14" style={{ background: p.swatch }} />
                    <div className="px-3 py-2 bg-black/40">
                      <p className="text-xs font-black text-white">{t(p.nameKey)}</p>
                      <p className="text-[10px] text-white/35 leading-snug mt-0.5">{t(p.descKey)}</p>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {presetId === "custom" && (
              <input
                type="text"
                value={customPrompt}
                onChange={(e) => setCustomPrompt(e.target.value)}
                placeholder={t(`${ns}.customPlaceholder`)}
                className="w-full px-3 py-2.5 rounded-xl bg-white/[0.03] border border-white/10 text-sm text-white placeholder:text-white/25 focus:outline-none focus:border-[#C9A84C]/50"
                data-testid="wave9b-bgprompt"
              />
            )}

            {/* ── Before/after preview ── */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-[11px] font-black text-white/40 uppercase tracking-widest">
                  {t(`${ns}.previewLabel`)}
                </p>
                {resultUrl && (
                  <div className="flex rounded-lg border border-white/10 overflow-hidden text-[11px] font-bold">
                    <button
                      type="button"
                      onClick={() => setShowAfter(false)}
                      className={`px-3 py-1 transition-colors ${!showAfter ? "bg-[#C9A84C]/20 text-[#e8c96a]" : "text-white/40 hover:text-white/70"}`}
                    >
                      {t(`${ns}.before`)}
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowAfter(true)}
                      className={`px-3 py-1 transition-colors ${showAfter ? "bg-[#C9A84C]/20 text-[#e8c96a]" : "text-white/40 hover:text-white/70"}`}
                    >
                      {t(`${ns}.after`)}
                    </button>
                  </div>
                )}
              </div>
              <div className="relative rounded-xl overflow-hidden border border-white/[0.08] bg-black">
                {previewSrc ? (
                  <video
                    key={previewSrc}
                    src={previewSrc}
                    controls
                    playsInline
                    className="w-full max-h-64 object-contain"
                    data-testid="wave9b-bgpreview"
                  />
                ) : (
                  <div className="h-40 flex items-center justify-center text-white/25 text-sm">
                    {t(`${ns}.noClipLoaded`)}
                  </div>
                )}
                {!resultUrl && phase !== "unavailable" && (
                  <div className="absolute inset-0 pointer-events-none flex items-end">
                    <div
                      className="w-full h-1/2 opacity-40"
                      style={{ background: preset.swatch }}
                      title={t(`${ns}.swatchTint`, { preset: t(preset.nameKey) })}
                    />
                  </div>
                )}
              </div>
            </div>

            {message && (
              <div
                className={`flex items-start gap-2.5 rounded-xl border px-4 py-3 ${
                  phase === "unavailable"
                    ? "border-amber-500/25 bg-amber-500/5"
                    : "border-red-500/25 bg-red-500/5"
                }`}
              >
                {phase === "unavailable" ? (
                  <Info className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
                ) : (
                  <AlertTriangle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
                )}
                <p className={`text-sm ${phase === "unavailable" ? "text-amber-200/80" : "text-red-200/80"}`}>
                  {message}
                </p>
              </div>
            )}

            <button
              type="button"
              onClick={replaceBackground}
              disabled={phase === "working" || phase === "unavailable"}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl font-black text-sm
                bg-gradient-to-r from-[#C9A84C] to-[#8a6f2e] text-black
                hover:from-[#e0bc58] hover:to-[#a5853a] transition-all shadow-lg shadow-[#C9A84C]/20
                disabled:opacity-40 disabled:cursor-not-allowed"
              data-testid="wave9b-bg-replace"
            >
              {phase === "working" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              {phase === "working" ? t(`${ns}.working`) : t(`${ns}.replace`, { cost: CREDIT_COST })}
            </button>

            {phase === "unavailable" && (
              <p className="text-[11px] text-white/35 leading-relaxed">
                {t(`${ns}.unavailableChromaHint`)}
              </p>
            )}

            {phase === "done" && resultUrl && (
              <p className="text-[11px] text-white/35 leading-relaxed">
                {t(`${ns}.doneNote`)}
              </p>
            )}
          </>
        )}
      </div>
    </EditorCard>
  );
}
