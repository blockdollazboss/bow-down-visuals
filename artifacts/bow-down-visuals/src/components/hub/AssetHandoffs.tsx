import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Mic2, AudioWaveform, Repeat, Captions, SplitSquareHorizontal,
  FileText, Laugh, Palette, Loader2, Check, AlertCircle, Copy,
  ExternalLink,
} from "lucide-react";
import { useHubProject, type HubAsset, type HubAssetKind } from "@/lib/hub-project";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { useToast } from "@/hooks/use-toast";

/* ─── AssetHandoffs ─────────────────────────────────────────────────────────
   "Send to next step" rail for orphaned backend tools — endpoints that exist
   server-side but never got a frontend caller. Each button runs the tool
   through the credit-confirmation flow, shows real progress, renders a
   reviewable result, and saves the output back into the hub project so the
   chain keeps flowing. Mount inside any tool's result area:

     <AssetHandoffs asset={songAsset} handoffs={["karaoke", "audiogram"]} />

   Virality: every result card carries the creator's referral share link and
   the project's "Made with Bow Down Visuals" credit line (when enabled). */

export type HandoffId =
  | "karaoke"
  | "audiogram"
  | "loop"
  | "auto-captions"
  | "thumbnail-ab"
  | "clip-description"
  | "meme"
  | "social-kit";

interface HandoffMeta {
  icon: typeof Mic2;
  endpoint: string;
  costKey: string; // i18n key under hubSpine.handoffs.<id>
  resultKind: HubAssetKind;
  resultMedia: "video" | "audio" | "image" | "text";
}

const HANDOFFS: Record<HandoffId, HandoffMeta> = {
  "karaoke":        { icon: Mic2,                   endpoint: "/api/karaoke-video",   costKey: "karaoke",        resultKind: "video", resultMedia: "video" },
  "audiogram":      { icon: AudioWaveform,          endpoint: "/api/audiogram",       costKey: "audiogram",      resultKind: "video", resultMedia: "video" },
  "loop":           { icon: Repeat,                 endpoint: "/api/loop-video",      costKey: "loop",           resultKind: "clip",  resultMedia: "video" },
  "auto-captions":  { icon: Captions,               endpoint: "/api/auto-captions",   costKey: "autoCaptions",   resultKind: "clip",  resultMedia: "video" },
  "thumbnail-ab":   { icon: SplitSquareHorizontal,  endpoint: "/api/thumbnail-ab",    costKey: "thumbnailAb",    resultKind: "image", resultMedia: "image" },
  "clip-description": { icon: FileText,             endpoint: "/api/clip-description", costKey: "clipDescription", resultKind: "script", resultMedia: "text" },
  "meme":           { icon: Laugh,                  endpoint: "/api/meme",            costKey: "meme",           resultKind: "image", resultMedia: "image" },
  "social-kit":     { icon: Palette,                endpoint: "/api/social-kit",      costKey: "socialKit",      resultKind: "image", resultMedia: "image" },
};

export interface AssetHandoffsProps {
  /** The source asset the handoff runs on. */
  asset: HubAsset;
  /** Which orphaned tools to offer, in display order. */
  handoffs: HandoffId[];
  /** Extra context some handoffs need. */
  lyricsText?: string;
  coverUrl?: string;
  topic?: string;
  prompt?: string;
  overlayText?: string;
  brandName?: string;
  tagline?: string;
}

interface HandoffResult {
  id: HandoffId;
  url?: string;
  text?: string;
  label: string;
}

function formatLrcTime(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = Math.floor(totalSeconds % 60);
  const cs = Math.floor((totalSeconds % 1) * 100);
  return `[${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}]`;
}

/** Evenly distribute lyric lines across the audio duration as LRC. */
function lyricsToLrc(lyrics: string, durationSec: number): string {
  const lines = lyrics
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !/^\[.*\]$/.test(l) && !/^(verse|chorus|hook|bridge|outro|intro|pre-chorus)/i.test(l));
  if (lines.length === 0) return "";
  const step = Math.max(durationSec / lines.length, 1);
  return lines.map((l, i) => `${formatLrcTime(1 + i * step)}${l}`).join("\n");
}

function audioDuration(url: string): Promise<number> {
  return new Promise((resolve) => {
    const el = document.createElement("audio");
    el.preload = "metadata";
    el.onloadedmetadata = () => resolve(el.duration && isFinite(el.duration) ? el.duration : 180);
    el.onerror = () => resolve(180);
    el.src = url;
    setTimeout(() => resolve(180), 8000);
  });
}

export function AssetHandoffs({ asset, handoffs, lyricsText, coverUrl, topic, prompt, overlayText, brandName, tagline }: AssetHandoffsProps) {
  const { t } = useTranslation();
  const { addAsset, project, getShareLink } = useHubProject();
  const { confirmedFetch } = useConfirmedApi();
  const { toast } = useToast();
  const [running, setRunning] = useState<HandoffId | null>(null);
  const [status, setStatus] = useState<string>("");
  const [results, setResults] = useState<HandoffResult[]>([]);
  const [errors, setErrors] = useState<Partial<Record<HandoffId, string>>>({});
  const [memeTexts, setMemeTexts] = useState({ top: "", bottom: "" });
  const [copied, setCopied] = useState(false);

  async function buildBody(id: HandoffId): Promise<Record<string, unknown> | null> {
    switch (id) {
      case "karaoke": {
        if (!lyricsText?.trim()) {
          toast({ title: t("hubSpine.handoffs.karaokeNeedsLyricsTitle"), description: t("hubSpine.handoffs.karaokeNeedsLyricsDesc"), variant: "destructive" });
          return null;
        }
        setStatus(t("hubSpine.handoffs.measuringAudio"));
        const duration = await audioDuration(asset.url);
        const lrc = lyricsToLrc(lyricsText, duration);
        if (!lrc) return null;
        return {
          audioUrl: asset.url,
          lrc,
          title: asset.meta?.["title"] ?? asset.label,
          artist: asset.meta?.["artist"] ?? "",
          theme: "gold-luxury",
        };
      }
      case "audiogram": {
        if (!coverUrl) {
          toast({ title: t("hubSpine.handoffs.audiogramNeedsCoverTitle"), description: t("hubSpine.handoffs.audiogramNeedsCoverDesc"), variant: "destructive" });
          return null;
        }
        return { audioUrl: asset.url, coverUrl, waveColor: "gold", style: "waveform" };
      }
      case "loop":
        return { videoUrl: asset.url, loops: 3, crossfade: 0.5 };
      case "auto-captions":
        return { videoUrl: asset.url, fontSize: 28, highlightColor: "#FFD700", includeWords: false };
      case "thumbnail-ab":
        return {
          prompt: prompt ?? asset.label,
          overlayText: overlayText ?? asset.meta?.["title"] ?? "",
          aspectRatio: "16:9",
        };
      case "clip-description":
        return {
          topic: topic ?? asset.label,
          style: "vlog",
          keywords: asset.meta?.["title"] ? [asset.meta["title"]] : [],
        };
      case "meme":
        return {
          customImageUrl: asset.url,
          topText: memeTexts.top.trim(),
          bottomText: memeTexts.bottom.trim(),
          uppercase: true,
          textColor: "#FFFFFF",
        };
      case "social-kit":
        return {
          brandName: brandName ?? project.name ?? "My Brand",
          tagline: tagline ?? project.concept.slice(0, 120) ?? "Made with Bow Down Visuals",
          style: "gold-luxury",
        };
    }
  }

  async function run(id: HandoffId) {
    if (running) return;
    const meta = HANDOFFS[id];
    setRunning(id);
    setStatus(t("hubSpine.handoffs.preparing"));
    setErrors((e) => ({ ...e, [id]: undefined }));
    try {
      const body = await buildBody(id);
      if (!body) {
        setRunning(null);
        setStatus("");
        return;
      }
      setStatus(t("hubSpine.handoffs.working", { tool: t(`hubSpine.handoffs.${meta.costKey}.label`) }));
      const res = await confirmedFetch(meta.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res) {
        setRunning(null); // user cancelled the credit confirmation
        setStatus("");
        return;
      }
      const data = (await res.json().catch(() => ({}))) as {
        url?: string;
        urls?: string[];
        assets?: Array<{ url?: string; kind?: string; label?: string }>;
        fullDescription?: string;
        error?: string;
        message?: string;
      };
      if (!res.ok) throw new Error(data.error ?? data.message ?? t("hubSpine.handoffs.failed"));

      const saved: HandoffResult[] = [];
      const pushResult = (url: string | undefined, label: string, kind: HubAssetKind, detail?: string, text?: string) => {
        if (!url && !text) return;
        if (url) {
          addAsset({
            kind,
            url,
            label,
            detail: detail ?? t(`hubSpine.handoffs.${meta.costKey}.label`),
            meta: { sourceAsset: asset.id, handoff: id },
          });
        } else if (text) {
          addAsset({
            kind,
            url: `data:text/plain;charset=utf-8,${encodeURIComponent(text)}`,
            label,
            detail: detail ?? t(`hubSpine.handoffs.${meta.costKey}.label`),
            meta: { sourceAsset: asset.id, handoff: id },
          });
        }
        saved.push({ id, url, text, label });
      };

      if (id === "social-kit" && Array.isArray(data.assets)) {
        data.assets.forEach((a, i) =>
          pushResult(a.url, a.label ?? t("hubSpine.handoffs.socialKit.assetLabel", { n: i + 1 }), "image", a.kind)
        );
      } else if (id === "thumbnail-ab" && Array.isArray(data.urls)) {
        data.urls.forEach((u, i) =>
          pushResult(u, t("hubSpine.handoffs.thumbnailAb.variantLabel", { n: i + 1 }), "image")
        );
      } else if (id === "clip-description" && data.fullDescription) {
        pushResult(undefined, t("hubSpine.handoffs.clipDescription.resultLabel", { topic: topic ?? asset.label }), "script", undefined, data.fullDescription);
      } else {
        pushResult(data.url, t("hubSpine.handoffs.resultLabel", { tool: t(`hubSpine.handoffs.${meta.costKey}.label`), source: asset.label }), meta.resultKind);
      }

      if (saved.length === 0) throw new Error(t("hubSpine.handoffs.noOutput"));
      setResults((r) => [...saved, ...r]);
      toast({ title: t("hubSpine.handoffs.doneTitle"), description: t("hubSpine.handoffs.doneDesc", { tool: t(`hubSpine.handoffs.${meta.costKey}.label`) }) });
    } catch (err) {
      const msg = err instanceof Error ? err.message : t("hubSpine.handoffs.failed");
      if (msg === "out_of_credits") {
        setErrors((e) => ({ ...e, [id]: t("hubSpine.handoffs.outOfCredits") }));
      } else {
        setErrors((e) => ({ ...e, [id]: msg }));
      }
    } finally {
      setRunning(null);
      setStatus("");
    }
  }

  function copyShareLink() {
    const link = getShareLink();
    const credit = project.attribution ? `\n${t("hubSpine.madeWith")}` : "";
    navigator.clipboard.writeText(`${link}${credit}`).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      },
      () => toast({ title: t("hubSpine.handoffs.copyFailedTitle"), variant: "destructive" })
    );
  }

  return (
    <div className="rounded-2xl border border-primary/25 bg-gradient-to-b from-primary/[0.08] to-transparent p-5 md:p-6">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-1">
        <p className="text-xs font-bold uppercase tracking-widest text-primary">
          {t("hubSpine.handoffs.title")}
        </p>
        <button
          type="button"
          onClick={copyShareLink}
          className="flex items-center gap-1.5 text-[11px] font-semibold text-white/50 hover:text-primary transition-colors"
          title={t("hubSpine.handoffs.copyShareTitle")}
        >
          {copied ? <Check className="h-3.5 w-3.5 text-green-400" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? t("hubSpine.handoffs.copied") : t("hubSpine.handoffs.copyShare")}
        </button>
      </div>
      <p className="text-xs text-white/40 mb-4">{t("hubSpine.handoffs.subtitle")}</p>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        {handoffs.map((id) => {
          const meta = HANDOFFS[id];
          const Icon = meta.icon;
          const isRunning = running === id;
          return (
            <div key={id} className="flex flex-col gap-1.5">
              <button
                type="button"
                onClick={() => void run(id)}
                disabled={running !== null}
                className="flex flex-col items-start gap-1.5 p-3 rounded-xl border border-white/10 bg-black/40 hover:border-primary/50 hover:bg-primary/[0.06] transition-all text-left disabled:opacity-50 disabled:cursor-wait"
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/15 border border-primary/25">
                  {isRunning ? <Loader2 className="h-4 w-4 text-primary animate-spin" /> : <Icon className="h-4 w-4 text-primary" />}
                </span>
                <span className="text-xs font-bold text-white leading-tight">
                  {t(`hubSpine.handoffs.${meta.costKey}.label`)}
                </span>
                <span className="text-[10px] text-white/40 leading-snug">
                  {t(`hubSpine.handoffs.${meta.costKey}.blurb`)}
                </span>
              </button>
              {id === "meme" && (
                <div className="flex flex-col gap-1.5">
                  <input
                    value={memeTexts.top}
                    onChange={(e) => setMemeTexts((m) => ({ ...m, top: e.target.value }))}
                    placeholder={t("hubSpine.handoffs.meme.topPlaceholder")}
                    maxLength={120}
                    className="h-8 rounded-lg bg-white/[0.04] border border-white/10 px-2.5 text-xs text-white placeholder:text-white/25 focus:outline-none focus:border-primary/50"
                  />
                  <input
                    value={memeTexts.bottom}
                    onChange={(e) => setMemeTexts((m) => ({ ...m, bottom: e.target.value }))}
                    placeholder={t("hubSpine.handoffs.meme.bottomPlaceholder")}
                    maxLength={120}
                    className="h-8 rounded-lg bg-white/[0.04] border border-white/10 px-2.5 text-xs text-white placeholder:text-white/25 focus:outline-none focus:border-primary/50"
                  />
                </div>
              )}
              {errors[id] && (
                <p className="flex items-start gap-1 text-[10px] text-red-300/90 leading-snug">
                  <AlertCircle className="h-3 w-3 shrink-0 mt-px" /> {errors[id]}
                </p>
              )}
            </div>
          );
        })}
      </div>

      {running && status && (
        <p className="mt-3 flex items-center gap-2 text-xs text-primary/90">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> {status}
        </p>
      )}

      {results.length > 0 && (
        <div className="mt-4 space-y-3">
          {results.map((r, i) => {
            const meta = HANDOFFS[r.id];
            return (
              <div key={`${r.id}-${i}`} className="rounded-xl border border-emerald-500/25 bg-emerald-500/[0.05] p-3">
                <div className="flex items-center gap-2 mb-2">
                  <Check className="h-4 w-4 text-emerald-400 shrink-0" />
                  <p className="text-xs font-bold text-emerald-300 truncate">{r.label}</p>
                </div>
                {r.url && meta.resultMedia === "video" && (
                  <video src={r.url} controls className="w-full max-h-56 rounded-lg bg-black" />
                )}
                {r.url && meta.resultMedia === "audio" && (
                  <audio src={r.url} controls className="w-full" />
                )}
                {r.url && meta.resultMedia === "image" && (
                  <img src={r.url} alt={r.label} className="max-h-56 rounded-lg border border-white/10" />
                )}
                {r.text && (
                  <p className="text-xs text-white/70 whitespace-pre-wrap max-h-40 overflow-y-auto">{r.text}</p>
                )}
                {r.url && (
                  <a
                    href={r.url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline"
                  >
                    <ExternalLink className="h-3 w-3" /> {t("hubSpine.handoffs.openFull")}
                  </a>
                )}
                {project.attribution && (
                  <p className="mt-2 text-[10px] text-white/30">{t("hubSpine.madeWith")}</p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
