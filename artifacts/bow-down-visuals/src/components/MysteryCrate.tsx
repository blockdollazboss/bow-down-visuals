import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Timer, Sparkles, X, Gift, Loader2, Package } from "lucide-react";
import { DraggableWidget } from "@/components/draggable-widget";

interface BoxPrize {
  credits: number;
  label: string;
  isJackpot: boolean;
}

interface BonusStatus {
  streak: number;
  canClaimDaily: boolean;
  dailyBonusBase: number;
  bonusCredits: number;
  wheelCooldownSeconds: number;
  wheelSegments: BoxPrize[];
}

type BoxPhase = "closed" | "shaking" | "opening" | "revealed";

/**
 * Thy Cheat Code's Mystery Crate. A golden crate floats bottom-left on every
 * page (when signed in); tapping it pops up the hourly mystery crate modal.
 * Tap the crate → it shakes → bursts open with golden light → prize revealed.
 * Uses the same /api/bonus/spin-wheel backend (weighted random prize).
 */
export function MysteryCrate() {
  const { user, getAccessToken } = useAuth();
  const [location] = useLocation();

  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<BonusStatus | null>(null);
  const [phase, setPhase] = useState<BoxPhase>("closed");
  const [result, setResult] = useState<{ prize: number; isJackpot: boolean } | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [loadError, setLoadError] = useState(false);
  const [claimedMessage, setClaimedMessage] = useState<string | null>(null);

  const hidden = !user || location.startsWith("/login") || location.startsWith("/signup") || location.startsWith("/video-editor");

  async function api(path: string, opts?: RequestInit) {
    const token = await getAccessToken();
    const res = await fetch(path, {
      ...opts,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(opts?.headers || {}) },
    });
    if (!res.ok) throw new Error(`Request failed: ${res.status} ${path}`);
    return res.json();
  }

  const loadStatus = useCallback(async () => {
    if (!user) return;
    try {
      const s: BonusStatus = await api("/api/bonus/status");
      setStatus(s);
      setCooldown(s.wheelCooldownSeconds);
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }, [user]);

  useEffect(() => {
    loadStatus();
    const t = setInterval(loadStatus, 60_000);
    return () => clearInterval(t);
  }, [loadStatus]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  useEffect(() => {
    if (open) {
      setResult(null);
      setPhase("closed");
      loadStatus();
    }
  }, [open, loadStatus]);

  function formatCooldown(s: number): string {
    if (s >= 3600) {
      const h = Math.floor(s / 3600);
      const m = Math.floor((s % 3600) / 60);
      return `${h}h ${m}m`;
    }
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, "0")}`;
  }

  function formatCompact(s: number): string {
    if (s >= 3600) return `${Math.floor(s / 3600)}h`;
    if (s >= 60) return `${Math.floor(s / 60)}m`;
    return `${s}s`;
  }

  async function handleOpen() {
    if (cooldown > 0) return;
    // From "revealed", a tap on "Open Another Crate" means "try again":
    // reset the crate visual first. The server still enforces the hourly
    // cap, and the 429 path below surfaces it as an "already claimed" note.
    if (phase !== "closed" && phase !== "revealed") return;
    setPhase("shaking");
    setResult(null);
    setClaimedMessage(null);
    try {
      // Fetch directly (not via api()) so a 429 "already claimed" still
      // yields its JSON body — api() throws on !ok before we can read it.
      const token = await getAccessToken();
      const res = await fetch("/api/bonus/spin-wheel", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      });
      const r = await res.json().catch(() => ({}));
      if (res.ok && r.spun) {
        // Shake for suspense, then burst open
        setTimeout(() => setPhase("opening"), 1200);
        setTimeout(() => {
          setResult({ prize: r.prize, isJackpot: r.isJackpot });
          setPhase("revealed");
          loadStatus();
        }, 2200);
      } else if (r.spun === false || res.status === 429) {
        setPhase("closed");
        // Someone else claimed this hour's crate — tell the user instead of silently doing nothing
        setClaimedMessage("Someone beat you to this hour's crate! Try again next hour.");
        // Backend sends nextHourIn (seconds until next UTC hour); fall back to cooldownSeconds, then 1h
        const wait = typeof r.nextHourIn === "number" ? r.nextHourIn
          : typeof r.cooldownSeconds === "number" ? r.cooldownSeconds
          : 3600;
        setCooldown(wait);
      } else {
        throw new Error(`spin failed: ${res.status}`);
      }
    } catch {
      setPhase("closed");
      setClaimedMessage("Couldn't open the crate. Check your connection and try again.");
    }
  }

  function renderCrate() {
    const isShaking = phase === "shaking";
    const isOpening = phase === "opening" || phase === "revealed";
    
    return (
      <div className="relative w-56 h-56 mx-auto">
        {/* Floating question marks — the mystery feel */}
        {!isOpening && (
          <>
            <span className="absolute top-2 left-8 text-2xl text-[#c9a84c]/60 animate-[float_2.5s_ease-in-out_infinite]">?</span>
            <span className="absolute top-6 right-6 text-xl text-[#c9a84c]/40 animate-[float_3s_ease-in-out_infinite] [animation-delay:0.5s]">?</span>
            <span className="absolute top-12 left-4 text-lg text-[#c9a84c]/30 animate-[float_2s_ease-in-out_infinite] [animation-delay:1s]">?</span>
          </>
        )}
        {/* Golden light burst when opening */}
        {isOpening && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="absolute w-40 h-40 bg-[#ffd700] rounded-full blur-3xl animate-ping opacity-60" />
            <div className="absolute w-32 h-64 bg-gradient-to-t from-transparent via-[#ffd700]/80 to-[#fff] blur-xl -top-16 animate-pulse" />
          </div>
        )}
        
        {/* The crate */}
        <div
          className={`relative w-full h-full transition-transform duration-300 ${
            isShaking ? "animate-[shake_0.12s_ease-in-out_infinite]" : ""
          }`}
          style={{
            animation: isShaking ? undefined : "float 3s ease-in-out infinite",
          }}
        >
          {/* Crate body */}
          <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-44 h-32 bg-gradient-to-b from-[#8a6d2f] via-[#c9a84c] to-[#6b5320] rounded-lg border-4 border-[#3a2f0f] shadow-[0_0_40px_rgba(201,168,76,0.4)]">
            {/* Wood planks */}
            <div className="absolute inset-2 flex flex-col justify-between opacity-30">
              <div className="h-px bg-black" />
              <div className="h-px bg-black" />
              <div className="h-px bg-black" />
            </div>
            {/* Gold bands */}
            <div className="absolute left-2 top-0 bottom-0 w-3 bg-gradient-to-b from-[#ffd700] to-[#8a6d2f] border-x border-[#3a2f0f]" />
            <div className="absolute right-2 top-0 bottom-0 w-3 bg-gradient-to-b from-[#ffd700] to-[#8a6d2f] border-x border-[#3a2f0f]" />
            {/* Visual Bucs emblem */}
            <div className="absolute inset-0 flex items-center justify-center">
              <img
                src="/images/visual-bucs-icon.webp"
                alt="Visual Bucs"
                className="h-16 w-16 object-contain drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]"
                draggable={false}
              />
            </div>
            {/* Lock */}
            {!isOpening && (
              <div className="absolute -top-3 left-1/2 -translate-x-1/2 w-10 h-8 bg-gradient-to-b from-[#ffd700] to-[#8a6d2f] rounded border-2 border-[#3a2f0f] flex items-center justify-center">
                <div className="w-3 h-3 bg-[#1a1a1a] rounded-full" />
              </div>
            )}
          </div>
          
          {/* Crate lid */}
          <div
            className={`absolute left-1/2 -translate-x-1/2 w-48 h-10 bg-gradient-to-b from-[#e8c766] via-[#c9a84c] to-[#8a6d2f] rounded-t-lg border-4 border-b-0 border-[#3a2f0f] transition-transform duration-500 origin-bottom ${
              isOpening ? "-translate-y-8 -rotate-12 opacity-90" : "bottom-32"
            }`}
            style={{ bottom: isOpening ? undefined : "8rem" }}
          >
            <div className="absolute inset-x-4 top-1/2 -translate-y-1/2 h-1 bg-[#3a2f0f]/40 rounded" />
          </div>
          
          {/* Light spilling out when open */}
          {isOpening && (
            <div className="absolute bottom-32 left-1/2 -translate-x-1/2 w-40 h-24 bg-gradient-to-t from-[#ffd700] to-transparent blur-md animate-pulse" />
          )}
        </div>
        
        {/* Prize reveal */}
        {phase === "revealed" && result && (
          <div className="absolute -top-8 left-1/2 -translate-x-1/2 animate-[popIn_0.5s_ease-out]">
            <div className={`px-6 py-3 rounded-xl border-2 font-bold text-2xl whitespace-nowrap shadow-[0_0_30px_rgba(255,215,0,0.6)] ${
              result.isJackpot
                ? "bg-[#ffd700] text-black border-[#fff] animate-pulse"
                : "bg-black text-[#ffd700] border-[#c9a84c]"
            }`}>
              {result.isJackpot ? "🏆 JACKPOT!" : `+${result.prize.toLocaleString()}`}
            </div>
            {result.isJackpot && (
              <p className="text-[#ffd700] font-bold mt-1">+{result.prize.toLocaleString()} Bucs!</p>
            )}
          </div>
        )}
      </div>
    );
  }

  if (hidden) return null;

  const prizes = status?.wheelSegments ?? [];
  const prizesLoaded = prizes.length > 0;
  const ready = cooldown <= 0 && phase === "closed" && prizesLoaded;

  return (
    <>
      {/* Floating button — draggable */}
      <DraggableWidget id="mystery-crate-button" defaultAnchor={{ x: 0.06, y: 0.92 }} zIndex={40}>
        <button
          onClick={() => setOpen(true)}
          aria-label="Open mystery crate"
          className={`w-16 h-16 rounded-2xl flex items-center justify-center shadow-lg transition-transform hover:scale-105 active:scale-95 ${
            ready
              ? "bg-gradient-to-br from-[#ffd700] to-[#8a6d2f] animate-[pulse_1.6s_ease-in-out_infinite] shadow-[0_0_24px_rgba(255,215,0,0.55)] border-2 border-[#fff]/30"
              : "bg-gradient-to-br from-[#3a3a3a] to-[#1a1a1a] border border-[#c9a84c]/50"
          }`}
        >
          {ready ? (
            <Package className="h-7 w-7 text-black" />
          ) : loadError ? (
            <Package className="h-7 w-7 text-[#c9a84c]/60" />
          ) : (
            <span className="text-[#c9a84c] text-[11px] font-bold leading-tight text-center px-1">
              {formatCompact(cooldown)}
            </span>
          )}
          {ready && (
            <span className="absolute -top-1 -right-1 bg-red-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
              OPEN
            </span>
          )}
        </button>
      </DraggableWidget>

      {/* Popup modal */}
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <div
            className="relative w-full max-w-md rounded-2xl border border-[#c9a84c]/40 bg-[#0d0d0d] p-6 text-center shadow-[0_0_60px_rgba(201,168,76,0.25)]"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setOpen(false)}
              aria-label="Close"
              className="absolute top-3 right-3 text-muted-foreground hover:text-white"
            >
              <X className="h-5 w-5" />
            </button>

            <h2 className="text-2xl font-bold text-[#c9a84c] mb-1">📦 Mystery Crate</h2>
            <p className="text-sm text-muted-foreground mb-4">
              Free crate every hour. Every crate holds Visual Bucs.
            </p>

            {status?.canClaimDaily && (
              <p className="text-xs text-[#e8c766] mb-3 flex items-center justify-center gap-1">
                <Gift className="h-3.5 w-3.5" /> Your daily bonus is also ready — claim it from the popup after login.
              </p>
            )}

            <div className="mb-6 mt-8">
              {prizesLoaded ? (
                renderCrate()
              ) : loadError ? (
                <div className="w-56 h-56 mx-auto rounded-2xl border-4 border-[#c9a84c]/30 flex flex-col items-center justify-center gap-3 p-8">
                  <p className="text-sm text-muted-foreground">
                    Couldn't load the Mystery Crate. Check your connection and try again.
                  </p>
                  <Button
                    onClick={() => loadStatus()}
                    variant="outline"
                    size="sm"
                    className="border-[#c9a84c]/50 text-[#c9a84c] hover:bg-[#c9a84c]/10 hover:text-[#e8c766]"
                  >
                    Try again
                  </Button>
                </div>
              ) : (
                <div className="w-56 h-56 mx-auto flex items-center justify-center">
                  <Loader2 className="h-10 w-10 text-[#c9a84c] animate-spin" />
                </div>
              )}
            </div>

            {phase === "revealed" && result && !result.isJackpot && (
              <div className="mb-4 p-3 rounded-lg bg-[#c9a84c]/10 border border-[#c9a84c]/40">
                <p className="text-xl font-bold text-[#c9a84c]">+{result.prize.toLocaleString()} Visual Bucs!</p>
              </div>
            )}

            {claimedMessage && (
              <div className="mb-4 p-3 rounded-lg bg-amber-500/10 border border-amber-500/40">
                <p className="text-sm font-bold text-amber-600 dark:text-amber-400">{claimedMessage}</p>
              </div>
            )}

            <Button
              onClick={handleOpen}
              disabled={!ready}
              size="lg"
              className="bg-[#c9a84c] text-black hover:bg-[#e8c766] text-lg px-8 py-5 w-full"
            >
              {phase === "shaking" ? (
                <><Sparkles className="h-5 w-5 mr-2 animate-spin" /> Shaking…</>
              ) : phase === "opening" ? (
                <><Sparkles className="h-5 w-5 mr-2 animate-pulse" /> Opening…</>
              ) : !prizesLoaded ? (
                <><Loader2 className="h-5 w-5 mr-2 animate-spin" /> Loading…</>
              ) : cooldown > 0 ? (
                <><Timer className="h-5 w-5 mr-2" /> Next crate in {formatCooldown(cooldown)}</>
              ) : phase === "revealed" ? (
                <><Package className="h-5 w-5 mr-2" /> Open Another Crate</>
              ) : (
                <><Package className="h-5 w-5 mr-2" /> OPEN THE CRATE</>
              )}
            </Button>

            {status && status.bonusCredits > 0 && (
              <p className="text-xs text-muted-foreground mt-3">
                Bonus balance: {status.bonusCredits.toLocaleString()} Bucs
              </p>
            )}
          </div>
        </div>
      )}

      <style>{`
        @keyframes shake {
          0%, 100% { transform: translateX(0) rotate(0); }
          25% { transform: translateX(-4px) rotate(-2deg); }
          75% { transform: translateX(4px) rotate(2deg); }
        }
        @keyframes float {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-8px); }
        }
        @keyframes popIn {
          0% { transform: translateX(-50%) scale(0.3); opacity: 0; }
          60% { transform: translateX(-50%) scale(1.15); opacity: 1; }
          100% { transform: translateX(-50%) scale(1); opacity: 1; }
        }
      `}</style>
    </>
  );
}
