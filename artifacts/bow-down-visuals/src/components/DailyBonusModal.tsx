import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Flame, Gift, X } from "lucide-react";

/* ── Daily bonus claim modal ────────────────────────────────────────────
 Shows once per session when the user has an unclaimed daily bonus.
 Dismissable; the bonus stays claimable from the /wheel page. */

export function DailyBonusModal() {
 const { user, getAccessToken } = useAuth();
 const [visible, setVisible] = useState(false);
 const [streak, setStreak] = useState(0);
 const [claiming, setClaiming] = useState(false);
 const [claimed, setClaimed] = useState<{ bonus: number; streak: number; milestone: boolean } | null>(null);
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
 setClaimed({ bonus: r.bonusGranted, streak: r.streak, milestone: r.isStreakMilestone });
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

 return (
 <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
 <div className="relative w-full max-w-sm rounded-2xl border-2 border-[#c9a84c] bg-gradient-to-b from-[#1a1a1a] to-black p-8 text-center shadow-[0_0_60px_rgba(201,168,76,0.4)] animate-[fadeSlideIn_0.5s_ease-out]">
 <button
 onClick={() => setVisible(false)}
 className="absolute top-3 right-3 text-muted-foreground hover:text-white"
 aria-label="Dismiss"
 >
 <X className="h-5 w-5" />
 </button>

 {claimed ? (
 <>
 <div className="text-6xl mb-4">🎉</div>
 <h2 className="text-2xl font-bold text-[#c9a84c] mb-2">+{claimed.bonus.toLocaleString("en-US")} Visual Bucs!</h2>
 <p className="text-sm text-muted-foreground mb-1">
 {claimed.milestone ? "🏆 7-day streak milestone!" : `${claimed.streak}-day streak 🔥`}
 </p>
 <p className="text-xs text-muted-foreground mb-6">Bonus Bucs expire in 48 hours — go create something!</p>
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
