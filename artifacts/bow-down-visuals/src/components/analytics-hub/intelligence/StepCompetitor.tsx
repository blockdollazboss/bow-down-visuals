import { useState } from "react";
import { Link } from "wouter";
import { Swords, ArrowRight, ArrowLeft, RefreshCw, Lightbulb, AlertTriangle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/contexts/AuthContext";
import type { IntelContext, CompetitorAnalysis } from "./types";
import { usePaidCall } from "./use-paid-call";
import {
  inputClass, labelClass, ghostButton, StepCard, StepFooter,
} from "./ui";

const COST = 200;

interface StepProps {
  ctx: IntelContext;
  onPatchCtx: (p: Partial<IntelContext>) => void;
  result: CompetitorAnalysis | null;
  onResult: (r: CompetitorAnalysis | null) => void;
  onAdvance: () => void;
  onBack: () => void;
}

export default function StepCompetitor({ ctx, onPatchCtx, result, onResult, onAdvance, onBack }: StepProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { call, loading, error, outOfCredits } = usePaidCall();
  const [compName, setCompName] = useState("");
  const [compUrl, setCompUrl] = useState("");
  const [notes, setNotes] = useState("");
  const [editing, setEditing] = useState(!result);

  async function run() {
    const data = await call<CompetitorAnalysis>("/api/competitor-analysis", {
      competitorName: compName.trim().slice(0, 120),
      channelUrl: compUrl.trim().slice(0, 2048),
      niche: ctx.niche.trim().slice(0, 120),
      notes: notes.trim().slice(0, 2000),
    });
    if (data?.opportunities && data.opportunities.length >= 3 && data.takeaways?.length === 3) {
      onResult(data);
      setEditing(false);
      setTimeout(() => {
        document.getElementById("intel-step-4")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 100);
    }
  }

  return (
    <StepCard
      id="intel-step-4"
      stepNumber={4}
      icon={Swords}
      eyebrow={t("contentIntelligence.step4Eyebrow")}
      title={t("contentIntelligence.step4Title")}
      blurb={t("contentIntelligence.step4Blurb")}
      done={!!result && !editing}
      doneSummary={
        result ? (
          <div className="flex flex-wrap items-center gap-3">
            <span className="rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-xs font-black uppercase tracking-widest text-primary">
              {result.opportunities.length} {t("contentIntelligence.gapsFound")}
            </span>
            <span className="text-sm text-white/55">{result.competitorName}</span>
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
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className={labelClass} htmlFor="intel-comp-name">{t("contentIntelligence.compNameLabel")}</label>
                <input
                  id="intel-comp-name"
                  value={compName}
                  onChange={(e) => setCompName(e.target.value)}
                  maxLength={120}
                  placeholder={t("contentIntelligence.compNamePlaceholder")}
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass} htmlFor="intel-comp-url">{t("contentIntelligence.compUrlLabel")}</label>
                <input
                  id="intel-comp-url"
                  value={compUrl}
                  onChange={(e) => setCompUrl(e.target.value)}
                  maxLength={2048}
                  placeholder={t("contentIntelligence.compUrlPlaceholder")}
                  className={inputClass}
                />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className={labelClass} htmlFor="intel-comp-niche">{t("contentIntelligence.nicheLabel")}</label>
                <input
                  id="intel-comp-niche"
                  value={ctx.niche}
                  onChange={(e) => onPatchCtx({ niche: e.target.value })}
                  maxLength={120}
                  placeholder={t("contentIntelligence.nichePlaceholder")}
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass} htmlFor="intel-comp-notes">{t("contentIntelligence.compNotesLabel")}</label>
                <input
                  id="intel-comp-notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  maxLength={2000}
                  placeholder={t("contentIntelligence.compNotesPlaceholder")}
                  className={inputClass}
                />
              </div>
            </div>
            <p className="flex items-start gap-1.5 text-xs leading-relaxed text-white/35">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {t("contentIntelligence.compHonesty")}
            </p>
          </div>

          {user ? (
            <StepFooter
              costNote={t("contentIntelligence.costNote", { cost: COST })}
              loading={loading}
              loadingLabel={t("contentIntelligence.analyzingCompetitor")}
              ctaLabel={t("contentIntelligence.step4Cta")}
              ctaIcon={Swords}
              onRun={run}
              error={error}
              outOfCredits={outOfCredits}
              disabled={(compName.trim().length < 2 && compUrl.trim().length < 4) || ctx.niche.trim().length < 2}
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
          <p className="mb-3 text-[11px] font-bold uppercase tracking-widest text-primary/80">
            {t("contentIntelligence.gapsTitle")}
          </p>
          <div className="grid gap-3">
            {result.opportunities.slice(0, 3).map((o, i) => (
              <div
                key={i}
                className="rounded-2xl border border-primary/30 bg-primary/[0.06] p-4 transition hover:border-primary/60"
              >
                <div className="flex items-start gap-3">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-sm font-black text-primary">
                    {i + 1}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-white">{o.gap}</p>
                    <p className="mt-1 text-[13px] leading-relaxed text-white/65">{o.howToExploit}</p>
                    <Link
                      href={`/hooks?topic=${encodeURIComponent(o.gap)}`}
                      className="mt-2.5 inline-flex items-center gap-1.5 text-xs font-bold text-primary hover:underline"
                    >
                      <Lightbulb className="h-3.5 w-3.5" aria-hidden="true" />
                      {t("contentIntelligence.gapToHooks")}
                      <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                    </Link>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {result.takeaways.length > 0 && (
            <>
              <p className="mb-3 mt-6 text-[11px] font-bold uppercase tracking-widest text-white/40">
                {t("contentIntelligence.takeawaysTitle")}
              </p>
              <div className="grid gap-2.5">
                {result.takeaways.map((take, i) => (
                  <div key={i} className="flex items-start gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-sm font-black text-primary">
                      {i + 1}
                    </span>
                    <p className="pt-1 text-sm leading-relaxed text-white/85">{take}</p>
                  </div>
                ))}
              </div>
            </>
          )}

          {result.disclaimer && (
            <p className="mt-4 text-center text-[11px] italic leading-relaxed text-white/30">{result.disclaimer}</p>
          )}

          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <button onClick={onBack} className="inline-flex items-center gap-1.5 rounded-full border border-white/15 px-5 py-2.5 text-sm font-bold text-white/60 transition hover:border-white/40 hover:text-white">
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              {t("contentIntelligence.back")}
            </button>
            <button onClick={onAdvance} className={ghostButton}>
              {t("contentIntelligence.continueCalendar")}
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      )}
    </StepCard>
  );
}
