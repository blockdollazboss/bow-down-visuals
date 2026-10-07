import { useState } from "react";
import { Link } from "wouter";
import { Zap, ArrowRight, RefreshCw, Copy, Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/contexts/AuthContext";
import type { IntelContext, HookAnalysis } from "./types";
import { INTEL_PLATFORM_LABELS } from "./types";
import { usePaidCall } from "./use-paid-call";
import {
  inputClass, labelClass, ghostButton,
  scoreColor, scoreBar, StepCard, StepFooter,
} from "./ui";

const COST = 75;

interface StepProps {
  ctx: IntelContext;
  onPatchCtx: (p: Partial<IntelContext>) => void;
  result: HookAnalysis | null;
  onResult: (r: HookAnalysis | null) => void;
  onAdvance: () => void;
  onBack: () => void;
}

function AxisBar({ label, value }: { label: string; value: number }) {
  const pct = Math.max(0, Math.min(100, value * 10));
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-bold text-white">{label}</p>
        <p className={`font-display text-xl font-black ${scoreColor(pct)}`}>{value}<span className="text-sm text-white/40">/10</span></p>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10">
        <div className={`h-full rounded-full bg-gradient-to-r ${scoreBar(pct)}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default function StepHookLab({ ctx, onPatchCtx, result, onResult, onAdvance, onBack }: StepProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { call, loading, error, outOfCredits } = usePaidCall();
  const [editing, setEditing] = useState(!result);
  const [copied, setCopied] = useState(false);
  /* Viral-loop engineering is the chain default: the rewrite must make the
     creator look elite AND leave the viewer asking "how did you make that?". */
  const [viralMode, setViralMode] = useState(true);

  async function run() {
    const transcript = ctx.hook.trim().slice(0, 3000);
    const data = await call<{ analysis?: HookAnalysis }>("/api/analyze-hook", {
      transcript,
      platform: ctx.platform,
      niche: ctx.niche.trim().slice(0, 100),
      mode: viralMode ? "viral" : "standard",
    });
    if (data?.analysis && data.analysis.overallScore != null) {
      onResult(data.analysis);
      setEditing(false);
      setTimeout(() => {
        document.getElementById("intel-step-2")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 100);
    }
  }

  function chooseHook(text: string) {
    onPatchCtx({ hook: text.trim().slice(0, 600) });
    setCopied(false);
  }

  async function copyHook() {
    try {
      await navigator.clipboard.writeText(ctx.hook);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  }

  const candidates = result
    ? [result.rewrittenHook, ...result.alternativeHooks].filter((h) => h && h.trim().length > 0)
    : [];

  return (
    <StepCard
      id="intel-step-2"
      stepNumber={2}
      icon={Zap}
      eyebrow={t("contentIntelligence.step2Eyebrow")}
      title={t("contentIntelligence.step2Title")}
      blurb={t("contentIntelligence.step2Blurb")}
      done={!!result && !editing}
      doneSummary={
        result ? (
          <div className="flex flex-wrap items-center gap-3">
            <span className={`font-display text-2xl font-black ${scoreColor(result.overallScore * 10)}`}>
              {result.overallScore}<span className="text-sm text-white/40">/10</span>
            </span>
            <span className="text-sm text-white/55">“{ctx.hook || "—"}”</span>
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
          <div className="grid gap-4">
            <div>
              <label className={labelClass} htmlFor="intel-hook">{t("contentIntelligence.hookLabel")}</label>
              <textarea
                id="intel-hook"
                value={ctx.hook}
                onChange={(e) => onPatchCtx({ hook: e.target.value })}
                maxLength={3000}
                rows={3}
                placeholder={t("contentIntelligence.hookPlaceholder")}
                className={inputClass}
              />
              <p className="mt-2 text-xs text-white/35">
                {t("contentIntelligence.hookContext", {
                  platform: INTEL_PLATFORM_LABELS[ctx.platform],
                  niche: ctx.niche || t("contentIntelligence.yourNiche"),
                })}
              </p>
            </div>
            <div className="rounded-2xl border border-primary/25 bg-primary/[0.06] p-4">
              <button
                onClick={() => setViralMode((v) => !v)}
                className="flex w-full items-center gap-3 text-left"
                aria-pressed={viralMode}
              >
                <span
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition ${
                    viralMode ? "border-primary bg-primary text-black" : "border-white/25 text-transparent"
                  }`}
                >
                  <Check className="h-3.5 w-3.5" aria-hidden="true" />
                </span>
                <span>
                  <span className="block text-sm font-bold text-white">
                    {t("contentIntelligence.viralModeLabel")}
                  </span>
                  <span className="block text-xs leading-relaxed text-white/50">
                    {t("contentIntelligence.viralModeBlurb")}
                  </span>
                </span>
              </button>
            </div>
          </div>

          {user ? (
            <StepFooter
              costNote={t("contentIntelligence.costNote", { cost: COST })}
              loading={loading}
              loadingLabel={t("contentIntelligence.scoringHook")}
              ctaLabel={t("contentIntelligence.step2Cta")}
              ctaIcon={Zap}
              onRun={run}
              error={error}
              outOfCredits={outOfCredits}
              disabled={ctx.hook.trim().length < 10}
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
          <p className="mb-4 text-[11px] font-bold uppercase tracking-widest text-white/40">
            {t("contentIntelligence.hookScoreTitle")}
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            <AxisBar label={t("contentIntelligence.axisCuriosity")} value={result.curiosityGap} />
            <AxisBar label={t("contentIntelligence.axisPattern")} value={result.patternInterrupt} />
            <AxisBar label={t("contentIntelligence.axisClarity")} value={result.clarity} />
          </div>
          <p className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-[15px] leading-relaxed text-white/90">
            <span className="font-bold text-primary">{t("contentIntelligence.verdictLabel")}: </span>
            {result.verdict}
          </p>

          {result.weaknesses.length > 0 && (
            <ul className="mt-4 grid gap-2">
              {result.weaknesses.map((w, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-white/60">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" aria-hidden="true" />
                  {w}
                </li>
              ))}
            </ul>
          )}

          {candidates.length > 0 && (
            <>
              <p className="mb-3 mt-6 text-[11px] font-bold uppercase tracking-widest text-white/40">
                {t("contentIntelligence.pickWinningHook")}
              </p>
              <div className="grid gap-2.5">
                {candidates.map((h, i) => (
                  <button
                    key={i}
                    onClick={() => chooseHook(h)}
                    className={`rounded-2xl border p-4 text-left transition ${
                      ctx.hook === h
                        ? "border-primary bg-primary/10 shadow-[0_0_16px_rgba(212,175,55,0.2)]"
                        : "border-white/10 bg-white/[0.03] hover:border-primary/40"
                    }`}
                  >
                    <p className="text-[11px] font-bold uppercase tracking-widest text-primary/70">
                      {i === 0 ? t("contentIntelligence.rewrite") : t("contentIntelligence.alternative", { n: i })}
                    </p>
                    <p className="mt-1 text-sm font-semibold leading-relaxed text-white">“{h}”</p>
                  </button>
                ))}
              </div>
            </>
          )}

          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <button onClick={copyHook} className="inline-flex items-center gap-1.5 rounded-full border border-white/15 px-4 py-2 text-xs font-bold text-white/60 transition hover:border-primary/50 hover:text-white">
              {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
              {copied ? t("contentIntelligence.copied") : t("contentIntelligence.copyHook")}
            </button>
            <p className="w-full text-center text-xs text-white/40">
              {t("contentIntelligence.winningHook")}: <span className="font-semibold text-white/70">“{ctx.hook || "—"}”</span>
            </p>
            <button onClick={onBack} className="rounded-full border border-white/15 px-5 py-2.5 text-sm font-bold text-white/60 transition hover:border-white/40 hover:text-white">
              {t("contentIntelligence.back")}
            </button>
            <button onClick={onAdvance} className={ghostButton}>
              {t("contentIntelligence.continueNiche")}
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      )}
    </StepCard>
  );
}
