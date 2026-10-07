import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Scan, Share2, Download, Sparkles } from "lucide-react";
import type { SceneData } from "@/lib/scene-parser";
import { EditorCard, Chip } from "@/components/editor/controls";
import { useToast } from "@/hooks/use-toast";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { useShareClip } from "@/hooks/use-share-clip";

/* ── Mask card (Pro Tools tab) ─────────────────────────────────────────────
 * CapCut-style masking: the masked region stays sharp, everything outside is
 * blurred + dimmed (single-layer friendly — the burned mp4 needs no alpha).
 * The live preview below mirrors the server ffmpeg build (spotlight-style
 * dim overlay + CSS mask), so what you see is what the export burns.
 * Presets map 1:1 onto the /api/apply-mask parameter surface
 * (shape / feather / invert / animate) — every preset actually renders.
 */

type MaskShape = "ellipse" | "rectangle" | "linear" | "radial";

interface MaskPreset {
  id: string;
  shape: MaskShape;
  animate: boolean;
  feather: number;
  labelKey: string;
  descKey: string;
  showpiece?: boolean;
  swatch: React.CSSProperties;
}

const PRESETS: MaskPreset[] = [
  {
    id: "circle-wipe",
    shape: "ellipse",
    animate: true,
    feather: 20,
    labelKey: "videoEditor.mask.presetCircleWipe",
    descKey: "videoEditor.mask.presetCircleWipeDesc",
    swatch: { background: "radial-gradient(circle at 50% 50%, #C9A84C 0 30%, rgba(201,168,76,0.25) 32%, transparent 55%)" },
  },
  {
    id: "bar-reveal",
    shape: "rectangle",
    animate: true,
    feather: 15,
    labelKey: "videoEditor.mask.presetBarReveal",
    descKey: "videoEditor.mask.presetBarRevealDesc",
    swatch: { background: "linear-gradient(90deg, transparent 36%, #C9A84C 36%, #C9A84C 64%, transparent 64%)" },
  },
  {
    id: "spotlight",
    shape: "radial",
    animate: true,
    feather: 35,
    labelKey: "videoEditor.mask.presetSpotlight",
    descKey: "videoEditor.mask.presetSpotlightDesc",
    showpiece: true,
    swatch: { background: "radial-gradient(circle at 50% 50%, #f0d488 0%, rgba(201,168,76,0.45) 38%, transparent 68%)" },
  },
  {
    id: "split",
    shape: "linear",
    animate: true,
    feather: 0,
    labelKey: "videoEditor.mask.presetSplit",
    descKey: "videoEditor.mask.presetSplitDesc",
    swatch: { background: "linear-gradient(90deg, #C9A84C 0%, rgba(201,168,76,0.35) 55%, transparent 90%)" },
  },
];

/**
 * CSS mask-image for the dim overlay (white = overlay visible = dimmed).
 * Mirrors the server geq expressions closely enough that the preview is
 * representative of the burned export.
 */
function overlayMaskImage(
  shape: MaskShape,
  feather: number,
  invert: boolean,
  animated: boolean,
  progress: number, // 0..1, only used when animated
): string {
  const f = Math.max(0, Math.min(100, feather));
  const soft = 6 + f * 0.25;
  const B = "black";
  const T = "transparent";
  const inv = (a: string, b: string) => (invert ? b : a);

  switch (shape) {
    case "ellipse": {
      if (animated) {
        const r = 8 + 54 * progress; // circle wipe: grows to cover frame
        return inv(
          `radial-gradient(ellipse 60% 60% at 50% 50%, ${T} ${Math.max(0, r - soft)}%, ${B} ${r + soft}%)`,
          `radial-gradient(ellipse 60% 60% at 50% 50%, ${B} ${Math.max(0, r - soft)}%, ${T} ${r + soft}%)`,
        );
      }
      const a = 62 - f * 0.42;
      const b = a + (f <= 0 ? 0 : 8 + f * 0.3);
      return inv(
        `radial-gradient(ellipse 36% 36% at 50% 50%, ${T} ${a}%, ${B} ${b}%)`,
        `radial-gradient(ellipse 36% 36% at 50% 50%, ${B} ${a}%, ${T} ${b}%)`,
      );
    }
    case "rectangle": {
      const s = f * 0.15;
      if (animated) {
        const c = progress * 100; // bar reveal: sweeps left → right
        return inv(
          `linear-gradient(90deg, ${B} ${c - 14 - s}%, ${T} ${c - 14 + s}%, ${T} ${c + 14 - s}%, ${B} ${c + 14 + s}%)`,
          `linear-gradient(90deg, ${T} ${c - 14 - s}%, ${B} ${c - 14 + s}%, ${B} ${c + 14 - s}%, ${T} ${c + 14 + s}%)`,
        );
      }
      return inv(
        `linear-gradient(90deg, ${B} ${36 - s}%, ${T} ${36 + s}%, ${T} ${64 - s}%, ${B} ${64 + s}%)`,
        `linear-gradient(90deg, ${T} ${36 - s}%, ${B} ${36 + s}%, ${B} ${64 - s}%, ${T} ${64 + s}%)`,
      );
    }
    case "linear": {
      if (animated) {
        const edge = (1 - progress) * 100; // reveal sweep
        return inv(
          `linear-gradient(90deg, ${B} 0%, ${B} ${edge}%, ${T} ${edge + 22}%)`,
          `linear-gradient(90deg, ${T} 0%, ${T} ${edge}%, ${B} ${edge + 22}%)`,
        );
      }
      return inv(
        `linear-gradient(90deg, ${B} ${40 - f * 0.2}%, ${T} ${70 + f * 0.2}%)`,
        `linear-gradient(90deg, ${T} ${40 - f * 0.2}%, ${B} ${70 + f * 0.2}%)`,
      );
    }
    case "radial": {
      if (animated) {
        const r = 6 + 56 * progress; // spotlight: grows from a point
        return inv(
          `radial-gradient(circle 65% at 50% 50%, ${T} ${Math.max(0, r - soft)}%, ${B} ${r + soft}%)`,
          `radial-gradient(circle 65% at 50% 50%, ${B} ${Math.max(0, r - soft)}%, ${T} ${r + soft}%)`,
        );
      }
      const a = 60 - f * 0.4;
      const b = a + (f <= 0 ? 0 : 10 + f * 0.3);
      return inv(
        `radial-gradient(circle 42% at 50% 50%, ${T} ${a}%, ${B} ${b}%)`,
        `radial-gradient(circle 42% at 50% 50%, ${B} ${a}%, ${T} ${b}%)`,
      );
    }
  }
}

export function MaskCard({
  scene,
  onReplaceClipVideo,
}: {
  scene: SceneData | null;
  onReplaceClipVideo?: (sceneId: string, url: string) => void;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { confirmedFetch } = useConfirmedApi();
  const { shareClip } = useShareClip();

  const [presetId, setPresetId] = useState<string>("spotlight");
  const [shape, setShape] = useState<MaskShape>("radial");
  const [feather, setFeather] = useState(35);
  const [invert, setInvert] = useState(false);
  const [animate, setAnimate] = useState(true);
  const [text, setText] = useState("");
  const [credit, setCredit] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const overlayRef = useRef<HTMLDivElement | null>(null);
  const paramsRef = useRef({ shape, feather, invert, animate });
  paramsRef.current = { shape, feather, invert, animate };
  const pollTimer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (pollTimer.current) window.clearInterval(pollTimer.current);
    };
  }, []);

  /* Live preview: rAF-driven mask animation mirrors the server render. */
  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const el = overlayRef.current;
      if (el) {
        const p = paramsRef.current;
        const progress = ((now - start) % 4000) / 4000;
        const img = overlayMaskImage(p.shape, p.feather, p.invert, p.animate, progress);
        el.style.maskImage = img;
        el.style.webkitMaskImage = img;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  function applyPreset(preset: MaskPreset) {
    setPresetId(preset.id);
    setShape(preset.shape);
    setAnimate(preset.animate);
    setFeather(preset.feather);
    setInvert(false);
  }

  async function handleApply() {
    if (!scene?.demoClipUrl || busy) return;
    setBusy(true);
    setResult(null);
    try {
      const res = await confirmedFetch("/api/apply-mask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          videoUrl: scene.demoClipUrl,
          shape,
          feather: Math.round(feather),
          invert,
          animate: animate ? "wipe" : "none",
          text: text.trim(),
          credit,
        }),
      });
      if (!res) return; // user cancelled the credit confirmation
      const body = await res.json().catch(() => ({}));
      if (res.status === 402) {
        toast({ title: t("videoEditor.mask.outOfBucs"), variant: "destructive" });
        return;
      }
      if (res.status !== 202 || !body.jobId) throw new Error(body.error ?? t("videoEditor.mask.applyFailed"));
      const jobId = body.jobId as string;
      pollTimer.current = window.setInterval(async () => {
        try {
          const pr = await confirmedFetch(`/api/freeze-mask/job/${jobId}`, { skipConfirm: true });
          if (!pr) return;
          const jb = await pr.json().catch(() => ({}));
          if (jb.status === "done" && jb.url) {
            if (pollTimer.current) window.clearInterval(pollTimer.current);
            setBusy(false);
            setResult(jb.url as string);
            toast({ title: t("videoEditor.mask.readyTitle"), description: t("videoEditor.mask.readyDesc") });
          } else if (jb.status === "failed") {
            if (pollTimer.current) window.clearInterval(pollTimer.current);
            setBusy(false);
            throw new Error(jb.error ?? t("videoEditor.mask.applyFailed"));
          }
        } catch (err) {
          if (pollTimer.current) window.clearInterval(pollTimer.current);
          setBusy(false);
          toast({
            title: t("videoEditor.mask.applyFailed"),
            description: err instanceof Error ? err.message : undefined,
            variant: "destructive",
          });
        }
      }, 2000);
    } catch (err) {
      setBusy(false);
      toast({
        title: t("videoEditor.mask.applyFailed"),
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    }
  }

  return (
    <EditorCard
      title={t("videoEditor.mask.cardTitle")}
      subtitle={t("videoEditor.mask.cardSubtitle")}
      icon={<Scan className="h-4 w-4" />}
    >
      <div data-testid="pro-card-mask">
        {!scene?.demoClipUrl ? (
          <p className="text-white/40 text-sm">{t("videoEditor.mask.noClip")}</p>
        ) : (
          <div className="space-y-3">
            {/* ── Live preview (mirrors the server render) ── */}
            <div className="relative rounded-xl overflow-hidden border border-[#C9A84C]/30 bg-black">
              <video
                src={scene.demoClipUrl}
                muted
                loop
                playsInline
                autoPlay
                className="w-full max-h-52 object-contain"
                data-testid="pro-mask-preview-video"
              />
              <div
                ref={overlayRef}
                className="absolute inset-0 pointer-events-none"
                style={{
                  backdropFilter: "blur(14px) brightness(0.62) saturate(0.6)",
                  WebkitBackdropFilter: "blur(14px) brightness(0.62) saturate(0.6)",
                }}
                data-testid="pro-mask-preview-overlay"
              />
              {text.trim() && (
                <div className="absolute bottom-3 left-0 right-0 text-center pointer-events-none">
                  <span className="text-white text-sm font-bold [text-shadow:0_1px_3px_rgba(0,0,0,0.9),0_0_8px_rgba(0,0,0,0.6)]">
                    {text.trim()}
                  </span>
                </div>
              )}
              {credit && (
                <div className="absolute bottom-1.5 right-2 pointer-events-none">
                  <span className="text-[#E8C96A] text-[9px] font-bold [text-shadow:0_1px_2px_rgba(0,0,0,0.9)]">
                    {t("videoEditor.mask.creditLine")}
                  </span>
                </div>
              )}
              <div className="absolute top-2 left-2 pointer-events-none">
                <span className="text-[9px] font-black uppercase tracking-widest text-[#C9A84C] bg-black/60 px-2 py-1 rounded-full border border-[#C9A84C]/30">
                  {t("videoEditor.mask.livePreview")}
                </span>
              </div>
            </div>

            {/* ── Presets ── */}
            <div>
              <p className="text-[11px] font-black text-white/40 uppercase tracking-widest mb-2">
                {t("videoEditor.mask.presetsTitle")}
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {PRESETS.map((preset) => {
                  const active = presetId === preset.id;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => applyPreset(preset)}
                      data-testid={`pro-mask-preset-${preset.id}`}
                      className={`relative rounded-xl border overflow-hidden text-left transition-all ${
                        active
                          ? "border-[#C9A84C] ring-1 ring-[#C9A84C]/60 shadow-lg shadow-[#C9A84C]/10"
                          : "border-white/10 hover:border-white/25"
                      }`}
                    >
                      <div className="h-14 bg-black/80" style={preset.swatch} />
                      <div className="px-2 py-1.5 bg-white/[0.02]">
                        <p className={`text-[10px] font-black leading-tight ${active ? "text-[#C9A84C]" : "text-white/70"}`}>
                          {preset.showpiece && <Sparkles className="h-2.5 w-2.5 inline mr-0.5 -mt-0.5" />}
                          {t(preset.labelKey)}
                        </p>
                        <p className="text-[9px] text-white/35 leading-tight mt-0.5">{t(preset.descKey)}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* ── Fine controls ── */}
            <div className="space-y-1.5 rounded-xl border border-white/[0.06] bg-white/[0.015] p-3">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-semibold text-white/60 w-24 shrink-0">{t("videoEditor.mask.feather")}</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={feather}
                  onChange={(e) => {
                    setFeather(Number(e.target.value));
                    setPresetId("custom");
                  }}
                  className="flex-1 h-1 cursor-pointer"
                  style={{ accentColor: "#C9A84C" }}
                  data-testid="pro-mask-feather"
                />
                <span className="text-[10px] font-mono text-white/40 w-10 text-right">{Math.round(feather)}</span>
              </div>
              <div className="flex flex-wrap gap-1.5 pt-1">
                <Chip active={animate} onClick={() => { setAnimate((v) => !v); setPresetId("custom"); }} data-testid="pro-mask-animate">
                  {t("videoEditor.mask.animate")}
                </Chip>
                <Chip active={invert} onClick={() => { setInvert((v) => !v); setPresetId("custom"); }} data-testid="pro-mask-invert">
                  {t("videoEditor.mask.invert")}
                </Chip>
                <Chip active={credit} onClick={() => setCredit((v) => !v)} data-testid="pro-mask-credit">
                  {t("videoEditor.mask.creditToggle")}
                </Chip>
              </div>
              <input
                type="text"
                value={text}
                maxLength={80}
                onChange={(e) => setText(e.target.value)}
                placeholder={t("videoEditor.mask.textPlaceholder")}
                className="w-full mt-1 rounded-lg bg-black/40 border border-white/10 px-3 py-2 text-xs text-white placeholder:text-white/25 focus:outline-none focus:border-[#C9A84C]/60"
                data-testid="pro-mask-text"
              />
            </div>

            {/* ── Apply ── */}
            <button
              type="button"
              onClick={handleApply}
              disabled={busy}
              data-testid="pro-mask-apply"
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl font-black text-sm
                bg-gradient-to-r from-[#C9A84C] to-[#8a6f2e] text-black
                hover:from-[#e0bc58] hover:to-[#a5853a] transition-all shadow-lg shadow-[#C9A84C]/20
                disabled:opacity-50 disabled:cursor-wait"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {busy ? t("videoEditor.mask.rendering") : t("videoEditor.mask.apply")}
            </button>

            {/* ── Result ── */}
            {result && (
              <div className="mt-1 rounded-xl border border-[#C9A84C]/30 bg-white/[0.02] p-2.5" data-testid="pro-mask-result">
                <video src={result} controls playsInline className="w-full max-h-44 object-contain rounded-lg bg-black" />
                <div className="flex flex-wrap gap-2 mt-2">
                  <button
                    type="button"
                    onClick={() => {
                      if (scene && onReplaceClipVideo) {
                        onReplaceClipVideo(scene.id, result);
                        toast({ title: t("videoEditor.mask.appliedTitle"), description: t("videoEditor.mask.appliedDesc") });
                      }
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-black
                      bg-gradient-to-r from-[#C9A84C] to-[#8a6f2e] text-black hover:from-[#e0bc58] hover:to-[#a5853a]"
                    data-testid="pro-mask-use-in-editor"
                  >
                    {t("videoEditor.useInEditor")}
                  </button>
                  <button
                    type="button"
                    onClick={() => shareClip(result, t("videoEditor.mask.shareTitle"))}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold
                      border border-white/15 text-white/70 hover:text-white hover:border-white/30"
                    data-testid="pro-mask-share"
                  >
                    <Share2 className="h-3.5 w-3.5" /> {t("videoEditor.share")}
                  </button>
                  <a
                    href={result}
                    download="mask-effect.mp4"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold
                      border border-white/15 text-white/70 hover:text-white hover:border-white/30"
                    data-testid="pro-mask-download"
                  >
                    <Download className="h-3.5 w-3.5" /> {t("videoEditor.download")}
                  </a>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </EditorCard>
  );
}
