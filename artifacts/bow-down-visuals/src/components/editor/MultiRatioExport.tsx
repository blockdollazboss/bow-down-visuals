import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import {
  LayoutGrid, Loader2, Download, CheckCircle2, XCircle, AlertTriangle,
  Music2, FileAudio, Copy, Share2, CalendarClock, MessageSquareText,
  Sparkles, Play, Tag,
} from "lucide-react";
import { EditorCard } from "@/components/editor/controls";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { useSocialAccounts } from "@/components/ConnectedAccounts";
import { InstagramPostModal } from "@/components/InstagramPostModal";
import { TikTokPostModal } from "@/components/TikTokPostModal";
import { FacebookPostModal } from "@/components/FacebookPostModal";

/* ─── Multi-ratio export + audio extract ───────────────────────────────
   "Export for all platforms" — one click renders 16:9, 9:16, 1:1 and 4:5
   from a finished video, each to its OWN exact canvas, with real per-ratio
   progress, reviewable downloads, one-click share to the matching platform,
   Social Kit (Hook Studio) caption + scheduler handoffs, and the virality
   attribution playbook (opt-in "Made with Bow Down Visuals" tag; the
   watermark-removal upsell strips it). */

/* ── Ratio config (dims mirror the backend presets) ─────────────────── */

type SharePlatform = "tiktok" | "instagram" | "facebook" | "youtube";

interface RatioConfig {
  key: string;
  width: number;
  height: number;
  label: string;
  platformLabel: string;
  blurb: string;
  /** Hook Studio caption platform. */
  captionPlatform: "tiktok" | "instagram" | "youtube" | "twitter";
  /** Scheduler platforms (scheduler supports instagram/tiktok/facebook). */
  schedulePlatforms: string[];
  share: SharePlatform[];
}

const RATIO_CONFIGS: RatioConfig[] = [
  {
    key: "16:9", width: 1280, height: 720, label: "Landscape",
    platformLabel: "YouTube", blurb: "YouTube, TV, widescreen players",
    captionPlatform: "youtube", schedulePlatforms: ["facebook"],
    share: ["youtube"],
  },
  {
    key: "9:16", width: 720, height: 1280, label: "Vertical",
    platformLabel: "TikTok · Reels · Shorts", blurb: "TikTok, Reels, YouTube Shorts",
    captionPlatform: "tiktok", schedulePlatforms: ["tiktok", "instagram"],
    share: ["tiktok", "instagram"],
  },
  {
    key: "1:1", width: 1080, height: 1080, label: "Square",
    platformLabel: "Instagram feed", blurb: "Instagram / Facebook feed posts",
    captionPlatform: "instagram", schedulePlatforms: ["instagram", "facebook"],
    share: ["instagram", "facebook"],
  },
  {
    key: "4:5", width: 1080, height: 1350, label: "Portrait",
    platformLabel: "Portrait feed", blurb: "Instagram / Facebook portrait feed",
    captionPlatform: "instagram", schedulePlatforms: ["instagram", "facebook"],
    share: ["instagram", "facebook"],
  },
];

const COST_PER_RATIO = 100;
const EXTRACT_COST = 50;

interface RatioStatus {
  ratio: string;
  width: number;
  height: number;
  label: string;
  platform: string;
  platformLabel: string;
  state: "queued" | "rendering" | "done" | "failed";
  progress: number;
  url: string | null;
  error: string | null;
}

interface MultiRatioJobStatus {
  jobId: string;
  state: "queued" | "active" | "done" | "failed";
  mode: "pad" | "crop";
  costPerRatio: number;
  costTotal: number;
  refunded: number;
  progress: number;
  completedRatios: number;
  failedRatios: number;
  totalRatios: number;
  error: string | null;
  ratios: RatioStatus[];
}

function ratioConfig(key: string): RatioConfig {
  return RATIO_CONFIGS.find((c) => c.key === key) ?? RATIO_CONFIGS[1]!;
}

/* ── Multi-ratio export card ─────────────────────────────────────────── */

export function MultiRatioExportCard({
  videoUrl,
  topic,
}: {
  /** The finished export video URL (null until the final export completes). */
  videoUrl: string | null;
  /** Project/song title, used to prefill caption handoffs. */
  topic?: string;
}) {
  const { t } = useTranslation();
  const { confirmedFetch } = useConfirmedApi();
  const { getAccessToken } = useAuth();
  const { toast } = useToast();
  const { accounts: socialAccounts } = useSocialAccounts();

  const [selected, setSelected] = useState<string[]>(["16:9", "9:16", "1:1", "4:5"]);
  const [mode, setMode] = useState<"pad" | "crop">("pad");
  const [attribution, setAttribution] = useState(false);
  /* One-shot prefill from handoffs (e.g. split-screen grid): the handoff
     stores the URL in sessionStorage under "bdv:multiratio-prefill" and the
     editor navigates to the export tab — we consume it here once. */
  const [manualUrl, setManualUrl] = useState(() => {
    try {
      const prefill = sessionStorage.getItem("bdv:multiratio-prefill");
      if (prefill) {
        sessionStorage.removeItem("bdv:multiratio-prefill");
        return prefill;
      }
    } catch {
      /* sessionStorage unavailable */
    }
    return "";
  });
  const [job, setJob] = useState<MultiRatioJobStatus | null>(null);
  const [rendering, setRendering] = useState(false);
  const [referralCode, setReferralCode] = useState<string | null>(null);
  const [shareModal, setShareModal] = useState<{ platform: SharePlatform; url: string } | null>(null);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const sourceUrl = (videoUrl ?? manualUrl.trim()) || null;

  /* Creator referral code — attached to every shared export link (?ref=CODE). */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await getAccessToken();
        const res = await fetch("/api/referrals/me", {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) return;
        const data = (await res.json()) as { code?: string };
        if (!cancelled && data.code) setReferralCode(data.code);
      } catch {
        /* referrals unavailable — share links just won't carry ?ref */
      }
    })();
    return () => { cancelled = true; };
  }, [getAccessToken]);

  const shareLink = useCallback(
    (url: string) => {
      if (!referralCode) return url;
      const sep = url.includes("?") ? "&" : "?";
      return `${url}${sep}ref=${encodeURIComponent(referralCode)}`;
    },
    [referralCode],
  );

  function toggleRatio(key: string) {
    setSelected((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );
  }

  const costTotal = selected.length * COST_PER_RATIO;

  async function pollJob(jobId: string): Promise<MultiRatioJobStatus | null> {
    try {
      const token = await getAccessToken();
      const res = await fetch(`/api/export-multi-ratio/job/${encodeURIComponent(jobId)}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) return null;
      return (await res.json()) as MultiRatioJobStatus;
    } catch {
      return null;
    }
  }

  useEffect(() => {
    if (!job || job.state === "done" || job.state === "failed") return;
    pollTimer.current = setInterval(async () => {
      const next = await pollJob(job.jobId);
      if (next) {
        setJob(next);
        if (next.state === "done" || next.state === "failed") {
          if (pollTimer.current) clearInterval(pollTimer.current);
          setRendering(false);
          if (next.state === "done") {
            const failed = next.failedRatios;
            toast({
              title: t("videoEditor.multiRatio.completeTitle"),
              description:
                failed > 0
                  ? t("videoEditor.multiRatio.completePartial", {
                      done: next.completedRatios,
                      failed,
                      refunded: next.refunded,
                    })
                  : t("videoEditor.multiRatio.completeFull", { done: next.completedRatios }),
            });
          } else {
            toast({
              title: t("videoEditor.multiRatio.failedTitle"),
              description: next.error ?? t("videoEditor.multiRatio.failedDesc"),
            });
          }
        }
      }
    }, 3000);
    return () => {
      if (pollTimer.current) clearInterval(pollTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.jobId, job?.state]);

  async function startRender() {
    if (!sourceUrl) {
      toast({
        title: t("videoEditor.multiRatio.noSourceTitle"),
        description: t("videoEditor.multiRatio.noSourceDesc"),
      });
      return;
    }
    if (selected.length === 0) {
      toast({
        title: t("videoEditor.multiRatio.noRatioTitle"),
        description: t("videoEditor.multiRatio.noRatioDesc"),
      });
      return;
    }
    setRendering(true);
    try {
      const res = await confirmedFetch("/api/export-multi-ratio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          videoUrl: sourceUrl,
          ratios: selected,
          mode,
          attribution,
          topic: topic?.trim() || undefined,
        }),
        overrideCost: costTotal,
        overrideFeature: t("videoEditor.multiRatio.confirmFeature"),
      });
      if (!res) {
        setRendering(false); // user cancelled the credit confirmation
        return;
      }
      const data = (await res.json()) as MultiRatioJobStatus & { error?: string };
      if (!res.ok) {
        throw new Error(data.error ?? t("videoEditor.multiRatio.startFailed"));
      }
      setJob(data);
    } catch (err) {
      setRendering(false);
      toast({
        title: t("videoEditor.multiRatio.startFailedTitle"),
        description: err instanceof Error ? err.message : t("videoEditor.multiRatio.startFailed"),
      });
    }
  }

  async function copyShareLink(url: string) {
    try {
      await navigator.clipboard.writeText(shareLink(url));
      toast({ title: t("videoEditor.multiRatio.linkCopied") });
    } catch {
      toast({ title: t("videoEditor.multiRatio.copyFailed") });
    }
  }

  async function shareToYouTube(url: string) {
    // No YouTube auto-post integration — copy the referral-tagged link +
    // a caption, then open YouTube Studio upload in one click.
    const caption = `${topic?.trim() ? topic.trim() + "\n\n" : ""}${t("videoEditor.multiRatio.ytCaption", { link: shareLink(url) })}`;
    try {
      await navigator.clipboard.writeText(caption);
    } catch {
      /* clipboard may be blocked — still open the upload page */
    }
    window.open("https://www.youtube.com/upload", "_blank", "noopener");
    toast({ title: t("videoEditor.multiRatio.ytCaptionCopied") });
  }

  const jobActive = job && job.state !== "done" && job.state !== "failed";

  return (
    <EditorCard
      title={t("videoEditor.multiRatio.title")}
      subtitle={t("videoEditor.multiRatio.subtitle")}
      icon={<LayoutGrid className="h-4 w-4" />}
      right={
        <span className="text-[10px] font-bold text-primary bg-primary/10 border border-primary/25 rounded-full px-2.5 py-1">
          {COST_PER_RATIO} {t("videoEditor.multiRatio.perRatio")}
        </span>
      }
    >
      <div className="p-5 space-y-4">
        {/* Source */}
        {!videoUrl && (
          <div>
            <label className="text-[11px] font-bold text-white/50 uppercase tracking-wider">
              {t("videoEditor.multiRatio.sourceLabel")}
            </label>
            <input
              value={manualUrl}
              onChange={(e) => setManualUrl(e.target.value)}
              placeholder={t("videoEditor.multiRatio.sourcePlaceholder")}
              className="mt-1.5 w-full rounded-xl border border-white/10 bg-black/60 px-4 py-2.5 text-sm text-white placeholder:text-white/25 outline-none focus:border-primary/60"
            />
            <p className="mt-1 text-[11px] text-white/35">{t("videoEditor.multiRatio.sourceHint")}</p>
          </div>
        )}

        {/* Ratio checkboxes with true preview dimensions */}
        <div>
          <p className="text-[11px] font-bold text-white/50 uppercase tracking-wider mb-2">
            {t("videoEditor.multiRatio.pickRatios")}
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {RATIO_CONFIGS.map((cfg) => {
              const active = selected.includes(cfg.key);
              const sw = cfg.width / cfg.height;
              return (
                <button
                  key={cfg.key}
                  onClick={() => toggleRatio(cfg.key)}
                  disabled={!!jobActive}
                  className={`rounded-xl border p-3 text-left transition-colors ${
                    active
                      ? "border-primary/50 bg-primary/[0.07]"
                      : "border-white/10 bg-white/[0.02] hover:border-white/25"
                  } disabled:opacity-50`}
                >
                  <div className="flex items-center justify-center h-14">
                    <div
                      className={`border-2 rounded-[3px] ${active ? "border-primary" : "border-white/30"}`}
                      style={{ aspectRatio: `${cfg.width} / ${cfg.height}`, height: sw >= 1 ? 40 : 52, maxWidth: "100%" }}
                    />
                  </div>
                  <div className="mt-2 flex items-center gap-1.5">
                    <span
                      className={`h-3.5 w-3.5 rounded border flex items-center justify-center shrink-0 ${
                        active ? "bg-primary border-primary" : "border-white/30"
                      }`}
                    >
                      {active && <CheckCircle2 className="h-3 w-3 text-black" />}
                    </span>
                    <span className="text-xs font-black text-white">{cfg.key}</span>
                    <span className="text-[10px] text-white/45">{cfg.label}</span>
                  </div>
                  <p className="mt-0.5 text-[10px] font-mono text-white/40">
                    {cfg.width} × {cfg.height}
                  </p>
                  <p className="text-[10px] text-primary/80 font-semibold">{cfg.platformLabel}</p>
                </button>
              );
            })}
          </div>
        </div>

        {/* Reframe mode */}
        <div>
          <p className="text-[11px] font-bold text-white/50 uppercase tracking-wider mb-2">
            {t("videoEditor.multiRatio.modeLabel")}
          </p>
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                { value: "pad", title: t("videoEditor.multiRatio.modePadTitle"), desc: t("videoEditor.multiRatio.modePadDesc") },
                { value: "crop", title: t("videoEditor.multiRatio.modeCropTitle"), desc: t("videoEditor.multiRatio.modeCropDesc") },
              ] as const
            ).map((m) => (
              <button
                key={m.value}
                onClick={() => setMode(m.value)}
                disabled={!!jobActive}
                className={`rounded-xl border px-3 py-2.5 text-left transition-colors ${
                  mode === m.value
                    ? "border-primary/50 bg-primary/[0.07]"
                    : "border-white/10 bg-white/[0.02] hover:border-white/25"
                } disabled:opacity-50`}
              >
                <p className="text-xs font-bold text-white">{m.title}</p>
                <p className="text-[10px] text-white/45 mt-0.5">{m.desc}</p>
              </button>
            ))}
          </div>
        </div>

        {/* Attribution — the virality playbook, opt-in for paid exports */}
        <label className="flex items-start gap-3 rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3 cursor-pointer hover:border-primary/30 transition-colors">
          <input
            type="checkbox"
            checked={attribution}
            onChange={(e) => setAttribution(e.target.checked)}
            disabled={!!jobActive}
            className="mt-0.5 h-4 w-4 accent-[#d4af37]"
          />
          <span>
            <span className="flex items-center gap-1.5 text-xs font-bold text-white">
              <Tag className="h-3.5 w-3.5 text-primary" />
              {t("videoEditor.multiRatio.attributionTitle")}
            </span>
            <span className="block text-[11px] text-white/45 mt-0.5">
              {t("videoEditor.multiRatio.attributionDesc")}{" "}
              <Link href="/watermark-removal" className="text-primary hover:underline font-semibold">
                {t("videoEditor.multiRatio.attributionUpsell")}
              </Link>
            </span>
          </span>
        </label>

        {/* Render */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <button
            onClick={startRender}
            disabled={rendering || !!jobActive || selected.length === 0 || !sourceUrl}
            className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-black text-black hover:bg-primary/90 transition-colors disabled:opacity-40"
          >
            {rendering || jobActive ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            {t("videoEditor.multiRatio.renderButton", { count: selected.length })}
          </button>
          <p className="text-xs text-white/50 text-center sm:text-right">
            <span className="font-black text-primary">{costTotal}</span>{" "}
            {t("videoEditor.multiRatio.costSuffix")}
          </p>
        </div>

        {/* Job progress — real per-ratio progress from ffmpeg */}
        {job && (
          <div className="rounded-xl border border-white/10 bg-black/40 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold text-white">
                {job.state === "done"
                  ? t("videoEditor.multiRatio.statusDone")
                  : job.state === "failed"
                    ? t("videoEditor.multiRatio.statusFailed")
                    : t("videoEditor.multiRatio.statusWorking", { progress: job.progress })}
              </p>
              <p className="text-[10px] font-mono text-white/40">
                {t("videoEditor.multiRatio.modeTag", { mode: job.mode === "pad" ? t("videoEditor.multiRatio.modePadTitle") : t("videoEditor.multiRatio.modeCropTitle") })}
              </p>
            </div>
            {jobActive && (
              <div className="h-2 rounded-full bg-white/10 overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-primary/70 to-primary transition-all duration-500"
                  style={{ width: `${job.progress}%` }}
                />
              </div>
            )}
            {job.refunded > 0 && (
              <p className="flex items-center gap-1.5 text-[11px] text-amber-300/90">
                <AlertTriangle className="h-3.5 w-3.5" />
                {t("videoEditor.multiRatio.refunded", { amount: job.refunded })}
              </p>
            )}
            {job.state === "failed" && job.error && (
              <p className="text-[11px] text-red-300/90">{job.error}</p>
            )}

            <div className="space-y-2">
              {job.ratios.map((r) => {
                const cfg = ratioConfig(r.ratio);
                return (
                  <div key={r.ratio} className="rounded-lg border border-white/[0.07] bg-white/[0.02] p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        {r.state === "done" ? (
                          <CheckCircle2 className="h-4 w-4 text-green-400 shrink-0" />
                        ) : r.state === "failed" ? (
                          <XCircle className="h-4 w-4 text-red-400 shrink-0" />
                        ) : (
                          <Loader2 className="h-4 w-4 text-primary animate-spin shrink-0" />
                        )}
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-white">
                            {r.ratio} · {r.width} × {r.height}
                          </p>
                          <p className="text-[10px] text-white/40 truncate">{r.platformLabel}</p>
                        </div>
                      </div>
                      <span className="text-[10px] font-mono text-white/50 shrink-0">
                        {r.state === "done" ? "100%" : r.state === "failed" ? t("videoEditor.multiRatio.failed") : `${r.progress}%`}
                      </span>
                    </div>
                    {r.state !== "done" && r.state !== "failed" && (
                      <div className="mt-2 h-1.5 rounded-full bg-white/10 overflow-hidden">
                        <div
                          className="h-full bg-primary/80 transition-all duration-500"
                          style={{ width: `${r.progress}%` }}
                        />
                      </div>
                    )}
                    {r.state === "failed" && r.error && (
                      <p className="mt-1.5 text-[11px] text-red-300/80 break-words">{r.error}</p>
                    )}

                    {/* Per-ratio actions: download, share, captions, schedule */}
                    {r.state === "done" && r.url && (
                      <div className="mt-2.5 space-y-2">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <a
                            href={r.url}
                            download
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-[11px] font-black text-black hover:bg-primary/90 transition-colors"
                          >
                            <Download className="h-3.5 w-3.5" />
                            {t("videoEditor.multiRatio.download")}
                          </a>
                          {/* One-click share to the matching platform(s) */}
                          {cfg.share.map((sp) =>
                            sp === "youtube" ? (
                              <button
                                key={sp}
                                onClick={() => shareToYouTube(r.url!)}
                                title={t("videoEditor.multiRatio.shareYouTube")}
                                className="flex items-center gap-1.5 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-[11px] font-bold text-red-300 hover:bg-red-500/20 transition-colors"
                              >
                                <Play className="h-3.5 w-3.5" />
                                YouTube
                              </button>
                            ) : (
                              <button
                                key={sp}
                                onClick={() => setShareModal({ platform: sp, url: r.url! })}
                                title={t("videoEditor.multiRatio.shareTo", { platform: sp })}
                                className="flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/[0.04] px-3 py-1.5 text-[11px] font-bold text-white/80 hover:text-white hover:border-primary/40 transition-colors"
                              >
                                <Share2 className="h-3.5 w-3.5" />
                                {sp === "tiktok" ? "TikTok" : sp === "instagram" ? "Reels" : "Facebook"}
                              </button>
                            ),
                          )}
                          <button
                            onClick={() => copyShareLink(r.url!)}
                            title={t("videoEditor.multiRatio.copyLinkTitle")}
                            className="flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/[0.04] px-3 py-1.5 text-[11px] font-bold text-white/80 hover:text-white hover:border-primary/40 transition-colors"
                          >
                            <Copy className="h-3.5 w-3.5" />
                            {referralCode ? t("videoEditor.multiRatio.copyRefLink") : t("videoEditor.multiRatio.copyLink")}
                          </button>
                        </div>
                        {/* Handoff chain: Social Kit captions → Scheduler */}
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Link
                            href={`/hooks?tab=captions&platform=${cfg.captionPlatform}&topic=${encodeURIComponent(topic?.trim() || r.platformLabel)}`}
                            className="flex items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/[0.06] px-3 py-1.5 text-[11px] font-bold text-primary hover:bg-primary/[0.12] transition-colors"
                          >
                            <MessageSquareText className="h-3.5 w-3.5" />
                            {t("videoEditor.multiRatio.toCaptions")}
                          </Link>
                          <Link
                            href={`/scheduler?schedule=1&platform=${cfg.schedulePlatforms.join(",")}&media=${encodeURIComponent(r.url)}&caption=${encodeURIComponent(
                              `${topic?.trim() ? topic.trim() + "\n\n" : ""}${t("videoEditor.multiRatio.defaultCaption", { platform: r.platformLabel })} ${shareLink(r.url)}`,
                            )}`}
                            className="flex items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/[0.06] px-3 py-1.5 text-[11px] font-bold text-primary hover:bg-primary/[0.12] transition-colors"
                          >
                            <CalendarClock className="h-3.5 w-3.5" />
                            {t("videoEditor.multiRatio.toScheduler")}
                          </Link>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Platform share modals */}
      {shareModal?.platform === "tiktok" && (
        <TikTokPostModal
          open
          onClose={() => setShareModal(null)}
          videoUrl={shareModal.url}
          accounts={socialAccounts}
        />
      )}
      {shareModal?.platform === "instagram" && (
        <InstagramPostModal
          open
          onClose={() => setShareModal(null)}
          videoUrl={shareModal.url}
          accounts={socialAccounts}
        />
      )}
      {shareModal?.platform === "facebook" && (
        <FacebookPostModal
          open
          onClose={() => setShareModal(null)}
          videoUrl={shareModal.url}
          accounts={socialAccounts.filter((a) => a.platform === "facebook")}
        />
      )}
    </EditorCard>
  );
}

/* ── Extract audio card ──────────────────────────────────────────────── */

export function ExtractAudioCard({ videoUrl }: { videoUrl: string | null }) {
  const { t } = useTranslation();
  const { confirmedFetch } = useConfirmedApi();
  const { toast } = useToast();

  const [urlInput, setUrlInput] = useState("");
  const [format, setFormat] = useState<"mp3" | "wav">("mp3");
  const [extracting, setExtracting] = useState(false);
  const [result, setResult] = useState<{
    url: string;
    formatLabel: string;
    durationSec: number;
    sizeBytes: number;
  } | null>(null);

  const sourceUrl = (videoUrl ?? urlInput.trim()) || null;

  async function extract() {
    if (!sourceUrl) {
      toast({
        title: t("videoEditor.extractAudio.noSourceTitle"),
        description: t("videoEditor.extractAudio.noSourceDesc"),
      });
      return;
    }
    setExtracting(true);
    setResult(null);
    try {
      const res = await confirmedFetch("/api/extract-audio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoUrl: sourceUrl, format }),
        overrideCost: EXTRACT_COST,
        overrideFeature: t("videoEditor.extractAudio.confirmFeature"),
      });
      if (!res) {
        setExtracting(false);
        return;
      }
      const data = (await res.json()) as {
        url?: string;
        formatLabel?: string;
        durationSec?: number;
        sizeBytes?: number;
        error?: string;
      };
      if (!res.ok || !data.url) {
        throw new Error(data.error ?? t("videoEditor.extractAudio.failed"));
      }
      setResult({
        url: data.url,
        formatLabel: data.formatLabel ?? format.toUpperCase(),
        durationSec: data.durationSec ?? 0,
        sizeBytes: data.sizeBytes ?? 0,
      });
      toast({ title: t("videoEditor.extractAudio.doneTitle") });
    } catch (err) {
      toast({
        title: t("videoEditor.extractAudio.failedTitle"),
        description: err instanceof Error ? err.message : t("videoEditor.extractAudio.failed"),
      });
    } finally {
      setExtracting(false);
    }
  }

  return (
    <EditorCard
      title={t("videoEditor.extractAudio.title")}
      subtitle={t("videoEditor.extractAudio.subtitle")}
      icon={<FileAudio className="h-4 w-4" />}
      right={
        <span className="text-[10px] font-bold text-primary bg-primary/10 border border-primary/25 rounded-full px-2.5 py-1">
          {EXTRACT_COST} {t("videoEditor.extractAudio.flat")}
        </span>
      }
    >
      <div className="p-5 space-y-4">
        {!videoUrl && (
          <div>
            <label className="text-[11px] font-bold text-white/50 uppercase tracking-wider">
              {t("videoEditor.extractAudio.sourceLabel")}
            </label>
            <input
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder={t("videoEditor.extractAudio.sourcePlaceholder")}
              className="mt-1.5 w-full rounded-xl border border-white/10 bg-black/60 px-4 py-2.5 text-sm text-white placeholder:text-white/25 outline-none focus:border-primary/60"
            />
          </div>
        )}

        <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
          <div className="flex rounded-xl border border-white/10 overflow-hidden shrink-0">
            {(["mp3", "wav"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFormat(f)}
                className={`px-5 py-2.5 text-xs font-black uppercase tracking-wider transition-colors ${
                  format === f ? "bg-primary text-black" : "bg-white/[0.03] text-white/60 hover:text-white"
                }`}
              >
                {f}
              </button>
            ))}
          </div>
          <button
            onClick={extract}
            disabled={extracting || !sourceUrl}
            className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-black text-black hover:bg-primary/90 transition-colors disabled:opacity-40"
          >
            {extracting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Music2 className="h-4 w-4" />}
            {t("videoEditor.extractAudio.extractButton")}
          </button>
        </div>

        {result && (
          <div className="rounded-xl border border-white/10 bg-black/40 p-4 space-y-3">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-green-400 shrink-0" />
              <p className="text-xs font-bold text-white">
                {result.formatLabel} · {result.durationSec}s
                {result.sizeBytes > 0 && (
                  <span className="text-white/40 font-normal"> · {(result.sizeBytes / 1024 / 1024).toFixed(1)} MB</span>
                )}
              </p>
            </div>
            <audio controls src={result.url} className="w-full" />
            <div className="flex flex-wrap items-center gap-1.5">
              <a
                href={result.url}
                download
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-[11px] font-black text-black hover:bg-primary/90 transition-colors"
              >
                <Download className="h-3.5 w-3.5" />
                {t("videoEditor.extractAudio.download")}
              </a>
              {/* Handoff chain: extracted audio → Song Maker / Podcast tools */}
              <Link
                href={`/make-song?audioUrl=${encodeURIComponent(result.url)}`}
                className="flex items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/[0.06] px-3 py-1.5 text-[11px] font-bold text-primary hover:bg-primary/[0.12] transition-colors"
              >
                <Music2 className="h-3.5 w-3.5" />
                {t("videoEditor.extractAudio.toSongMaker")}
              </Link>
              <Link
                href={`/podcast?mode=video&videoUrl=${encodeURIComponent(result.url)}`}
                className="flex items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/[0.06] px-3 py-1.5 text-[11px] font-bold text-primary hover:bg-primary/[0.12] transition-colors"
              >
                <FileAudio className="h-3.5 w-3.5" />
                {t("videoEditor.extractAudio.toPodcast")}
              </Link>
            </div>
          </div>
        )}
      </div>
    </EditorCard>
  );
}
