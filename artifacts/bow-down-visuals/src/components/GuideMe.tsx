import { useState, useEffect, useCallback, useRef } from "react";
import { useLocation } from "wouter";
import {
  X, ChevronLeft, ChevronRight, Sparkles, MessageCircle, Play, Flag,
} from "lucide-react";
import {
  getGuideForRoute, ONBOARDING_TOUR,
  type PageGuide, type GuideStep,
} from "@/guides";

/* ─── AI Guide Mode — Thy Cheat Code walks beside you ─────────────────────
   Floating gold shark button (bottom-left) toggles page-aware walkthroughs.
   Purely additive: no existing page logic is touched. */

const WELCOME_KEY = "guideme-welcomed-v1";

interface ActiveTour {
  kind: "page" | "onboarding";
  pageName: string;
  /** Steps for a page tour; for onboarding, the current stop's single step. */
  steps: GuideStep[];
  /** For onboarding: index into ONBOARDING_TOUR. */
  onboardingIndex: number;
}

interface TargetRect {
  x: number; y: number; w: number; h: number;
}

/** Find a step's target element: CSS selector first, then visible-text match. */
function findTarget(step: GuideStep): Element | null {
  try {
    if (step.target) {
      const el = document.querySelector(step.target);
      if (el && isVisible(el)) return el;
    }
    if (step.targetText) {
      const scope = document.querySelector("main") ?? document;
      const needle = step.targetText.toLowerCase();
      const candidates = scope.querySelectorAll(
        "h1,h2,h3,h4,button,a,label,summary,[role='button'],[aria-label]"
      );
      let best: Element | null = null;
      let bestLen = Infinity;
      for (const el of candidates) {
        if (!isVisible(el)) continue;
        const t = (el.textContent || "").trim().toLowerCase();
        if (t.includes(needle) && t.length < bestLen) {
          best = el;
          bestLen = t.length;
        }
      }
      return best;
    }
  } catch {
    /* selector errors fall through to centered card */
  }
  return null;
}

function isVisible(el: Element): boolean {
  const r = (el as HTMLElement).getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

export function GuideMe() {
  const [location, navigate] = useLocation();
  const [tour, setTour] = useState<ActiveTour | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [showWelcome, setShowWelcome] = useState(false);
  const [rect, setRect] = useState<TargetRect | null>(null);
  const [cardReady, setCardReady] = useState(false);
  const tourRef = useRef<ActiveTour | null>(null);
  tourRef.current = tour;

  /* First-visit welcome prompt (once). */
  useEffect(() => {
    try {
      if (!localStorage.getItem(WELCOME_KEY)) setShowWelcome(true);
    } catch { /* private mode — skip welcome */ }
  }, []);

  const dismissWelcome = useCallback(() => {
    setShowWelcome(false);
    try { localStorage.setItem(WELCOME_KEY, "1"); } catch { /* noop */ }
  }, []);

  /* Resolve the current step from tour state. */
  const steps = tour?.steps ?? [];
  const step: GuideStep | null =
    tour?.kind === "onboarding"
      ? ONBOARDING_TOUR[tour.onboardingIndex]?.step ?? null
      : steps[stepIndex] ?? null;

  /* Measure + spotlight the current step's target. */
  const measure = useCallback(() => {
    const t = tourRef.current;
    if (!t) { setRect(null); return; }
    const s: GuideStep | null =
      t.kind === "onboarding"
        ? ONBOARDING_TOUR[t.onboardingIndex]?.step ?? null
        : t.steps[stepIndex] ?? null;
    if (!s) { setRect(null); return; }
    const el = findTarget(s);
    if (el) {
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      window.setTimeout(() => {
        const r = (el as HTMLElement).getBoundingClientRect();
        if (r.width > 0) setRect({ x: r.x, y: r.y, w: r.width, h: r.height });
        else setRect(null);
      }, 380);
    } else {
      setRect(null);
    }
    setCardReady(true);
  }, [stepIndex]);

  /* Re-measure on step change, keep tracking on scroll/resize. */
  useEffect(() => {
    if (!tour) return;
    setCardReady(false);
    setRect(null);
    measure();
    const onMove = () => {
      const t = tourRef.current;
      if (!t) return;
      const s: GuideStep | null =
        t.kind === "onboarding"
          ? ONBOARDING_TOUR[t.onboardingIndex]?.step ?? null
          : t.steps[stepIndex] ?? null;
      const el = s ? findTarget(s) : null;
      if (el) {
        const r = (el as HTMLElement).getBoundingClientRect();
        setRect({ x: r.x, y: r.y, w: r.width, h: r.height });
      }
    };
    window.addEventListener("scroll", onMove, { passive: true });
    window.addEventListener("resize", onMove);
    return () => {
      window.removeEventListener("scroll", onMove);
      window.removeEventListener("resize", onMove);
    };
  }, [tour, stepIndex, measure, location]);

  /* If the user navigates manually mid-tour, end the tour. */
  const lastLocRef = useRef(location);
  useEffect(() => {
    if (lastLocRef.current !== location) {
      lastLocRef.current = location;
      if (tourRef.current?.kind === "page") setTour(null);
      /* Onboarding: if the new route isn't the current stop's route, end it. */
      if (tourRef.current?.kind === "onboarding") {
        const stop = ONBOARDING_TOUR[tourRef.current.onboardingIndex];
        const norm = (p: string) => p.split("?")[0].split("#")[0].replace(/\/+$/, "") || "/";
        if (stop && norm(stop.route) !== norm(location)) setTour(null);
      }
    }
  }, [location]);

  /* Escape ends the tour. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setTour(null); setShowWelcome(false); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const startPageGuide = useCallback(() => {
    const guide: PageGuide | null = getGuideForRoute(location);
    if (guide) {
      setTour({ kind: "page", pageName: guide.pageName, steps: guide.steps, onboardingIndex: 0 });
    } else {
      /* Generic fallback: describe the page, invite questions. */
      setTour({
        kind: "page",
        pageName: "This page",
        steps: [{
          title: "Here's the lay of the land",
          body: "I don't have a step-by-step walkthrough for this page yet — but I know the whole site. Tap 'Ask Thy Cheat Code' and tell me what you're trying to do here; I'll coach you through it.",
          askPrompt: `What can I do on this page? (${location})`,
        }],
        onboardingIndex: 0,
      });
    }
    setStepIndex(0);
    setShowWelcome(false);
  }, [location]);

  const startOnboarding = useCallback(() => {
    dismissWelcome();
    const first = ONBOARDING_TOUR[0];
    setTour({ kind: "onboarding", pageName: first.pageName, steps: [], onboardingIndex: 0 });
    setStepIndex(0);
    if (first.route !== location) navigate(first.route);
  }, [dismissWelcome, location, navigate]);

  const endTour = useCallback(() => setTour(null), []);

  const goNext = useCallback(() => {
    const t = tourRef.current;
    if (!t) return;
    if (t.kind === "onboarding") {
      const nextIdx = t.onboardingIndex + 1;
      if (nextIdx >= ONBOARDING_TOUR.length) { setTour(null); return; }
      const next = ONBOARDING_TOUR[nextIdx];
      setTour({ ...t, onboardingIndex: nextIdx, pageName: next.pageName });
      setStepIndex(0);
      const norm = (p: string) => p.split("?")[0].split("#")[0].replace(/\/+$/, "") || "/";
      if (norm(next.route) !== norm(location)) navigate(next.route);
    } else {
      if (stepIndex + 1 >= t.steps.length) setTour(null);
      else setStepIndex(stepIndex + 1);
    }
  }, [stepIndex, location, navigate]);

  const goBack = useCallback(() => {
    const t = tourRef.current;
    if (!t) return;
    if (t.kind === "onboarding") {
      const prevIdx = t.onboardingIndex - 1;
      if (prevIdx < 0) return;
      const prev = ONBOARDING_TOUR[prevIdx];
      setTour({ ...t, onboardingIndex: prevIdx, pageName: prev.pageName });
      setStepIndex(0);
      const norm = (p: string) => p.split("?")[0].split("#")[0].replace(/\/+$/, "") || "/";
      if (norm(prev.route) !== norm(location)) navigate(prev.route);
    } else if (stepIndex > 0) {
      setStepIndex(stepIndex - 1);
    }
  }, [stepIndex, location, navigate]);

  const askCheatCode = useCallback(() => {
    const q = step?.askPrompt
      ?? (step ? `Tell me more about: ${step.title}` : "Help me with this page");
    setTour(null);
    window.dispatchEvent(new CustomEvent("guideme:ask", { detail: { question: q } }));
  }, [step]);

  /* ── Coach card position: below target, else above, else bottom-center ── */
  const CARD_W = 380;
  let cardStyle: React.CSSProperties = {
    position: "fixed", zIndex: 9992, width: `min(${CARD_W}px, calc(100vw - 32px))`,
    left: "50%", transform: "translateX(-50%)", bottom: 24,
  };
  if (rect) {
    const vw = window.innerWidth, vh = window.innerHeight;
    const left = Math.max(16, Math.min(rect.x, vw - CARD_W - 16));
    if (rect.y + rect.h + 300 < vh) {
      cardStyle = { ...cardStyle, left, transform: "none", bottom: "auto", top: rect.y + rect.h + 16 };
    } else if (rect.y - 300 > 0) {
      cardStyle = { ...cardStyle, left, transform: "none", bottom: vh - rect.y + 16, top: "auto" };
    } else {
      cardStyle = { ...cardStyle, left, transform: "none", bottom: 24 };
    }
  }

  const totalSteps = tour?.kind === "onboarding" ? ONBOARDING_TOUR.length : steps.length;
  const currentNum = tour?.kind === "onboarding" ? tour.onboardingIndex + 1 : stepIndex + 1;
  const isLast = currentNum >= totalSteps;

  return (
    <>
      {/* Floating Guide button — bottom-left, clear of the chat widget */}
      <button
        onClick={() => (tour ? endTour() : startPageGuide())}
        aria-label={tour ? "End guided tour" : "Guide me — Thy Cheat Code walkthrough"}
        title="Guide Me — Thy Cheat Code walks you through this page"
        className={`guideme-fab fixed bottom-5 left-5 z-[9996] flex h-14 w-14 items-center justify-center rounded-full border border-amber-300/60 bg-gradient-to-br from-amber-400 via-yellow-600 to-amber-800 text-2xl shadow-[0_0_28px_rgba(218,165,32,0.55)] transition-transform hover:scale-110 active:scale-95 ${showWelcome ? "animate-bounce" : ""}`}
      >
        {tour ? <X className="h-6 w-6 text-black" /> : <span role="img" aria-hidden>🦈</span>}
      </button>

      {/* First-visit welcome card */}
      {showWelcome && !tour && (
        <div className="fixed bottom-24 left-5 z-[9996] w-[min(340px,calc(100vw-40px))] overflow-hidden rounded-2xl border border-amber-400/40 bg-black/85 shadow-[0_8px_40px_rgba(0,0,0,0.7),0_0_24px_rgba(218,165,32,0.25)] backdrop-blur-xl">
          <div className="border-b border-amber-400/20 bg-gradient-to-r from-amber-500/15 to-transparent px-5 py-4">
            <p className="flex items-center gap-2 text-sm font-black text-amber-300">
              <span className="text-lg">🦈</span> Hey, I'm Thy Cheat Code
            </p>
          </div>
          <div className="px-5 py-4">
            <p className="text-sm leading-relaxed text-white/80">
              Want me to show you around? I'll walk you through the whole site,
              step by step — like a coach right beside you.
            </p>
            <div className="mt-4 flex gap-2">
              <button
                onClick={startOnboarding}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-amber-400 to-yellow-600 px-4 py-2.5 text-sm font-black text-black transition hover:brightness-110"
              >
                <Play className="h-4 w-4" /> Start Tour
              </button>
              <button
                onClick={dismissWelcome}
                className="rounded-xl border border-white/15 px-4 py-2.5 text-sm font-semibold text-white/60 transition hover:bg-white/5 hover:text-white"
              >
                Later
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Spotlight overlay + coach card */}
      {tour && step && cardReady && (
        <>
          {/* Dim layer (4 rects around the target, or full-screen if no target) */}
          {rect ? (
            <>
              <div className="guideme-dim" style={{ left: 0, top: 0, width: "100vw", height: Math.max(0, rect.y - 8) }} />
              <div className="guideme-dim" style={{ left: 0, top: rect.y + rect.h + 8, width: "100vw", bottom: 0 }} />
              <div className="guideme-dim" style={{ left: 0, top: rect.y - 8, width: Math.max(0, rect.x - 8), height: rect.h + 16 }} />
              <div className="guideme-dim" style={{ left: rect.x + rect.w + 8, top: rect.y - 8, right: 0, height: rect.h + 16 }} />
              {/* Pulsing gold ring on the target */}
              <div
                className="guideme-ring"
                style={{ left: rect.x - 8, top: rect.y - 8, width: rect.w + 16, height: rect.h + 16 }}
              />
            </>
          ) : (
            <div className="guideme-dim" style={{ inset: 0 }} />
          )}

          {/* Coach card */}
          <div style={cardStyle} className="overflow-hidden rounded-2xl border border-amber-400/40 bg-black/85 shadow-[0_8px_40px_rgba(0,0,0,0.7),0_0_32px_rgba(218,165,32,0.3)] backdrop-blur-xl">
            <div className="flex items-center justify-between border-b border-amber-400/20 bg-gradient-to-r from-amber-500/15 to-transparent px-5 py-3">
              <p className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.18em] text-amber-300">
                <span className="text-base">🦈</span> Thy Cheat Code
              </p>
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-bold text-white/40">
                  Step {currentNum} of {totalSteps}
                </span>
                <button onClick={endTour} aria-label="End tour"
                  className="rounded-full p-1 text-white/40 transition hover:bg-white/10 hover:text-white">
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="max-h-[40vh] overflow-y-auto px-5 py-4">
              <h3 className="mb-2 text-base font-black text-white">{step.title}</h3>
              <p className="text-sm leading-relaxed text-white/75">{step.body}</p>
              {step.tip && (
                <div className="mt-3 flex gap-2 rounded-xl border border-amber-400/25 bg-amber-400/[0.07] px-3 py-2.5">
                  <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
                  <p className="text-xs leading-relaxed text-amber-100/90">
                    <span className="font-black text-amber-300">Pro tip: </span>{step.tip}
                  </p>
                </div>
              )}
            </div>

            {/* Progress bar */}
            <div className="h-1 bg-white/5">
              <div
                className="h-full bg-gradient-to-r from-amber-500 to-yellow-300 transition-all duration-300"
                style={{ width: `${(currentNum / totalSteps) * 100}%` }}
              />
            </div>

            <div className="flex items-center gap-2 px-5 py-3">
              <button
                onClick={goBack}
                disabled={currentNum <= 1}
                className="flex items-center gap-1 rounded-lg px-3 py-2 text-xs font-bold text-white/50 transition hover:bg-white/5 hover:text-white disabled:opacity-30"
              >
                <ChevronLeft className="h-4 w-4" /> Back
              </button>
              <button
                onClick={askCheatCode}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs font-bold text-amber-200 transition hover:bg-amber-400/20"
              >
                <MessageCircle className="h-3.5 w-3.5" /> Ask Thy Cheat Code
              </button>
              {isLast ? (
                <button
                  onClick={endTour}
                  className="flex items-center gap-1 rounded-lg bg-gradient-to-r from-amber-400 to-yellow-600 px-3 py-2 text-xs font-black text-black transition hover:brightness-110"
                >
                  <Flag className="h-3.5 w-3.5" /> Done
                </button>
              ) : (
                <button
                  onClick={goNext}
                  className="flex items-center gap-1 rounded-lg bg-gradient-to-r from-amber-400 to-yellow-600 px-3 py-2 text-xs font-black text-black transition hover:brightness-110"
                >
                  Next <ChevronRight className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            {!isLast && (
              <button onClick={endTour}
                className="w-full pb-3 text-center text-[11px] font-semibold text-white/30 transition hover:text-white/60">
                Skip tour
              </button>
            )}
          </div>
        </>
      )}
    </>
  );
}
