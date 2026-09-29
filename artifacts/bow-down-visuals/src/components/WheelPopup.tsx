import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Timer, Sparkles, Trophy, X, Gift } from "lucide-react";
import { DraggableWidget } from "@/components/draggable-widget";

interface WheelSegment {
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
  wheelSegments: WheelSegment[];
}

const SEGMENT_COLORS = ["#c9a84c", "#1a1a1a", "#e8c766", "#2a2a2a", "#c9a84c", "#1a1a1a", "#ffd700"];

/**
 * Floating jackpot wheel widget. A gold circular button floats bottom-left
 * on every page (when signed in); tapping it pops up the hourly wheel modal.
 */
export function WheelPopup() {
  const { user, getAccessToken } = useAuth();
  const [location] = useLocation();

  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<BonusStatus | null>(null);
  const [spinning, setSpinning] = useState(false);
  const [rotation, setRotation] = useState(0);
  const [result, setResult] = useState<{ prize: number; isJackpot: boolean } | null>(null);
  const [cooldown, setCooldown] = useState(0);

  // Hide on auth pages and when signed out
  const hidden = !user || location.startsWith("/login") || location.startsWith("/signup");

  async function api(path: string, opts?: RequestInit) {
    const token = await getAccessToken();
    const res = await fetch(path, {
      ...opts,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(opts?.headers || {}) },
    });
    return res.json();
  }

  const loadStatus = useCallback(async () => {
    if (!user) return;
    try {
      const s: BonusStatus = await api("/api/bonus/status");
      setStatus(s);
      setCooldown(s.wheelCooldownSeconds);
    } catch { /* silent */ }
  }, [user]);

  // Load on mount + refresh every minute so the floating button state stays fresh
  useEffect(() => {
    loadStatus();
    const t = setInterval(loadStatus, 60_000);
    return () => clearInterval(t);
  }, [loadStatus]);

  // Cooldown countdown
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  // Refresh status when the popup opens
  useEffect(() => {
    if (open) {
      setResult(null);
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

  async function handleSpin() {
    if (spinning || cooldown > 0) return;
    setSpinning(true);
    setResult(null);
    try {
      const r = await api("/api/bonus/spin-wheel", { method: "POST" });
      if (r.spun) {
        const segments = status?.wheelSegments || [];
        const segIndex = Math.max(0, segments.findIndex((s) => s.credits === r.prize));
        const segAngle = 360 / segments.length;
        const targetOffset = 360 - (segIndex * segAngle + segAngle / 2);
        const newRotation = rotation + 360 * 5 + ((targetOffset - (rotation % 360) + 360) % 360);
        setRotation(newRotation);
        setTimeout(() => {
          setResult({ prize: r.prize, isJackpot: r.isJackpot });
          setSpinning(false);
          loadStatus();
        }, 4200);
      } else {
        setSpinning(false);
        if (r.cooldownSeconds) setCooldown(r.cooldownSeconds);
      }
    } catch {
      setSpinning(false);
    }
  }

  function renderWheel() {
    const segments = status?.wheelSegments || [];
    const n = segments.length;
    if (n === 0) return null;
    const segAngle = 360 / n;
    const cx = 150, cy = 150, r = 140;

    return (
      <svg viewBox="0 0 300 300" className="w-full h-full">
        {segments.map((seg, i) => {
          const startAngle = (i * segAngle - 90) * (Math.PI / 180);
          const endAngle = ((i + 1) * segAngle - 90) * (Math.PI / 180);
          const x1 = cx + r * Math.cos(startAngle);
          const y1 = cy + r * Math.sin(startAngle);
          const x2 = cx + r * Math.cos(endAngle);
          const y2 = cy + r * Math.sin(endAngle);
          const largeArc = segAngle > 180 ? 1 : 0;
          const midAngle = (startAngle + endAngle) / 2;
          const tx = cx + (r * 0.62) * Math.cos(midAngle);
          const ty = cy + (r * 0.62) * Math.sin(midAngle);
          const color = SEGMENT_COLORS[i % SEGMENT_COLORS.length];
          const textColor = color === "#1a1a1a" || color === "#2a2a2a" ? "#c9a84c" : "#1a1a1a";
          return (
            <g key={i}>
              <path
                d={`M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} Z`}
                fill={color}
                stroke="#0a0a0a"
                strokeWidth="2"
              />
              <text
                x={tx}
                y={ty}
                textAnchor="middle"
                dominantBaseline="middle"
                fill={textColor}
                fontSize={seg.isJackpot ? 12 : 15}
                fontWeight="bold"
                transform={`rotate(${(i * segAngle + segAngle / 2)} ${tx} ${ty})`}
              >
                {seg.isJackpot ? "★ JP ★" : seg.label}
              </text>
            </g>
          );
        })}
        <circle cx={cx} cy={cy} r={22} fill="#0a0a0a" stroke="#c9a84c" strokeWidth="3" />
        <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle" fontSize="20">🦈</text>
      </svg>
    );
  }

  if (hidden) return null;

  const ready = cooldown <= 0 && !spinning;

  return (
    <>
      {/* Floating button — draggable, snaps to 40-position grid */}
      <DraggableWidget id="wheel-button" defaultAnchor={{ x: 0.06, y: 0.92 }} zIndex={40}>
        <button
          onClick={() => setOpen(true)}
          aria-label="Open jackpot wheel"
          className={`w-16 h-16 rounded-full flex items-center justify-center shadow-lg transition-transform hover:scale-105 active:scale-95 ${
          ready
            ? "bg-gradient-to-br from-[#ffd700] to-[#c9a84c] animate-[pulse_1.6s_ease-in-out_infinite] shadow-[0_0_24px_rgba(255,215,0,0.55)]"
            : "bg-gradient-to-br from-[#3a3a3a] to-[#1a1a1a] border border-[#c9a84c]/50"
        }`}
      >
        {ready ? (
          <Trophy className="h-7 w-7 text-black" />
        ) : (
          <span className="text-[#c9a84c] text-[11px] font-bold leading-tight text-center px-1">
            {formatCompact(cooldown)}
          </span>
        )}
        {ready && (
          <span className="absolute -top-1 -right-1 bg-red-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
            SPIN
          </span>
        )}
        </button>
      </DraggableWidget>

      {/* Popup modal */}
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
          onClick={() => !spinning && setOpen(false)}
        >
          <div
            className="relative w-full max-w-md rounded-2xl border border-[#c9a84c]/40 bg-[#0d0d0d] p-6 text-center shadow-[0_0_60px_rgba(201,168,76,0.25)]"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => !spinning && setOpen(false)}
              aria-label="Close"
              className="absolute top-3 right-3 text-muted-foreground hover:text-white"
            >
              <X className="h-5 w-5" />
            </button>

            <h2 className="text-2xl font-bold text-[#c9a84c] mb-1">🎡 Jackpot Wheel</h2>
            <p className="text-sm text-muted-foreground mb-4">
              Free spin every hour. Every spin wins Visual Bucs.
            </p>

            {status?.canClaimDaily && (
              <p className="text-xs text-[#e8c766] mb-3 flex items-center justify-center gap-1">
                <Gift className="h-3.5 w-3.5" /> Your daily bonus is also ready — claim it from the popup after login.
              </p>
            )}

            <div className="relative w-64 h-64 mx-auto mb-4">
              <div className="absolute -top-2 left-1/2 -translate-x-1/2 z-10">
                <div className="w-0 h-0 border-l-[10px] border-r-[10px] border-t-[16px] border-l-transparent border-r-transparent border-t-[#c9a84c]" />
              </div>
              <div
                className="w-full h-full rounded-full border-4 border-[#c9a84c] shadow-[0_0_40px_rgba(201,168,76,0.3)]"
                style={{
                  transform: `rotate(${rotation}deg)`,
                  transition: spinning ? "transform 4s cubic-bezier(0.15, 0.85, 0.25, 1)" : "none",
                }}
              >
                {renderWheel()}
              </div>
            </div>

            {result && (
              <div className={`mb-4 p-3 rounded-lg ${result.isJackpot ? "bg-[#ffd700]/20 border-2 border-[#ffd700] animate-pulse" : "bg-[#c9a84c]/10 border border-[#c9a84c]/40"}`}>
                {result.isJackpot ? (
                  <p className="text-2xl font-bold text-[#ffd700]">🏆 JACKPOT! +{result.prize} Bucs! 🏆</p>
                ) : (
                  <p className="text-xl font-bold text-[#c9a84c]">+{result.prize} Visual Bucs!</p>
                )}
              </div>
            )}

            <Button
              onClick={handleSpin}
              disabled={spinning || cooldown > 0}
              size="lg"
              className="bg-[#c9a84c] text-black hover:bg-[#e8c766] text-lg px-8 py-5 w-full"
            >
              {spinning ? (
                <><Sparkles className="h-5 w-5 mr-2 animate-spin" /> Spinning…</>
              ) : cooldown > 0 ? (
                <><Timer className="h-5 w-5 mr-2" /> Next spin in {formatCooldown(cooldown)}</>
              ) : (
                <><Trophy className="h-5 w-5 mr-2" /> SPIN THE WHEEL</>
              )}
            </Button>

            {status && status.bonusCredits > 0 && (
              <p className="text-xs text-muted-foreground mt-3">
                Bonus balance: {status.bonusCredits} Bucs
              </p>
            )}
          </div>
        </div>
      )}
    </>
  );
}
