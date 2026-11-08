/**
 * CaptionStylerBench — the Caption Styler's native bench at
 * the Hook Desk (Stack 300 world parity, census Lane B item 7
 * / manifest item 100), stacked under the Hook Desk itself:
 * the Hooks page's "styler" tab cross-links to the styler as
 * the burned-in captions home, and its desk now lives where
 * the Hooks family lives.
 *
 * The page's own flow on its own rail (lib/world/
 * caption-styler-bench.ts): pick a video (≤ 80 MB), pick a
 * style / position / size, the 300-Buc start post rides the
 * registry-priced spend confirmation, then the server-owned
 * job polls until the captioned video lands — and flows
 * into the hub project exactly as the page's does. A failed
 * job is refunded server-side; the bench renders the page's
 * own copy for every state, from captionStyler.*.
 */
import { useEffect, useRef, useState } from "react";
import { Captions, CheckCircle2, Download, Loader2, Sparkles, Upload } from "lucide-react";
import { useTranslation } from "react-i18next";
import { apiErrorMessage } from "@/lib/api-error";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { useHubProject } from "@/lib/hub-project";
import { DeskSelectField } from "./CreateDeskLeaf";
import {
  CAPTION_STYLER_FONT_SIZES,
  CAPTION_STYLER_PATH,
  CAPTION_STYLER_POSITIONS,
  CAPTION_STYLER_STYLE_LABEL_KEYS,
  CAPTION_STYLER_STYLES,
  captionStylerCost,
  captionStylerFileVerdict,
  captionStylerFormFields,
  captionStylerJobOf,
  captionStylerJobPath,
  captionStylerStartedOf,
  isCaptionStylerBusyStatus,
  type CaptionStylerFontSize,
  type CaptionStylerPosition,
  type CaptionStylerStyle,
} from "@/lib/world/caption-styler-bench";

type BenchStatus = "idle" | "uploading" | "queued" | "transcribing" | "rendering" | "done" | "failed";

export function CaptionStylerBench({ isLight }: { isLight: boolean }) {
  const { t } = useTranslation();
  const { confirmedFetch } = useConfirmedApi();
  const { addAsset } = useHubProject();

  const [file, setFile] = useState<File | null>(null);
  const [style, setStyle] = useState<CaptionStylerStyle>("hormozi");
  const [position, setPosition] = useState<CaptionStylerPosition>("bottom");
  const [fontSize, setFontSize] = useState<CaptionStylerFontSize>("medium");
  const [withEmoji, setWithEmoji] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState<BenchStatus>("idle");
  const [outputUrl, setOutputUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creditsRemaining, setCreditsRemaining] = useState<number | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const pollRef = useRef<number | null>(null);

  const cost = captionStylerCost();
  const busy = status === "uploading" || isCaptionStylerBusyStatus(status);
  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const strong = isLight ? "text-[#2a1e07]" : "text-white";
  const cardCls = isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5";
  const statusLabel: Record<string, string> = {
    uploading: t("captionStyler.statusUploading"),
    queued: t("captionStyler.statusQueued"),
    transcribing: t("captionStyler.statusTranscribing"),
    rendering: t("captionStyler.statusRendering"),
  };

  /* Poll the server-owned job until it completes — the job
     lives on the server, so the bench can close mid-run and
     lose nothing (the page's own poll, same cadence). */
  useEffect(() => {
    if (!jobId || !isCaptionStylerBusyStatus(status)) return;
    pollRef.current = window.setInterval(async () => {
      try {
        const res = await fetch(captionStylerJobPath(jobId));
        const data: unknown = await res.json().catch(() => null);
        if (!res.ok) {
          setStatus("failed");
          setError(apiErrorMessage(data, t("captionStyler.errorJobNotFound")));
          return;
        }
        const job = captionStylerJobOf(data);
        if (!job) {
          setStatus("failed");
          setError(t("captionStyler.errorJobFailed"));
          return;
        }
        if (job.status === "done") {
          setStatus("done");
          setOutputUrl(job.outputUrl);
          if (job.outputUrl) {
            try {
              addAsset({ kind: "video", url: job.outputUrl, label: "Captioned video", detail: `Caption styler · ${style}` });
            } catch { /* non-fatal — the page's own guard */ }
          }
        } else if (job.status === "failed") {
          setStatus("failed");
          setError(apiErrorMessage(data, t("captionStyler.errorJobFailed")));
        } else {
          setStatus(job.status);
        }
      } catch {
        /* keep polling on transient network errors */
      }
    }, 3000);
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, status]);

  function pickFile(f: File | undefined) {
    if (!f) return;
    const verdict = captionStylerFileVerdict(f);
    if (verdict === "not-video") {
      setError(t("captionStyler.errorNotVideo"));
      return;
    }
    if (verdict === "too-large") {
      setError(t("captionStyler.errorTooLarge"));
      return;
    }
    setFile(f);
    setError(null);
    setOutputUrl(null);
    setJobId(null);
    setStatus("idle");
  }

  async function startStyling() {
    if (!file || busy) return;
    setStatus("uploading");
    setError(null);
    setOutOfCredits(false);
    try {
      const form = new FormData();
      form.append("video", file);
      for (const [k, v] of captionStylerFormFields({ style, position, fontSize, withEmoji })) {
        form.append(k, v);
      }
      const res = await confirmedFetch(CAPTION_STYLER_PATH, {
        method: "POST",
        body: form,
        overrideCost: cost,
        overrideFeature: "Caption Styler",
      });
      if (!res) { setStatus("idle"); return; } // spend confirmation declined — nothing ran
      const data: unknown = await res.json().catch(() => null);
      if (res.status === 402) {
        setOutOfCredits(true);
        setStatus("idle");
        return;
      }
      const started = captionStylerStartedOf(data);
      if (!res.ok || !started) {
        setStatus("failed");
        setError(apiErrorMessage(data, t("captionStyler.errorStartFailed")));
        return;
      }
      setJobId(started.jobId);
      setStatus(isCaptionStylerBusyStatus(started.status) ? started.status : "queued");
      if (started.creditsRemaining !== null) setCreditsRemaining(started.creditsRemaining);
    } catch {
      setStatus("failed");
      setError(t("captionStyler.errorNetwork"));
    }
  }

  const chipCls = (active: boolean) =>
    `rounded-xl border px-3 py-2 text-left text-xs transition bdv-touch-target ${
      active
        ? isLight
          ? "border-[#C9A84C] bg-[#F7ECD2] text-[#2a1e07]"
          : "border-amber-400 bg-amber-400/[0.16] text-amber-200"
        : isLight
          ? "border-[#C9A84C]/30 text-[#6B5B36] hover:border-[#C9A84C]/60"
          : "border-white/10 text-white/60 hover:border-white/30"
    }`;

  return (
    <div className="space-y-3" data-testid="world-caption-styler-bench">
      <div className="flex items-center gap-2">
        <Captions className={`h-4 w-4 ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`} />
        <p className={`text-base font-black ${strong}`}>
          {t("captionStyler.titleAi")} {t("captionStyler.title")}
        </p>
        <span className={`ml-auto rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${isLight ? "border-[#C9A84C]/50 text-[#7A5A12]" : "border-[#d4af37]/40 bg-[#d4af37]/10 text-[#e8c86a]"}`}>
          {cost} VB
        </span>
      </div>
      <p className={`text-xs ${muted}`}>{t("captionStyler.subtitle")}</p>

      {/* Upload — the page's picker, desk-sized. */}
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        className={`w-full rounded-xl border-2 border-dashed p-5 text-center transition bdv-touch-target ${
          isLight ? "border-[#C9A84C]/40 hover:border-[#C9A84C]/70" : "border-white/15 hover:border-amber-500/50"
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="video/*"
          className="hidden"
          onChange={(e) => pickFile(e.target.files?.[0])}
        />
        <Upload className={`mx-auto h-6 w-6 ${isLight ? "text-[#7A5A12]" : "text-amber-400"}`} />
        <span className={`mt-2 block text-sm font-medium ${strong}`}>{file ? file.name : t("captionStyler.dropPrompt")}</span>
        <span className={`mt-1 block text-[11px] ${muted}`}>{t("captionStyler.fileHint")}</span>
      </button>

      {/* Style presets — the page's five, labels + blurbs from
          the page's own catalog keys. */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {CAPTION_STYLER_STYLES.map((s) => (
          <button key={s} type="button" onClick={() => setStyle(s)} className={chipCls(style === s)}>
            <span className="block text-xs font-bold">
              {t(`captionStyler.styles.${CAPTION_STYLER_STYLE_LABEL_KEYS[s]}.label`)}
            </span>
            <span className={`mt-0.5 block text-[11px] ${muted}`}>
              {t(`captionStyler.styles.${CAPTION_STYLER_STYLE_LABEL_KEYS[s]}.blurb`)}
            </span>
          </button>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <DeskSelectField
          isLight={isLight}
          label={t("captionStyler.positionLabel")}
          value={position}
          onChange={(v) => setPosition(v as CaptionStylerPosition)}
          options={CAPTION_STYLER_POSITIONS.map((p) => ({ value: p, label: t(`captionStyler.positions.${p}`) }))}
        />
        <DeskSelectField
          isLight={isLight}
          label={t("captionStyler.fontSizeLabel")}
          value={fontSize}
          onChange={(v) => setFontSize(v as CaptionStylerFontSize)}
          options={CAPTION_STYLER_FONT_SIZES.map((f) => ({ value: f, label: t(`captionStyler.fontSizes.${f}`) }))}
        />
      </div>

      <label className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 ${cardCls}`}>
        <input
          type="checkbox"
          checked={withEmoji}
          onChange={(e) => setWithEmoji(e.target.checked)}
          className="h-4 w-4 accent-amber-400"
        />
        <span className="text-sm">
          <span className={`font-semibold ${strong}`}>{t("captionStyler.autoEmoji")}</span>{" "}
          <span className={muted}>{t("captionStyler.autoEmojiHint")}</span>
        </span>
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          data-testid="world-caption-styler-run"
          onClick={() => void startStyling()}
          disabled={!file || busy}
          className="ml-auto inline-flex items-center gap-2 rounded-full bg-[#d4af37] px-4 py-2 text-sm font-bold text-black transition hover:scale-105 disabled:opacity-50 bdv-touch-target"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {busy ? statusLabel[status] ?? t("captionStyler.statusWorking") : t("captionStyler.styleButton", { n: cost })}
        </button>
      </div>

      {outOfCredits && (
        <p className={`text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>
          {t("worldBenches300.outOfBucs", { feature: "Caption Styler" })}
        </p>
      )}
      {error && (
        <p className={`text-xs font-semibold ${isLight ? "text-red-800" : "text-red-300"}`}>{error}</p>
      )}

      {status === "done" && outputUrl && (
        <div className={`rounded-xl border p-3 ${cardCls}`} data-testid="world-caption-styler-result">
          <p className={`flex items-center gap-2 text-sm font-semibold ${strong}`}>
            <CheckCircle2 className="h-4 w-4 text-green-500" /> {t("captionStyler.doneTitle")}
          </p>
          <video src={outputUrl} controls className="mt-3 w-full rounded-lg" />
          <a
            href={outputUrl}
            download
            className="mt-3 inline-flex items-center gap-2 rounded-full bg-green-500 px-4 py-2 text-xs font-bold text-black hover:brightness-110"
          >
            <Download className="h-3.5 w-3.5" /> {t("captionStyler.downloadButton")}
          </a>
        </div>
      )}

      {creditsRemaining !== null && (
        <p className={`text-[11px] ${muted}`}>{t("captionStyler.creditsRemaining", { n: creditsRemaining })}</p>
      )}
      <p className={`text-[11px] leading-relaxed ${muted}`}>{t("captionStyler.infoText")}</p>
    </div>
  );
}
