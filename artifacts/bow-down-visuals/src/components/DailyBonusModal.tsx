import { useIsLightTheme } from "@/hooks/use-is-light-theme";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Flame, Gift, X, Check, Snowflake } from "lucide-react";
import ConfettiBurst from "@/components/artist/confetti-burst";

/* ── Daily bonus claim modal ────────────────────────────────────────────
 Shows once per session when the user has an unclaimed daily bonus.
 Dismissable; the bonus stays claimable from the /wheel page.
 Login streaks with teeth (2026-10-11):
 - 30-day rewards ladder (4 milestone rungs: 7 / 14 / 21 / 30)
 - gold confetti celebration on milestone claims
 - streak-freeze tokens: +1 at every 7-day milestone claim, auto-consumed
   when exactly one day is missed to preserve the streak. */

const LADDER_RUNGS = [7, 14, 21, 30] as const;

interface ClaimResult {
  bonus: number;
  streak: number;
  milestone: boolean;
  freezeUsed?: boolean;
  freezesEarned?: boolean;
  streakFreezes?: number;
}

type RungState = "claimed" | "claimable" | "locked";

export function DailyBonusModal() {
  const isLight = useIsLightTheme();
 const { t } = useTranslation();
 const { user, getAccessToken } = useAuth();
 const [visible, setVisible] = useState(false);
 const [streak, setStreak] = useState(0);
 const [canClaim, setCanClaim] = useState(false);
 const [streakFreezes, setStreakFreezes] = useState(0);
 const [milestoneBonus, setMilestoneBonus] = useState(1000);
 const [claiming, setClaiming] = useState(false);
 const [claimed, setClaimed] = useState<ClaimResult | null>(null);
 const [crateAvailable, setCrateAvailable] = useState<boolean | null>(null);
 const [crateClaiming, setCrateClaiming] = useState(false);
 const [crateResult, setCrateResult] = useState<{ prize?: number; alreadyClaimed?: boolean } | null>(null);

 useEffect(() => {
 if (!user) return;
 // Only check once per session.
 const checked = sessionStorage.getItem("bdv_bonus_checked");
 if (checked) return;
 sessionStorage.setItem("bdv_bonus_checked", "1");

 (async () => {
 try {
 const token = await getAccessToken();
 const res = await fetch("/api/bonus/status", {
 headers: { Authorization: `Bearer ${token}` },
 });
 const s = await res.json();
 // No auto-popup: user claims manually via the StreakWidget. We don't push free credits.
 if (s.canClaimDaily) {
 setStreak(s.streak || 0);
 setCanClaim(true);
 setStreakFreezes(s.streakFreezes || 0);
 if (s.dailyBonusMilestone) setMilestoneBonus(s.dailyBonusMilestone);
 }
 // Check hourly crate status too
 try {
 const cs = await fetch("/api/bonus/hourly-crate-status", {
 headers: { Authorization: `Bearer ${token}` },
 });
 const c = await cs.json();
 setCrateAvailable(!!c.available);
 } catch { /* silent */ }
 } catch { /* silent */ }
 })();
 }, [user]);

 async function handleCrateClaim() {
 setCrateClaiming(true);
 try {
 const token = await getAccessToken();
 const res = await fetch("/api/bonus/spin-wheel", {
 method: "POST",
 headers: { Authorization: `Bearer ${token}` },
 });
 const r = await res.json();
 if (r.spun) {
 setCrateResult({ prize: r.prize });
 setCrateAvailable(false);
 } else {
 setCrateResult({ alreadyClaimed: true });
 setCrateAvailable(false);
 }
 } catch { /* silent */ }
 setCrateClaiming(false);
 }

 async function handleClaim() {
 setClaiming(true);
 try {
 const token = await getAccessToken();
 const res = await fetch("/api/bonus/claim-daily", {
 method: "POST",
 headers: { Authorization: `Bearer ${token}` },
 });
 const r = await res.json();
 if (r.claimed) {
 setClaimed({
 bonus: r.bonusGranted,
 streak: r.streak,
 milestone: r.isStreakMilestone,
 freezeUsed: !!r.freezeUsed,
 freezesEarned: !!r.freezesEarned,
 streakFreezes: r.streakFreezes ?? 0,
 });
 setStreak(r.streak);
 setStreakFreezes(r.streakFreezes ?? 0);
 setCanClaim(false);
 } else {
 setVisible(false);
 }
 } catch { /* silent */ }
 setClaiming(false);
 }

 // Refresh bonus + crate status from the API
 async function refreshStatus() {
 try {
 const token = await getAccessToken();
 const res = await fetch("/api/bonus/status", {
 headers: { Authorization: `Bearer ${token}` },
 });
 const s = await res.json();
 setStreak(s.streak || 0);
 setCanClaim(!!s.canClaimDaily);
 setStreakFreezes(s.streakFreezes || 0);
 if (s.dailyBonusMilestone) setMilestoneBonus(s.dailyBonusMilestone);
 try {
 const cs = await fetch("/api/bonus/hourly-crate-status", {
 headers: { Authorization: `Bearer ${token}` },
 });
 const c = await cs.json();
 setCrateAvailable(!!c.available);
 } catch { /* silent */ }
 } catch { /* silent */ }
 }

 // Listen for manual open requests (from StreakWidget click)
 // Always refresh status on open so the modal never shows stale data.
 useEffect(() => {
 const open = () => {
 setClaimed(null);
 setCrateResult(null);
 setVisible(true);
 void refreshStatus();
 };
 window.addEventListener("bdv:open-bonus-modal", open);
 return () => window.removeEventListener("bdv:open-bonus-modal", open);
 }, []);

 if (!visible) return null;

 function rungState(days: number): RungState {
 if (streak >= days) return "claimed";
 if (canClaim && streak === days - 1) return "claimable";
 return "locked";
 }

 function renderLadder() {
 const progressPct = Math.min(streak, 30) / 30 * 100;
 return (
 <div className="mt-6 mb-1">
 <p className="text-[10px] font-black uppercase tracking-[0.25em] text-[#c9a84c]/70 mb-3">
 {t("retention.dailyBonus.ladderTitle", { defaultValue: "The 30-day climb" })}
 </p>
 <div className="relative">
 <div className="absolute left-[10%] right-[10%] top-4 h-[3px] rounded-full bg-white/10" />
 <div
 className="absolute left-[10%] top-4 h-[3px] rounded-full bg-gradient-to-r from-[#c9a84c] to-[#e8c766] transition-all duration-700"
 style={{ width: `calc(${progressPct * 0.8}% )` }}
 />
 <div className="relative flex justify-between">
 {LADDER_RUNGS.map((d) => {
 const st = rungState(d);
 return (
 <div key={d} className="flex w-16 flex-col items-center">
 <div
 className={
 "flex h-8 w-8 items-center justify-center rounded-full border-2 text-[11px] font-black " +
 (st === "claimed"
 ? "border-[#e8c766] bg-gradient-to-br from-[#c9a84c] to-[#e8c766] text-black shadow-[0_0_14px_rgba(201,168,76,0.6)]"
 : st === "claimable"
 ? "border-[#e8c766] bg-[#c9a84c]/15 text-[#e8c766] animate-pulse shadow-[0_0_14px_rgba(201,168,76,0.45)]"
 : "border-white/15 bg-white/[0.04] text-white/40")
 }
 aria-label={t("retention.dailyBonus.rungDay", { day: d, defaultValue: `Day ${d}` }) + (st === "claimed" ? " — claimed" : st === "claimable" ? " — claimable today" : " — locked")}
 >
 {st === "claimed" ? <Check className="h-4 w-4" /> : st === "claimable" ? <Gift className="h-4 w-4" /> : d}
 </div>
 <p className="mt-1.5 text-[10px] font-bold text-white/60">
 {t("retention.dailyBonus.rungDay", { day: d, defaultValue: `Day ${d}` })}
 </p>
 <p className="mt-0.5 text-center text-[9px] leading-tight text-[#c9a84c]/80">
 {d === 30
 ? t("retention.dailyBonus.rungLegend", { defaultValue: "👑 30-day legend" })
 : t("retention.dailyBonus.rungReward", { bonus: milestoneBonus.toLocaleString("en-US"), defaultValue: `🎁 ${milestoneBonus.toLocaleString("en-US")} VB · 🧊 +1 freeze` })}
 </p>
 </div>
 );
 })}
 </div>
 </div>
 {streakFreezes > 0 && (
 <p className="mt-3 flex items-center justify-center gap-1.5 text-[11px] font-bold text-[#9fd8ff]">
 <Snowflake className="h-3.5 w-3.5" />
 {t("retention.dailyBonus.freezesBanked", { count: streakFreezes, defaultValue: `🧊 ${streakFreezes} streak ${streakFreezes === 1 ? "freeze" : "freezes"} banked — miss a day and your chain survives` })}
 </p>
 )}
 </div>
 );
 }

 return (
 <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
 {claimed?.milestone && <ConfettiBurst count={110} />}
 <div className={`${isLight ? "relative w-full max-w-sm rounded-2xl border-2 border-[#c9a84c] bg-gradient-to-b from-[#F7ECD2] to-[#FCF7EA] p-8 text-center shadow-[0_0_60px_rgba(201,168,76,0.4)] animate-[fadeSlideIn_0.5s_ease-out] max-h-[92vh] overflow-y-auto" : "relative w-full max-w-sm rounded-2xl border-2 border-[#c9a84c] bg-gradient-to-b from-[#1a1a1a] to-black p-8 text-center shadow-[0_0_60px_rgba(201,168,76,0.4)] animate-[fadeSlideIn_0.5s_ease-out] max-h-[92vh] overflow-y-auto"}`}>
 <button
 onClick={() => setVisible(false)}
 className="absolute top-3 right-3 text-muted-foreground hover:text-white"
 aria-label="Dismiss"
 >
 <X className="h-5 w-5" />
 </button>

 {claimed ? (
 <>
 {claimed.milestone ? (
 <>
 <div className="text-6xl mb-3">🏆</div>
 <h2 className="text-2xl font-black text-transparent bg-clip-text bg-gradient-to-r from-[#e8c766] via-[#fff3c4] to-[#e8c766] mb-2">
 {t("retention.dailyBonus.milestoneHeadline", { days: claimed.streak, defaultValue: `🏆 ${claimed.streak}-day streak!` })}
 </h2>
 </>
 ) : (
 <div className="text-6xl mb-4">🎉</div>
 )}
 <h2 className={claimed.milestone ? "text-xl font-bold text-[#c9a84c] mb-2" : "text-2xl font-bold text-[#c9a84c] mb-2"}>
 +{claimed.bonus.toLocaleString("en-US")} Visual Bucs!
 </h2>
 <p className="text-sm text-muted-foreground mb-1">
 {claimed.milestone ? t("retention.dailyBonus.milestoneSub", { defaultValue: "Milestone bonus secured 🔥" }) : `${claimed.streak}-day streak 🔥`}
 </p>
 {claimed.freezesEarned && (
 <p className="mt-2 flex items-center justify-center gap-1.5 text-xs font-bold text-[#9fd8ff]">
 <Snowflake className="h-3.5 w-3.5" />
 {t("retention.dailyBonus.freezeEarned", { defaultValue: "🧊 +1 streak freeze earned — miss a day and your chain survives!" })}
 </p>
 )}
 {claimed.freezeUsed && (
 <p className="mt-2 flex items-center justify-center gap-1.5 text-xs font-bold text-[#9fd8ff]">
 <Snowflake className="h-3.5 w-3.5" />
 {t("retention.dailyBonus.freezeUsed", { streak: claimed.streak, defaultValue: `🧊 Streak freeze used — your ${claimed.streak}-day chain is saved!` })}
 </p>
 )}
 <p className="text-xs text-muted-foreground mb-6 mt-3">Bonus Bucs expire in 48 hours — go create something!</p>
 <Button onClick={() => setVisible(false)} className="bg-[#c9a84c] text-black hover:bg-[#e8c766] w-full">
 Let's Go
 </Button>
 </>
 ) : (
 <>
 <div className="text-6xl mb-4">🎁</div>
 <h2 className="text-2xl font-bold text-[#c9a84c] mb-2">Daily Bonus Ready!</h2>
 {streak > 0 && (
 <p className="flex items-center justify-center gap-1 text-sm text-[#c9a84c] mb-2">
 <Flame className="h-4 w-4" /> {streak}-day streak
 </p>
 )}
 <p className="text-sm text-muted-foreground mb-6">
 Claim your free Visual Bucs. Come back daily to build your streak — day 7 pays big!
 </p>
 <Button
 onClick={handleClaim}
 disabled={claiming}
 className="bg-[#c9a84c] text-black hover:bg-[#e8c766] w-full text-lg py-6"
 >
 <Gift className="h-5 w-5 mr-2" />
 {claiming ? "Claiming…" : "Claim Bonus"}
 </Button>
 {renderLadder()}
 {/* Hourly Mystery Crate — claim right here */}
 {crateAvailable !== null && (
 <div className="mt-4 rounded-xl border border-[#c9a84c]/30 bg-[#c9a84c]/5 p-3">
 {crateResult?.prize ? (
 <p className="text-sm font-bold text-[#c9a84c]">🎁 +{crateResult.prize.toLocaleString("en-US")} Visual Bucs from the Mystery Crate!</p>
 ) : crateResult?.alreadyClaimed ? (
 <p className="text-xs text-muted-foreground">This hour's crate was already claimed — try again next hour!</p>
 ) : crateAvailable ? (
 <Button
 onClick={handleCrateClaim}
 disabled={crateClaiming}
 className="bg-gradient-to-r from-[#c9a84c] to-[#e8c766] text-black hover:opacity-90 w-full"
 >
 {crateClaiming ? "Opening…" : "🎁 Open the Hourly Mystery Crate"}
 </Button>
 ) : (
 <p className="text-xs text-muted-foreground">Hourly crate claimed — next one in under an hour!</p>
 )}
 </div>
 )}
 </>
 )}
 </div>
 </div>
 );
}
