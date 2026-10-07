import { useEffect, useRef, useState } from "react";
import {
  Lightbulb, Zap, Crosshair, Swords, CalendarDays, FileCheck2, Check,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type {
  IntelContext, IntelResults, ValidateVerdict, HookAnalysis,
  NicheAnalysis, CompetitorAnalysis, CalendarDay,
} from "./intelligence/types";
import StepValidateIdea from "./intelligence/StepValidateIdea";
import StepHookLab from "./intelligence/StepHookLab";
import StepNiche from "./intelligence/StepNiche";
import StepCompetitor from "./intelligence/StepCompetitor";
import StepCalendar from "./intelligence/StepCalendar";
import PlanReview from "./intelligence/PlanReview";

/* ─── Content Intelligence chain ──────────────────────────────────────────
   One guided flow mounted as a tab inside the Analytics Hub (no new page,
   no new sidebar item). Five chained steps share a single IntelContext —
   idea, niche, audience, platform, hook — so the creator types once and
   every step prefills from the previous step's output. Each step is
   editable and re-runnable at any time. */

const STEP_IDS = ["intel-step-1", "intel-step-2", "intel-step-3", "intel-step-4", "intel-step-5", "intel-plan"];

export default function ContentIntelligenceChain({ initialHook }: { initialHook?: string }) {
  const { t } = useTranslation();

  const [ctx, setCtx] = useState<IntelContext>({
    idea: "",
    niche: "",
    audience: "",
    platform: "tiktok",
    hook: "",
  });
  const [results, setResults] = useState<IntelResults>({
    validate: null,
    hook: null,
    niche: null,
    competitor: null,
    calendar: null,
  });
  const [activeStep, setActiveStep] = useState(1);
  const appliedHook = useRef(false);

  function patchCtx(p: Partial<IntelContext>) {
    setCtx((prev) => ({ ...prev, ...p }));
  }

  function setValidate(r: ValidateVerdict | null) {
    setResults((prev) => ({ ...prev, validate: r }));
  }
  function setHook(r: HookAnalysis | null) {
    setResults((prev) => ({ ...prev, hook: r }));
  }
  function setNiche(r: NicheAnalysis | null) {
    setResults((prev) => ({ ...prev, niche: r }));
  }
  function setCompetitor(r: CompetitorAnalysis | null) {
    setResults((prev) => ({ ...prev, competitor: r }));
  }
  function setCalendar(r: CalendarDay[] | null) {
    setResults((prev) => ({ ...prev, calendar: r }));
  }

  function goStep(n: number) {
    setActiveStep(n);
    setTimeout(() => {
      document.getElementById(STEP_IDS[n - 1])?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 60);
  }

  /* Deep-link: ?hook= (e.g. from Hook Studio's "full intelligence check")
     drops the hook straight into Step 2. */
  useEffect(() => {
    if (!initialHook || appliedHook.current) return;
    appliedHook.current = true;
    setCtx((prev) => ({ ...prev, hook: prev.hook || initialHook }));
    setActiveStep(2);
    setTimeout(() => {
      document.getElementById("intel-step-2")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 350);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialHook]);

  const stepDefs = [
    { n: 1, icon: Lightbulb, label: t("contentIntelligence.nav1"), done: !!results.validate },
    { n: 2, icon: Zap, label: t("contentIntelligence.nav2"), done: !!results.hook },
    { n: 3, icon: Crosshair, label: t("contentIntelligence.nav3"), done: !!results.niche },
    { n: 4, icon: Swords, label: t("contentIntelligence.nav4"), done: !!results.competitor },
    { n: 5, icon: CalendarDays, label: t("contentIntelligence.nav5"), done: !!results.calendar },
    { n: 6, icon: FileCheck2, label: t("contentIntelligence.nav6"), done: false },
  ];

  return (
    <div className="relative">
      {/* header */}
      <div className="text-center">
        <p className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-widest text-primary">
          <Zap className="h-3 w-3" aria-hidden="true" /> {t("contentIntelligence.heroBadge")}
        </p>
        <h2 className="font-display text-3xl font-black tracking-tight text-white md:text-4xl">
          {t("contentIntelligence.heroTitleStart")}{" "}
          <span className="text-primary">{t("contentIntelligence.heroTitleHighlight")}</span>
        </h2>
        <p className="mx-auto mt-3 max-w-2xl text-[15px] leading-relaxed text-white/55">
          {t("contentIntelligence.heroSubtitle")}
        </p>
      </div>

      {/* stepper */}
      <nav aria-label={t("contentIntelligence.stepperLabel")} className="relative mt-8">
        <div className="flex gap-2 overflow-x-auto pb-2 md:justify-center">
          {stepDefs.map((s) => {
            const Icon = s.icon;
            const current = activeStep === s.n;
            return (
              <button
                key={s.n}
                onClick={() => goStep(s.n)}
                aria-current={current ? "step" : undefined}
                className={`flex shrink-0 items-center gap-2 rounded-2xl border px-4 py-2.5 text-sm font-bold transition ${
                  current
                    ? "border-primary bg-primary/15 text-white shadow-[0_0_16px_rgba(212,175,55,0.25)]"
                    : s.done
                      ? "border-primary/40 bg-primary/[0.06] text-primary"
                      : "border-white/10 bg-white/[0.03] text-white/50 hover:border-white/25 hover:text-white"
                }`}
              >
                <span
                  className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-black ${
                    s.done ? "bg-primary text-black" : current ? "bg-primary/25 text-primary" : "bg-white/10 text-white/50"
                  }`}
                >
                  {s.done ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : s.n}
                </span>
                <Icon className="h-4 w-4" aria-hidden="true" />
                <span className="whitespace-nowrap">{s.label}</span>
              </button>
            );
          })}
        </div>
      </nav>

      {/* steps */}
      <div className="mt-8 grid gap-6">
        <StepValidateIdea
          ctx={ctx}
          onPatchCtx={patchCtx}
          result={results.validate}
          onResult={setValidate}
          onAdvance={() => goStep(2)}
        />
        <StepHookLab
          ctx={ctx}
          onPatchCtx={patchCtx}
          result={results.hook}
          onResult={setHook}
          onAdvance={() => goStep(3)}
          onBack={() => goStep(1)}
        />
        <StepNiche
          ctx={ctx}
          onPatchCtx={patchCtx}
          result={results.niche}
          onResult={setNiche}
          onAdvance={() => goStep(4)}
          onBack={() => goStep(2)}
        />
        <StepCompetitor
          ctx={ctx}
          onPatchCtx={patchCtx}
          result={results.competitor}
          onResult={setCompetitor}
          onAdvance={() => goStep(5)}
          onBack={() => goStep(3)}
        />
        <StepCalendar
          ctx={ctx}
          onPatchCtx={patchCtx}
          result={results.calendar}
          onResult={setCalendar}
          onAdvance={() => goStep(6)}
          onBack={() => goStep(4)}
        />
        <PlanReview ctx={ctx} results={results} />
      </div>
    </div>
  );
}
