import { useEffect, useState } from "react";
import { Link } from "wouter";
import {
  Handshake, Loader2, Sparkles, ArrowRight, Target, PenLine,
  Briefcase, CalendarClock, BadgeDollarSign, CheckCircle2, Copy,
  Megaphone, Users, ChevronDown,
} from "lucide-react";
import { MarketingNav } from "@/components/MarketingNav";
import { SiteFooter } from "@/components/layout/footer";
import { useAuth } from "@/contexts/AuthContext";
import { OutOfCredits } from "@/components/OutOfCredits";
import { formatBudgetRange, daysLeftLabel } from "@/lib/sponsors";
import { CheatCodeName } from "@/components/pixel-headline";

/* ─── Sponsor Marketplace ───────────────────────────────────────────────
   Brands post paid sponsorship deals, creators apply with a pitch —
   Bow Down Visuals takes a cut of every closed deal.
   Money rules: browsing + applying are free (pure UI); posting a deal is
   5 credits; the AI pitch writer and AI deal matcher are 1 credit each. */

interface Deal {
  id: string;
  brandName: string;
  budgetMin: number;
  budgetMax: number;
  niche: string;
  deliverables: string;
  description: string;
  deadline: string;
  status: string;
  createdAt: string;
}

interface Match {
  dealId: string;
  brandName: string;
  score: number;
  why: string;
}

const POST_COST = 5;
const AI_COST = 1;
const TONES = ["professional", "bold", "friendly"] as const;

const inputClass =
  "w-full rounded-xl border border-white/10 bg-black/60 px-4 py-3 text-sm text-white placeholder:text-white/25 outline-none transition focus:border-primary/60 focus:ring-1 focus:ring-primary/40";

const sectionLabel =
  "mb-3 text-[11px] font-bold uppercase tracking-widest text-white/40";

function money(min: number, max: number): string {
  return formatBudgetRange(min, max);
}

function daysLeft(deadline: string): string {
  return daysLeftLabel(deadline);
}

export default function Sponsors() {
  const { user, getAccessToken, refreshProfile } = useAuth();

  const [deals, setDeals] = useState<Deal[]>([]);
  const [dealsLoading, setDealsLoading] = useState(true);
  const [dealsError, setDealsError] = useState<string | null>(null);

  // post-a-deal form
  const [showPostForm, setShowPostForm] = useState(false);
  const [brandName, setBrandName] = useState("");
  const [budgetMin, setBudgetMin] = useState("");
  const [budgetMax, setBudgetMax] = useState("");
  const [niche, setNiche] = useState("");
  const [deliverables, setDeliverables] = useState("");
  const [description, setDescription] = useState("");
  const [deadline, setDeadline] = useState("");
  const [posting, setPosting] = useState(false);

  // apply
  const [applyingTo, setApplyingTo] = useState<string | null>(null);
  const [pitch, setPitch] = useState("");
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState<Set<string>>(new Set());

  // AI pitch writer
  const [pitchDealId, setPitchDealId] = useState("");
  const [creatorName, setCreatorName] = useState("");
  const [creatorNiche, setCreatorNiche] = useState("");
  const [creatorFollowers, setCreatorFollowers] = useState("");
  const [creatorPlatforms, setCreatorPlatforms] = useState("");
  const [achievements, setAchievements] = useState("");
  const [tone, setTone] = useState<(typeof TONES)[number]>("professional");
  const [generatedPitch, setGeneratedPitch] = useState("");
  const [generatedSubject, setGeneratedSubject] = useState("");
  const [pitchLoading, setPitchLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  // AI deal matcher
  const [matchNiche, setMatchNiche] = useState("");
  const [matchFollowers, setMatchFollowers] = useState("");
  const [matchPlatforms, setMatchPlatforms] = useState("");
  const [matches, setMatches] = useState<Match[]>([]);
  const [matchNote, setMatchNote] = useState("");
  const [matchLoading, setMatchLoading] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);

  async function authHeaders(): Promise<Record<string, string>> {
    const token = await getAccessToken();
    return {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
  }

  function handle402(): boolean {
    setOutOfCredits(true);
    refreshProfile();
    return true;
  }

  async function loadDeals() {
    if (!user) {
      setDealsLoading(false);
      return;
    }
    setDealsLoading(true);
    setDealsError(null);
    try {
      const res = await fetch("/api/sponsors/deals", { headers: await authHeaders() });
      const data = (await res.json().catch(() => ({}))) as { deals?: Deal[]; error?: string };
      if (!res.ok) throw new Error(data.error || "Could not load deals.");
      setDeals(Array.isArray(data.deals) ? data.deals : []);
    } catch (err) {
      setDealsError(err instanceof Error ? err.message : "Could not load deals.");
    } finally {
      setDealsLoading(false);
    }
  }

  useEffect(() => {
    loadDeals();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  async function postDeal() {
    if (posting || !user) return;
    const min = parseInt(budgetMin || "0", 10) || 0;
    const max = parseInt(budgetMax || "0", 10) || 0;
    if (!brandName.trim() || !niche.trim() || !deliverables.trim() || !description.trim() || !deadline) {
      setError("Fill every field — brands that look legit close deals.");
      return;
    }
    if (max < min) {
      setError("Max budget has to be at least the min budget.");
      return;
    }
    setPosting(true);
    setError(null);
    setOutOfCredits(false);
    try {
      const res = await fetch("/api/sponsors/deals", {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({
          brandName: brandName.trim().slice(0, 120),
          budgetMin: min,
          budgetMax: max,
          niche: niche.trim().slice(0, 120),
          deliverables: deliverables.trim().slice(0, 500),
          description: description.trim().slice(0, 2000),
          deadline: new Date(deadline).toISOString(),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { deal?: Deal; error?: string; message?: string };
      if (res.status === 402 || data.error === "out_of_credits") {
        handle402();
        return;
      }
      if (!res.ok || !data.deal) throw new Error(data.message || data.error || "Could not post your deal.");
      setDeals((prev) => [data.deal!, ...prev]);
      setBrandName(""); setBudgetMin(""); setBudgetMax(""); setNiche("");
      setDeliverables(""); setDescription(""); setDeadline("");
      setShowPostForm(false);
      refreshProfile();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not post your deal.");
    } finally {
      setPosting(false);
    }
  }

  async function applyToDeal(dealId: string) {
    if (applying || !user || !pitch.trim()) return;
    setApplying(true);
    setError(null);
    try {
      const res = await fetch(`/api/sponsors/deals/${dealId}/apply`, {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({ pitch: pitch.trim().slice(0, 2000) }),
      });
      const data = (await res.json().catch(() => ({}))) as { success?: boolean; error?: string };
      if (!res.ok) throw new Error(data.error || "Could not send your application.");
      setApplied((prev) => new Set(prev).add(dealId));
      setApplyingTo(null);
      setPitch("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send your application.");
    } finally {
      setApplying(false);
    }
  }

  async function writePitch() {
    if (pitchLoading || !user) return;
    if (!pitchDealId) {
      setError("Pick the deal you're pitching for first.");
      return;
    }
    if (!creatorNiche.trim()) {
      setError("Tell the AI your niche so the pitch lands.");
      return;
    }
    setPitchLoading(true);
    setError(null);
    setOutOfCredits(false);
    try {
      const res = await fetch("/api/sponsors/pitch", {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({
          dealId: pitchDealId,
          creatorName: creatorName.trim().slice(0, 120),
          niche: creatorNiche.trim().slice(0, 120),
          followers: parseInt(creatorFollowers || "0", 10) || 0,
          platforms: creatorPlatforms.split(",").map((p) => p.trim()).filter(Boolean).slice(0, 5),
          achievements: achievements.trim().slice(0, 500),
          tone,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { pitch?: string; subject?: string; error?: string; message?: string };
      if (res.status === 402 || data.error === "out_of_credits") {
        handle402();
        return;
      }
      if (!res.ok || !data.pitch) throw new Error(data.message || data.error || "Pitch writer failed — try again.");
      setGeneratedPitch(data.pitch);
      setGeneratedSubject(data.subject || "");
      setCopied(false);
      refreshProfile();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Pitch writer failed — try again.");
    } finally {
      setPitchLoading(false);
    }
  }

  async function findMatches() {
    if (matchLoading || !user) return;
    if (!matchNiche.trim()) {
      setError("Tell the matcher your niche first.");
      return;
    }
    setMatchLoading(true);
    setError(null);
    setOutOfCredits(false);
    try {
      const res = await fetch("/api/sponsors/match", {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({
          niche: matchNiche.trim().slice(0, 120),
          followers: parseInt(matchFollowers || "0", 10) || 0,
          platforms: matchPlatforms.split(",").map((p) => p.trim()).filter(Boolean).slice(0, 5),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { matches?: Match[]; note?: string; error?: string; message?: string };
      if (res.status === 402 || data.error === "out_of_credits") {
        handle402();
        return;
      }
      if (!res.ok) throw new Error(data.message || data.error || "Matcher failed — try again.");
      setMatches(Array.isArray(data.matches) ? data.matches : []);
      setMatchNote(data.note || "");
      refreshProfile();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Matcher failed — try again.");
    } finally {
      setMatchLoading(false);
    }
  }

  function usePitchForApplication(dealId: string) {
    setApplyingTo(dealId);
    setPitch(generatedPitch);
    setTimeout(() => {
      document.getElementById(`apply-${dealId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 100);
  }

  function copyPitch() {
    navigator.clipboard.writeText(generatedPitch).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="min-h-screen bg-black text-white">
      <MarketingNav />

      <main className="relative mx-auto max-w-6xl px-5 pb-24 pt-14 md:pt-20">
        <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-center" aria-hidden="true">
          <div className="h-[280px] w-[560px] rounded-full bg-yellow-600/10 blur-[110px]" />
        </div>

        {/* hero */}
        <div className="relative text-center">
          <p className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-widest text-primary">
            <Handshake className="h-3 w-3" aria-hidden="true" /> <CheatCodeName possessive /> money tools
          </p>
          <h1 className="font-display text-4xl font-black tracking-tight md:text-5xl">
            Sponsor <span className="text-primary">Marketplace</span>
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-[15px] leading-relaxed text-white/55">
            Brands post paid deals. Creators pitch and get paid.
            Real money, real deliverables, real deadlines.
          </p>
        </div>

        {outOfCredits && (
          <div className="relative mx-auto mt-8 max-w-md"><OutOfCredits /></div>
        )}
        {error && !outOfCredits && (
          <p className="relative mx-auto mt-8 max-w-md rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {error}
          </p>
        )}

        {/* ── BROWSE DEALS ─────────────────────────────────────────── */}
        <div className="relative mt-12">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-primary/80">
              <Briefcase className="h-3.5 w-3.5" aria-hidden="true" /> Active deals · free to browse
            </p>
            {user && (
              <button
                onClick={() => setShowPostForm((v) => !v)}
                className="inline-flex items-center gap-1.5 rounded-full border border-primary/40 px-4 py-2 text-sm font-bold text-primary transition hover:bg-primary hover:text-black"
              >
                <Megaphone className="h-4 w-4" aria-hidden="true" />
                Post a deal ({POST_COST} credits)
                <ChevronDown className={`h-4 w-4 transition ${showPostForm ? "rotate-180" : ""}`} aria-hidden="true" />
              </button>
            )}
          </div>

          {/* post-a-deal form */}
          {showPostForm && user && (
            <div className="mb-6 rounded-3xl border border-primary/25 bg-gradient-to-b from-[#14100a] to-black p-6 md:p-8">
              <p className={sectionLabel}>Brand name</p>
              <input value={brandName} onChange={(e) => setBrandName(e.target.value)} maxLength={120}
                placeholder="e.g. Golden Audio" className={inputClass} />
              <div className="mt-4 grid grid-cols-2 gap-3">
                <div>
                  <p className={sectionLabel}>Min budget ($)</p>
                  <input value={budgetMin} onChange={(e) => setBudgetMin(e.target.value.replace(/[^0-9]/g, "").slice(0, 9))}
                    inputMode="numeric" placeholder="500" className={inputClass} />
                </div>
                <div>
                  <p className={sectionLabel}>Max budget ($)</p>
                  <input value={budgetMax} onChange={(e) => setBudgetMax(e.target.value.replace(/[^0-9]/g, "").slice(0, 9))}
                    inputMode="numeric" placeholder="2000" className={inputClass} />
                </div>
              </div>
              <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
                <div>
                  <p className={sectionLabel}>Creator niche needed</p>
                  <input value={niche} onChange={(e) => setNiche(e.target.value)} maxLength={120}
                    placeholder="e.g. Music, Gaming, Fitness" className={inputClass} />
                </div>
                <div>
                  <p className={sectionLabel}>Deadline</p>
                  <input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)}
                    className={`${inputClass} [color-scheme:dark]`} />
                </div>
              </div>
              <p className={`${sectionLabel} mt-4`}>Deliverables</p>
              <input value={deliverables} onChange={(e) => setDeliverables(e.target.value)} maxLength={500}
                placeholder="e.g. 1 TikTok + 2 stories" className={inputClass} />
              <p className={`${sectionLabel} mt-4`}>Description</p>
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} rows={3}
                placeholder="What the brand is about, what great looks like…" className={`${inputClass} resize-y`} />
              <div className="mt-6 text-center">
                <button
                  onClick={postDeal}
                  disabled={posting}
                  className="inline-flex items-center gap-2 rounded-2xl bg-gradient-to-br from-[#f5d67b] via-primary to-[#8a6d1f] px-8 py-3.5 text-base font-black text-black shadow-[0_4px_28px_rgba(212,175,55,0.4)] transition hover:scale-[1.03] active:scale-95 disabled:opacity-50"
                >
                  {posting ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> : <Megaphone className="h-5 w-5" aria-hidden="true" />}
                  {posting ? "Posting…" : `Post deal · ${POST_COST} credits`}
                </button>
              </div>
            </div>
          )}

          {/* deals grid */}
          {!user ? (
            <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-10 text-center">
              <p className="text-white/60">Sign in to browse live sponsor deals.</p>
              <Link href="/login"
                className="mt-4 inline-flex items-center gap-2 rounded-2xl border border-primary/50 bg-primary/10 px-6 py-3 font-bold text-primary transition hover:bg-primary hover:text-black">
                Sign in <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </div>
          ) : dealsLoading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-white/40">
              <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> Loading deals…
            </div>
          ) : dealsError ? (
            <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{dealsError}</p>
          ) : deals.length === 0 ? (
            <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-10 text-center">
              <Handshake className="mx-auto h-10 w-10 text-primary/60" aria-hidden="true" />
              <p className="mt-3 font-bold text-white">No active deals yet</p>
              <p className="mt-1 text-sm text-white/50">Be the first brand to post — or run the AI matcher below.</p>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {deals.map((d) => {
                const isApplied = applied.has(d.id);
                const isApplying = applyingTo === d.id;
                return (
                  <div key={d.id} id={`apply-${d.id}`}
                    className="rounded-3xl border border-white/10 bg-white/[0.03] p-6 transition hover:border-primary/30">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-lg font-black text-white">{d.brandName}</p>
                        <p className="mt-0.5 text-xs text-white/40">{d.niche}</p>
                      </div>
                      <span className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-sm font-black text-primary">
                        <BadgeDollarSign className="h-4 w-4" aria-hidden="true" />
                        {money(d.budgetMin, d.budgetMax)}
                      </span>
                    </div>
                    <p className="mt-3 text-sm leading-relaxed text-white/70">{d.description}</p>
                    <div className="mt-4 space-y-1.5 text-[13px] text-white/55">
                      <p><span className="font-semibold text-white/80">Deliverables: </span>{d.deliverables}</p>
                      <p className="inline-flex items-center gap-1.5">
                        <CalendarClock className="h-3.5 w-3.5 text-primary/70" aria-hidden="true" />
                        {daysLeft(d.deadline)}
                      </p>
                    </div>
                    <div className="mt-5">
                      {isApplied ? (
                        <p className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-4 py-2 text-sm font-bold text-emerald-300">
                          <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> Application sent
                        </p>
                      ) : isApplying ? (
                        <div>
                          <textarea value={pitch} onChange={(e) => setPitch(e.target.value)} maxLength={2000} rows={4}
                            placeholder="Your pitch to the brand… (or generate one with the AI pitch writer below)"
                            className={`${inputClass} resize-y`} />
                          <div className="mt-3 flex gap-2">
                            <button onClick={() => applyToDeal(d.id)} disabled={applying || !pitch.trim()}
                              className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-5 py-2.5 text-sm font-black text-black transition hover:brightness-110 disabled:opacity-50">
                              {applying ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <PenLine className="h-4 w-4" aria-hidden="true" />}
                              Send application · free
                            </button>
                            <button onClick={() => { setApplyingTo(null); setPitch(""); }}
                              className="rounded-xl border border-white/15 px-4 py-2.5 text-sm text-white/60 hover:text-white">
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button onClick={() => { setApplyingTo(d.id); setPitch(""); setError(null); }}
                          className="inline-flex items-center gap-1.5 rounded-xl border border-primary/40 px-5 py-2.5 text-sm font-bold text-primary transition hover:bg-primary hover:text-black">
                          <PenLine className="h-4 w-4" aria-hidden="true" /> Apply · free
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ── AI DEAL MATCHER ──────────────────────────────────────── */}
        <div className="relative mt-12 rounded-3xl border border-primary/25 bg-gradient-to-b from-[#14100a] to-black p-6 md:p-10">
          <p className="mb-1 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-primary/80">
            <Target className="h-3.5 w-3.5" aria-hidden="true" /> AI deal matcher · {AI_COST} credit
          </p>
          <h2 className="font-display text-2xl font-black">Which deals fit <span className="text-primary">you?</span></h2>
          <p className="mt-2 max-w-xl text-sm text-white/55">
            Drop your niche and audience size — the AI ranks the active deals by fit.
          </p>
          <div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-3">
            <div>
              <p className={sectionLabel}>Your niche</p>
              <input value={matchNiche} onChange={(e) => setMatchNiche(e.target.value)} maxLength={120}
                placeholder="e.g. Music" className={inputClass} />
            </div>
            <div>
              <p className={sectionLabel}>Followers</p>
              <input value={matchFollowers} onChange={(e) => setMatchFollowers(e.target.value.replace(/[^0-9]/g, "").slice(0, 10))}
                inputMode="numeric" placeholder="25000" className={inputClass} />
            </div>
            <div>
              <p className={sectionLabel}>Platforms (comma separated)</p>
              <input value={matchPlatforms} onChange={(e) => setMatchPlatforms(e.target.value)} maxLength={200}
                placeholder="tiktok, instagram" className={inputClass} />
            </div>
          </div>
          <div className="mt-6 text-center">
            {user ? (
              <button onClick={findMatches} disabled={matchLoading}
                className="inline-flex items-center gap-2 rounded-2xl bg-gradient-to-br from-[#f5d67b] via-primary to-[#8a6d1f] px-8 py-3.5 text-base font-black text-black shadow-[0_4px_28px_rgba(212,175,55,0.4)] transition hover:scale-[1.03] active:scale-95 disabled:opacity-50">
                {matchLoading ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> : <Target className="h-5 w-5" aria-hidden="true" />}
                {matchLoading ? "Matching…" : "Find my matches"}
              </button>
            ) : (
              <Link href="/login"
                className="inline-flex items-center gap-2 rounded-2xl border border-primary/50 bg-primary/10 px-8 py-3.5 font-bold text-primary transition hover:bg-primary hover:text-black">
                Sign in to match <ArrowRight className="h-5 w-5" aria-hidden="true" />
              </Link>
            )}
            <p className="mt-2.5 text-xs text-white/35">{AI_COST} credit per match · powered by GPT-6</p>
          </div>

          {matches.length > 0 && (
            <div className="mt-8">
              {matchNote && <p className="mb-4 text-center text-sm italic text-white/50">{matchNote}</p>}
              <div className="grid gap-3">
                {matches.map((m) => {
                  const deal = deals.find((d) => d.id === m.dealId);
                  return (
                    <div key={m.dealId} className="flex items-start gap-4 rounded-2xl border border-primary/25 bg-primary/[0.06] p-5">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/15 font-display text-base font-black text-primary">
                        {m.score}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="font-bold text-white">
                          {m.brandName}
                          {deal && <span className="ml-2 text-sm font-semibold text-primary">{money(deal.budgetMin, deal.budgetMax)}</span>}
                        </p>
                        <p className="mt-1 text-sm leading-relaxed text-white/65">{m.why}</p>
                        {deal && !applied.has(deal.id) && (
                          <button onClick={() => { setApplyingTo(deal.id); setPitch(""); setTimeout(() => document.getElementById(`apply-${deal.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 100); }}
                            className="mt-3 inline-flex items-center gap-1.5 rounded-xl border border-primary/40 px-4 py-2 text-xs font-bold text-primary transition hover:bg-primary hover:text-black">
                            <PenLine className="h-3.5 w-3.5" aria-hidden="true" /> Apply to this deal
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* ── AI PITCH WRITER ──────────────────────────────────────── */}
        <div className="relative mt-8 rounded-3xl border border-primary/25 bg-gradient-to-b from-[#14100a] to-black p-6 md:p-10">
          <p className="mb-1 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-primary/80">
            <Sparkles className="h-3.5 w-3.5" aria-hidden="true" /> AI pitch writer · {AI_COST} credit
          </p>
          <h2 className="font-display text-2xl font-black">Pitch like you <span className="text-primary">close.</span></h2>
          <p className="mt-2 max-w-xl text-sm text-white/55">
            Pick a deal, drop your stats — the AI writes a pitch built to win it.
          </p>

          <div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <p className={sectionLabel}>Deal you're pitching for</p>
              <select value={pitchDealId} onChange={(e) => setPitchDealId(e.target.value)}
                className={`${inputClass} appearance-none ${!pitchDealId ? "text-white/25" : ""}`}>
                <option value="">Pick a deal…</option>
                {deals.map((d) => (
                  <option key={d.id} value={d.id} className="bg-black text-white">
                    {d.brandName} · {money(d.budgetMin, d.budgetMax)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <p className={sectionLabel}>Your name (optional)</p>
              <input value={creatorName} onChange={(e) => setCreatorName(e.target.value)} maxLength={120}
                placeholder="e.g. King Shark" className={inputClass} />
            </div>
            <div>
              <p className={sectionLabel}>Your niche</p>
              <input value={creatorNiche} onChange={(e) => setCreatorNiche(e.target.value)} maxLength={120}
                placeholder="e.g. Music" className={inputClass} />
            </div>
            <div>
              <p className={sectionLabel}>Followers</p>
              <input value={creatorFollowers} onChange={(e) => setCreatorFollowers(e.target.value.replace(/[^0-9]/g, "").slice(0, 10))}
                inputMode="numeric" placeholder="25000" className={inputClass} />
            </div>
            <div>
              <p className={sectionLabel}>Platforms (comma separated)</p>
              <input value={creatorPlatforms} onChange={(e) => setCreatorPlatforms(e.target.value)} maxLength={200}
                placeholder="tiktok, instagram" className={inputClass} />
            </div>
            <div>
              <p className={sectionLabel}>Tone</p>
              <div className="flex gap-2">
                {TONES.map((t) => (
                  <button key={t} onClick={() => setTone(t)}
                    className={`flex-1 rounded-xl border px-3 py-2.5 text-sm font-bold capitalize transition ${
                      tone === t
                        ? "border-primary bg-primary/15 text-primary"
                        : "border-white/10 bg-white/[0.03] text-white/55 hover:border-primary/40 hover:text-white"
                    }`}>
                    {t}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <p className={`${sectionLabel} mt-4`}>Wins / achievements (optional)</p>
          <textarea value={achievements} onChange={(e) => setAchievements(e.target.value)} maxLength={500} rows={2}
            placeholder="e.g. 2M views on my last brand collab, 40k engaged followers" className={`${inputClass} resize-y`} />

          <div className="mt-6 text-center">
            {user ? (
              <button onClick={writePitch} disabled={pitchLoading}
                className="inline-flex items-center gap-2 rounded-2xl bg-gradient-to-br from-[#f5d67b] via-primary to-[#8a6d1f] px-8 py-3.5 text-base font-black text-black shadow-[0_4px_28px_rgba(212,175,55,0.4)] transition hover:scale-[1.03] active:scale-95 disabled:opacity-50">
                {pitchLoading ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> : <PenLine className="h-5 w-5" aria-hidden="true" />}
                {pitchLoading ? "Writing…" : "Write my pitch"}
              </button>
            ) : (
              <Link href="/login"
                className="inline-flex items-center gap-2 rounded-2xl border border-primary/50 bg-primary/10 px-8 py-3.5 font-bold text-primary transition hover:bg-primary hover:text-black">
                Sign in to write <ArrowRight className="h-5 w-5" aria-hidden="true" />
              </Link>
            )}
            <p className="mt-2.5 text-xs text-white/35">{AI_COST} credit per pitch · powered by GPT-6</p>
          </div>

          {generatedPitch && (
            <div className="mt-8 rounded-2xl border border-primary/30 bg-black/60 p-6">
              {generatedSubject && (
                <p className="text-sm font-bold text-primary">Subject: {generatedSubject}</p>
              )}
              <p className="mt-3 whitespace-pre-wrap text-[15px] leading-relaxed text-white/90">{generatedPitch}</p>
              <div className="mt-5 flex flex-wrap gap-2">
                <button onClick={copyPitch}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-primary/40 px-4 py-2 text-sm font-bold text-primary transition hover:bg-primary hover:text-black">
                  {copied ? <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
                  {copied ? "Copied!" : "Copy pitch"}
                </button>
                {pitchDealId && deals.some((d) => d.id === pitchDealId) && !applied.has(pitchDealId) && (
                  <button onClick={() => usePitchForApplication(pitchDealId)}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-black text-black transition hover:brightness-110">
                    <Users className="h-4 w-4" aria-hidden="true" /> Use it to apply
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        <p className="relative mt-8 text-center text-sm text-white/40">
          Closed a deal? Ask{" "}
          <CheatCodeName /> 🦈{" "}
          in the chat bubble for content ideas that over-deliver for the brand.
        </p>
      </main>

      <SiteFooter />
    </div>
  );
}
