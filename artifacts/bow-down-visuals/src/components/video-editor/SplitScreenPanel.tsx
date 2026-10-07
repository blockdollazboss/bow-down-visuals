import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { getSupabase } from "@/lib/supabase";
import type { SceneData } from "@/lib/scene-parser";
import {
  ArrowLeft,
  BadgeCheck,
  Captions,
  Check,
  Clapperboard,
  Copy,
  Download,
  Film,
  ImagePlus,
  Layers,
  Link2,
  Loader2,
  RefreshCw,
  Send,
  Share2,
  SlidersHorizontal,
  Sparkles,
  Upload,
  Wand2,
  X,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";

/* ─── Split-screen video grids ───
   Docked inside the Video Editor Templates tab. Pick a layout, drop a clip
   in each cell, choose the audio mix, one tap renders — the server composes
   the grid with ffmpeg (xstack/overlay) and the panel polls to completion. */

export interface SplitScreenLayout {
  key: string;
  name: string;
  cells: number;
  description: string;
}

interface SplitScreenPanelProps {
  scenes: SceneData[];
  onUseInEditor: (videoUrl: string, title: string) => void;
  onAddCaptions: (videoUrl: string, title: string) => void;
  onMultiRatio: (videoUrl: string) => void;
  onBack: () => void;
}

type Phase = "configure" | "working" | "done";
type AudioMix = "first" | "mix" | "custom";

const VIDEO_EXT = /\.(mp4|mov|m4v|webm|avi|mkv)(\?|#|$)/i;
const PIP_CORNERS = ["top-left", "top-right", "bottom-left", "bottom-right"] as const;

const CELL_LABELS: Record<string, string[]> = {
  pip: ["splitScreen.mainClip", "splitScreen.insetClip"],
};

function cellLabelKey(layout: string, idx: number): string {
  const custom = CELL_LABELS[layout];
  return custom?.[idx] ?? "splitScreen.cellN";
}

/* Mini visual thumbnail for each layout — pure CSS diagrams. */
function LayoutThumb({ layout, selected }: { layout: string; selected: boolean }) {
  const cell = "bg-[#e8c86a]/70 rounded-[2px]";
  const frame = `relative h-14 w-full overflow-hidden rounded-md border ${selected ? "border-[#e8c86a]" : "border-white/10"} bg-black/50`;
  switch (layout) {
    case "side-by-side":
      return (
        <div className={frame}>
          <div className="absolute inset-1 grid grid-cols-2 gap-0.5">
            <div className={cell} />
            <div className={cell} />
          </div>
        </div>
      );
    case "stacked":
      return (
        <div className={frame}>
          <div className="absolute inset-1 grid grid-rows-2 gap-0.5">
            <div className={cell} />
            <div className={cell} />
          </div>
        </div>
      );
    case "triple":
      return (
        <div className={frame}>
          <div className="absolute inset-1 grid grid-rows-2 gap-0.5">
            <div className={cell} />
            <div className="grid grid-cols-2 gap-0.5">
              <div className={cell} />
              <div className={cell} />
            </div>
          </div>
        </div>
      );
    case "quad":
      return (
        <div className={frame}>
          <div className="absolute inset-1 grid grid-cols-2 grid-rows-2 gap-0.5">
            <div className={cell} />
            <div className={cell} />
            <div className={cell} />
            <div className={cell} />
          </div>
        </div>
      );
    case "pip":
    default:
      return (
        <div className={frame}>
          <div className="absolute inset-1 rounded-[2px] bg-[#e8c86a]/40" />
          <div className="absolute bottom-2 right-2 h-5 w-8 rounded-[2px] bg-[#e8c86a] border border-black/60" />
        </div>
      );
  }
}

export default function SplitScreenPanel({
  scenes,
  onUseInEditor,
  onAddCaptions,
  onMultiRatio,
  onBack,
}: SplitScreenPanelProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { user, getAccessToken } = useAuth();
  const { confirmedFetch } = useConfirmedApi();
  const [, navigate] = useLocation();

  const [layouts, setLayouts] = useState<SplitScreenLayout[] | null>(null);
  const [price, setPrice] = useState(200);
  const [catalogError, setCatalogError] = useState<string | null>(null);

  const [phase, setPhase] = useState<Phase>("configure");
  const [layoutKey, setLayoutKey] = useState("side-by-side");
  const [mode, setMode] = useState<"simple" | "custom">("simple");
  const [cellUrls, setCellUrls] = useState<Record<number, string>>({});
  const [cellNames, setCellNames] = useState<Record<number, string>>({});
  const [audioMix, setAudioMix] = useState<AudioMix>("first");
  const [levels, setLevels] = useState<number[]>([1, 1, 1, 1]);
  const [gap, setGap] = useState(8);
  const [border, setBorder] = useState(0);
  const [borderColor, setBorderColor] = useState("#C9A84C");
  const [backgroundColor, setBackgroundColor] = useState("#000000");
  const [pipCorner, setPipCorner] = useState<(typeof PIP_CORNERS)[number]>("bottom-right");
  const [pipSize, setPipSize] = useState(0.28);
  const [attribution, setAttribution] = useState(false);

  const [uploadingCell, setUploadingCell] = useState<number | null>(null);
  const [urlDrafts, setUrlDrafts] = useState<Record<number, string>>({});
  const [showUrlInput, setShowUrlInput] = useState<Record<number, boolean>>({});
  const [projectPickerFor, setProjectPickerFor] = useState<number | null>(null);
  const [referralCode, setReferralCode] = useState<string | null>(null);

  const [jobStage, setJobStage] = useState("");
  const [jobProgress, setJobProgress] = useState(0);
  const [jobError, setJobError] = useState<string | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [resultDuration, setResultDuration] = useState<number | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fileInputs = useRef<Record<number, HTMLInputElement | null>>({});

  const layout = layouts?.find((l) => l.key === layoutKey) ?? null;
  const cellCount = layout?.cells ?? 2;
  const projectClips = scenes.filter((s) => s.demoClipUrl);

  const loadLayouts = useCallback(async () => {
    setCatalogError(null);
    try {
      const token = await getAccessToken().catch(() => null);
      const res = await fetch("/api/split-screen/layouts", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error(t("splitScreen.catalogFailed"));
      const data = await res.json();
      setLayouts(data.layouts ?? []);
      if (typeof data.price === "number") setPrice(data.price);
    } catch (err) {
      setCatalogError(err instanceof Error ? err.message : t("splitScreen.catalogFailed"));
    }
  }, [getAccessToken, t]);

  useEffect(() => {
    loadLayouts();
  }, [loadLayouts]);

  /* Creator referral code — rides along on every shared link (?ref=CODE). */
  useEffect(() => {
    (async () => {
      try {
        const token = await getAccessToken();
        const res = await fetch("/api/referrals/me", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = await res.json();
          if (data?.code) setReferralCode(data.code);
        }
      } catch {
        /* sharing still works without the code */
      }
    })();
  }, [getAccessToken]);

  useEffect(() => () => {
    if (pollRef.current) clearInterval(pollRef.current);
  }, []);

  function changeLayout(key: string) {
    setLayoutKey(key);
    setCellUrls({});
    setCellNames({});
    setJobError(null);
  }

  /* ── Cell media ── */
  async function uploadFile(file: File): Promise<string> {
    const sb = getSupabase();
    const ext = (file.name.split(".").pop() ?? "mp4").toLowerCase().slice(0, 8);
    const path = `${user?.id ?? "anon"}/split-screen/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    const { error } = await sb.storage
      .from("artist-references")
      .upload(path, file, { upsert: true, contentType: file.type || "video/mp4" });
    if (error) throw error;
    const { data } = sb.storage.from("artist-references").getPublicUrl(path);
    return data.publicUrl;
  }

  async function handleCellFile(cell: number, file: File) {
    if (!file.type.startsWith("video/") && !VIDEO_EXT.test(file.name)) {
      toast({ title: t("splitScreen.wrongKindTitle"), description: t("splitScreen.wrongKindDesc") });
      return;
    }
    setUploadingCell(cell);
    try {
      const url = await uploadFile(file);
      setCellUrls((p) => ({ ...p, [cell]: url }));
      setCellNames((p) => ({ ...p, [cell]: file.name }));
      setProjectPickerFor(null);
    } catch (err) {
      toast({
        title: t("splitScreen.uploadFailed"),
        description: err instanceof Error ? err.message : t("splitScreen.tryAgain"),
      });
    } finally {
      setUploadingCell(null);
    }
  }

  function commitUrlDraft(cell: number) {
    const url = (urlDrafts[cell] ?? "").trim();
    if (!url) return;
    setCellUrls((p) => ({ ...p, [cell]: url }));
    setCellNames((p) => ({ ...p, [cell]: url }));
    setShowUrlInput((p) => ({ ...p, [cell]: false }));
    setProjectPickerFor(null);
  }

  function clearCell(cell: number) {
    setCellUrls((p) => {
      const next = { ...p };
      delete next[cell];
      return next;
    });
    setCellNames((p) => {
      const next = { ...p };
      delete next[cell];
      return next;
    });
  }

  /* ── Render ── */
  async function pollJob(jobId: string) {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const token = await getAccessToken().catch(() => null);
        const res = await fetch(`/api/split-screen/job/${jobId}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) throw new Error(t("splitScreen.pollFailed"));
        const job = await res.json();
        setJobStage(job.stage ?? "");
        setJobProgress(job.progress ?? 0);
        if (job.state === "done") {
          if (pollRef.current) clearInterval(pollRef.current);
          setResultUrl(job.result.url);
          setResultDuration(job.result.durationSec ?? null);
          setPhase("done");
          toast({ title: t("splitScreen.renderDoneTitle"), description: t("splitScreen.renderDoneDesc") });
        } else if (job.state === "failed") {
          if (pollRef.current) clearInterval(pollRef.current);
          setJobError(job.error ?? t("splitScreen.renderFailedDefault"));
          setPhase("configure");
          toast({ title: t("splitScreen.renderFailedTitle"), description: t("splitScreen.refundedNote") });
        }
      } catch (err) {
        if (pollRef.current) clearInterval(pollRef.current);
        setJobError(err instanceof Error ? err.message : t("splitScreen.pollFailed"));
        setPhase("configure");
      }
    }, 3000);
  }

  async function render() {
    const missing: number[] = [];
    for (let i = 0; i < cellCount; i++) if (!cellUrls[i]) missing.push(i + 1);
    if (missing.length > 0) {
      toast({
        title: t("splitScreen.cellsMissingTitle"),
        description: t("splitScreen.cellsMissingDesc", { cells: missing.join(", ") }),
      });
      return;
    }
    setJobError(null);
    setJobStage("queued");
    setJobProgress(0);
    setPhase("working");
    try {
      const res = await confirmedFetch("/api/split-screen/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clips: Array.from({ length: cellCount }, (_, i) => ({ url: cellUrls[i] })),
          layout: layoutKey,
          audioMix,
          levels: audioMix === "custom" ? levels.slice(0, cellCount) : [],
          gap,
          border,
          borderColor,
          backgroundColor,
          pipCorner,
          pipSize,
          attribution,
          title: layout?.name,
        }),
      });
      if (!res) {
        // User cancelled the credit confirmation
        setPhase("configure");
        return;
      }
      if (res.status === 402) {
        const data = await res.json().catch(() => ({}));
        setJobError(data.message ?? t("splitScreen.outOfCredits"));
        setPhase("configure");
        return;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? t("splitScreen.renderFailedDefault"));
      }
      const data = await res.json();
      pollJob(data.jobId);
    } catch (err) {
      setJobError(err instanceof Error ? err.message : t("splitScreen.renderFailedDefault"));
      setPhase("configure");
    }
  }

  /* ── Virality: share links carry the creator's referral code ── */
  function shareUrl(): string | null {
    if (!resultUrl) return null;
    return referralCode ? `${resultUrl}${resultUrl.includes("?") ? "&" : "?"}ref=${referralCode}` : resultUrl;
  }

  function shareTargets() {
    const url = shareUrl();
    if (!url) return [];
    const text = t("splitScreen.shareText", { name: layout?.name ?? "" });
    return [
      {
        label: "X",
        href: `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`,
      },
      {
        label: "Facebook",
        href: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`,
      },
      {
        label: "WhatsApp",
        href: `https://wa.me/?text=${encodeURIComponent(text + " " + url)}`,
      },
    ];
  }

  async function nativeShare() {
    const url = shareUrl();
    if (!url || !navigator.share) return;
    try {
      await navigator.share({
        title: layout?.name ?? "Bow Down Visuals",
        text: t("splitScreen.shareText", { name: layout?.name ?? "" }),
        url,
      });
    } catch {
      /* user dismissed */
    }
  }

  async function copyResultLink() {
    const url = shareUrl();
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      toast({ title: t("splitScreen.linkCopied") });
    } catch {
      toast({ title: t("splitScreen.copyFailed") });
    }
  }

  /* Scheduler handoff — the scheduler's deep-link protocol
     (/scheduler?schedule=1&media=…&caption=…) auto-opens the composer
     with the finished grid video pre-attached. */
  function scheduleHandoff() {
    if (!resultUrl) return;
    const caption = t("splitScreen.scheduleCaption", { name: layout?.name ?? "" });
    navigate(`/scheduler?schedule=1&media=${encodeURIComponent(resultUrl)}&caption=${encodeURIComponent(caption)}`);
  }

  /* "Make a reaction video" — the PiP layout IS the reaction-video look:
     jump back to configure with PiP preselected and the same clips mapped. */
  function makeReactionVideo() {
    setLayoutKey("pip");
    setAudioMix("mix");
    setPhase("configure");
    setResultUrl(null);
    toast({ title: t("splitScreen.reactionPresetTitle"), description: t("splitScreen.reactionPresetDesc") });
  }

  const title = layout?.name ?? t("splitScreen.title");

  return (
    <div className="space-y-5">
      <style>{`
        @keyframes ss-bar { 0%,100% { transform: scaleX(0.35); opacity:.55; } 50% { transform: scaleX(1); opacity:1; } }
        @keyframes ss-pulse-gold { 0%,100% { box-shadow: 0 0 0 0 rgba(232,200,106,.35);} 50% { box-shadow: 0 0 24px 2px rgba(232,200,106,.35);} }
        .ss-bar { animation: ss-bar 2.2s ease-in-out infinite; transform-origin: left; }
        .ss-gold-pulse { animation: ss-pulse-gold 2.4s ease-in-out infinite; }
      `}</style>

      {/* Header */}
      <div className="flex items-center gap-3">
        <Button size="sm" variant="ghost" onClick={onBack} className="text-white/60 hover:text-white -ml-2">
          <ArrowLeft className="h-4 w-4 mr-1" /> {t("splitScreen.back")}
        </Button>
        <div className="min-w-0">
          <h3 className="text-base font-black text-white flex items-center gap-2">
            <Layers className="h-4 w-4 text-[#e8c86a]" />
            {t("splitScreen.title")}
          </h3>
          <p className="text-xs text-white/45 truncate">{t("splitScreen.sub")}</p>
        </div>
      </div>

      {catalogError && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
          <p className="font-semibold mb-2">{catalogError}</p>
          <Button size="sm" variant="outline" onClick={loadLayouts} className="border-red-500/40 text-red-100">
            <RefreshCw className="h-3.5 w-3.5 mr-2" /> {t("splitScreen.retry")}
          </Button>
        </div>
      )}

      {/* ── CONFIGURE ── */}
      {phase === "configure" && !catalogError && (
        <div className="space-y-5">
          {jobError && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
              {jobError}
            </div>
          )}

          {/* Layout picker */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-black uppercase tracking-widest text-white/50">
                {t("splitScreen.pickLayout")}
              </p>
              {/* Simple / Custom mode */}
              <div className="flex rounded-lg border border-white/10 bg-black/40 p-0.5">
                <button
                  onClick={() => setMode("simple")}
                  className={`flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-bold transition-colors ${
                    mode === "simple" ? "bg-[#e8c86a] text-black" : "text-white/50 hover:text-white"
                  }`}
                  data-testid="ss-mode-simple"
                >
                  <Zap className="h-3 w-3" /> {t("splitScreen.modeSimple")}
                </button>
                <button
                  onClick={() => setMode("custom")}
                  className={`flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-bold transition-colors ${
                    mode === "custom" ? "bg-[#e8c86a] text-black" : "text-white/50 hover:text-white"
                  }`}
                  data-testid="ss-mode-custom"
                >
                  <SlidersHorizontal className="h-3 w-3" /> {t("splitScreen.modeCustom")}
                </button>
              </div>
            </div>
            {!layouts ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {[0, 1, 2, 3, 4].map((i) => (
                  <div key={i} className="rounded-xl border border-white/10 bg-white/[0.03] p-2 animate-pulse">
                    <div className="h-14 rounded-md bg-white/5" />
                    <div className="mt-2 h-3 w-2/3 rounded bg-white/10" />
                  </div>
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {layouts.map((l) => (
                  <button
                    key={l.key}
                    onClick={() => changeLayout(l.key)}
                    data-testid={`ss-layout-${l.key}`}
                    className={`text-left rounded-xl border p-2 transition-all ${
                      layoutKey === l.key
                        ? "border-[#e8c86a] bg-[#e8c86a]/[0.07]"
                        : "border-white/10 bg-white/[0.03] hover:border-[#e8c86a]/50"
                    }`}
                  >
                    <LayoutThumb layout={l.key} selected={layoutKey === l.key} />
                    <p className={`mt-1.5 text-xs font-bold ${layoutKey === l.key ? "text-[#e8c86a]" : "text-white"}`}>
                      {l.name}
                    </p>
                    <p className="text-[10px] text-white/40 leading-snug line-clamp-2">{l.description}</p>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* PiP options */}
          {layoutKey === "pip" && (
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 space-y-3">
              <div>
                <p className="text-xs font-bold text-white mb-2">{t("splitScreen.pipCorner")}</p>
                <div className="grid grid-cols-4 gap-1.5">
                  {PIP_CORNERS.map((c) => (
                    <button
                      key={c}
                      onClick={() => setPipCorner(c)}
                      className={`rounded-lg border px-2 py-1.5 text-[11px] font-bold transition-colors ${
                        pipCorner === c
                          ? "border-[#e8c86a] bg-[#e8c86a]/10 text-[#e8c86a]"
                          : "border-white/10 text-white/50 hover:border-white/30"
                      }`}
                    >
                      {t(`splitScreen.corner.${c}`)}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <p className="text-xs font-bold text-white">{t("splitScreen.pipSize")}</p>
                  <span className="text-[11px] text-white/40">{Math.round(pipSize * 100)}%</span>
                </div>
                <input
                  type="range"
                  min={0.1}
                  max={0.5}
                  step={0.02}
                  value={pipSize}
                  onChange={(e) => setPipSize(Number(e.target.value))}
                  className="w-full accent-[#e8c86a]"
                />
              </div>
            </div>
          )}

          {/* Cells */}
          <div className="space-y-3">
            <p className="text-xs font-black uppercase tracking-widest text-white/50">
              {t("splitScreen.yourClips")}
            </p>
            {Array.from({ length: cellCount }, (_, i) => {
              const url = cellUrls[i];
              return (
                <div
                  key={`${layoutKey}-${i}`}
                  className="rounded-xl border border-white/10 bg-white/[0.03] p-3"
                  data-testid={`ss-cell-${i}`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-bold text-white">
                      <span className="text-[#e8c86a] mr-1.5">{i + 1}.</span>{" "}
                      {t(cellLabelKey(layoutKey, i), { n: i + 1 })}
                    </p>
                  </div>

                  {url ? (
                    <div className="flex items-center gap-3">
                      <video src={url} className="h-14 w-14 rounded-lg object-cover border border-white/10" muted playsInline preload="metadata" />
                      <p className="flex-1 min-w-0 text-xs text-white/50 truncate">{cellNames[i] ?? url}</p>
                      <span className="text-[#e8c86a]">
                        <BadgeCheck className="h-5 w-5" />
                      </span>
                      <Button size="sm" variant="ghost" onClick={() => clearCell(i)} className="text-white/40 hover:text-white h-8 w-8 p-0">
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {projectClips.length > 0 && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-white/15 text-white/70 hover:border-[#e8c86a]/50"
                          onClick={() => setProjectPickerFor(projectPickerFor === i ? null : i)}
                        >
                          <Film className="h-3.5 w-3.5 mr-1.5" /> {t("splitScreen.fromProject")}
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-white/15 text-white/70 hover:border-[#e8c86a]/50"
                        disabled={uploadingCell === i}
                        onClick={() => fileInputs.current[i]?.click()}
                      >
                        {uploadingCell === i
                          ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                          : <Upload className="h-3.5 w-3.5 mr-1.5" />}
                        {t("splitScreen.upload")}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-white/15 text-white/70 hover:border-[#e8c86a]/50"
                        onClick={() => setShowUrlInput((p) => ({ ...p, [i]: !p[i] }))}
                      >
                        <Link2 className="h-3.5 w-3.5 mr-1.5" /> {t("splitScreen.pasteUrl")}
                      </Button>
                      <input
                        ref={(el) => { fileInputs.current[i] = el; }}
                        type="file"
                        className="hidden"
                        accept="video/*"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) handleCellFile(i, f);
                          e.target.value = "";
                        }}
                      />
                    </div>
                  )}

                  {projectPickerFor === i && !url && (
                    <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
                      {projectClips.map((scene) => (
                        <button
                          key={scene.id}
                          onClick={() => {
                            setCellUrls((p) => ({ ...p, [i]: scene.demoClipUrl! }));
                            setCellNames((p) => ({ ...p, [i]: `${t("splitScreen.scene")} ${scene.sceneNumber}` }));
                            setProjectPickerFor(null);
                          }}
                          className="shrink-0 w-20 rounded-lg border border-white/10 overflow-hidden hover:border-[#e8c86a]/60 transition-colors"
                        >
                          {scene.thumbnailUrl ? (
                            <img src={scene.thumbnailUrl} alt="" className="h-12 w-full object-cover" />
                          ) : (
                            <div className="h-12 w-full bg-white/5 flex items-center justify-center">
                              <Film className="h-5 w-5 text-white/30" />
                            </div>
                          )}
                          <p className="text-[10px] text-white/60 py-1 bg-black/40">
                            {t("splitScreen.scene")} {scene.sceneNumber}
                          </p>
                        </button>
                      ))}
                    </div>
                  )}

                  {showUrlInput[i] && !url && (
                    <div className="mt-2 flex gap-2">
                      <input
                        value={urlDrafts[i] ?? ""}
                        onChange={(e) => setUrlDrafts((p) => ({ ...p, [i]: e.target.value }))}
                        placeholder="https://…"
                        className="flex-1 min-w-0 rounded-lg bg-black/40 border border-white/15 px-3 py-2 text-xs text-white placeholder:text-white/25 focus:border-[#e8c86a]/60 focus:outline-none"
                      />
                      <Button size="sm" onClick={() => commitUrlDraft(i)} className="bg-[#e8c86a] text-black hover:brightness-110">
                        <Check className="h-4 w-4" />
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Audio mix */}
          <div className="space-y-2">
            <p className="text-xs font-black uppercase tracking-widest text-white/50">
              {t("splitScreen.audioMix")}
            </p>
            <div className="grid grid-cols-3 gap-1.5">
              {(["first", "mix", "custom"] as AudioMix[]).map((m) => (
                <button
                  key={m}
                  onClick={() => setAudioMix(m)}
                  data-testid={`ss-mix-${m}`}
                  className={`rounded-xl border px-2 py-2.5 text-center transition-all ${
                    audioMix === m
                      ? "border-[#e8c86a] bg-[#e8c86a]/10"
                      : "border-white/10 bg-white/[0.03] hover:border-white/30"
                  }`}
                >
                  <p className={`text-xs font-bold ${audioMix === m ? "text-[#e8c86a]" : "text-white"}`}>
                    {t(`splitScreen.mix.${m}`)}
                  </p>
                  <p className="text-[10px] text-white/40 mt-0.5 leading-snug">{t(`splitScreen.mix.${m}Desc`)}</p>
                </button>
              ))}
            </div>
            {audioMix === "custom" && (
              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 space-y-3">
                {Array.from({ length: cellCount }, (_, i) => (
                  <div key={i}>
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-xs font-bold text-white">
                        {t(cellLabelKey(layoutKey, i), { n: i + 1 })}
                      </p>
                      <span className="text-[11px] text-white/40">{Math.round((levels[i] ?? 1) * 100)}%</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={levels[i] ?? 1}
                      onChange={(e) =>
                        setLevels((p) => {
                          const next = [...p];
                          next[i] = Number(e.target.value);
                          return next;
                        })
                      }
                      className="w-full accent-[#e8c86a]"
                      data-testid={`ss-level-${i}`}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Custom styling (Custom mode only) */}
          {mode === "custom" && layoutKey !== "pip" && (
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 space-y-4">
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <p className="text-xs font-bold text-white">{t("splitScreen.gap")}</p>
                  <span className="text-[11px] text-white/40">{gap}px</span>
                </div>
                <input type="range" min={0} max={48} step={2} value={gap} onChange={(e) => setGap(Number(e.target.value))} className="w-full accent-[#e8c86a]" />
              </div>
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <p className="text-xs font-bold text-white">{t("splitScreen.borderWidth")}</p>
                  <span className="text-[11px] text-white/40">{border}px</span>
                </div>
                <input type="range" min={0} max={16} step={1} value={border} onChange={(e) => setBorder(Number(e.target.value))} className="w-full accent-[#e8c86a]" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <p className="text-xs font-bold text-white mb-1.5">{t("splitScreen.borderColor")}</p>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={borderColor}
                      onChange={(e) => setBorderColor(e.target.value)}
                      className="h-9 w-12 rounded-lg bg-transparent border border-white/15 cursor-pointer"
                    />
                    <span className="text-[11px] text-white/40 font-mono">{borderColor}</span>
                  </div>
                </label>
                <label className="block">
                  <p className="text-xs font-bold text-white mb-1.5">{t("splitScreen.bgColor")}</p>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={backgroundColor}
                      onChange={(e) => setBackgroundColor(e.target.value)}
                      className="h-9 w-12 rounded-lg bg-transparent border border-white/15 cursor-pointer"
                    />
                    <span className="text-[11px] text-white/40 font-mono">{backgroundColor}</span>
                  </div>
                </label>
              </div>
            </div>
          )}

          {/* Attribution (virality) */}
          <label className="flex items-start gap-3 rounded-xl border border-[#e8c86a]/25 bg-[#e8c86a]/[0.05] p-3 cursor-pointer">
            <input
              type="checkbox"
              checked={attribution}
              onChange={(e) => setAttribution(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-[#e8c86a]"
            />
            <span>
              <span className="block text-sm font-bold text-white">{t("splitScreen.attributionTitle")}</span>
              <span className="block text-xs text-white/45 mt-0.5">{t("splitScreen.attributionDesc")}</span>
            </span>
          </label>

          {/* Render CTA */}
          <Button
            onClick={render}
            className="w-full bg-gradient-to-b from-[#e8c86a] to-[#b08d3e] text-black font-black hover:brightness-110 ss-gold-pulse"
            data-testid="btn-render-splitscreen"
          >
            <Sparkles className="h-4 w-4 mr-2" />
            {t("splitScreen.renderCta", { price })}
          </Button>
          <p className="text-[11px] text-white/35 text-center -mt-3">{t("splitScreen.refundedNote")}</p>
        </div>
      )}

      {/* ── WORKING ── */}
      {phase === "working" && (
        <div className="rounded-xl border border-[#e8c86a]/30 bg-[#e8c86a]/[0.04] p-6 text-center space-y-4">
          <Loader2 className="h-10 w-10 mx-auto text-[#e8c86a] animate-spin" />
          <div>
            <p className="text-sm font-bold text-white">{t("splitScreen.renderingTitle", { name: layout?.name ?? "" })}</p>
            <p className="text-xs text-white/45 mt-1 capitalize">{jobStage || "queued"}…</p>
          </div>
          <div className="h-2 rounded-full bg-white/10 overflow-hidden">
            <div
              className="ss-bar h-full rounded-full bg-gradient-to-r from-[#e8c86a] to-[#b08d3e] transition-all duration-500"
              style={{ width: `${Math.min(100, Math.max(4, jobProgress))}%` }}
            />
          </div>
          <p className="text-[11px] text-white/35">{t("splitScreen.renderingHint")}</p>
        </div>
      )}

      {/* ── DONE ── */}
      {phase === "done" && resultUrl && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <span className="text-[#e8c86a]">
              <BadgeCheck className="h-5 w-5" />
            </span>
            <h3 className="text-base font-black text-white">{t("splitScreen.doneTitle")}</h3>
            {resultDuration != null && resultDuration > 0 && (
              <span className="text-[11px] text-white/40">· {resultDuration.toFixed(1)}s</span>
            )}
          </div>

          <video
            src={resultUrl}
            controls
            playsInline
            className="w-full rounded-xl border border-white/10 bg-black max-h-[420px]"
            data-testid="splitscreen-result-video"
          />

          {/* Handoff chain */}
          <div className="space-y-2">
            <p className="text-xs font-black uppercase tracking-widest text-white/50">
              {t("splitScreen.nextSteps")}
            </p>
            <div className="grid grid-cols-2 gap-2">
              <Button
                onClick={() => onUseInEditor(resultUrl, title)}
                className="bg-gradient-to-b from-[#e8c86a] to-[#b08d3e] text-black font-bold hover:brightness-110"
                data-testid="btn-handoff-use-in-editor"
              >
                <Clapperboard className="h-4 w-4 mr-1.5" /> {t("splitScreen.handoffUseInEditor")}
              </Button>
              <Button
                onClick={() => onAddCaptions(resultUrl, title)}
                variant="outline"
                className="border-white/15 text-white/80 hover:border-[#e8c86a]/50"
                data-testid="btn-handoff-captions"
              >
                <Captions className="h-4 w-4 mr-1.5" /> {t("splitScreen.handoffCaptions")}
              </Button>
              <Button
                variant="outline"
                onClick={() => onMultiRatio(resultUrl)}
                className="border-white/15 text-white/80 hover:border-[#e8c86a]/50"
                data-testid="btn-handoff-multiratio"
              >
                <ImagePlus className="h-4 w-4 mr-1.5" /> {t("splitScreen.handoffMultiRatio")}
              </Button>
              <Button
                variant="outline"
                onClick={scheduleHandoff}
                className="border-white/15 text-white/80 hover:border-[#e8c86a]/50"
                data-testid="btn-handoff-schedule"
              >
                <Send className="h-4 w-4 mr-1.5" /> {t("splitScreen.handoffSchedule")}
              </Button>
            </div>
          </div>

          {/* "Make a reaction video" suggested next step */}
          <button
            onClick={makeReactionVideo}
            className="w-full rounded-xl border border-[#e8c86a]/30 bg-gradient-to-r from-[#e8c86a]/10 to-transparent p-3 text-left hover:border-[#e8c86a]/60 transition-all"
            data-testid="btn-reaction-video"
          >
            <p className="text-sm font-bold text-[#e8c86a] flex items-center gap-2">
              <Wand2 className="h-4 w-4" /> {t("splitScreen.reactionCta")}
            </p>
            <p className="text-xs text-white/45 mt-0.5">{t("splitScreen.reactionCtaDesc")}</p>
          </button>

          {/* Share (virality) */}
          <div className="space-y-2">
            <p className="text-xs font-black uppercase tracking-widest text-white/50">
              {t("splitScreen.shareTitle")}
            </p>
            <div className="flex flex-wrap gap-2">
              {typeof navigator !== "undefined" && "share" in navigator && (
                <Button size="sm" variant="outline" onClick={nativeShare} className="border-[#e8c86a]/40 text-[#e8c86a]">
                  <Share2 className="h-3.5 w-3.5 mr-1.5" /> {t("splitScreen.share")}
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={copyResultLink} className="border-white/15 text-white/70">
                <Copy className="h-3.5 w-3.5 mr-1.5" /> {t("splitScreen.copyLink")}
              </Button>
              {shareTargets().map((s) => (
                <a key={s.label} href={s.href} target="_blank" rel="noopener noreferrer">
                  <Button size="sm" variant="outline" className="border-white/15 text-white/70">
                    {s.label}
                  </Button>
                </a>
              ))}
              <a href={resultUrl} download={`bowdown-splitscreen-${layoutKey}.mp4`}>
                <Button size="sm" variant="outline" className="border-white/15 text-white/70">
                  <Download className="h-3.5 w-3.5 mr-1.5" /> {t("splitScreen.download")}
                </Button>
              </a>
            </div>
          </div>

          <Button variant="ghost" onClick={onBack} className="w-full text-white/60 hover:text-white">
            <RefreshCw className="h-4 w-4 mr-2" /> {t("splitScreen.makeAnother")}
          </Button>
        </div>
      )}
    </div>
  );
}
