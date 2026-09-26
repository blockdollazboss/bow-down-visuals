import { useEffect, useState } from "react";
import { Link } from "wouter";
import {
  Handshake, Loader2, ArrowRight, Target,
  Briefcase, CalendarClock, BadgeDollarSign, Megaphone,
  LayoutDashboard, PlusCircle, Sparkles,
} from "lucide-react";
import { MarketingNav } from "@/components/MarketingNav";
import { SiteFooter } from "@/components/layout/footer";
import { useAuth } from "@/contexts/AuthContext";
import { OutOfCredits } from "@/components/OutOfCredits";
import { formatBudgetRange, daysLeftLabel } from "@/lib/sponsors";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";

/* ─── Sponsor Marketplace — browse ────────────────────────────────────────
   Brands post paid sponsorship deals, creators apply with a pitch —
   Bow Down Visuals takes 15% of every released deal.
   Money rules: browsing is free (pure UI); the AI deal matcher is 1 credit;
   posting a deal lives on /sponsors/post (5 credits). */

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

const AI_COST = 1;

const inputClass =
  "w-full rounded-xl border border-white/10 bg-black/60 px-4 py-3 text-sm text-white placeholder:text-white/25 outline-none transition focus:border-primary/60 focus:ring-1 focus:ring-primary/40";

const sectionLabel =
  "mb-3 text-[11px] font-bold uppercase tracking-widest text-white/40";

export default function Sponsors() {
  const { user, getAccessToken, refreshProfile } = useAuth();
  const { confirmedFetch } = useConfirmedApi();

  const [deals, setDeals] = useState<Deal[]>([]);
  const [dealsLoading, setDealsLoading] = useState(true);
  const [dealsError, setDealsError] = useState<string | null>(null);
  const [nicheFilter, setNicheFilter] = useState("");

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

  async function runMatcher() {
    if (!matchNiche.trim()) {
      setError("Tell the AI your niche first.");
      return;
    }
    setMatchLoading(true);
    setError(null);
    try {
      const res = await confirmedFetch("/api/sponsors/match", {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({
          niche: matchNiche.trim(),
          followers: Number(matchFollowers.replace(/[^0-9]/g, "")) || 0,
          platforms: matchPlatforms.split(",").map((p) => p.trim()).filter(Boolean).slice(0, 5),
        }),
      });
      if (!res) return; /* user cancelled the credit confirmation */
      const data = (await res.json().catch(() => ({}))) as {
        matches?: Match[]; note?: string; error?: string; creditsRemaining?: number;
      };
      if (res.status === 402) {
        setOutOfCredits(true);
        refreshProfile();
        return;
      }
      if (!res.ok) throw new Error(data.error || "Matcher failed.");
      setMatches(Array.isArray(data.matches) ? data.matches : []);
      setMatchNote(data.note || "");
      refreshProfile();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Matcher failed.");
    } finally {
      setMatchLoading(false);
    }
  }

  const filtered = nicheFilter.trim()
    ? deals.filter((d) => d.niche.toLowerCase().includes(nicheFilter.trim().toLowerCase()))
    : deals;

  return (
    <div className="min-h-screen bg-black text-white">
      <MarketingNav />
      <main className="mx-auto max-w-6xl px-4 pb-24 pt-28 md:pt-32">
        {/* header */}
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-primary/80">
              <Handshake className="h-3.5 w-3.5" aria-hidden="true" /> Sponsor marketplace
            </p>
            <h1 className="font-display text-4xl font-black md:text-5xl">
              Get <span className="text-primary">paid</span> by brands
            </h1>
            <p className="mt-3 max-w-xl text-sm text-white/55">
              Browse live sponsorship deals, apply with a pitch, and close real money.
              Escrow protects both sides — brands fund up front, creators get paid on delivery.
            </p>
          </div>
          <div className="flex gap-2">
            <Link href="/sponsors/dashboard"
              className="inline-flex items-center gap-1.5 rounded-xl border border-white/15 px-4 py-2.5 text-sm font-bold text-white/80 transition hover:border-primary/50 hover:text-white">
              <LayoutDashboard className="h-4 w-4" aria-hidden="true" /> My dashboard
            </Link>
            <Link href="/sponsors/post"
              className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-br from-[#f5d67b] via-primary to-[#8a6d1f] px-4 py-2.5 text-sm font-black text-black shadow-[0_4px_24px_rgba(212,175,55,0.35)] transition hover:scale-[1.03]">
              <PlusCircle className="h-4 w-4" aria-hidden="true" /> Post a deal
            </Link>
          </div>
        </div>

        {error && (
          <p className="mt-6 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</p>
        )}

        {/* filter */}
        <div className="mt-8 flex max-w-sm items-center gap-2">
          <input value={nicheFilter} onChange={(e) => setNicheFilter(e.target.value)} maxLength={60}
            placeholder="Filter by niche…" className={inputClass} />
        </div>

        {/* deals grid */}
        <div className="mt-6">
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
          ) : filtered.length === 0 ? (
            <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-10 text-center">
              <Handshake className="mx-auto h-10 w-10 text-primary/60" aria-hidden="true" />
              <p className="mt-3 font-bold text-white">{deals.length === 0 ? "No active deals yet" : "No deals match that niche"}</p>
              <p className="mt-1 text-sm text-white/50">
                {deals.length === 0 ? "Be the first brand to post — or run the AI matcher below." : "Try a different niche, or clear the filter."}
              </p>
              {deals.length === 0 && (
                <Link href="/sponsors/post"
                  className="mt-4 inline-flex items-center gap-2 rounded-2xl bg-primary px-6 py-3 font-black text-black transition hover:brightness-110">
                  <Megaphone className="h-4 w-4" aria-hidden="true" /> Post the first deal
                </Link>
              )}
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {filtered.map((d) => (
                <Link key={d.id} href={`/sponsors/${d.id}`}
                  className="group rounded-3xl border border-white/10 bg-white/[0.03] p-6 transition hover:border-primary/40 hover:bg-white/[0.05]">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="flex items-center gap-2 text-lg font-black text-white">
                        <Briefcase className="h-4 w-4 text-primary/70" aria-hidden="true" />
                        {d.brandName}
                      </p>
                      <p className="mt-0.5 text-xs uppercase tracking-wider text-white/40">{d.niche}</p>
                    </div>
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-sm font-black text-primary">
                      <BadgeDollarSign className="h-4 w-4" aria-hidden="true" />
                      {formatBudgetRange(d.budgetMin, d.budgetMax)}
                    </span>
                  </div>
                  <p className="mt-3 line-clamp-2 text-sm leading-relaxed text-white/70">{d.description}</p>
                  <div className="mt-4 flex items-center justify-between text-[13px] text-white/55">
                    <p className="inline-flex items-center gap-1.5">
                      <CalendarClock className="h-3.5 w-3.5 text-primary/70" aria-hidden="true" />
                      {daysLeftLabel(d.deadline)}
                    </p>
                    <span className="inline-flex items-center gap-1 font-bold text-primary opacity-0 transition group-hover:opacity-100">
                      View deal <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                    </span>
                  </div>
                </Link>
              ))}
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
          <button onClick={runMatcher} disabled={matchLoading}
            className="mt-5 inline-flex items-center gap-2 rounded-2xl bg-gradient-to-br from-[#f5d67b] via-primary to-[#8a6d1f] px-7 py-3 text-sm font-black text-black shadow-[0_4px_24px_rgba(212,175,55,0.35)] transition hover:scale-[1.03] disabled:opacity-50">
            {matchLoading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Sparkles className="h-4 w-4" aria-hidden="true" />}
            {matchLoading ? "Matching…" : `Find my matches · ${AI_COST} credit`}
          </button>
          {matchNote && <p className="mt-4 text-sm italic text-white/60">{matchNote}</p>}
          {matches.length > 0 && (
            <div className="mt-4 space-y-2">
              {matches.map((m) => (
                <Link key={m.dealId} href={`/sponsors/${m.dealId}`}
                  className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-black/40 px-4 py-3 transition hover:border-primary/40">
                  <div>
                    <p className="font-bold text-white">{m.brandName}</p>
                    <p className="text-xs text-white/50">{m.why}</p>
                  </div>
                  <span className="shrink-0 rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-sm font-black text-primary">
                    {m.score}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </main>
      <SiteFooter />
      {outOfCredits && <OutOfCredits onClose={() => setOutOfCredits(false)} />}
    </div>
  );
}
