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
  Link2,
  Loader2,
  Music2,
  RefreshCw,
  Scissors,
  Send,
  Share2,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import SplitScreenPanel from "./SplitScreenPanel";

/* ─── Video edit templates tab ───
   CapCut-style templates: pick a template, map clips/photos into its slots,
   edit the text overlays, one tap applies — the server assembles the video
   with ffmpeg and the panel polls the job to completion. */

interface CatalogSlot {
  key: string;
  label: string;
  kind: "video" | "photo" | "any";
  durationSec: number;
}
interface CatalogOverlay {
  text: string;
  slotIndex: number;
  position: "top" | "center" | "bottom";
  size: "sm" | "md" | "lg";
  color: "white" | "gold";
}
export interface CatalogTemplate {
  key: string;
  name: string;
  tagline: string;
  description: string;
  aspect: "9:16" | "16:9" | "1:1";
  durationTargetSec: number;
  outputSeconds: number;
  slots: CatalogSlot[];
  transitions: string[];
  overlays: CatalogOverlay[];
  audioMode: "keep" | "bed";
}

interface TemplatesTabPanelProps {
  scenes: SceneData[];
  deepLinkedKey: string | null;
  onDeepLinkConsumed: () => void;
  onAddCaptions: (videoUrl: string, title: string) => void;
  onUseInEditor: (videoUrl: string, title: string) => void;
  onMultiRatio: (videoUrl: string) => void;
}

type Phase = "browse" | "configure" | "working" | "done" | "splitscreen";

const IMAGE_EXT = /\.(jpe?g|png|webp|gif|bmp|avif)(\?|#|$)/i;
const VIDEO_EXT = /\.(mp4|mov|m4v|webm|avi|mkv)(\?|#|$)/i;

const ASPECT_CLASS: Record<CatalogTemplate["aspect"], string> = {
  "9:16": "aspect-[9/16]",
  "16:9": "aspect-[16/9]",
  "1:1": "aspect-square",
};

function isImageLike(url: string): boolean {
  return IMAGE_EXT.test(url);
}
function isVideoLike(url: string): boolean {
  return VIDEO_EXT.test(url);
}

export default function TemplatesTabPanel({
  scenes,
  deepLinkedKey,
  onDeepLinkConsumed,
  onAddCaptions,
  onUseInEditor,
  onMultiRatio,
}: TemplatesTabPanelProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { user, getAccessToken } = useAuth();
  const { confirmedFetch } = useConfirmedApi();
  const [, navigate] = useLocation();

  const [catalog, setCatalog] = useState<CatalogTemplate[] | null>(null);
  const [price, setPrice] = useState(250);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("browse");
  const [selected, setSelected] = useState<CatalogTemplate | null>(null);

  const [slotUrls, setSlotUrls] = useState<Record<string, string>>({});
  const [slotNames, setSlotNames] = useState<Record<string, string>>({});
  const [overlayTexts, setOverlayTexts] = useState<string[]>([]);
  const [musicBedUrl, setMusicBedUrl] = useState("");
  const [musicBedName, setMusicBedName] = useState("");
  const [endCard, setEndCard] = useState(false);
  const [uploadingSlot, setUploadingSlot] = useState<string | null>(null);
  const [urlDrafts, setUrlDrafts] = useState<Record<string, string>>({});
  const [showUrlInput, setShowUrlInput] = useState<Record<string, boolean>>({});
  const [projectPickerFor, setProjectPickerFor] = useState<string | null>(null);

  const [jobStage, setJobStage] = useState("");
  const [jobProgress, setJobProgress] = useState(0);
  const [jobError, setJobError] = useState<string | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [resultDuration, setResultDuration] = useState<number | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({});
  const bedInput = useRef<HTMLInputElement | null>(null);

  /* ── Catalog ── */
  const loadCatalog = useCallback(async () => {
    setCatalogError(null);
    try {
      const token = await getAccessToken().catch(() => null);
      const res = await fetch("/api/video-template/templates", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error(t("videoTemplates.catalogFailed"));
      const data = await res.json();
      setCatalog(data.templates ?? []);
      if (typeof data.price === "number") setPrice(data.price);
    } catch (err) {
      setCatalogError(err instanceof Error ? err.message : t("videoTemplates.catalogFailed"));
    }
  }, [getAccessToken, t]);

  useEffect(() => {
    loadCatalog();
  }, [loadCatalog]);

  /* Deep link: ?template=<key> preselects a template */
  useEffect(() => {
    if (!catalog || !deepLinkedKey) return;
    const found = catalog.find((c) => c.key === deepLinkedKey);
    if (found) {
      pickTemplate(found);
      onDeepLinkConsumed();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalog, deepLinkedKey]);

  useEffect(() => () => {
    if (pollRef.current) clearInterval(pollRef.current);
  }, []);

  function pickTemplate(tpl: CatalogTemplate) {
    setSelected(tpl);
    setSlotUrls({});
    setSlotNames({});
    setOverlayTexts(tpl.overlays.map((o) => o.text));
    setMusicBedUrl("");
    setMusicBedName("");
    setEndCard(false);
    setJobError(null);
    setResultUrl(null);
    setPhase("configure");
  }

  function backToBrowse() {
    if (pollRef.current) clearInterval(pollRef.current);
    setSelected(null);
    setPhase("browse");
  }

  /* ── Slot media ── */
  const projectClips = scenes.filter((s) => s.demoClipUrl);

  function slotAccepts(slot: CatalogSlot, url: string, mime = ""): boolean {
    if (mime.startsWith("image/")) return slot.kind !== "video";
    if (mime.startsWith("video/")) return slot.kind !== "photo";
    if (isImageLike(url)) return slot.kind !== "video";
    if (isVideoLike(url)) return slot.kind !== "photo";
    return true; // unknown extension — the server probes and reports clearly
  }

  async function uploadFile(file: File, folder: string): Promise<string> {
    const sb = getSupabase();
    const ext = (file.name.split(".").pop() ?? "bin").toLowerCase().slice(0, 8);
    const path = `${user?.id ?? "anon"}/${folder}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    const { error } = await sb.storage
      .from("artist-references")
      .upload(path, file, { upsert: true, contentType: file.type || "application/octet-stream" });
    if (error) throw error;
    const { data } = sb.storage.from("artist-references").getPublicUrl(path);
    return data.publicUrl;
  }

  async function handleSlotFile(slot: CatalogSlot, file: File) {
    if (!slotAccepts(slot, file.name, file.type)) {
      toast({
        title: t("videoTemplates.wrongKindTitle"),
        description: t("videoTemplates.wrongKindDesc", { label: slot.label, kind: slot.kind }),
      });
      return;
    }
    setUploadingSlot(slot.key);
    try {
      const url = await uploadFile(file, "video-templates");
      setSlotUrls((p) => ({ ...p, [slot.key]: url }));
      setSlotNames((p) => ({ ...p, [slot.key]: file.name }));
      setProjectPickerFor(null);
    } catch (err) {
      toast({
        title: t("videoTemplates.uploadFailed"),
        description: err instanceof Error ? err.message : t("videoTemplates.tryAgain"),
      });
    } finally {
      setUploadingSlot(null);
    }
  }

  function commitUrlDraft(slot: CatalogSlot) {
    const url = (urlDrafts[slot.key] ?? "").trim();
    if (!url) return;
    if (!slotAccepts(slot, url)) {
      toast({
        title: t("videoTemplates.wrongKindTitle"),
        description: t("videoTemplates.wrongKindDesc", { label: slot.label, kind: slot.kind }),
      });
      return;
    }
    setSlotUrls((p) => ({ ...p, [slot.key]: url }));
    setSlotNames((p) => ({ ...p, [slot.key]: url }));
    setShowUrlInput((p) => ({ ...p, [slot.key]: false }));
    setProjectPickerFor(null);
  }

  function clearSlot(slotKey: string) {
    setSlotUrls((p) => {
      const next = { ...p };
      delete next[slotKey];
      return next;
    });
    setSlotNames((p) => {
      const next = { ...p };
      delete next[slotKey];
      return next;
    });
  }

  /* ── Apply ── */
  async function pollJob(jobId: string) {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const token = await getAccessToken().catch(() => null);
        const res = await fetch(`/api/video-template/job/${jobId}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) throw new Error(t("videoTemplates.pollFailed"));
        const job = await res.json();
        setJobStage(job.stage ?? "");
        setJobProgress(job.progress ?? 0);
        if (job.state === "done") {
          if (pollRef.current) clearInterval(pollRef.current);
          setResultUrl(job.result.url);
          setResultDuration(job.result.durationSec ?? null);
          setPhase("done");
          toast({ title: t("videoTemplates.renderDoneTitle"), description: t("videoTemplates.renderDoneDesc") });
        } else if (job.state === "failed") {
          if (pollRef.current) clearInterval(pollRef.current);
          setJobError(job.error ?? t("videoTemplates.renderFailedDefault"));
          setPhase("configure");
          toast({ title: t("videoTemplates.renderFailedTitle"), description: t("videoTemplates.refundedNote") });
        }
      } catch (err) {
        if (pollRef.current) clearInterval(pollRef.current);
        setJobError(err instanceof Error ? err.message : t("videoTemplates.pollFailed"));
        setPhase("configure");
      }
    }, 3000);
  }

  async function applyTemplate() {
    if (!selected) return;
    const missing = selected.slots.filter((s) => !slotUrls[s.key]);
    if (missing.length > 0) {
      toast({
        title: t("videoTemplates.slotsMissingTitle"),
        description: t("videoTemplates.slotsMissingDesc", { labels: missing.map((m) => m.label).join(", ") }),
      });
      return;
    }
    setJobError(null);
    setJobStage("queued");
    setJobProgress(0);
    setPhase("working");
    try {
      const res = await confirmedFetch("/api/video-template/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          template: selected.key,
          slots: selected.slots.map((s) => ({ url: slotUrls[s.key] })),
          overlays: overlayTexts,
          musicBedUrl: musicBedUrl.trim() || undefined,
          title: selected.name,
          endCard,
        }),
      });
      if (!res) {
        // User cancelled the credit confirmation
        setPhase("configure");
        return;
      }
      if (res.status === 402) {
        const data = await res.json().catch(() => ({}));
        setJobError(data.message ?? t("videoTemplates.outOfCredits"));
        setPhase("configure");
        return;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? t("videoTemplates.renderFailedDefault"));
      }
      const data = await res.json();
      pollJob(data.jobId);
    } catch (err) {
      setJobError(err instanceof Error ? err.message : t("videoTemplates.renderFailedDefault"));
      setPhase("configure");
    }
  }

  /* ── Share (virality) ── */
  function shareTargets() {
    if (!resultUrl) return [];
    const text = t("videoTemplates.shareText", { name: selected?.name ?? "" });
    return [
      {
        label: "X",
        href: `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(resultUrl)}`,
      },
      {
        label: "Facebook",
        href: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(resultUrl)}`,
      },
      {
        label: "WhatsApp",
        href: `https://wa.me/?text=${encodeURIComponent(text + " " + resultUrl)}`,
      },
    ];
  }

  async function nativeShare() {
    if (!resultUrl || !navigator.share) return;
    try {
      await navigator.share({
        title: selected?.name ?? "Bow Down Visuals",
        text: t("videoTemplates.shareText", { name: selected?.name ?? "" }),
        url: resultUrl,
      });
    } catch {
      /* user dismissed */
    }
  }

  async function copyResultLink() {
    if (!resultUrl) return;
    try {
      await navigator.clipboard.writeText(resultUrl);
      toast({ title: t("videoTemplates.linkCopied") });
    } catch {
      toast({ title: t("videoTemplates.copyFailed") });
    }
  }

  /* Scheduler handoff — the scheduler's deep-link protocol
     (/scheduler?schedule=1&media=…&caption=…) auto-opens the composer
     with the finished template video pre-attached. */
  function scheduleHandoff() {
    if (!resultUrl) return;
    const caption = t("videoTemplates.scheduleCaption", { name: selected?.name ?? "" });
    navigate(
      `/scheduler?schedule=1&media=${encodeURIComponent(resultUrl)}&caption=${encodeURIComponent(caption)}`,
    );
  }

  /* ── Render ── */
  return (
    <div className="space-y-5">
      <style>{`
        @keyframes vt-shimmer { 0% { transform: translateX(-120%) skewX(-18deg); } 100% { transform: translateX(240%) skewX(-18deg); } }
        @keyframes vt-bar { 0%,100% { transform: scaleX(0.35); opacity:.55; } 50% { transform: scaleX(1); opacity:1; } }
        @keyframes vt-rise { 0%,100% { transform: translateY(6px); opacity:.5; } 50% { transform: translateY(-6px); opacity:1; } }
        @keyframes vt-pulse-gold { 0%,100% { box-shadow: 0 0 0 0 rgba(232,200,106,.35);} 50% { box-shadow: 0 0 24px 2px rgba(232,200,106,.35);} }
        .vt-shimmer { animation: vt-shimmer 2.6s ease-in-out infinite; }
        .vt-bar { animation: vt-bar 2.2s ease-in-out infinite; transform-origin: left; }
        .vt-rise { animation: vt-rise 2.8s ease-in-out infinite; }
        .vt-gold-pulse { animation: vt-pulse-gold 2.4s ease-in-out infinite; }
      `}</style>

      {/* Catalog error */}
      {catalogError && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
          <p className="font-semibold mb-2">{catalogError}</p>
          <Button size="sm" variant="outline" onClick={loadCatalog} className="border-red-500/40 text-red-100">
            <RefreshCw className="h-3.5 w-3.5 mr-2" /> {t("videoTemplates.retry")}
          </Button>
        </div>
      )}

      {/* ── BROWSE ── */}
      {phase === "browse" && !catalogError && (
        <>
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-black text-white flex items-center gap-2">
                <Clapperboard className="h-4 w-4 text-[#e8c86a]" />
                {t("videoTemplates.browseTitle")}
              </h3>
              <p className="text-xs text-white/45 mt-1">{t("videoTemplates.browseSub")}</p>
            </div>
          </div>

          {/* Split-screen grids — docked inside the Templates tab (no new sidebar item) */}
          <button
            onClick={() => setPhase("splitscreen")}
            data-testid="card-splitscreen"
            className="w-full text-left rounded-xl border border-[#e8c86a]/40 bg-gradient-to-r from-[#e8c86a]/[0.08] via-[#e8c86a]/[0.03] to-transparent p-4 hover:border-[#e8c86a]/70 transition-all"
          >
            <div className="flex items-center gap-3">
              <div className="grid grid-cols-2 grid-rows-2 gap-1 w-11 h-11 shrink-0 rounded-lg overflow-hidden border border-[#e8c86a]/40 p-1 bg-black/50">
                <div className="rounded-[3px] bg-[#e8c86a]/80" />
                <div className="rounded-[3px] bg-[#e8c86a]/50" />
                <div className="rounded-[3px] bg-[#e8c86a]/50" />
                <div className="rounded-[3px] bg-[#e8c86a]/80" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-black text-[#e8c86a]">{t("videoTemplates.splitScreenTitle")}</p>
                <p className="text-xs text-white/45 mt-0.5 line-clamp-2">{t("videoTemplates.splitScreenDesc")}</p>
              </div>
              <span className="shrink-0 rounded-full bg-[#e8c86a] text-black text-[10px] font-black uppercase tracking-wider px-2.5 py-1">
                {t("videoTemplates.new")}
              </span>
            </div>
          </button>

          {!catalog ? (
            <div className="grid grid-cols-2 gap-3">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="rounded-xl border border-white/10 bg-white/[0.03] p-3 animate-pulse">
                  <div className="aspect-[9/16] rounded-lg bg-white/5" />
                  <div className="mt-3 h-3 w-2/3 rounded bg-white/10" />
                  <div className="mt-2 h-2 w-1/2 rounded bg-white/5" />
                </div>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {catalog.map((tpl) => (
                <button
                  key={tpl.key}
                  onClick={() => pickTemplate(tpl)}
                  data-testid={`template-card-${tpl.key}`}
                  className="group text-left rounded-xl border border-white/10 bg-white/[0.03] p-3 hover:border-[#e8c86a]/50 hover:bg-white/[0.05] transition-all"
                >
                  {/* Animated preview */}
                  <div className={`relative ${ASPECT_CLASS[tpl.aspect]} w-full overflow-hidden rounded-lg bg-gradient-to-br from-[#141414] via-[#0a0a0a] to-[#1c1408] border border-white/5`}>
                    <div className="vt-shimmer absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-[#e8c86a]/25 to-transparent" />
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-3">
                      <div className="vt-rise flex gap-1">
                        {tpl.slots.slice(0, 5).map((s, i) => (
                          <span
                            key={s.key}
                            className="h-1.5 w-6 rounded-full bg-[#e8c86a]/70"
                            style={{ animationDelay: `${i * 0.25}s` }}
                          />
                        ))}
                      </div>
                      <div className="vt-bar h-2.5 w-3/4 rounded-full bg-gradient-to-r from-[#e8c86a] to-[#b08d3e]" />
                      <div className="vt-bar h-2 w-1/2 rounded-full bg-white/25" style={{ animationDelay: "0.6s" }} />
                    </div>
                    <span className="absolute top-2 left-2 rounded-full bg-black/70 border border-[#e8c86a]/40 px-2 py-0.5 text-[10px] font-bold text-[#e8c86a]">
                      {tpl.aspect}
                    </span>
                  </div>
                  <p className="mt-3 text-sm font-bold text-white group-hover:text-[#e8c86a] transition-colors">
                    {tpl.name}
                  </p>
                  <p className="text-[11px] text-white/45 leading-snug mt-0.5 line-clamp-2">{tpl.tagline}</p>
                  <p className="mt-2 text-[10px] font-semibold uppercase tracking-wider text-white/35">
                    {t("videoTemplates.slotsLabel", { count: tpl.slots.length })} · ~{Math.round(tpl.outputSeconds)}s
                  </p>
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {/* ── SPLIT-SCREEN ── */}
      {phase === "splitscreen" && (
        <SplitScreenPanel
          scenes={scenes}
          onUseInEditor={onUseInEditor}
          onAddCaptions={onAddCaptions}
          onMultiRatio={onMultiRatio}
          onBack={() => setPhase("browse")}
        />
      )}

      {/* ── CONFIGURE ── */}
      {phase === "configure" && selected && (
        <div className="space-y-5">
          <div className="flex items-center gap-3">
            <Button size="sm" variant="ghost" onClick={backToBrowse} className="text-white/60 hover:text-white -ml-2">
              <ArrowLeft className="h-4 w-4 mr-1" /> {t("videoTemplates.back")}
            </Button>
            <div className="min-w-0">
              <h3 className="text-base font-black text-white truncate">{selected.name}</h3>
              <p className="text-xs text-white/45 truncate">{selected.tagline}</p>
            </div>
          </div>

          {jobError && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
              {jobError}
            </div>
          )}

          {/* Slots */}
          <div className="space-y-3">
            <p className="text-xs font-black uppercase tracking-widest text-white/50">
              {t("videoTemplates.yourMedia")}
            </p>
            {selected.slots.map((slot, idx) => {
              const url = slotUrls[slot.key];
              const isImg = url ? isImageLike(url) : false;
              return (
                <div
                  key={slot.key}
                  className="rounded-xl border border-white/10 bg-white/[0.03] p-3"
                  data-testid={`slot-${slot.key}`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-bold text-white">
                      <span className="text-[#e8c86a] mr-1.5">{idx + 1}.</span> {slot.label}
                    </p>
                    <span className="text-[10px] uppercase tracking-wider text-white/35 font-semibold">
                      {slot.kind === "photo"
                        ? t("videoTemplates.kindPhoto")
                        : slot.kind === "video"
                          ? t("videoTemplates.kindVideo")
                          : t("videoTemplates.kindAny")}
                      {" · "}{slot.durationSec}s
                    </span>
                  </div>

                  {url ? (
                    <div className="flex items-center gap-3">
                      {isImg ? (
                        <img src={url} alt={slot.label} className="h-14 w-14 rounded-lg object-cover border border-white/10" />
                      ) : (
                        <video src={url} className="h-14 w-14 rounded-lg object-cover border border-white/10" muted playsInline preload="metadata" />
                      )}
                      <p className="flex-1 min-w-0 text-xs text-white/50 truncate">{slotNames[slot.key] ?? url}</p>
                      <span className="text-[#e8c86a]"><BadgeCheck className="h-5 w-5" /></span>
                      <Button size="sm" variant="ghost" onClick={() => clearSlot(slot.key)} className="text-white/40 hover:text-white h-8 w-8 p-0">
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {(slot.kind === "video" || slot.kind === "any") && projectClips.length > 0 && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-white/15 text-white/70 hover:border-[#e8c86a]/50"
                          onClick={() => setProjectPickerFor(projectPickerFor === slot.key ? null : slot.key)}
                        >
                          <Film className="h-3.5 w-3.5 mr-1.5" /> {t("videoTemplates.fromProject")}
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-white/15 text-white/70 hover:border-[#e8c86a]/50"
                        disabled={uploadingSlot === slot.key}
                        onClick={() => fileInputs.current[slot.key]?.click()}
                      >
                        {uploadingSlot === slot.key
                          ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                          : <Upload className="h-3.5 w-3.5 mr-1.5" />}
                        {t("videoTemplates.upload")}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-white/15 text-white/70 hover:border-[#e8c86a]/50"
                        onClick={() => setShowUrlInput((p) => ({ ...p, [slot.key]: !p[slot.key] }))}
                      >
                        <Link2 className="h-3.5 w-3.5 mr-1.5" /> {t("videoTemplates.pasteUrl")}
                      </Button>
                      <input
                        ref={(el) => { fileInputs.current[slot.key] = el; }}
                        type="file"
                        className="hidden"
                        accept={slot.kind === "photo" ? "image/*" : slot.kind === "video" ? "video/*" : "image/*,video/*"}
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) handleSlotFile(slot, f);
                          e.target.value = "";
                        }}
                      />
                    </div>
                  )}

                  {/* Project clip picker */}
                  {projectPickerFor === slot.key && !url && (
                    <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
                      {projectClips.map((scene) => (
                        <button
                          key={scene.id}
                          onClick={() => {
                            setSlotUrls((p) => ({ ...p, [slot.key]: scene.demoClipUrl! }));
                            setSlotNames((p) => ({ ...p, [slot.key]: `${t("videoTemplates.scene")} ${scene.sceneNumber}` }));
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
                            {t("videoTemplates.scene")} {scene.sceneNumber}
                          </p>
                        </button>
                      ))}
                    </div>
                  )}

                  {/* URL input */}
                  {showUrlInput[slot.key] && !url && (
                    <div className="mt-2 flex gap-2">
                      <input
                        value={urlDrafts[slot.key] ?? ""}
                        onChange={(e) => setUrlDrafts((p) => ({ ...p, [slot.key]: e.target.value }))}
                        placeholder="https://…"
                        className="flex-1 min-w-0 rounded-lg bg-black/40 border border-white/15 px-3 py-2 text-xs text-white placeholder:text-white/25 focus:border-[#e8c86a]/60 focus:outline-none"
                      />
                      <Button size="sm" onClick={() => commitUrlDraft(slot)} className="bg-[#e8c86a] text-black hover:brightness-110">
                        <Check className="h-4 w-4" />
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Text overlays */}
          {selected.overlays.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-black uppercase tracking-widest text-white/50">
                {t("videoTemplates.textOverlays")}
              </p>
              {selected.overlays.map((ov, i) => (
                <input
                  key={i}
                  value={overlayTexts[i] ?? ""}
                  onChange={(e) =>
                    setOverlayTexts((p) => {
                      const next = [...p];
                      next[i] = e.target.value;
                      return next;
                    })
                  }
                  maxLength={140}
                  placeholder={ov.text}
                  className="w-full rounded-lg bg-black/40 border border-white/15 px-3 py-2 text-sm text-white placeholder:text-white/25 focus:border-[#e8c86a]/60 focus:outline-none"
                />
              ))}
            </div>
          )}

          {/* Music bed */}
          <div className="space-y-2">
            <p className="text-xs font-black uppercase tracking-widest text-white/50 flex items-center gap-1.5">
              <Music2 className="h-3.5 w-3.5 text-[#e8c86a]" /> {t("videoTemplates.musicBed")}
              <span className="normal-case font-medium text-white/35 tracking-normal">({t("videoTemplates.optional")})</span>
            </p>
            {musicBedUrl ? (
              <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
                <Music2 className="h-4 w-4 text-[#e8c86a] shrink-0" />
                <p className="flex-1 min-w-0 text-xs text-white/60 truncate">{musicBedName || musicBedUrl}</p>
                <Button size="sm" variant="ghost" onClick={() => { setMusicBedUrl(""); setMusicBedName(""); }} className="text-white/40 hover:text-white h-7 w-7 p-0">
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            ) : (
              <div className="flex gap-2">
                <Button size="sm" variant="outline" className="border-white/15 text-white/70" onClick={() => bedInput.current?.click()}>
                  <Upload className="h-3.5 w-3.5 mr-1.5" /> {t("videoTemplates.uploadAudio")}
                </Button>
                <input
                  ref={bedInput}
                  type="file"
                  accept="audio/*"
                  className="hidden"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    try {
                      const url = await uploadFile(f, "video-template-beds");
                      setMusicBedUrl(url);
                      setMusicBedName(f.name);
                    } catch (err) {
                      toast({ title: t("videoTemplates.uploadFailed"), description: err instanceof Error ? err.message : "" });
                    }
                    e.target.value = "";
                  }}
                />
              </div>
            )}
            <p className="text-[11px] text-white/35">{t("videoTemplates.musicBedHint")}</p>
          </div>

          {/* Branded end card (virality) */}
          <label className="flex items-start gap-3 rounded-xl border border-[#e8c86a]/25 bg-[#e8c86a]/[0.05] p-3 cursor-pointer">
            <input
              type="checkbox"
              checked={endCard}
              onChange={(e) => setEndCard(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-[#e8c86a]"
            />
            <span>
              <span className="block text-sm font-bold text-white">{t("videoTemplates.endCardTitle")}</span>
              <span className="block text-xs text-white/45 mt-0.5">{t("videoTemplates.endCardDesc")}</span>
            </span>
          </label>

          {/* Apply */}
          <Button
            onClick={applyTemplate}
            className="w-full bg-gradient-to-b from-[#e8c86a] to-[#b08d3e] text-black font-black hover:brightness-110 vt-gold-pulse"
            data-testid="btn-apply-template"
          >
            <Sparkles className="h-4 w-4 mr-2" />
            {t("videoTemplates.applyCta", { price })}
          </Button>
          <p className="text-[11px] text-white/35 text-center -mt-3">{t("videoTemplates.refundedNote")}</p>
        </div>
      )}

      {/* ── WORKING ── */}
      {phase === "working" && selected && (
        <div className="rounded-xl border border-[#e8c86a]/30 bg-[#e8c86a]/[0.04] p-6 text-center space-y-4">
          <Loader2 className="h-10 w-10 mx-auto text-[#e8c86a] animate-spin" />
          <div>
            <p className="text-sm font-bold text-white">{t("videoTemplates.renderingTitle", { name: selected.name })}</p>
            <p className="text-xs text-white/45 mt-1 capitalize">{jobStage || "queued"}…</p>
          </div>
          <div className="h-2 rounded-full bg-white/10 overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-[#e8c86a] to-[#b08d3e] transition-all duration-500"
              style={{ width: `${Math.min(100, Math.max(4, jobProgress))}%` }}
            />
          </div>
          <p className="text-[11px] text-white/35">{t("videoTemplates.renderingHint")}</p>
        </div>
      )}

      {/* ── DONE ── */}
      {phase === "done" && selected && resultUrl && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <span className="text-[#e8c86a]"><BadgeCheck className="h-5 w-5" /></span>
            <h3 className="text-base font-black text-white">{t("videoTemplates.doneTitle")}</h3>
            {resultDuration != null && (
              <span className="text-[11px] text-white/40">· {resultDuration.toFixed(1)}s</span>
            )}
          </div>

          <video
            src={resultUrl}
            controls
            playsInline
            className="w-full rounded-xl border border-white/10 bg-black max-h-[420px]"
            data-testid="template-result-video"
          />

          {/* Handoff chain */}
          <div className="space-y-2">
            <p className="text-xs font-black uppercase tracking-widest text-white/50">
              {t("videoTemplates.nextSteps")}
            </p>
            <div className="grid grid-cols-2 gap-2">
              <Button
                onClick={() => onAddCaptions(resultUrl, selected.name)}
                className="bg-gradient-to-b from-[#e8c86a] to-[#b08d3e] text-black font-bold hover:brightness-110"
                data-testid="btn-handoff-captions"
              >
                <Captions className="h-4 w-4 mr-1.5" /> {t("videoTemplates.handoffCaptions")}
              </Button>
              <Button
                variant="outline"
                onClick={() => navigate("/thumbnail-maker")}
                className="border-white/15 text-white/80 hover:border-[#e8c86a]/50"
                data-testid="btn-handoff-thumbnail"
              >
                <ImagePlus className="h-4 w-4 mr-1.5" /> {t("videoTemplates.handoffThumbnail")}
              </Button>
              <Button
                variant="outline"
                onClick={() => navigate("/repurpose?mode=stream")}
                className="border-white/15 text-white/80 hover:border-[#e8c86a]/50"
                data-testid="btn-handoff-clips"
              >
                <Scissors className="h-4 w-4 mr-1.5" /> {t("videoTemplates.handoffClips")}
              </Button>
              <Button
                variant="outline"
                onClick={scheduleHandoff}
                className="border-white/15 text-white/80 hover:border-[#e8c86a]/50"
                data-testid="btn-handoff-schedule"
              >
                <Send className="h-4 w-4 mr-1.5" /> {t("videoTemplates.handoffSchedule")}
              </Button>
            </div>
          </div>

          {/* Share (virality) */}
          <div className="space-y-2">
            <p className="text-xs font-black uppercase tracking-widest text-white/50">
              {t("videoTemplates.shareTitle")}
            </p>
            <div className="flex flex-wrap gap-2">
              {typeof navigator !== "undefined" && "share" in navigator && (
                <Button size="sm" variant="outline" onClick={nativeShare} className="border-[#e8c86a]/40 text-[#e8c86a]">
                  <Share2 className="h-3.5 w-3.5 mr-1.5" /> {t("videoTemplates.share")}
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={copyResultLink} className="border-white/15 text-white/70">
                <Copy className="h-3.5 w-3.5 mr-1.5" /> {t("videoTemplates.copyLink")}
              </Button>
              {shareTargets().map((s) => (
                <a key={s.label} href={s.href} target="_blank" rel="noopener noreferrer">
                  <Button size="sm" variant="outline" className="border-white/15 text-white/70">
                    {s.label}
                  </Button>
                </a>
              ))}
              <a href={resultUrl} download={`bowdown-template-${selected.key}.mp4`}>
                <Button size="sm" variant="outline" className="border-white/15 text-white/70">
                  <Download className="h-3.5 w-3.5 mr-1.5" /> {t("videoTemplates.download")}
                </Button>
              </a>
            </div>
          </div>

          <Button variant="ghost" onClick={backToBrowse} className="w-full text-white/60 hover:text-white">
            <RefreshCw className="h-4 w-4 mr-2" /> {t("videoTemplates.makeAnother")}
          </Button>
        </div>
      )}
    </div>
  );
}
