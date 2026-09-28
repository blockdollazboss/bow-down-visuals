import { useEffect, useState, useRef, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { usePageTitle } from "@/hooks/use-page-title";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Flame, Gift, Timer, Sparkles, Trophy } from "lucide-react";

interface WheelSegment {
  credits: number;
  label: string;
  isJackpot: boolean;
}

interface BonusStatus {
  streak: number;
  canClaimDaily: boolean;
  dailyBonusBase: number;
  dailyBonusMilestone: number;
  bonusCredits: number;
  bonusExpiresAt: string | null;
  wheelCooldownSeconds: number;
  wheelSegments: WheelSegment[];
}

const SEGMENT_COLORS = ["#c9a84c", "#1a1a1a", "#e8c766", "#2a2a2a", "#c9a84c", "#1a1a1a", "#ffd700"];

export default function WheelPage() {
  usePageTitle("Jackpot Wheel", "Spin the hourly jackpot wheel and claim your daily bonus.");
  const { getAccessToken } = useAuth();

  const [status, setStatus] = useState<BonusStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [spinning, setSpinning] = useState(false);
  const [rotation, setRotation] = useState(0);
  const [result, setResult] = useState<{ prize: number; isJackpot: boolean } | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [claimResult, setClaimResult] = useState<{ streak: number; bonus: number; milestone: boolean } | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const wheelRef = useRef<HTMLDivElement>(null);

  async function api(path: string, opts?: RequestInit) {
    const token = await getAccessToken();
    const res = await fetch(path, {
      ...opts,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(opts?.headers || {}) },
    });
    return res.json();
  }

  const loadStatus = useCallback(async () => {
    try {
      const s: BonusStatus = await api("/api/bonus/status");
      setStatus(s);
      setCooldown(s.wheelCooldownSeconds);
    } catch { /* silent */ }
    setLoading(false);
  }, []);

  useEffect(() => { loadStatus(); }, [loadStatus]);

  // Cooldown countdown
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  function formatCooldown(s: number): string {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, "0")}`;
  }

  async function handleClaimDaily() {
    setClaiming(true);
    try {
      const r = await api("/api/bonus/claim-daily", { method: "POST" });
      if (r.claimed) {
        setClaimResult({ streak: r.streak, bonus: r.bonusGranted, milestone: r.isStreakMilestone });
      }
      await loadStatus();
    } catch { /* silent */ }
    setClaiming(false);
  }

  async function handleSpin() {
    if (spinning || cooldown > 0) return;
    setSpinning(true);
    setResult(null);
    try {
      const r = await api("/api/bonus/spin-wheel", { method: "POST" });
      if (r.spun) {
        // Animate: spin 5 full turns + land on a random offset, then show result.
        // The visual landing position is decorative; the server decided the prize.
        const segments = status?.wheelSegments || [];
        const segIndex = segments.findIndex((s) => s.credits === r.prize);
        const segAngle = 360 / segments.length;
        // Pointer at top (0deg). Target: center of winning segment at top.
        const targetOffset = 360 - (segIndex * segAngle + segAngle / 2);
        const newRotation = rotation + 360 * 5 + ((targetOffset - (rotation % 360) + 360) % 360);
        setRotation(newRotation);
        // Show result after animation completes
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
                fontSize={seg.isJackpot ? 13 : 16}
                fontWeight="bold"
                transform={`rotate(${(i * segAngle + segAngle / 2)} ${tx} ${ty})`}
              >
                {seg.isJackpot ? "★ JP ★" : seg.label}
              </text>
            </g>
          );
        })}
        <circle cx={cx} cy={cy} r={22} fill="#0a0a0a" stroke="#c9a84c" strokeWidth="3" />
        <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle" fill="#c9a84c" fontSize="20">🦈</text>
      </svg>
    );
  }

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center"><p className="text-[#c9a84c]">Loading…</p></div>;
  }

  return (
    <div className="min-h-screen px-4 py-8 max-w-4xl mx-auto">
      <div className="text-center mb-8">
        <h1 className="text-3xl md:text-4xl font-bold text-[#c9a84c] mb-2">🎡 Jackpot Wheel</h1>
        <p className="text-muted-foreground">Free spin every hour. Every spin wins Visual Bucs.</p>
      </div>

      {/* Daily bonus card */}
      <Card className="p-6 mb-6 border-[#c9a84c]/30 bg-black/40">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-full bg-[#c9a84c]/15">
              <Flame className="h-6 w-6 text-[#c9a84c]" />
            </div>
            <div>
              <p className="font-semibold text-lg">
                {status?.streak ? `${status.streak}-day streak 🔥` : "Start your streak"}
              </p>
              <p className="text-sm text-muted-foreground">
                Day 7, 14, 21… pays {status?.dailyBonusMilestone} bonus Bucs
              </p>
            </div>
          </div>
          {claimResult ? (
            <div className="text-center px-6 py-3 rounded-lg bg-[#c9a84c]/15 border border-[#c9a84c]/40">
              <p className="text-2xl font-bold text-[#c9a84c]">+{claimResult.bonus} Bucs!</p>
              <p className="text-xs text-muted-foreground">
                {claimResult.milestone ? "🏆 Streak milestone!" : `${claimResult.streak}-day streak`}
              </p>
            </div>
          ) : status?.canClaimDaily ? (
            <Button onClick={handleClaimDaily} disabled={claiming} className="bg-[#c9a84c] text-black hover:bg-[#e8c766]">
              <Gift className="h-4 w-4 mr-2" />
              {claiming ? "Claiming…" : `Claim ${status.dailyBonusBase} Bucs`}
            </Button>
          ) : (
            <p className="text-sm text-muted-foreground">✅ Claimed today — come back tomorrow</p>
          )}
        </div>
        {status && status.bonusCredits > 0 && (
          <p className="text-xs text-muted-foreground mt-3">
            Bonus balance: {status.bonusCredits} Bucs
            {status.bonusExpiresAt && ` (expires ${new Date(status.bonusExpiresAt).toLocaleString()})`}
          </p>
        )}
      </Card>

      {/* Wheel */}
      <Card className="p-8 border-[#c9a84c]/30 bg-black/40 text-center">
        <div className="relative w-72 h-72 md:w-80 md:h-80 mx-auto mb-6">
          {/* Pointer */}
          <div className="absolute -top-2 left-1/2 -translate-x-1/2 z-10">
            <div className="w-0 h-0 border-l-[12px] border-r-[12px] border-t-[20px] border-l-transparent border-r-transparent border-t-[#c9a84c]" />
          </div>
          <div
            ref={wheelRef}
            className="w-full h-full rounded-full border-4 border-[#c9a84c] shadow-[0_0_40px_rgba(201,168,76,0.3)]"
            style={{
              transform: `rotate(${rotation}deg)`,
              transition: spinning ? "transform 4s cubic-bezier(0.15, 0.85, 0.25, 1)" : "none",
            }}
          >
            {renderWheel()}
          </div>
        </div>

        {result ? (
          <div className={`mb-6 p-4 rounded-lg ${result.isJackpot ? "bg-[#ffd700]/20 border-2 border-[#ffd700] animate-pulse" : "bg-[#c9a84c]/10 border border-[#c9a84c]/40"}`}>
            {result.isJackpot ? (
              <p className="text-3xl font-bold text-[#ffd700]">🏆 JACKPOT! +{result.prize} Bucs! 🏆</p>
            ) : (
              <p className="text-2xl font-bold text-[#c9a84c]">+{result.prize} Visual Bucs!</p>
            )}
          </div>
        ) : null}

        <Button
          onClick={handleSpin}
          disabled={spinning || cooldown > 0}
          size="lg"
          className="bg-[#c9a84c] text-black hover:bg-[#e8c766] text-lg px-10 py-6"
        >
          {spinning ? (
            <><Sparkles className="h-5 w-5 mr-2 animate-spin" /> Spinning…</>
          ) : cooldown > 0 ? (
            <><Timer className="h-5 w-5 mr-2" /> Next spin in {formatCooldown(cooldown)}</>
          ) : (
            <><Trophy className="h-5 w-5 mr-2" /> SPIN THE WHEEL</>
          )}
        </Button>

        <div className="mt-6 flex flex-wrap justify-center gap-2">
          {status?.wheelSegments.map((seg, i) => (
            <span
              key={i}
              className={`text-xs px-3 py-1 rounded-full border ${seg.isJackpot ? "border-[#ffd700] text-[#ffd700] font-bold" : "border-[#c9a84c]/30 text-muted-foreground"}`}
            >
              {seg.isJackpot ? `★ Jackpot ${seg.label}` : seg.label}
            </span>
          ))}
        </div>
      </Card>
    </div>
  );
}
