import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { PixelSprite } from "@/components/pixel-headline";
import { cn } from "@/lib/utils";
import {
  ARROW_TO_DIR,
  DIR_GLYPH,
  formatJackpotDate,
  rollBuffer,
  type Direction,
  type JackpotPhase,
  type JackpotStatus,
} from "@/components/cheat-code-jackpot-logic";

/**
 * Cheat Code Jackpot — the site-wide, once-per-season prize event.
 *
 * One secret directional-pad sequence per 6-month cycle. First signed-in
 * player to enter it wins the prize credits. The secret itself NEVER ships
 * to the client: the server only tells us the code LENGTH (a game hint),
 * and every attempt is validated server-side.
 *
 * Pieces:
 *  - Status banner (sticky top): unclaimed / claimed / upcoming / ended,
 *    with season start, end, and reset dates + winner spotlight.
 *  - Global arrow-key listener with an "armed combo" window: the first
 *    arrow press arms input for a few seconds (page scroll is only
 *    captured while armed or while the D-pad panel is open).
 *  - Touch D-pad panel (bottom-left FAB) so mobile players can enter.
 *  - Winner celebration overlay + sign-in prompt + toasts.
 *
 * The typed `cheatcode` easter egg stays as a harmless decoy.
 */

export type { Direction, JackpotPhase, JackpotStatus };

const ARM_MS = 6000;
const POLL_MS = 60_000;
const BANNER_DISMISS_KEY = "cheat-code-jackpot-banner-dismissed";

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return (
    !!el &&
    (el.tagName === "INPUT" ||
      el.tagName === "TEXTAREA" ||
      el.tagName === "SELECT" ||
      el.isContentEditable)
  );
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

/** 8-bit jackpot fanfare — square wave, zero assets. Garnish only. */
function playFanfare() {
  try {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    const notes = [
      523.25, 523.25, 523.25, 659.25, 783.99, 1046.5, 783.99, 1046.5,
    ];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "square";
      osc.frequency.value = freq;
      const t = ctx.currentTime + i * 0.11;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.09, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.18);
    });
    window.setTimeout(() => void ctx.close(), 1400);
  } catch {
    /* never break the page over audio */
  }
}

function CelebrationCoins({ reduced }: { reduced: boolean }) {
  const coins = useMemo(
    () =>
      Array.from({ length: reduced ? 0 : 34 }).map((_, i) => {
        const angle = (i / 34) * Math.PI * 2 + Math.random() * 0.4;
        const dist = 140 + Math.random() * 230;
        return {
          x: Math.cos(angle) * dist,
          y: Math.sin(angle) * dist - 70,
          delay: Math.random() * 0.3,
          pixel: 4 + Math.floor(Math.random() * 5),
          spin: Math.random() > 0.5 ? 1 : -1,
        };
      }),
    [reduced],
  );
  if (reduced) return null;
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 flex items-center justify-center"
    >
      {coins.map((c, i) => (
        <span
          key={i}
          className="pixel-coin-burst absolute"
          style={
            {
              "--burst-x": `${c.x}px`,
              "--burst-y": `${c.y}px`,
              animationDelay: `${c.delay}s`,
            } as React.CSSProperties
          }
        >
          <PixelSprite name="coin" pixel={c.pixel} />
        </span>
      ))}
    </div>
  );
}

async function fetchStatus(): Promise<JackpotStatus> {
  const res = await fetch("/api/cheat-code/status");
  if (!res.ok) throw new Error(`status ${res.status}`);
  return (await res.json()) as JackpotStatus;
}

export function CheatCodeJackpot() {
  const { user, getAccessToken, refreshProfile } = useAuth();
  const [status, setStatus] = useState<JackpotStatus | null>(null);
  const [dismissed, setDismissed] = useState(
    () =>
      typeof window !== "undefined" &&
      window.sessionStorage.getItem(BANNER_DISMISS_KEY) === "1",
  );
  const [buffer, setBuffer] = useState<Direction[]>([]);
  const [armed, setArmed] = useState(false);
  const [padOpen, setPadOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [wrongFlash, setWrongFlash] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [signInPrompt, setSignInPrompt] = useState(false);
  const [celebration, setCelebration] = useState<{
    name: string;
    prize: number;
  } | null>(null);
  const reducedMotion = useReducedMotion();

  const statusRef = useRef(status);
  statusRef.current = status;
  const userRef = useRef(user);
  userRef.current = user;
  const padOpenRef = useRef(padOpen);
  padOpenRef.current = padOpen;
  const armedUntilRef = useRef(0);
  const submittingRef = useRef(false);
  const toastTimer = useRef(0);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 5200);
  }, []);

  const refreshStatus = useCallback(async () => {
    try {
      setStatus(await fetchStatus());
    } catch {
      /* banner stays on last known state */
    }
  }, []);

  useEffect(() => {
    refreshStatus();
    const id = window.setInterval(refreshStatus, POLL_MS);
    const onVis = () => {
      if (document.visibilityState === "visible") refreshStatus();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [refreshStatus]);

  const clearBuffer = useCallback(() => {
    setBuffer([]);
    setArmed(false);
    armedUntilRef.current = 0;
  }, []);

  const submitAttempt = useCallback(
    async (sequence: Direction[]) => {
      if (submittingRef.current || sequence.length === 0) return;
      const currentUser = userRef.current;
      if (!currentUser) {
        setSignInPrompt(true);
        return;
      }
      submittingRef.current = true;
      setSubmitting(true);
      try {
        const token = await getAccessToken();
        const res = await fetch("/api/cheat-code/attempt", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ sequence }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          correct?: boolean;
          claimed?: boolean;
          prizeCredits?: number;
          winnerDisplayName?: string | null;
          message?: string;
          error?: string;
          retryAfterSeconds?: number;
          triesLeft?: number;
        };
        if (res.status === 401) {
          setSignInPrompt(true);
        } else if (res.status === 429) {
          const wait = data.retryAfterSeconds;
          const waitText =
            wait != null && wait > 0
              ? ` Try again in ${wait >= 3600 ? `~${Math.round(wait / 3600)}h` : `~${Math.ceil(wait / 60)}m`}.`
              : "";
          showToast(
            (data.error ?? "Too many attempts — take a breath.") + waitText,
          );
        } else if (data.correct && data.claimed) {
          const name = data.winnerDisplayName ?? "Champion";
          setCelebration({ name, prize: data.prizeCredits ?? 0 });
          if (!reducedMotion) playFanfare();
          void refreshProfile();
          setStatus((s) =>
            s
              ? {
                  ...s,
                  phase: "claimed",
                  winnerDisplayName: name,
                  claimedAt: new Date().toISOString(),
                }
              : s,
          );
        } else if (data.claimed) {
          showToast(
            data.message ??
              `Already claimed by ${data.winnerDisplayName ?? "someone"} — better luck next season.`,
          );
          void refreshStatus();
        } else if (data.error) {
          showToast(data.error);
        } else {
          /* wrong code — shake the input, keep hunting */
          setWrongFlash(true);
          window.setTimeout(() => setWrongFlash(false), 450);
          if (data.triesLeft != null) {
            showToast(
              data.triesLeft > 0
                ? `Wrong code — ${data.triesLeft} ${data.triesLeft === 1 ? "try" : "tries"} left today.`
                : "Wrong code — that's your 3 tries for today.",
            );
          }
        }
      } catch {
        showToast("Could not check the code. Try again.");
      } finally {
        submittingRef.current = false;
        setSubmitting(false);
        clearBuffer();
      }
    },
    [clearBuffer, getAccessToken, refreshProfile, refreshStatus, showToast, reducedMotion],
  );

  const pushDirection = useCallback(
    (dir: Direction) => {
      const s = statusRef.current;
      if (!s || s.phase !== "live") return;
      const max = s.codeLength ?? 10;
      setBuffer((prev) => {
        const next = rollBuffer(prev, dir, max);
        if (next.length >= max) {
          /* complete combo — submit on the next tick */
          window.setTimeout(() => submitAttempt(next), 0);
        }
        return next;
      });
    },
    [submitAttempt],
  );

  /* Global arrow-key listener with an armed-combo window. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;
      if (e.key === "Escape") {
        setPadOpen(false);
        setSignInPrompt(false);
        clearBuffer();
        return;
      }
      const dir = ARROW_TO_DIR[e.key];
      if (!dir) return;
      const s = statusRef.current;
      if (!s || s.phase !== "live") return;
      const now = Date.now();
      const isArmed = padOpenRef.current || now < armedUntilRef.current;
      if (isArmed) e.preventDefault();
      armedUntilRef.current = now + ARM_MS;
      setArmed(true);
      pushDirection(dir);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pushDirection, clearBuffer]);

  /* Disarm the combo window when it lapses. */
  useEffect(() => {
    if (!armed) return;
    const id = window.setInterval(() => {
      if (Date.now() >= armedUntilRef.current) clearBuffer();
    }, 500);
    return () => window.clearInterval(id);
  }, [armed, clearBuffer]);

  const dismissBanner = useCallback(() => {
    setDismissed(true);
    try {
      window.sessionStorage.setItem(BANNER_DISMISS_KEY, "1");
    } catch {
      /* private mode etc. — banner just comes back next load */
    }
  }, []);

  const phase = status?.phase ?? "none";
  const showBanner = !dismissed && status !== null;
  const codeLength = status?.codeLength ?? 10;

  const bannerBody = (() => {
    switch (phase) {
      case "live":
        return {
          title: `CHEAT CODE JACKPOT — ${status?.prizeCredits ?? 100} credits unclaimed`,
          sub: `One code for the whole site · ends ${formatJackpotDate(status?.endsAt)}`,
          accent: true,
        };
      case "claimed":
        return {
          title: `🏆 ${status?.winnerDisplayName ?? "a sharp player"} won the jackpot`,
          sub: `+${status?.prizeCredits ?? 100} credits claimed — think you can beat them? A new code is coming`,
          accent: true,
        };
      case "upcoming":
        return {
          title: "The next jackpot season is loading…",
          sub: `A new secret code goes live — one winner takes ${status?.prizeCredits ?? 100} credits`,
          accent: false,
        };
      case "ended":
        return {
          title: status?.winnerDisplayName
            ? `👑 ${status.winnerDisplayName} took the crown`
            : "Season over with no winner",
          sub: "A new secret code is on the way",
          accent: false,
        };
      case "none":
      default:
        return {
          title: "Cheat Code Jackpot — coming soon",
          sub: "One secret code for the whole site. One winner takes the credits.",
          accent: false,
        };
    }
  })();

  return (
    <>
      {/* ── Status banner ─────────────────────────────────────────── */}
      {showBanner && bannerBody && (
        <div
          role="status"
          className={cn(
            "sticky top-0 z-[60] border-b",
            bannerBody.accent
              ? "border-[#C9A84C]/60 bg-black/95"
              : "border-white/10 bg-[#0a0a0a]/95",
          )}
        >
          <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-2">
            <span aria-hidden="true" className="shrink-0 leading-none">
              <PixelSprite name="shark" pixel={4} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="pixel-display truncate text-[10px] sm:text-xs tracking-[0.14em] text-[#F5DE8E] uppercase">
                {bannerBody.title}
              </p>
              <p className="truncate text-[11px] sm:text-xs text-white/50">
                {bannerBody.sub}
              </p>
            </div>
            {phase === "live" && (
              <button
                type="button"
                onClick={() => setPadOpen(true)}
                className={cn(
                  "pixel-display shrink-0 rounded-none border-2 border-[#C9A84C]",
                  "bg-[#C9A84C]/15 px-3 py-1.5 text-[10px] uppercase tracking-[0.18em]",
                  "text-[#F5DE8E] hover:bg-[#C9A84C]/30 transition-colors",
                )}
              >
                Enter code
              </button>
            )}
            <button
              type="button"
              onClick={dismissBanner}
              aria-label="Dismiss jackpot banner"
              className="shrink-0 px-2 text-lg leading-none text-white/40 hover:text-white/80"
            >
              ×
            </button>
          </div>
        </div>
      )}

      {/* ── D-pad FAB (mobile / touch entry) ──────────────────────── */}
      {phase === "live" && (
        <button
          type="button"
          onClick={() => setPadOpen((v) => !v)}
          aria-label={padOpen ? "Close directional pad" : "Open directional pad"}
          aria-expanded={padOpen}
          className={cn(
            "fixed bottom-5 left-5 z-[9990] flex h-14 w-14 items-center justify-center",
            "rounded-full border-2 border-[#C9A84C] bg-black/90 text-2xl",
            "text-[#F5DE8E] shadow-[0_0_24px_rgba(201,168,76,0.35)]",
            "hover:bg-[#C9A84C]/20 transition-colors",
          )}
        >
          <span aria-hidden="true">✛</span>
        </button>
      )}

      {/* ── D-pad panel ───────────────────────────────────────────── */}
      {padOpen && phase === "live" && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Enter the cheat code"
          className="fixed inset-0 z-[9991] flex items-center justify-center bg-black/80 p-6 backdrop-blur-sm"
          onClick={() => setPadOpen(false)}
        >
          <div
            className={cn(
              "relative border-2 border-[#C9A84C]/70 bg-[#0a0a0a] p-6 sm:p-8",
              "w-full max-w-sm text-center",
              wrongFlash && !reducedMotion && "animate-[jackpot-shake_0.4s_ease]",
            )}
            onClick={(e) => e.stopPropagation()}
          >
            <p className="pixel-display text-xs sm:text-sm tracking-[0.18em] text-[#F5DE8E] uppercase">
              Enter the code
            </p>
            <p className="mt-2 text-xs text-white/50 leading-relaxed">
              The secret {codeLength}-move combo. Arrows on your keyboard work
              too — anywhere on the page.
            </p>

            {/* input progress */}
            <div
              aria-live="polite"
              className="mt-4 flex min-h-[2.5rem] flex-wrap items-center justify-center gap-1.5"
            >
              {buffer.length === 0 ? (
                <span className="text-xs text-white/30">
                  {codeLength} moves, one shot at glory…
                </span>
              ) : (
                buffer.map((d, i) => (
                  <span
                    key={i}
                    className="flex h-9 w-9 items-center justify-center border border-[#C9A84C]/60 bg-[#C9A84C]/10 text-lg text-[#F5DE8E]"
                  >
                    {DIR_GLYPH[d]}
                  </span>
                ))
              )}
            </div>

            {/* the pad */}
            <div className="mx-auto mt-4 grid w-52 grid-cols-3 grid-rows-3 gap-1.5">
              <span />
              <PadButton dir="up" onPress={pushDirection} disabled={submitting} />
              <span />
              <PadButton dir="left" onPress={pushDirection} disabled={submitting} />
              <span className="flex items-center justify-center">
                <span className="h-3 w-3 rounded-full bg-[#C9A84C]/50" aria-hidden="true" />
              </span>
              <PadButton dir="right" onPress={pushDirection} disabled={submitting} />
              <span />
              <PadButton dir="down" onPress={pushDirection} disabled={submitting} />
              <span />
            </div>

            <div className="mt-5 flex items-center justify-center gap-3">
              <button
                type="button"
                onClick={clearBuffer}
                className="text-xs text-white/40 underline-offset-2 hover:text-white/70 hover:underline"
              >
                Clear
              </button>
              <button
                type="button"
                onClick={() => setPadOpen(false)}
                className={cn(
                  "pixel-display rounded-none border border-white/20 px-4 py-2",
                  "text-[10px] uppercase tracking-[0.2em] text-white/70",
                  "hover:bg-white/10 transition-colors",
                )}
              >
                Close
              </button>
            </div>
            {submitting && (
              <p className="mt-3 text-xs text-[#F5DE8E]/80">Checking…</p>
            )}
          </div>
        </div>
      )}

      {/* ── Armed-combo progress chip (keyboard entry feedback) ───── */}
      {armed && !padOpen && phase === "live" && buffer.length > 0 && (
        <div className="fixed bottom-5 left-1/2 z-[9990] -translate-x-1/2">
          <div
            aria-live="polite"
            className={cn(
              "flex items-center gap-1.5 border border-[#C9A84C]/60 bg-black/95 px-3 py-2",
              wrongFlash &&
                !reducedMotion &&
                "animate-[jackpot-shake_0.4s_ease]",
            )}
          >
            {buffer.map((d, i) => (
              <span key={i} className="text-base text-[#F5DE8E]" aria-hidden="true">
                {DIR_GLYPH[d]}
              </span>
            ))}
            <span className="ml-1 text-[10px] text-white/40">
              {buffer.length}/{codeLength}
            </span>
          </div>
        </div>
      )}

      {/* ── Sign-in prompt ────────────────────────────────────────── */}
      {signInPrompt && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Sign in to enter the jackpot"
          className="fixed inset-0 z-[9992] flex items-center justify-center bg-black/80 p-6 backdrop-blur-sm"
          onClick={() => setSignInPrompt(false)}
        >
          <div
            className="w-full max-w-sm border-2 border-[#C9A84C]/70 bg-[#0a0a0a] p-8 text-center"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="pixel-display text-sm tracking-[0.18em] text-[#F5DE8E] uppercase">
              Hold up, player
            </p>
            <p className="mt-3 text-sm text-white/60 leading-relaxed">
              You need an account to claim the jackpot — otherwise anyone could
              snatch your 100 credits.
            </p>
            <div className="mt-6 flex flex-col gap-3">
              <a
                href="/login"
                className={cn(
                  "pixel-display rounded-none border-2 border-[#C9A84C] bg-[#C9A84C]/15",
                  "px-6 py-3 text-xs uppercase tracking-[0.2em] text-[#F5DE8E]",
                  "hover:bg-[#C9A84C]/30 transition-colors text-center",
                )}
              >
                Sign in
              </a>
              <button
                type="button"
                onClick={() => setSignInPrompt(false)}
                className="text-xs text-white/40 hover:text-white/70"
              >
                Keep looking for the code
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Winner celebration ────────────────────────────────────── */}
      {celebration && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Jackpot won"
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/90 p-6 backdrop-blur-sm"
          onClick={() => setCelebration(null)}
        >
          <CelebrationCoins reduced={reducedMotion} />
          <div
            className={cn(
              "relative text-center max-w-md",
              !reducedMotion && "pixel-overlay-pop",
            )}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-6 flex justify-center">
              <PixelSprite name="shark" pixel={11} />
            </div>
            <p className="pixel-display pixel-gold-text text-2xl sm:text-4xl leading-[1.6]">
              Jackpot!
            </p>
            <p className="pixel-display mt-4 text-sm sm:text-base tracking-[0.2em] text-[#F5DE8E] uppercase">
              +{celebration.prize} credits
            </p>
            <div
              className="pixel-divider my-6 justify-center"
              aria-hidden="true"
            >
              {Array.from({ length: 14 }).map((_, i) => (
                <span key={i} />
              ))}
            </div>
            <p className="text-white/80 text-base sm:text-lg leading-relaxed">
              Thank you,{" "}
              <span className="text-[#F5DE8E] font-semibold">
                {celebration.name}
              </span>
              .
              <br />
              You cracked the code — the King Shark bows to you.
            </p>
            <p className="mt-4 text-white/40 text-xs leading-relaxed">
              One code, one winner, one season. Your credits are already in
              your balance.
            </p>
            <button
              type="button"
              onClick={() => setCelebration(null)}
              className={cn(
                "pixel-display mt-8 rounded-none border-2 border-[#C9A84C] bg-[#C9A84C]/10",
                "px-6 py-3 text-xs uppercase tracking-[0.2em] text-[#F5DE8E]",
                "hover:bg-[#C9A84C]/25 transition-colors",
              )}
            >
              Keep creating
            </button>
          </div>
        </div>
      )}

      {/* ── Toast ─────────────────────────────────────────────────── */}
      {toast && (
        <div
          role="alert"
          className="fixed bottom-5 left-1/2 z-[9993] max-w-[calc(100vw-2rem)] -translate-x-1/2 border border-[#C9A84C]/60 bg-black/95 px-4 py-3 text-center text-sm text-white/85"
        >
          {toast}
        </div>
      )}
    </>
  );
}

function PadButton({
  dir,
  onPress,
  disabled,
}: {
  dir: Direction;
  onPress: (dir: Direction) => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={`Move ${dir}`}
      disabled={disabled}
      onPointerDown={(e) => {
        e.preventDefault();
        onPress(dir);
      }}
      className={cn(
        "flex h-16 w-16 items-center justify-center border-2 border-[#C9A84C]/70",
        "bg-[#C9A84C]/10 text-2xl text-[#F5DE8E] touch-none select-none",
        "active:bg-[#C9A84C]/40 hover:bg-[#C9A84C]/25 transition-colors",
        "disabled:opacity-50",
      )}
    >
      <span aria-hidden="true">{DIR_GLYPH[dir]}</span>
    </button>
  );
}
