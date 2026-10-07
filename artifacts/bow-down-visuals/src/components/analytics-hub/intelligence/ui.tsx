import type { ReactNode } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { OutOfCredits } from "@/components/OutOfCredits";

/* ─── Content Intelligence chain — shared UI atoms ───────────────────────
   Gold/black luxury styling matching the rest of the hub. */

export const inputClass =
  "w-full rounded-xl border border-white/10 bg-black/60 px-4 py-3 text-sm text-white placeholder:text-white/25 outline-none transition focus:border-primary/60 focus:ring-1 focus:ring-primary/40";

export const labelClass =
  "mb-2 block text-[11px] font-bold uppercase tracking-widest text-white/40";

export const goldButton =
  "inline-flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-br from-[#f5d67b] via-primary to-[#8a6d1f] px-8 py-4 text-base font-black text-black shadow-[0_4px_28px_rgba(212,175,55,0.4)] transition hover:scale-[1.03] active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100";

export const ghostButton =
  "inline-flex items-center justify-center gap-2 rounded-2xl border border-primary/40 px-6 py-3 text-sm font-bold text-primary transition hover:bg-primary hover:text-black disabled:opacity-50";

export const sectionTitle =
  "mb-4 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-primary/80";

export function scoreColor(score: number): string {
  if (score >= 75) return "text-emerald-400";
  if (score >= 50) return "text-amber-400";
  return "text-red-400";
}

export function scoreBar(score: number): string {
  if (score >= 75) return "from-emerald-500 to-emerald-300";
  if (score >= 50) return "from-amber-500 to-amber-300";
  return "from-red-500 to-red-300";
}

/** Horizontal 0-100 score bar with numeric readout. */
export function ScoreRow({ label, score, reasoning }: { label: string; score: number; reasoning?: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-bold text-white">{label}</p>
        <p className={`font-display text-xl font-black ${scoreColor(score)}`}>{score}</p>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10">
        <div className={`h-full rounded-full bg-gradient-to-r ${scoreBar(score)}`} style={{ width: `${score}%` }} />
      </div>
      {reasoning && <p className="mt-2 text-[13px] leading-relaxed text-white/55">{reasoning}</p>}
    </div>
  );
}

/** Paid-step footer: cost note, error, out-of-credits, CTA. */
export function StepFooter({
  costNote,
  loading,
  loadingLabel,
  ctaLabel,
  onRun,
  error,
  outOfCredits,
  disabled,
  ctaIcon: CtaIcon,
}: {
  costNote: string;
  loading: boolean;
  loadingLabel: string;
  ctaLabel: string;
  onRun: () => void;
  error: string | null;
  outOfCredits: boolean;
  disabled?: boolean;
  ctaIcon?: LucideIcon;
}) {
  return (
    <div className="mt-6 text-center">
      <button onClick={onRun} disabled={loading || disabled} className={goldButton}>
        {loading ? (
          <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
        ) : CtaIcon ? (
          <CtaIcon className="h-5 w-5" aria-hidden="true" />
        ) : null}
        {loading ? loadingLabel : ctaLabel}
      </button>
      <p className="mt-2.5 text-xs text-white/35">{costNote}</p>
      {outOfCredits && (
        <div className="mx-auto mt-4 max-w-md">
          <OutOfCredits />
        </div>
      )}
      {error && !outOfCredits && (
        <p className="mx-auto mt-4 max-w-md rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * Step card shell: numbered header with a "why this step exists" blurb,
 * collapsible body, and a done-state summary so completed steps stay
 * reviewable without re-running.
 */
export function StepCard({
  id,
  stepNumber,
  icon: Icon,
  eyebrow,
  title,
  blurb,
  done,
  doneSummary,
  children,
}: {
  id: string;
  stepNumber: number;
  icon: LucideIcon;
  eyebrow: string;
  title: string;
  blurb: string;
  done: boolean;
  doneSummary?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      className="relative scroll-mt-24 overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-b from-[#14100a] to-black"
    >
      <div className="p-6 md:p-8">
        <div className="flex items-start gap-4">
          <span
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border ${
              done ? "border-primary bg-primary/15 text-primary" : "border-white/15 bg-white/[0.04] text-white/60"
            }`}
          >
            {done ? (
              <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
            ) : (
              <Icon className="h-5 w-5" aria-hidden="true" />
            )}
          </span>
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-widest text-primary/80">
              {eyebrow} · {stepNumber}
            </p>
            <h3 className="mt-1 text-xl font-black text-white md:text-2xl">{title}</h3>
            <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-white/55">{blurb}</p>
          </div>
        </div>
        {done && doneSummary ? (
          <div className="mt-5 rounded-2xl border border-primary/25 bg-primary/[0.05] p-4">{doneSummary}</div>
        ) : null}
        <div className={done ? "mt-5" : "mt-6"}>{children}</div>
      </div>
    </section>
  );
}
