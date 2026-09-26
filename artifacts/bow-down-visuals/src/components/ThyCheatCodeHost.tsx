import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { X, MessageCircle, Sparkles, Footprints } from "lucide-react";
import { getGuideForRoute } from "@/guides";
import { openThyChat } from "@/components/ThyCheatCodeChat";

/* ─── Thy Cheat Code — the in-page coach ──────────────────────────────────
   He doesn't float outside the page anymore. He IS the page's coach: rendered
   in the normal content flow at the top of every page, walking you through
   what to do here step by step. Dismiss him and he collapses to a slim
   in-flow chip (per route, remembered in localStorage).

   Never rendered on auth pages, the full-viewport video editor studio, or
   legal/fan-facing pages where he'd clutter. Full 8-bit pixel styling —
   he communicates in 8-bit everywhere. */

const EXCLUDED_RE =
  /^\/(login|signup|video-editor|terms|privacy|refund-policy|press\/|join\/)/;

function normalizePath(p: string): string {
  return p.split("?")[0].split("#")[0].replace(/\/+$/, "") || "/";
}

function dismissKey(route: string): string {
  return `tcc-host-dismissed:${route}`;
}

function readDismissed(route: string): boolean {
  try {
    return window.localStorage.getItem(dismissKey(route)) === "1";
  } catch {
    return false;
  }
}

export function ThyCheatCodeHost() {
  const [location] = useLocation();
  const route = normalizePath(location);
  const [dismissed, setDismissed] = useState<boolean>(() => readDismissed(route));

  /* Re-read dismissal when the route changes (one host instance, many pages). */
  useEffect(() => {
    setDismissed(readDismissed(route));
  }, [route]);

  if (EXCLUDED_RE.test(route)) return null;

  const guide = getGuideForRoute(route);

  const dismiss = () => {
    try {
      window.localStorage.setItem(dismissKey(route), "1");
    } catch {
      /* private mode — collapse for this visit only */
    }
    setDismissed(true);
  };

  const expand = () => {
    try {
      window.localStorage.removeItem(dismissKey(route));
    } catch {
      /* noop */
    }
    setDismissed(false);
  };

  const startTour = () => {
    window.dispatchEvent(new CustomEvent("thy-tour:start"));
  };

  /* ── Collapsed: slim in-flow chip ── */
  if (dismissed) {
    return (
      <div className="px-4 pt-4 sm:px-6 lg:px-8">
        <button
          onClick={expand}
          className="inline-flex items-center gap-2 border-2 border-[#C9A84C]/40 bg-black/60 py-1.5 pl-2 pr-4 text-sm text-neutral-300 transition hover:border-[#C9A84C]/70 hover:text-white"
          style={{ imageRendering: "pixelated" }}
        >
          <span className="flex h-7 w-7 items-center justify-center overflow-hidden border-2 border-[#C9A84C]/60">
            <video
              src="/thy-cheat-code-idle.mp4"
              autoPlay
              muted
              loop
              playsInline
              aria-hidden="true"
              className="h-full w-full object-cover"
            />
          </span>
          <span>
            <span className="tcc-display text-sm text-[#E8C96A]">THY CHEAT CODE</span>
            <span className="tcc-accent text-xs text-neutral-400"> · TIPS FOR THIS PAGE</span>
          </span>
        </button>
      </div>
    );
  }

  /* ── Full coach card ── */
  return (
    <div className="px-4 pt-4 sm:px-6 lg:px-8">
      <section
        aria-label="Thy Cheat Code — your coach on this page"
        className="overflow-hidden border-4 border-[#C9A84C]/40 bg-gradient-to-br from-[#171208] via-black to-black shadow-[0_8px_32px_rgba(0,0,0,0.6)]"
        style={{ imageRendering: "pixelated" }}
      >
        {/* Coach header — him, in first person */}
        <div className="flex items-start gap-4 p-5 sm:p-6">
          <div className="h-20 w-20 shrink-0 overflow-hidden border-4 border-[#C9A84C] bg-black shadow-[0_0_24px_rgba(201,168,76,0.25)]">
            <video
              src="/thy-cheat-code-making.mp4"
              autoPlay
              muted
              loop
              playsInline
              aria-label="Thy Cheat Code — the King Shark"
              className="h-full w-full object-cover"
            />
          </div>
          <div className="min-w-0 flex-1">
            <p className="tcc-display text-xl tracking-wide text-[#E8C96A]">
              THY CHEAT CODE
            </p>
            <p className="tcc-accent mt-1 text-xs uppercase tracking-[0.22em] text-neutral-400">
              YOUR COACH ON THIS PAGE
            </p>
            <p className="tcc-chat mt-3 text-xl leading-snug text-neutral-100">
              YO — I&apos;M THY CHEAT CODE. HERE&apos;S THE PLAY
              {guide ? (
                <> ON <span className="text-[#E8C96A]">{guide.pageName.toUpperCase()}</span>:</>
              ) : (
                <>:</>
              )}
            </p>
            <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-neutral-300">
              {guide
                ? guide.summary
                : "I run this whole site. Tell me what you're trying to make and I'll point you at the right tool and walk you through it — no guesswork."}
            </p>
          </div>
          <button
            onClick={dismiss}
            aria-label="Hide Thy Cheat Code's tips for this page"
            title="Hide for this page"
            className="shrink-0 p-1.5 text-neutral-500 transition hover:bg-white/10 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Steps */}
        {guide && guide.steps.length > 0 && (
          <ol className="grid gap-3 px-5 pb-5 sm:px-6 sm:pb-6 md:grid-cols-2 xl:grid-cols-3">
            {guide.steps.map((step, i) => (
              <li
                key={i}
                className="flex flex-col border-2 border-white/10 bg-white/[0.03] p-4"
              >
                <div className="flex items-center gap-2.5">
                  <span
                    aria-hidden="true"
                    className="tcc-display flex h-7 w-7 shrink-0 items-center justify-center border-2 border-[#C9A84C]/60 bg-[#C9A84C]/10 text-sm text-[#E8C96A]"
                  >
                    {i + 1}
                  </span>
                  <h3 className="tcc-display text-sm tracking-wide text-white">
                    {step.title.toUpperCase()}
                  </h3>
                </div>
                <p className="mt-2 flex-1 text-sm leading-relaxed text-neutral-300">
                  {step.body}
                </p>
                {step.tip && (
                  <div className="mt-3 flex gap-2 border-2 border-[#C9A84C]/25 bg-[#C9A84C]/[0.07] px-3 py-2.5">
                    <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-[#E8C96A]" />
                    <p className="text-xs leading-relaxed text-amber-100/90">
                      <span className="tcc-display text-xs text-[#E8C96A]">MY TIP: </span>
                      {step.tip}
                    </p>
                  </div>
                )}
                <button
                  onClick={() =>
                    openThyChat(step.askPrompt ?? `Tell me more about: ${step.title}`)
                  }
                  className="tcc-display mt-3 inline-flex items-center justify-center gap-1.5 border-2 border-[#C9A84C]/30 bg-[#C9A84C]/10 px-3 py-2 text-xs tracking-wide text-[#E8C96A] transition hover:bg-[#C9A84C]/20"
                >
                  <MessageCircle className="h-3.5 w-3.5" />
                  ASK ABOUT THIS
                </button>
              </li>
            ))}
          </ol>
        )}

        {/* Actions */}
        <div className="flex flex-wrap items-center gap-2 border-t-4 border-[#C9A84C]/20 bg-black/40 px-5 py-4 sm:px-6">
          <button
            onClick={() => openThyChat()}
            className="tcc-display inline-flex items-center gap-2 border-2 border-black bg-gradient-to-r from-[#C9A84C] to-[#E8C96A] px-5 py-2.5 text-sm tracking-wide text-black transition hover:brightness-110"
          >
            <MessageCircle className="h-4 w-4" />
            CHAT WITH ME
          </button>
          {guide && guide.steps.length > 0 && (
            <button
              onClick={startTour}
              className="tcc-display inline-flex items-center gap-2 border-2 border-[#C9A84C]/40 px-5 py-2.5 text-sm tracking-wide text-[#E8C96A] transition hover:bg-[#C9A84C]/10"
            >
              <Footprints className="h-4 w-4" />
              WALK ME THROUGH IT
            </button>
          )}
          <p className="tcc-accent ml-auto hidden text-xs text-neutral-500 sm:block">
            I&apos;M ON EVERY PAGE — I&apos;VE GOT YOU.
          </p>
        </div>
      </section>
    </div>
  );
}
