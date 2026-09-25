import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { X, ArrowRight, ArrowLeft, Sparkles } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import {
  TOUR_STEPS,
  ONBOARDING_START_EVENT,
  hasCompletedOnboarding,
  markOnboardingComplete,
  computeTooltipPosition,
  type Box,
  type TooltipPlacement,
} from "@/lib/onboarding";

const SPOTLIGHT_PAD = 8;
const TOOLTIP_WIDTH = 340;

/**
 * First-visit onboarding tour — a lightweight custom spotlight overlay.
 *
 * Mounted once inside the authenticated layout. Auto-starts for signed-in
 * users who have never completed the tour (localStorage `bdv_onboarded`),
 * and restarts on demand via the `bdv:start-tour` window event (fired from
 * Settings and the Help panel). Never nags: completing, skipping, or
 * pressing Escape all mark the tour done.
 */
export function OnboardingTour() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const [stepIndex, setStepIndex] = useState<number | null>(null);
  const [spot, setSpot] = useState<Box | null>(null);
  const [placement, setPlacement] = useState<TooltipPlacement | null>(null);
  const [tooltipHeight, setTooltipHeight] = useState(220);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef(0);

  const step = stepIndex === null ? null : TOUR_STEPS[stepIndex] ?? null;
  const isLast = stepIndex !== null && stepIndex === TOUR_STEPS.length - 1;

  /* Measure the target element and position the spotlight + tooltip. */
  const measure = useCallback(() => {
    if (stepIndex === null) return;
    const current = TOUR_STEPS[stepIndex];
    if (!current) return;

    let box: Box | null = null;
    if (current.target) {
      const el = document.querySelector(current.target);
      if (el) {
        const r = el.getBoundingClientRect();
        // Element exists but isn't visible (e.g. collapsed sidebar) — treat as missing.
        if (r.width > 0 && r.height > 0) {
          box = { top: r.top, left: r.left, width: r.width, height: r.height };
        }
      }
    }
    setSpot(box);

    const tooltipWidth =
      window.innerWidth < 640 ? window.innerWidth - 24 : TOOLTIP_WIDTH;
    setPlacement(
      computeTooltipPosition(
        box,
        { width: tooltipWidth, height: tooltipHeight },
        { width: window.innerWidth, height: window.innerHeight },
      ),
    );
  }, [stepIndex, tooltipHeight]);

  /* When the step changes: scroll the target into view, then measure. */
  useEffect(() => {
    if (stepIndex === null) return;
    const current = TOUR_STEPS[stepIndex];
    const el = current?.target ? document.querySelector(current.target) : null;
    if (el) {
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      el.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
    }
    const t = window.setTimeout(measure, 380);
    return () => window.clearTimeout(t);
  }, [stepIndex, measure]);

  /* Keep the spotlight glued to the target on scroll / resize. */
  useEffect(() => {
    if (stepIndex === null) return;
    const onChange = () => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(measure);
    };
    window.addEventListener("scroll", onChange, true);
    window.addEventListener("resize", onChange);
    return () => {
      window.removeEventListener("scroll", onChange, true);
      window.removeEventListener("resize", onChange);
      cancelAnimationFrame(rafRef.current);
    };
  }, [stepIndex, measure]);

  /* Measure the tooltip card height so placement math uses the real size. */
  useLayoutEffect(() => {
    if (stepIndex === null) return;
    const h = tooltipRef.current?.offsetHeight ?? 220;
    if (h !== tooltipHeight) setTooltipHeight(h);
  });

  const finish = useCallback(() => {
    markOnboardingComplete();
    setStepIndex(null);
  }, []);

  const goTo = useCallback(
    (next: number) => {
      if (next < 0 || next >= TOUR_STEPS.length) {
        finish();
        return;
      }
      setStepIndex(next);
    },
    [finish],
  );

  /* Auto-start once for first-time signed-in users; listen for replays. */
  useEffect(() => {
    if (!user || hasCompletedOnboarding()) return;
    const t = window.setTimeout(() => setStepIndex(0), 900);
    return () => window.clearTimeout(t);
  }, [user]);

  useEffect(() => {
    const onStart = () => setStepIndex(0);
    window.addEventListener(ONBOARDING_START_EVENT, onStart);
    return () => window.removeEventListener(ONBOARDING_START_EVENT, onStart);
  }, []);

  /* Escape dismisses (and marks complete so it never nags). */
  useEffect(() => {
    if (stepIndex === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") finish();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stepIndex, finish]);

  if (step === null || stepIndex === null) return null;

  const handleCta = () => {
    if (step.cta?.href) navigate(step.cta.href);
    finish();
  };

  const tooltipStyle: React.CSSProperties =
    placement?.anchor === "sheet"
      ? {
          position: "fixed",
          left: 12,
          right: 12,
          bottom: 12,
          zIndex: 202,
        }
      : {
          position: "fixed",
          top: placement?.top ?? 0,
          left: placement?.left ?? 0,
          width: TOOLTIP_WIDTH,
          maxWidth: "calc(100vw - 32px)",
          zIndex: 202,
        };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Tour step ${stepIndex + 1} of ${TOUR_STEPS.length}: ${step.title}`}
      className="fixed inset-0"
      style={{ zIndex: 200 }}
    >
      {/* Dim layer */}
      <div className="absolute inset-0 bg-black/75" />

      {/* Spotlight cut-out around the target */}
      {spot && (
        <div
          aria-hidden="true"
          className="absolute rounded-2xl border-2 border-primary shadow-[0_0_32px_rgba(218,165,32,0.35)] transition-all duration-300"
          style={{
            top: spot.top - SPOTLIGHT_PAD,
            left: spot.left - SPOTLIGHT_PAD,
            width: spot.width + SPOTLIGHT_PAD * 2,
            height: spot.height + SPOTLIGHT_PAD * 2,
            boxShadow:
              "0 0 0 9999px rgba(0,0,0,0.75), 0 0 32px rgba(218,165,32,0.35)",
          }}
        />
      )}

      {/* Tooltip card */}
      <div
        ref={tooltipRef}
        style={tooltipStyle}
        className="rounded-2xl border border-primary/40 bg-[#0d0b06] p-5 shadow-[0_8px_48px_rgba(218,165,32,0.25)]"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary shrink-0" />
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-primary/70">
              Step {stepIndex + 1} of {TOUR_STEPS.length}
            </p>
          </div>
          <button
            type="button"
            onClick={finish}
            aria-label="Skip tour"
            className="rounded-lg p-1 text-white/40 transition hover:bg-white/10 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <h3 className="mt-2 text-lg font-black text-white">{step.title}</h3>
        <p className="mt-1.5 text-sm leading-relaxed text-white/60">{step.body}</p>

        {/* Progress dots */}
        <div className="mt-4 flex items-center gap-1.5" aria-hidden="true">
          {TOUR_STEPS.map((s, i) => (
            <span
              key={s.id}
              className={`h-1.5 rounded-full transition-all ${
                i === stepIndex
                  ? "w-6 bg-primary"
                  : i < stepIndex
                    ? "w-1.5 bg-primary/50"
                    : "w-1.5 bg-white/15"
              }`}
            />
          ))}
        </div>

        {/* Controls */}
        <div className="mt-4 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={finish}
            className="text-xs font-semibold text-white/40 transition hover:text-white/80"
          >
            Skip tour
          </button>
          <div className="flex items-center gap-2">
            {stepIndex > 0 && (
              <button
                type="button"
                onClick={() => goTo(stepIndex - 1)}
                className="inline-flex items-center gap-1.5 rounded-xl border border-white/15 px-3.5 py-2 text-xs font-bold text-white/70 transition hover:border-white/30 hover:text-white"
              >
                <ArrowLeft className="h-3.5 w-3.5" /> Back
              </button>
            )}
            {step.cta ? (
              <button
                type="button"
                onClick={handleCta}
                className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-xs font-black text-black transition hover:brightness-110"
              >
                {step.cta.label} <ArrowRight className="h-3.5 w-3.5" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => goTo(stepIndex + 1)}
                className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-xs font-black text-black transition hover:brightness-110"
              >
                {isLast ? "Finish" : "Next"} <ArrowRight className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
