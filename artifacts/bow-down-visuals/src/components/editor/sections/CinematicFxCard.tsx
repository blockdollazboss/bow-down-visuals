import { useMemo, useState } from "react";
import {
  Clapperboard, Sparkles, Loader2, Share2, Link2, Check,
  ArrowRight, CalendarClock, Download, Film,
} from "lucide-react";
import type { SceneData } from "@/lib/scene-parser";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { useToast } from "@/hooks/use-toast";
import { EditorCard, Chip } from "@/components/editor/controls";

/* ── True Cinematic FX (CapCut parity) ──────────────────────────────────────
 * Renders REAL burned-in effects server-side via POST /api/cinematic-fx
 * (pure ffmpeg — 150 Visual Bucs). The old Effects-tab chips for VHS /
 * Cinematic Bars / Camera Shake were CSS-preview approximations only; this
 * card burns the actual thing: crop-wobble shake, drawbox letterbox bars,
 * VHS (noise + scanlines + tracking-line wobble + chromatic aberration),
 * and animated film grain.
 * Lives INSIDE the Effects tab — no new sidebar item, no new page. */

export const CINEMATIC_FX_PRICE = 150;

const FX_OPTIONS: {
  name: string;
  desc: string;
  /** Honest WYSIWYG note — true preview is impossible in CSS for some FX. */
  note: string;
  noteExact: boolean;
}[] = [
  {
    name: "True Camera Shake",
    desc: "Real crop-wobble motion, burned in — not a brightness tweak.",
    note: "Preview approximates — export is the real thing",
    noteExact: false,
  },
  {
    name: "True Letterbox Cinematic Bars",
    desc: "Real black bars burned into the frame (2.35:1 feel).",
    note: "Preview matches exactly",
    noteExact: true,
  },
  {
    name: "True VHS",
    desc: "Tape noise + scanlines + tracking-line wobble + chromatic aberration.",
    note: "Preview approximates — export is the real thing",
    noteExact: false,
  },
  {
    name: "Film Grain",
    desc: "Animated grain overlay, burned in.",
    note: "Preview is close to the burn",
    noteExact: true,
  },
];

function toggleListItem(list: string[], item: string): string[] {
  return list.includes(item) ? list.filter((x) => x !== item) : [...list, item];
}

export function CinematicFxCard({
  scenes,
  onReplaceClipVideo,
  onGoToCaptions,
  onGoToExport,
}: {
  scenes: SceneData[];
  /** Replaces a scene's clip URL with the burned render. */
  onReplaceClipVideo?: (sceneId: string, url: string) => void;
  /** Handoff: jump to the Captions tab. */
  onGoToCaptions?: () => void;
  /** Handoff: jump to the Export tab (multi-ratio). */
  onGoToExport?: () => void;
}) {
  const { toast } = useToast();
  const { confirmedFetch } = useConfirmedApi();
  const [sceneId, setSceneId] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>(["True Letterbox Cinematic Bars"]);
  const [intensity, setIntensity] = useState(60);
  const [attribution, setAttribution] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [shared, setShared] = useState(false);

  const clips = useMemo(() => scenes.filter((s) => s.demoClipUrl), [scenes]);
  const activeScene = clips.find((s) => s.id === sceneId) ?? clips[0] ?? null;

  async function handleBurn() {
    if (!activeScene?.demoClipUrl) {
      toast({ title: "No clip", description: "Add a video clip to a scene first.", variant: "destructive" });
      return;
    }
    if (selected.length === 0) {
      toast({ title: "Pick an effect", description: "Choose at least one true FX to burn.", variant: "destructive" });
      return;
    }
    setBusy(true);
    setError(null);
    setResultUrl(null);
    try {
      const res = await confirmedFetch("/api/cinematic-fx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          videoUrl: activeScene.demoClipUrl,
          effects: selected,
          intensity,
          attribution,
        }),
      });
      if (!res) return; // user cancelled the credit confirmation
      const body = await res.json().catch(() => ({}));
      if (res.status === 402) {
        setError("Out of Visual Bucs — top up to burn cinematic FX.");
        return;
      }
      if (!res.ok || !body.url) throw new Error(body.error ?? "Cinematic FX render failed.");
      setResultUrl(body.url as string);
      toast({
        title: "✨ Cinematic FX burned",
        description: `${selected.join(" + ")} rendered server-side — real pixels, not a preview filter.`,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Render failed. Your Visual Bucs were refunded.");
    } finally {
      setBusy(false);
    }
  }

  /* ── Virality: one-tap share of the burned clip ── */
  async function handleNativeShare() {
    if (!resultUrl) return;
    try {
      if (navigator.share) {
        await navigator.share({
          title: "Made with Bow Down Visuals",
          text: "Cinematic FX burned with Bow Down Visuals 🎬",
          url: resultUrl,
        });
      } else {
        await navigator.clipboard.writeText(resultUrl);
        setShared(true);
        setTimeout(() => setShared(false), 2000);
      }
    } catch { /* user cancelled */ }
  }

  async function handleCopyLink() {
    if (!resultUrl) return;
    try {
      await navigator.clipboard.writeText(resultUrl);
      setShared(true);
      setTimeout(() => setShared(false), 2000);
    } catch { /* clipboard unavailable */ }
  }

  function socialShareHref(network: "x" | "facebook" | "whatsapp" | "telegram") {
    if (!resultUrl) return "#";
    const url = encodeURIComponent(resultUrl);
    const text = encodeURIComponent("Cinematic FX burned with Bow Down Visuals 🎬");
    switch (network) {
      case "x": return `https://twitter.com/intent/tweet?text=${text}&url=${url}`;
      case "facebook": return `https://www.facebook.com/sharer/sharer.php?u=${url}`;
      case "whatsapp": return `https://wa.me/?text=${text}%20${url}`;
      case "telegram": return `https://t.me/share/url?url=${url}&text=${text}`;
    }
  }

  if (clips.length === 0) return null;

  return (
    <EditorCard
      title="True Cinematic FX"
      subtitle="Real burned-in effects — not preview filters"
      icon={<Clapperboard className="h-4 w-4" />}
    >
      <p className="text-[11px] text-white/40 mb-3">
        The old VHS / Cinematic Bars / Camera Shake chips were{" "}
        <span className="text-white/60 font-semibold">CSS-preview approximations</span>. This burns the{" "}
        <span className="text-[#C9A84C] font-semibold">real thing</span> into your clip with ffmpeg —{" "}
        {CINEMATIC_FX_PRICE} Visual Bucs per render.
      </p>

      {/* Scene picker */}
      <div className="flex items-center gap-2 mb-3">
        <span className="text-[11px] font-semibold text-white/50 shrink-0">Clip</span>
        <select
          value={activeScene?.id ?? ""}
          onChange={(e) => setSceneId(e.target.value)}
          data-testid="cinematic-fx-scene-picker"
          className="flex-1 min-w-0 bg-white/[0.04] border border-white/[0.1] rounded-lg px-3 py-2 text-sm text-white/80 focus:outline-none focus:border-primary/40 transition-colors"
          style={{ colorScheme: "dark" }}
        >
          {clips.map((s, i) => (
            <option key={s.id} value={s.id}>
              Scene {i + 1}{s.section ? ` — ${s.section}` : ""}
            </option>
          ))}
        </select>
      </div>

      {/* Effect picker */}
      <div className="flex flex-wrap gap-1.5 mb-1.5">
        {FX_OPTIONS.map((fx) => (
          <Chip
            key={fx.name}
            active={selected.includes(fx.name)}
            onClick={() => setSelected(toggleListItem(selected, fx.name))}
          >
            {fx.name.replace("True ", "")}
          </Chip>
        ))}
      </div>
      {/* Honest WYSIWYG notes */}
      <div className="space-y-1 mb-3">
        {selected.map((name) => {
          const fx = FX_OPTIONS.find((o) => o.name === name);
          if (!fx) return null;
          return (
            <p key={name} className="text-[10px] leading-snug text-white/35">
              <span className="font-bold text-white/55">{fx.name.replace("True ", "")}:</span>{" "}
              {fx.desc}{" "}
              <span className={fx.noteExact ? "text-green-400/80 font-semibold" : "text-amber-400/80 font-semibold"}>
                {fx.noteExact ? "✓ " : "⚠ "}{fx.note}.
              </span>
            </p>
          );
        })}
        {selected.length === 0 && (
          <p className="text-[10px] text-white/30">Pick at least one effect above.</p>
        )}
      </div>

      {/* Intensity */}
      <div className="flex items-center gap-2 mb-3">
        <span className="text-[11px] font-semibold text-white/60 w-24 shrink-0">Intensity</span>
        <input
          type="range" min={10} max={100} value={intensity}
          onChange={(e) => setIntensity(Number(e.target.value))}
          className="flex-1 h-1 min-w-0 cursor-pointer" style={{ accentColor: "#C9A84C" }}
          data-testid="cinematic-fx-intensity"
        />
        <span className="text-[10px] font-mono text-white/40 w-10 text-right shrink-0">{intensity}%</span>
      </div>

      {/* Attribution — free burned tag (virality) */}
      <button
        type="button"
        onClick={() => setAttribution(!attribution)}
        data-testid="cinematic-fx-attribution"
        className={`w-full mb-3 flex items-center justify-between gap-2 rounded-lg border px-3 py-2 transition-colors ${
          attribution
            ? "border-[#C9A84C]/40 bg-[#C9A84C]/[0.08]"
            : "border-white/[0.08] bg-white/[0.02] hover:border-white/[0.16]"
        }`}
      >
        <span className="text-left">
          <span className="block text-[11px] font-bold text-white/75">
            “Made with Bow Down Visuals” tag
          </span>
          <span className="block text-[10px] text-white/35">
            Burned into the corner — free, spreads the word
          </span>
        </span>
        <span className={`shrink-0 px-2 py-0.5 rounded text-[9px] font-black uppercase ${
          attribution ? "bg-[#C9A84C]/25 text-[#C9A84C]" : "bg-white/[0.06] text-white/30"
        }`}>
          {attribution ? "On" : "Off"}
        </span>
      </button>

      {/* Burn button */}
      <button
        type="button" onClick={handleBurn} disabled={busy || selected.length === 0}
        data-testid="cinematic-fx-burn"
        className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl font-black text-sm
          bg-gradient-to-r from-[#C9A84C] to-[#8a6f2e] text-black
          hover:from-[#e0bc58] hover:to-[#a5853a] transition-all shadow-lg shadow-[#C9A84C]/20
          disabled:opacity-50 disabled:cursor-wait"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
        {busy ? "Burning FX…" : `Burn True FX — ${CINEMATIC_FX_PRICE} Visual Bucs`}
      </button>
      {error && (
        <p className="text-[11px] text-red-400 mt-2" data-testid="cinematic-fx-error">{error}</p>
      )}

      {/* Result + handoff chain */}
      {resultUrl && (
        <div className="mt-3 rounded-xl border border-[#C9A84C]/30 bg-white/[0.02] p-2.5" data-testid="cinematic-fx-result">
          <video src={resultUrl} controls playsInline
            className="w-full max-h-44 object-contain rounded-lg bg-black" />
          <div className="flex flex-wrap gap-2 mt-2.5">
            {onReplaceClipVideo && activeScene && (
              <button
                type="button"
                onClick={() => {
                  onReplaceClipVideo(activeScene.id, resultUrl);
                  toast({ title: "Added to editor", description: "The burned clip replaced the scene's video." });
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-black
                  bg-gradient-to-r from-[#C9A84C] to-[#8a6f2e] text-black hover:from-[#e0bc58] hover:to-[#a5853a]"
                data-testid="cinematic-fx-use-in-editor"
              >
                <Film className="h-3.5 w-3.5" /> Use in editor
              </button>
            )}
            <a
              href={resultUrl} download="cinematic-fx.mp4"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold
                border border-white/15 text-white/70 hover:text-white hover:border-white/30"
              data-testid="cinematic-fx-download"
            >
              <Download className="h-3.5 w-3.5" /> Download
            </a>
            <button
              type="button" onClick={handleNativeShare}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-black
                bg-[#E8C468] text-black hover:bg-[#f0d47e]"
              data-testid="cinematic-fx-share"
            >
              {shared ? <Check className="h-3.5 w-3.5" /> : <Share2 className="h-3.5 w-3.5" />}
              {shared ? "Copied!" : "Share"}
            </button>
            <button
              type="button" onClick={handleCopyLink}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold
                border border-white/15 text-white/70 hover:text-white hover:border-white/30"
              data-testid="cinematic-fx-copy-link"
            >
              <Link2 className="h-3.5 w-3.5" /> Copy link
            </button>
          </div>
          {/* Social intents */}
          <div className="flex flex-wrap gap-1.5 mt-2">
            {(["x", "facebook", "whatsapp", "telegram"] as const).map((net) => (
              <a key={net} href={socialShareHref(net)} target="_blank" rel="noreferrer"
                className="px-2.5 py-1 rounded-md text-[10px] font-bold capitalize border border-white/[0.08]
                  text-white/40 hover:text-white/75 hover:border-white/20 transition-colors"
                data-testid={`cinematic-fx-share-${net}`}
              >
                {net === "x" ? "X" : net}
              </a>
            ))}
          </div>
          {/* Handoff chain: captions → multi-ratio export → scheduler */}
          <div className="flex flex-wrap items-center gap-1.5 mt-3 pt-2.5 border-t border-white/[0.06]">
            <span className="text-[10px] font-black uppercase tracking-wide text-white/30 mr-1">Next</span>
            {onGoToCaptions && (
              <button
                type="button" onClick={onGoToCaptions}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold
                  border border-[#C9A84C]/30 text-[#C9A84C] hover:bg-[#C9A84C]/10 transition-colors"
                data-testid="cinematic-fx-goto-captions"
              >
                Captions <ArrowRight className="h-3 w-3" />
              </button>
            )}
            {onGoToExport && (
              <button
                type="button" onClick={onGoToExport}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold
                  border border-[#C9A84C]/30 text-[#C9A84C] hover:bg-[#C9A84C]/10 transition-colors"
                data-testid="cinematic-fx-goto-export"
              >
                Multi-ratio export <ArrowRight className="h-3 w-3" />
              </button>
            )}
            <a
              href="/scheduler"
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold
                border border-[#C9A84C]/30 text-[#C9A84C] hover:bg-[#C9A84C]/10 transition-colors"
              data-testid="cinematic-fx-goto-scheduler"
            >
              <CalendarClock className="h-3 w-3" /> Scheduler <ArrowRight className="h-3 w-3" />
            </a>
          </div>
        </div>
      )}
    </EditorCard>
  );
}
