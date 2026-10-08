import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import {
  Stethoscope, Plus, X, CalendarDays, Share2, Check,
  ArrowRight, PenLine, Clapperboard, Sparkles,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/contexts/AuthContext";
import { useHubProject } from "@/lib/hub-project";
import { usePaidCall } from "./intelligence/use-paid-call";
import {
  inputClass, labelClass, goldButton, ghostButton, StepCard, StepFooter,
} from "./intelligence/ui";

/* ─── AI Retention Doctor ───────────────────────────────────────────────
   Mounted in the Analytics Hub → Intelligence tab, right after the Content
   Intelligence chain: the next step once the plan exists — diagnose where
   viewers drop off and hand each fix to the tool that solves it. */

const COST = 150;
const MM_SS = /^\d{1,3}:[0-5]\d$/;

const VIDEO_TYPES = ["music-video", "tutorial", "vlog", "short", "promo", "livestream-clip", "other"] as const;
const PLATFORMS = ["tiktok", "instagram", "youtube", "x"] as const;

interface DropOffRow {
  at: string;
  dropPct: string;
}

interface Diagnosis {
  at: string;
  dropPct: number;
  causeCategory: string;
  causeLabel: string;
  diagnosis: string;
  prescription: string;
  fixAction: "hook" | "script" | "editor";
  fixLabel: string;
  fixUrl: string;
}

interface DoctorResult {
  reportCard: { grade: string; score: number; headline: string };
  summary: string;
  diagnoses: Diagnosis[];
}

const FIX_ICON = {
  hook: PenLine,
  script: Sparkles,
  editor: Clapperboard,
} as const;

function gradeColor(grade: string): string {
  if (grade.startsWith("A")) return "text-emerald-400";
  if (grade.startsWith("B")) return "text-lime-300";
  if (grade.startsWith("C")) return "text-amber-400";
  if (grade.startsWith("D")) return "text-orange-400";
  return "text-red-400";
}

function gradeRing(grade: string): string {
  if (grade.startsWith("A")) return "border-emerald-500/40 shadow-[0_0_24px_rgba(52,211,153,0.25)]";
  if (grade.startsWith("B")) return "border-lime-500/40 shadow-[0_0_24px_rgba(163,230,53,0.2)]";
  if (grade.startsWith("C")) return "border-amber-500/40 shadow-[0_0_24px_rgba(251,191,36,0.2)]";
  if (grade.startsWith("D")) return "border-orange-500/40 shadow-[0_0_24px_rgba(251,146,60,0.2)]";
  return "border-red-500/40 shadow-[0_0_24px_rgba(248,113,113,0.2)]";
}

export default function RetentionDoctor() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const { project, latestOfKind } = useHubProject();
  const { call, loading, error, outOfCredits } = usePaidCall();

  const [title, setTitle] = useState("");
  const [rows, setRows] = useState<DropOffRow[]>([{ at: "", dropPct: "" }]);
  const [totalLength, setTotalLength] = useState("");
  const [niche, setNiche] = useState("");
  const [videoType, setVideoType] = useState<string>("");
  const [platform, setPlatform] = useState<string>("tiktok");
  const [result, setResult] = useState<DoctorResult | null>(null);
  const [editing, setEditing] = useState(true);
  const [shared, setShared] = useState<"copied" | "shared" | null>(null);
  const [calendarAdded, setCalendarAdded] = useState(false);
  const [prefilled, setPrefilled] = useState(false);

  /* Chain FROM hub project context: prefill the video title/topic from the
     song/video the creator is already working on. */
  useEffect(() => {
    if (prefilled) return;
    setPrefilled(true);
    const hubScript = latestOfKind("script");
    const fallback = hubScript?.meta?.text?.slice(0, 120) || project.name;
    if (fallback && fallback !== "Untitled Project") setTitle(fallback);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefilled]);

  function setRow(i: number, patch: Partial<DropOffRow>) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  function addRow() {
    if (rows.length >= 8) return;
    setRows((prev) => [...prev, { at: "", dropPct: "" }]);
  }

  function removeRow(i: number) {
    if (rows.length <= 1) return;
    setRows((prev) => prev.filter((_, idx) => idx !== i));
  }

  const validRows = rows.filter(
    (r) => MM_SS.test(r.at.trim()) && r.dropPct.trim() !== "" && Number(r.dropPct) >= 1 && Number(r.dropPct) <= 99
  );
  const formValid = title.trim().length >= 3 && validRows.length > 0;

  async function run() {
    const data = await call<DoctorResult>("/api/retention-doctor", {
      title: title.trim().slice(0, 200),
      dropOffs: validRows.map((r) => ({ at: r.at.trim(), dropPct: Number(r.dropPct) })),
      ...(totalLength.trim() && MM_SS.test(totalLength.trim())
        ? { totalLength: totalLength.trim() }
        : {}),
      ...(niche.trim() ? { niche: niche.trim().slice(0, 100) } : {}),
      ...(videoType ? { videoType } : {}),
      ...(platform ? { platform } : {}),
    });
    if (data?.reportCard && Array.isArray(data.diagnoses) && data.diagnoses.length > 0) {
      setResult(data);
      setEditing(false);
      setShared(null);
      setCalendarAdded(false);
      setTimeout(() => {
        document.getElementById("retention-doctor")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 100);
    }
  }

  /* Coherence: "Add fixes to content calendar" — stash the fix list where
     /content-calendar picks it up as an importable fix day. */
  function addToCalendar() {
    if (!result) return;
    try {
      localStorage.setItem(
        "bdv-retention-fixes",
        JSON.stringify({
          title: title.trim().slice(0, 120),
          niche: niche.trim().slice(0, 100),
          fixes: result.diagnoses.map((d) => ({
            at: d.at,
            dropPct: d.dropPct,
            causeLabel: d.causeLabel,
            prescription: d.prescription,
          })),
          savedAt: Date.now(),
        })
      );
    } catch {
      /* storage blocked — still navigate */
    }
    setCalendarAdded(true);
    const qs = niche.trim() ? `?niche=${encodeURIComponent(niche.trim().slice(0, 100))}` : "";
    navigate(`/content-calendar${qs}`);
  }

  /* Virality: one-click share of the retention report card, attribution rides along. */
  function reportCardText(): string {
    if (!result) return "";
    const lines = [
      `🩺 Retention Report Card — "${title.trim()}"`,
      `Grade: ${result.reportCard.grade} (${result.reportCard.score}/100)`,
      result.reportCard.headline,
      "",
      "Biggest leaks:",
      ...result.diagnoses.slice(0, 4).map(
        (d) => `• ${d.dropPct}% leave at ${d.at} — ${d.causeLabel}: ${d.prescription.slice(0, 140)}`
      ),
      "",
      "Diagnosed by Bow Down Visuals' AI Retention Doctor 🦈",
      "Made with Bow Down Visuals — bowdownvisuals.com",
    ];
    return lines.join("\n");
  }

  async function share() {
    const text = reportCardText();
    if (!text) return;
    if (typeof navigator !== "undefined" && "share" in navigator) {
      try {
        await (navigator as Navigator & { share: (d: { title: string; text: string }) => Promise<void> }).share({
          title: t("retentionDoctor.shareTitle"),
          text,
        });
        setShared("shared");
        setTimeout(() => setShared(null), 2000);
        return;
      } catch {
        /* user cancelled or share unavailable — fall through to clipboard */
      }
    }
    try {
      await navigator.clipboard.writeText(text);
      setShared("copied");
      setTimeout(() => setShared(null), 2000);
    } catch {
      /* clipboard unavailable */
    }
  }

  return (
    <div id="retention-doctor" className="relative scroll-mt-24">
      <StepCard
        id="retention-doctor-card"
        stepNumber={7}
        icon={Stethoscope}
        eyebrow={t("retentionDoctor.eyebrow")}
        title={t("retentionDoctor.title")}
        blurb={t("retentionDoctor.blurb")}
        done={!!result && !editing}
        doneSummary={
          result ? (
            <div className="flex flex-wrap items-center gap-4">
              <span
                className={`flex h-16 w-16 items-center justify-center rounded-full border-2 bg-black/50 font-display text-2xl font-black ${gradeColor(result.reportCard.grade)} ${gradeRing(result.reportCard.grade)}`}
              >
                {result.reportCard.grade}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold text-white">“{title || "—"}”</p>
                <p className="mt-0.5 text-sm text-white/55">{result.reportCard.headline}</p>
              </div>
              <button
                onClick={() => setEditing(true)}
                className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-white/15 px-3.5 py-1.5 text-xs font-bold text-white/60 transition hover:border-primary/50 hover:text-white"
              >
                {t("retentionDoctor.editRerun")}
              </button>
            </div>
          ) : undefined
        }
      >
        {(!result || editing) && (
          <>
            <div className="grid gap-4">
              <div>
                <label className={labelClass} htmlFor="rd-title">{t("retentionDoctor.titleLabel")}</label>
                <input
                  id="rd-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={200}
                  placeholder={t("retentionDoctor.titlePlaceholder")}
                  className={inputClass}
                />
              </div>

              <div>
                <span className={labelClass}>{t("retentionDoctor.dropOffsLabel")}</span>
                <div className="grid gap-2">
                  {rows.map((r, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <input
                        value={r.at}
                        onChange={(e) => setRow(i, { at: e.target.value })}
                        placeholder={t("retentionDoctor.atPlaceholder")}
                        inputMode="numeric"
                        aria-label={t("retentionDoctor.atLabel", { n: i + 1 })}
                        className={`${inputClass} max-w-[130px] font-mono`}
                      />
                      <div className="relative flex-1">
                        <input
                          value={r.dropPct}
                          onChange={(e) => setRow(i, { dropPct: e.target.value.replace(/[^0-9]/g, "").slice(0, 2) })}
                          placeholder={t("retentionDoctor.dropPlaceholder")}
                          inputMode="numeric"
                          aria-label={t("retentionDoctor.dropLabel", { n: i + 1 })}
                          className={`${inputClass} pr-9`}
                        />
                        <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-sm text-white/35">%</span>
                      </div>
                      {rows.length > 1 && (
                        <button
                          onClick={() => removeRow(i)}
                          aria-label={t("retentionDoctor.removeRow", { n: i + 1 })}
                          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/10 text-white/40 transition hover:border-red-500/50 hover:text-red-400"
                        >
                          <X className="h-4 w-4" aria-hidden="true" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                {rows.length < 8 && (
                  <button
                    onClick={addRow}
                    className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-white/15 px-4 py-2 text-xs font-bold text-white/60 transition hover:border-primary/50 hover:text-white"
                  >
                    <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                    {t("retentionDoctor.addDropOff")}
                  </button>
                )}
                <p className="mt-2 text-xs text-white/35">{t("retentionDoctor.dropOffsHint")}</p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <label className={labelClass} htmlFor="rd-length">{t("retentionDoctor.lengthLabel")}</label>
                  <input
                    id="rd-length"
                    value={totalLength}
                    onChange={(e) => setTotalLength(e.target.value)}
                    placeholder={t("retentionDoctor.lengthPlaceholder")}
                    inputMode="numeric"
                    className={`${inputClass} font-mono`}
                  />
                </div>
                <div>
                  <label className={labelClass} htmlFor="rd-niche">{t("retentionDoctor.nicheLabel")}</label>
                  <input
                    id="rd-niche"
                    value={niche}
                    onChange={(e) => setNiche(e.target.value)}
                    maxLength={100}
                    placeholder={t("retentionDoctor.nichePlaceholder")}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass} htmlFor="rd-type">{t("retentionDoctor.typeLabel")}</label>
                  <select id="rd-type" value={videoType} onChange={(e) => setVideoType(e.target.value)} className={`${inputClass} bg-black/60`}>
                    <option value="">{t("retentionDoctor.typeAny")}</option>
                    {VIDEO_TYPES.map((v) => (
                      <option key={v} value={v}>{t(`retentionDoctor.type_${v}`)}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelClass} htmlFor="rd-platform">{t("retentionDoctor.platformLabel")}</label>
                  <select id="rd-platform" value={platform} onChange={(e) => setPlatform(e.target.value)} className={`${inputClass} bg-black/60`}>
                    {PLATFORMS.map((p) => (
                      <option key={p} value={p}>{t(`retentionDoctor.platform_${p}`)}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {user ? (
              <StepFooter
                costNote={t("retentionDoctor.costNote", { cost: COST })}
                loading={loading}
                loadingLabel={t("retentionDoctor.diagnosing")}
                ctaLabel={t("retentionDoctor.cta")}
                ctaIcon={Stethoscope}
                onRun={run}
                error={error}
                outOfCredits={outOfCredits}
                disabled={!formValid}
              />
            ) : (
              <p className="mt-6 text-center text-sm text-white/50">
                <Link href="/login" className="font-bold text-primary hover:underline">
                  {t("retentionDoctor.signIn")}
                </Link>{" "}
                {t("retentionDoctor.signInSuffix")}
              </p>
            )}
          </>
        )}

        {result && !editing && (
          <div className="mt-5">
            {/* ── report card ── */}
            <div className="rounded-2xl border border-primary/25 bg-gradient-to-b from-primary/[0.08] to-transparent p-6 text-center">
              <p className="text-[11px] font-bold uppercase tracking-widest text-white/40">
                {t("retentionDoctor.reportCard")}
              </p>
              <p className={`mt-2 font-display text-6xl font-black ${gradeColor(result.reportCard.grade)}`}>
                {result.reportCard.grade}
              </p>
              <p className="mt-1 text-sm text-white/40">
                {result.reportCard.score}
                <span className="text-white/25">/100</span>
              </p>
              <p className="mx-auto mt-3 max-w-xl text-[15px] font-semibold leading-relaxed text-white">
                {result.reportCard.headline}
              </p>
              <p className="mx-auto mt-2 max-w-2xl text-sm leading-relaxed text-white/55">{result.summary}</p>
            </div>

            {/* ── diagnoses ── */}
            <p className="mb-4 mt-8 text-[11px] font-bold uppercase tracking-widest text-white/40">
              {t("retentionDoctor.diagnosesTitle")}
            </p>
            <div className="grid gap-4">
              {result.diagnoses.map((d, i) => {
                const FixIcon = FIX_ICON[d.fixAction] ?? Clapperboard;
                return (
                  <article key={i} className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-red-500/15 px-3 py-1 font-mono text-xs font-black text-red-300">
                        −{d.dropPct}% @ {d.at}
                      </span>
                      <span className="rounded-full border border-amber-400/30 bg-amber-400/10 px-3 py-1 text-xs font-bold text-amber-300">
                        {d.causeLabel}
                      </span>
                    </div>
                    <p className="mt-3 text-[15px] leading-relaxed text-white/85">
                      <span className="font-bold text-white">{t("retentionDoctor.diagnosisLabel")}: </span>
                      {d.diagnosis}
                    </p>
                    <div className="mt-3 rounded-xl border border-primary/25 bg-primary/[0.07] p-4">
                      <p className="text-sm leading-relaxed text-white/90">
                        <span className="font-bold text-primary">℞ {t("retentionDoctor.prescriptionLabel")}: </span>
                        {d.prescription}
                      </p>
                      <Link
                        href={d.fixUrl}
                        className="mt-3 inline-flex items-center gap-2 rounded-full bg-gradient-to-br from-[#f5d67b] via-primary to-[#8a6d1f] px-5 py-2.5 text-sm font-black text-black shadow-[0_4px_20px_rgba(212,175,55,0.35)] transition hover:scale-[1.03] active:scale-95"
                      >
                        <FixIcon className="h-4 w-4" aria-hidden="true" />
                        {d.fixAction === "editor"
                          ? t("retentionDoctor.fixEditor", { at: d.at })
                          : d.fixLabel}
                        <ArrowRight className="h-4 w-4" aria-hidden="true" />
                      </Link>
                    </div>
                  </article>
                );
              })}
            </div>

            {/* ── coherence + virality ── */}
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <button
                onClick={addToCalendar}
                disabled={calendarAdded}
                className={calendarAdded ? ghostButton + " opacity-60" : ghostButton}
              >
                {calendarAdded ? (
                  <Check className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <CalendarDays className="h-4 w-4" aria-hidden="true" />
                )}
                {calendarAdded ? t("retentionDoctor.addedToCalendar") : t("retentionDoctor.addToCalendar")}
              </button>
              <button
                onClick={share}
                className="inline-flex items-center justify-center gap-2 rounded-2xl border border-primary/40 px-6 py-3 text-sm font-bold text-primary transition hover:bg-primary hover:text-black"
              >
                {shared ? (
                  <Check className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <Share2 className="h-4 w-4" aria-hidden="true" />
                )}
                {shared === "shared"
                  ? t("retentionDoctor.shared")
                  : shared === "copied"
                    ? t("retentionDoctor.copied")
                    : t("retentionDoctor.shareReport")}
              </button>
            </div>
            <p className="mt-3 text-center text-xs text-white/30">
              {t("retentionDoctor.shareHint")}
            </p>
          </div>
        )}
      </StepCard>
    </div>
  );
}
