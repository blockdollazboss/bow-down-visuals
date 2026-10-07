import { useState } from "react";
import { Link } from "wouter";
import { CalendarDays, ArrowRight, ArrowLeft, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/contexts/AuthContext";
import type { IntelContext, CalendarDay, IntelPlatform } from "./types";
import { usePaidCall } from "./use-paid-call";
import {
  inputClass, labelClass, ghostButton, StepCard, StepFooter,
} from "./ui";

const COST = 150;

type CalPlatform = "tiktok" | "youtube" | "instagram";

interface StepProps {
  ctx: IntelContext;
  onPatchCtx: (p: Partial<IntelContext>) => void;
  result: CalendarDay[] | null;
  onResult: (r: CalendarDay[] | null) => void;
  onAdvance: () => void;
  onBack: () => void;
}

function todayISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const PLATFORM_COLORS: Record<string, string> = {
  tiktok: "border-cyan-400/40 text-cyan-300",
  instagram: "border-pink-500/40 text-pink-300",
  youtube: "border-red-500/40 text-red-300",
};

export default function StepCalendar({ ctx, onPatchCtx, result, onResult, onAdvance, onBack }: StepProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { call, loading, error, outOfCredits } = usePaidCall();

  const defaultPlatforms: CalPlatform[] = (["tiktok", "youtube", "instagram"] as const).includes(
    ctx.platform as CalPlatform
  )
    ? [ctx.platform as CalPlatform]
    : ["tiktok", "instagram", "youtube"];

  const [platforms, setPlatforms] = useState<CalPlatform[]>(defaultPlatforms);
  const [postsPerWeek, setPostsPerWeek] = useState("3");
  const [startDate, setStartDate] = useState(todayISO());
  const [editing, setEditing] = useState(!result);

  function togglePlatform(p: CalPlatform) {
    setPlatforms((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));
  }

  async function run() {
    const data = await call<{ days?: CalendarDay[] }>("/api/content-calendar", {
      niche: ctx.niche.trim().slice(0, 120),
      platforms,
      postsPerWeek: Math.max(1, Math.min(14, parseInt(postsPerWeek, 10) || 3)),
      startDate,
    });
    if (data?.days && data.days.some((d) => d.post)) {
      onResult(data.days);
      setEditing(false);
      setTimeout(() => {
        document.getElementById("intel-step-5")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 100);
    }
  }

  const postDays = result ? result.filter((d) => d.post) : [];

  return (
    <StepCard
      id="intel-step-5"
      stepNumber={5}
      icon={CalendarDays}
      eyebrow={t("contentIntelligence.step5Eyebrow")}
      title={t("contentIntelligence.step5Title")}
      blurb={t("contentIntelligence.step5Blurb")}
      done={!!result && !editing}
      doneSummary={
        result ? (
          <div className="flex flex-wrap items-center gap-3">
            <span className="rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-xs font-black uppercase tracking-widest text-primary">
              {postDays.length} {t("contentIntelligence.postsPlanned")}
            </span>
            <span className="text-sm text-white/55">
              {t("contentIntelligence.calendarFrom", { from: result[0]?.dayLabel ?? "", to: result[result.length - 1]?.dayLabel ?? "" })}
            </span>
            <button
              onClick={() => setEditing(true)}
              className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-white/15 px-3.5 py-1.5 text-xs font-bold text-white/60 transition hover:border-primary/50 hover:text-white"
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              {t("contentIntelligence.editRerun")}
            </button>
          </div>
        ) : undefined
      }
    >
      {(!result || editing) && (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={labelClass} htmlFor="intel-cal-niche">{t("contentIntelligence.nicheLabel")}</label>
              <input
                id="intel-cal-niche"
                value={ctx.niche}
                onChange={(e) => onPatchCtx({ niche: e.target.value })}
                maxLength={120}
                placeholder={t("contentIntelligence.nichePlaceholder")}
                className={inputClass}
              />
              <p className="mt-2 text-xs text-white/35">
                {t("contentIntelligence.calendarHookNote", { hook: ctx.hook ? `“${ctx.hook.slice(0, 80)}${ctx.hook.length > 80 ? "…" : ""}”` : t("contentIntelligence.noHookYet") })}
              </p>
            </div>
            <div>
              <label className={labelClass} htmlFor="intel-cal-start">{t("contentIntelligence.startDateLabel")}</label>
              <input
                id="intel-cal-start"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className={`${inputClass} [color-scheme:dark]`}
              />
            </div>
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <p className={labelClass}>{t("contentIntelligence.calPlatformsLabel")}</p>
              <div className="flex flex-wrap gap-2">
                {(["tiktok", "instagram", "youtube"] as const).map((p) => (
                  <button
                    key={p}
                    onClick={() => togglePlatform(p)}
                    className={`rounded-full px-4 py-2 text-sm font-semibold capitalize transition ${
                      platforms.includes(p)
                        ? "bg-primary text-black shadow-[0_0_16px_rgba(212,175,55,0.3)]"
                        : "border border-white/10 bg-white/[0.03] text-white/60 hover:border-primary/40 hover:text-white"
                    }`}
                  >
                    {p === "youtube" ? "YouTube" : p === "tiktok" ? "TikTok" : "Instagram"}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className={labelClass} htmlFor="intel-cal-cadence">{t("contentIntelligence.cadenceLabel")}</label>
              <input
                id="intel-cal-cadence"
                value={postsPerWeek}
                onChange={(e) => setPostsPerWeek(e.target.value.replace(/[^0-9]/g, "").slice(0, 2))}
                inputMode="numeric"
                className={`${inputClass} max-w-[140px]`}
              />
            </div>
          </div>

          {user ? (
            <StepFooter
              costNote={t("contentIntelligence.costNote", { cost: COST })}
              loading={loading}
              loadingLabel={t("contentIntelligence.buildingCalendar")}
              ctaLabel={t("contentIntelligence.step5Cta")}
              ctaIcon={CalendarDays}
              onRun={run}
              error={error}
              outOfCredits={outOfCredits}
              disabled={ctx.niche.trim().length < 1 || platforms.length === 0}
            />
          ) : (
            <p className="mt-6 text-center text-sm text-white/50">
              <Link href="/login" className="font-bold text-primary hover:underline">
                {t("contentIntelligence.signIn")}
              </Link>{" "}
              {t("contentIntelligence.signInSuffix")}
            </p>
          )}
        </>
      )}

      {result && !editing && (
        <div className="mt-5">
          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {postDays.map((d) => (
              <div key={d.date} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-bold uppercase tracking-widest text-white/40">{d.dayLabel}</p>
                  <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold capitalize ${PLATFORM_COLORS[d.platform] ?? "border-white/15 text-white/50"}`}>
                    {d.platform}
                  </span>
                </div>
                <p className="mt-2 text-sm font-bold leading-snug text-white">{d.title}</p>
                {d.hook && <p className="mt-1.5 text-xs italic leading-relaxed text-primary/80">“{d.hook}”</p>}
                <p className="mt-2 text-[11px] text-white/35">
                  {d.format && <span className="capitalize">{d.format} · </span>}
                  {d.bestTime}
                </p>
              </div>
            ))}
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <button onClick={onBack} className="inline-flex items-center gap-1.5 rounded-full border border-white/15 px-5 py-2.5 text-sm font-bold text-white/60 transition hover:border-white/40 hover:text-white">
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              {t("contentIntelligence.back")}
            </button>
            <button onClick={onAdvance} className={ghostButton}>
              {t("contentIntelligence.seePlan")}
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      )}
    </StepCard>
  );
}
