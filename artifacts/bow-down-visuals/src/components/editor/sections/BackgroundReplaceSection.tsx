import { useState } from "react";
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
  name: string;
  description: string;
  /** CSS gradient swatch standing in for the preset until AI previews exist. */
  swatch: string;
}

const BG_PRESETS: BgPreset[] = [
  {
    id: "studio",
    name: "Studio",
    description: "Clean studio backdrop with soft gold rim light.",
    swatch: "linear-gradient(135deg, #1a1a1a 0%, #3a2f18 60%, #C9A84C33 100%)",
  },
  {
    id: "stage",
    name: "Stage",
    description: "Concert stage glow — dark crowd, gold spotlights.",
    swatch: "linear-gradient(135deg, #0d0d12 0%, #2a1f3d 50%, #C9A84C55 100%)",
  },
  {
    id: "city-night",
    name: "City Night",
    description: "Night skyline bokeh in gold and deep blue.",
    swatch: "linear-gradient(135deg, #05070f 0%, #0f1e3a 55%, #8a6f2e66 100%)",
  },
  {
    id: "abstract-gold",
    name: "Abstract Gold",
    description: "Flowing gold abstraction on black — the brand look.",
    swatch: "linear-gradient(135deg, #000000 0%, #4a3a12 55%, #e8c96a 130%)",
  },
  {
    id: "custom",
    name: "Custom",
    description: "Describe your own background in plain words.",
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
      setMessage("Describe your custom background first — a few plain words is enough.");
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
            : "AI background replacement isn't available yet."
        );
        return;
      }
      if (!res.ok || !data.outputUrl) {
        throw new Error(typeof data.error === "string" ? data.error : "Background replacement failed.");
      }
      setResultUrl(data.outputUrl as string);
      setShowAfter(true);
      setPhase("done");
      onReplaceClipVideo?.(scene!.id, data.outputUrl as string);
      toast({
        title: "Background replaced",
        description: `${preset.name} is now behind your clip. Toggle before/after to compare.`,
      });
    } catch (err) {
      setPhase("idle");
      setMessage(err instanceof Error ? err.message : "Background replacement failed.");
    }
  }

  const previewSrc = showAfter && resultUrl ? resultUrl : mediaUrl;

  return (
    <EditorCard
      title="Background Replace"
      subtitle={`Swap a plain background for an AI scene — ${CREDIT_COST} Visual Bucs`}
      icon={<ImageIcon className="h-4 w-4" />}
      data-testid="wave9b-bgreplace"
    >
      <div className="space-y-4">
        {outOfCredits && <OutOfCredits />}

        {!scene || !mediaUrl ? (
          <p className="text-sm text-white/40">
            Pick a talking-head clip to replace its background.
          </p>
        ) : (
          <>
            {/* ── Preset gallery ── */}
            <div>
              <p className="text-[11px] font-black text-white/40 uppercase tracking-widest mb-2">
                AI background
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
                      <p className="text-xs font-black text-white">{p.name}</p>
                      <p className="text-[10px] text-white/35 leading-snug mt-0.5">{p.description}</p>
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
                placeholder="e.g. rooftop at sunset with gold haze"
                className="w-full px-3 py-2.5 rounded-xl bg-white/[0.03] border border-white/10 text-sm text-white placeholder:text-white/25 focus:outline-none focus:border-[#C9A84C]/50"
                data-testid="wave9b-bgprompt"
              />
            )}

            {/* ── Before/after preview ── */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-[11px] font-black text-white/40 uppercase tracking-widest">
                  Preview
                </p>
                {resultUrl && (
                  <div className="flex rounded-lg border border-white/10 overflow-hidden text-[11px] font-bold">
                    <button
                      type="button"
                      onClick={() => setShowAfter(false)}
                      className={`px-3 py-1 transition-colors ${!showAfter ? "bg-[#C9A84C]/20 text-[#e8c96a]" : "text-white/40 hover:text-white/70"}`}
                    >
                      Before
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowAfter(true)}
                      className={`px-3 py-1 transition-colors ${showAfter ? "bg-[#C9A84C]/20 text-[#e8c96a]" : "text-white/40 hover:text-white/70"}`}
                    >
                      After
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
                    No clip loaded.
                  </div>
                )}
                {!resultUrl && phase !== "unavailable" && (
                  <div className="absolute inset-0 pointer-events-none flex items-end">
                    <div
                      className="w-full h-1/2 opacity-40"
                      style={{ background: preset.swatch }}
                      title={`${preset.name} preview tint — real swap renders server-side`}
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
              {phase === "working" ? "Working…" : `Replace background (${CREDIT_COST} VB)`}
            </button>

            {phase === "unavailable" && (
              <p className="text-[11px] text-white/35 leading-relaxed">
                Shot on a green screen? Use Chroma Key in Pro Tools — that path works today.
              </p>
            )}

            {phase === "done" && resultUrl && (
              <p className="text-[11px] text-white/35 leading-relaxed">
                The replaced clip is live on your timeline. Toggle Before/After above to compare.
              </p>
            )}
          </>
        )}
      </div>
    </EditorCard>
  );
}
