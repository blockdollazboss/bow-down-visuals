import { useState } from "react";
import { Scissors, Loader2, AlertTriangle, ArrowRight, CalendarClock } from "lucide-react";
import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { useAuth } from "@/contexts/AuthContext";
import { OutOfCredits } from "@/components/OutOfCredits";

interface Moment {
  startSec: number;
  endSec: number;
  score: number;
  label: string;
  reason: string;
}

interface ReelSegment {
  startSec: number;
  endSec: number;
  caption: string;
}

interface HighlightResult {
  moments: Moment[];
  reelPlan: { totalSec: number; segments: ReelSegment[] };
  summary: string;
  creditsUsed?: number;
  creditsRemaining?: number;
}

const TARGET_LENGTHS = [30, 60, 90, 120, 180];

const inputClass =
  "w-full rounded-xl border border-white/10 bg-black/60 px-4 py-3 text-sm text-white placeholder:text-white/25 outline-none transition focus:border-primary/60 focus:ring-1 focus:ring-primary/40";

function fmt(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${r.toString().padStart(2, "0")}`;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

export function HighlightCutter({ vodUrlPrefill }: { vodUrlPrefill?: string | null }) {
  const { t } = useTranslation();
  const { confirmedFetch } = useConfirmedApi();
  const { refreshProfile } = useAuth();

  const [vodUrl, setVodUrl] = useState(vodUrlPrefill ?? "");
  const [vodTitle, setVodTitle] = useState("");
  const [chatLog, setChatLog] = useState("");
  const [transcript, setTranscript] = useState("");
  const [targetSeconds, setTargetSeconds] = useState(60);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const [result, setResult] = useState<HighlightResult | null>(null);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);

  async function cut() {
    if (loading) return;
    if (!vodUrl.trim() && !chatLog.trim() && !transcript.trim()) {
      setError(t("wave8.highlights.errorNoSource"));
      return;
    }
    setLoading(true);
    setError(null);
    setOutOfCredits(false);
    setSelectedIdx(null);
    try {
      const res = await confirmedFetch("/api/wave8/highlights/cut", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vodUrl: vodUrl.trim(),
          vodTitle: vodTitle.trim(),
          chatLog: chatLog.trim(),
          transcript: transcript.trim(),
          targetSeconds,
        }),
      });
      if (!res) return; // user cancelled the credit confirmation
      const data = (await res.json().catch(() => ({}))) as HighlightResult & { error?: string; message?: string };
      if (res.status === 402 || data.error === "out_of_credits") {
        setOutOfCredits(true);
        refreshProfile();
        return;
      }
      if (!res.ok || !Array.isArray(data.moments) || data.moments.length === 0) {
        throw new Error(data.message || data.error || t("wave8.highlights.errorGeneric"));
      }
      setResult(data);
      refreshProfile();
      setTimeout(() => {
        document.getElementById("highlight-results")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }, 100);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("wave8.highlights.errorGeneric"));
    } finally {
      setLoading(false);
    }
  }

  function sendToPromoClips() {
    if (!result) return;
    localStorage.setItem(
      "wave8_reel_plan",
      JSON.stringify({
        moments: result.moments,
        reelPlan: result.reelPlan,
        summary: result.summary,
        vodUrl: vodUrl.trim(),
        vodTitle: vodTitle.trim(),
        targetSeconds,
        createdAt: new Date().toISOString(),
      })
    );
  }

  function queueInScheduler() {
    if (!result) return;
    localStorage.setItem(
      "wave8_scheduler_draft",
      JSON.stringify({
        title: vodTitle.trim() || t("wave8.highlights.title"),
        summary: result.summary,
        segments: result.reelPlan.segments,
        vodUrl: vodUrl.trim(),
        createdAt: new Date().toISOString(),
      })
    );
  }

  /* Timeline scale: longest edge of moments + reel plan, at least the target. */
  const maxTime = result
    ? Math.max(
        targetSeconds,
        ...result.moments.map((m) => m.endSec),
        ...result.reelPlan.segments.map((s) => s.endSec),
        1
      )
    : 1;

  const selectedMoment = selectedIdx != null ? result?.moments[selectedIdx] ?? null : null;

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6" data-testid="highlight-cutter">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-xl bg-primary/10 border border-primary/25 flex items-center justify-center shrink-0">
          <Scissors className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h2 className="text-lg font-black text-white">{t("wave8.highlights.title")}</h2>
          <p className="text-sm text-white/55">{t("wave8.highlights.subtitle")}</p>
        </div>
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <div>
          <label className="block mb-1.5 text-xs font-semibold uppercase tracking-wider text-white/45">
            {t("wave8.highlights.vodUrlLabel")}
          </label>
          <input
            className={inputClass}
            placeholder={t("wave8.highlights.vodUrlPlaceholder")}
            value={vodUrl}
            onChange={(e) => setVodUrl(e.target.value)}
          />
        </div>
        <div>
          <label className="block mb-1.5 text-xs font-semibold uppercase tracking-wider text-white/45">
            {t("wave8.highlights.vodTitleLabel")}
          </label>
          <input
            className={inputClass}
            placeholder={t("wave8.highlights.vodTitlePlaceholder")}
            value={vodTitle}
            onChange={(e) => setVodTitle(e.target.value)}
          />
        </div>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <label className="block mb-1.5 text-xs font-semibold uppercase tracking-wider text-white/45">
            {t("wave8.highlights.chatLogLabel")}
          </label>
          <textarea
            className={`${inputClass} min-h-[140px] resize-y`}
            placeholder={t("wave8.highlights.chatLogPlaceholder")}
            value={chatLog}
            onChange={(e) => setChatLog(e.target.value)}
          />
        </div>
        <div>
          <label className="block mb-1.5 text-xs font-semibold uppercase tracking-wider text-white/45">
            {t("wave8.highlights.transcriptLabel")}
          </label>
          <textarea
            className={`${inputClass} min-h-[140px] resize-y`}
            placeholder={t("wave8.highlights.transcriptPlaceholder")}
            value={transcript}
            onChange={(e) => setTranscript(e.target.value)}
          />
        </div>
      </div>

      <div className="mt-4" data-min-stars="2">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-white/45">
          {t("wave8.highlights.targetLengthLabel")} ·{" "}
          <span className="text-primary">{t("wave8.highlights.reelLengthSeconds", { n: targetSeconds })}</span>
        </div>
        <div className="flex gap-2">
          {TARGET_LENGTHS.map((len) => (
            <button
              key={len}
              type="button"
              onClick={() => setTargetSeconds(len)}
              className={`flex-1 rounded-xl border px-3 py-2.5 text-sm font-bold transition ${
                targetSeconds === len
                  ? "border-primary bg-primary/15 text-primary"
                  : "border-white/10 bg-black/40 text-white/55 hover:border-white/25"
              }`}
            >
              {len}s
            </button>
          ))}
        </div>
      </div>

      <button
        type="button"
        onClick={cut}
        disabled={loading}
        className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-6 py-4 text-base font-black text-black transition hover:brightness-110 disabled:opacity-40"
      >
        {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Scissors className="h-5 w-5" />}
        {loading ? t("wave8.highlights.cutting") : result ? t("wave8.highlights.regenerate") : t("wave8.highlights.cut")}
      </button>
      <p className="mt-2 text-center text-xs text-white/40">{t("wave8.highlights.disclaimer")}</p>

      {outOfCredits && (
        <div className="mt-4">
          <OutOfCredits />
        </div>
      )}
      {error && (
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-red-400/30 bg-red-400/10 p-4 text-sm text-red-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {result && (
        <div id="highlight-results" className="mt-6 space-y-6">
          {/* Scored moments timeline */}
          <div>
            <h3 className="text-sm font-black uppercase tracking-widest text-white/60">
              {t("wave8.highlights.momentsHeading")}
            </h3>
            <p className="mt-1 text-xs text-white/35">{t("wave8.highlights.timelineHint")}</p>
            <div className="mt-3 relative h-16 rounded-xl border border-white/10 bg-black/60 overflow-hidden px-1">
              {result.moments.map((m, i) => {
                const left = (m.startSec / maxTime) * 100;
                const width = Math.max(1.5, ((m.endSec - m.startSec) / maxTime) * 100);
                const alpha = 0.25 + 0.75 * (m.score / 100);
                return (
                  <button
                    key={i}
                    type="button"
                    title={`${m.label} — ${m.score}`}
                    onClick={() => setSelectedIdx(i === selectedIdx ? null : i)}
                    className={`absolute top-2 bottom-2 rounded-md border transition-transform ${
                      selectedIdx === i ? "border-white scale-y-110" : "border-primary/60 hover:scale-y-105"
                    }`}
                    style={{
                      left: `${left}%`,
                      width: `${width}%`,
                      backgroundColor: `rgba(201, 168, 76, ${alpha})`,
                    }}
                    data-testid={`highlight-moment-${i}`}
                  >
                    <span className="absolute inset-x-0 top-1 text-center text-[9px] font-black text-black/70 tabular-nums">
                      {m.score}
                    </span>
                  </button>
                );
              })}
              <div className="absolute bottom-0.5 left-1 right-1 flex justify-between text-[9px] font-mono text-white/25 tabular-nums pointer-events-none">
                <span>{fmt(0)}</span>
                <span>{fmt(maxTime)}</span>
              </div>
            </div>
            {selectedMoment && (
              <div className="mt-3 rounded-xl border border-primary/30 bg-primary/[0.06] p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs text-primary">
                    {fmt(selectedMoment.startSec)}–{fmt(selectedMoment.endSec)}
                  </span>
                  <span className="font-black text-white">{selectedMoment.label}</span>
                  <span className="ml-auto rounded-full bg-primary/15 border border-primary/30 px-2 py-0.5 text-[11px] font-black text-primary">
                    {selectedMoment.score}
                  </span>
                </div>
                <p className="mt-1.5 text-sm text-white/60">
                  <span className="font-bold text-white/75">{t("wave8.highlights.reason")}: </span>
                  {selectedMoment.reason}
                </p>
              </div>
            )}
          </div>

          {/* Reel plan */}
          <div>
            <div className="flex items-baseline justify-between gap-2">
              <h3 className="text-sm font-black uppercase tracking-widest text-white/60">
                {t("wave8.highlights.planHeading")}
              </h3>
              <span className="text-xs text-white/35">
                {t("wave8.highlights.segmentsTotal", {
                  total: Math.round(
                    result.reelPlan.segments.reduce((a, s) => a + (s.endSec - s.startSec), 0)
                  ),
                  count: result.reelPlan.segments.length,
                })}
              </span>
            </div>
            <p className="mt-1 text-xs text-white/35">{t("wave8.highlights.segmentsHint")}</p>
            <div className="mt-3 space-y-2">
              {result.reelPlan.segments.map((s, i) => (
                <div key={i} className="flex items-start gap-3 rounded-xl border border-white/10 bg-black/40 p-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/20 text-[11px] font-black text-primary">
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="font-mono text-xs text-primary tabular-nums">
                      {fmt(s.startSec)}–{fmt(s.endSec)}
                    </div>
                    <div className="text-sm font-bold text-white">“{s.caption}”</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Summary */}
          <div className="rounded-xl border border-white/10 bg-black/40 p-4">
            <h3 className="text-sm font-black uppercase tracking-widest text-white/60">
              {t("wave8.highlights.summaryHeading")}
            </h3>
            <p className="mt-1.5 text-sm text-white/60 leading-relaxed">{result.summary}</p>
          </div>

          {/* Handoffs */}
          <div className="grid gap-2 sm:grid-cols-2">
            <Link
              href="/video-editor?tab=promo-clips"
              onClick={sendToPromoClips}
              className="flex items-center justify-center gap-2 rounded-xl border border-primary/40 bg-primary/10 px-6 py-3.5 text-sm font-black text-primary transition hover:bg-primary/20"
              data-testid="highlights-send-to-promo"
            >
              {t("wave8.highlights.sendToPromo")} <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="/scheduler"
              onClick={queueInScheduler}
              className="flex items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/[0.04] px-6 py-3.5 text-sm font-black text-white/80 transition hover:border-white/30 hover:text-white"
              data-testid="highlights-queue-scheduler"
            >
              <CalendarClock className="h-4 w-4" /> {t("wave8.highlights.queueInScheduler")}
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
