import { useEffect, useMemo, useState } from "react";
import { Link, useRoute, useLocation } from "wouter";
import {
  Trophy, Loader2, ArrowLeft, Plus, BadgeDollarSign, Users, Eye,
  ThumbsUp, Crown, Timer, Flame, ChevronRight,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { usePageTitle } from "@/hooks/use-page-title";
import { formatBucs, formatBucsShort } from "@/lib/visual-bucs";
import { cn } from "@/lib/utils";

/* ─── Challenge page — /challenge/:slug ────────────────────────────────────
   Hero, entry grid, join flow. The prize/earning angle leads — guide them to
   the money: prize pool in Visual Bucs, lifecycle countdown, community
   voting, winners' circle. The loop: compete → share entry for votes →
   winner fame → new users. */

type Lifecycle = "upcoming" | "live" | "judging" | "winners";

interface Prize { place: number; prize_credits: number; description: string }

interface ChallengeEntry {
  id: string; title: string; video_url: string; thumbnail_url: string | null;
  view_count: number; like_count: number; vote_count: number; viewer_voted: boolean;
  entered_at: string;
  creator: { id: string; slug: string; display_name: string; avatar_url: string | null };
}

interface ChallengeData {
  challenge: {
    id: string; slug: string; title: string; description: string; hashtag: string;
    cover_url: string | null; prize_text: string; entry_count: number; total_views: number;
    status: Lifecycle; starts_at: string | null; ends_at: string | null;
    judging_ends_at: string | null; prize_pool_credits: number;
    prizes: Prize[]; winners_announced: boolean;
  };
  entries: ChallengeEntry[];
}

interface TrendingChallenge {
  slug: string; title: string; hashtag: string; entry_count: number;
  prize_text: string; effective_status?: Lifecycle; prize_pool_credits?: number;
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function pad(n: number): string { return String(n).padStart(2, "0"); }

/** Live countdown ticking every second. Returns null when the target passes. */
function useCountdown(target: string | null): string | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!target) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [target]);
  if (!target) return null;
  const ms = new Date(target).getTime() - now;
  if (ms <= 0) return null;
  const d = Math.floor(ms / 86_400_000);
  const h = Math.floor(ms / 3_600_000) % 24;
  const m = Math.floor(ms / 60_000) % 60;
  const s = Math.floor(ms / 1_000) % 60;
  return d > 0 ? `${d}d ${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(h)}:${pad(m)}:${pad(s)}`;
}

export default function ChallengePage() {
  const [, params] = useRoute("/challenge/:slug");
  const slug = params?.slug ?? "";
  const [, navigate] = useLocation();
  const { user, getAccessToken } = useAuth();
  const { toast } = useToast();
  const [data, setData] = useState<ChallengeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState<TrendingChallenge[]>([]);
  const [sort, setSort] = useState<"votes" | "views">("votes");
  const [votingId, setVotingId] = useState<string | null>(null);

  const challenge = data?.challenge ?? null;
  const countdownTarget = challenge
    ? challenge.status === "upcoming" ? challenge.starts_at
      : challenge.status === "live" ? challenge.ends_at
      : challenge.status === "judging" ? challenge.judging_ends_at
      : null
    : null;
  const countdown = useCountdown(countdownTarget);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const res = await fetch(`/api/challenges/${encodeURIComponent(slug)}`);
        if (!res.ok) throw new Error(String(res.status));
        const json = (await res.json()) as ChallengeData;
        if (!cancelled) setData(json);
      } catch {
        if (!cancelled) setData(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
      try {
        const t = await fetch("/api/challenges/trending?limit=6");
        if (t.ok) {
          const j = await t.json();
          if (!cancelled) setMore((j.challenges ?? []).filter((c: TrendingChallenge) => c.slug !== slug));
        }
      } catch { /* optional */ }
    })();
    return () => { cancelled = true; };
  }, [slug]);

  usePageTitle(
    challenge ? `${challenge.title} — Challenge` : "Challenge",
    challenge ? `Join the "${challenge.title}" challenge (#${challenge.hashtag}) on Bow Down Visuals — vote for entries, win Visual Bucs prizes.` : "A creator challenge on Bow Down Visuals.",
  );

  const entries = useMemo(() => {
    const list = [...(data?.entries ?? [])];
    list.sort((a, b) => sort === "votes" ? b.vote_count - a.vote_count : b.view_count - a.view_count);
    return list;
  }, [data, sort]);

  const vote = async (videoId: string) => {
    if (!user) { navigate("/login"); return; }
    if (votingId) return;
    setVotingId(videoId);
    try {
      const token = await getAccessToken();
      const res = await fetch(`/api/challenges/${encodeURIComponent(slug)}/vote`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ video_id: videoId }),
      });
      const j = await res.json();
      if (!res.ok) {
        toast({ title: "Vote didn't land", description: j.error ?? "Try again." });
        return;
      }
      setData((prev) => prev && {
        ...prev,
        entries: prev.entries.map((e) => e.id === videoId
          ? { ...e, vote_count: j.vote_count ?? e.vote_count, viewer_voted: !!j.voted }
          : e),
      });
      if (j.voted) toast({ title: "Vote counted 🦈", description: "Share the entry to rally more votes." });
    } catch {
      toast({ title: "Vote didn't land", description: "Check your connection and try again." });
    } finally {
      setVotingId(null);
    }
  };

  if (loading) {
    return <div className="flex h-[calc(100dvh-4rem)] items-center justify-center bg-black"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }
  if (!data || !challenge) {
    return (
      <div className="flex h-[calc(100dvh-4rem)] flex-col items-center justify-center gap-4 bg-black px-6 text-center">
        <Trophy className="h-12 w-12 text-white/20" />
        <h1 className="text-xl font-bold text-white">No challenge by that name.</h1>
        <p className="text-white/50">Start it yourself — the crown's empty.</p>
        <Link href="/shorts" className="rounded-full bg-primary px-6 py-2.5 font-bold text-black">Back to Shorts</Link>
      </div>
    );
  }

  const joinHref = user
    ? `/publish?type=video&category=video&challenge=${encodeURIComponent(challenge.slug)}&description=${encodeURIComponent(`#${challenge.hashtag} — ${challenge.title}\n`)}`
    : "/login";
  const canVote = challenge.status === "live" || challenge.status === "judging";

  return (
    <div className="min-h-[calc(100dvh-4rem)] bg-black px-4 py-6 md:px-8">
      <Link href="/shorts" className="mb-6 inline-flex items-center gap-2 text-sm text-white/60 hover:text-primary">
        <ArrowLeft className="h-4 w-4" /> Back to Shorts
      </Link>

      {/* lifecycle banner */}
      <LifecycleBanner status={challenge.status} countdown={countdown} slug={challenge.slug} />

      {/* hero — money angle leads */}
      <div className="relative mb-8 overflow-hidden rounded-2xl border border-primary/25">
        {challenge.cover_url && (
          <img src={challenge.cover_url} alt={challenge.title} className="h-56 w-full object-cover md:h-72" />
        )}
        <div className={challenge.cover_url ? "absolute inset-0 bg-gradient-to-t from-black via-black/70 to-black/20" : "bg-gradient-to-br from-zinc-950 to-zinc-900"}>
          <div className="flex h-full flex-col justify-end p-6">
            <p className="text-xs font-bold uppercase tracking-widest text-primary">#{challenge.hashtag}</p>
            <h1 className="mt-1 text-3xl font-black text-white md:text-4xl">{challenge.title}</h1>
            {challenge.description && <p className="mt-2 max-w-2xl text-sm text-white/70">{challenge.description}</p>}
            <div className="mt-3 flex flex-wrap items-center gap-4 text-sm text-white/60">
              <span className="inline-flex items-center gap-1.5"><Users className="h-4 w-4 text-primary" /> {fmt(challenge.entry_count)} entries</span>
              <span className="inline-flex items-center gap-1.5"><Eye className="h-4 w-4 text-primary" /> {fmt(challenge.total_views)} views</span>
            </div>
            {/* prize pool — shown upfront, in Visual Bucs */}
            {challenge.prizes.length > 0 ? (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/50 bg-primary/10 px-4 py-1.5 text-sm font-black text-primary">
                  <Trophy className="h-4 w-4" /> {formatBucs(challenge.prize_pool_credits)} prize pool
                </span>
                {challenge.prizes.slice(0, 3).map((p) => (
                  <span key={p.place} className="inline-flex items-center gap-1 rounded-full bg-white/5 px-3 py-1 text-xs font-bold text-white/80">
                    {p.place === 1 ? "🥇" : p.place === 2 ? "🥈" : "🥉"} {formatBucsShort(p.prize_credits)} VB
                  </span>
                ))}
              </div>
            ) : challenge.prize_text ? (
              <p className="mt-3 inline-flex w-fit items-center gap-2 rounded-full border border-primary/50 bg-primary/10 px-4 py-1.5 text-sm font-bold text-primary">
                <Trophy className="h-4 w-4" /> Prize: {challenge.prize_text}
              </p>
            ) : (
              <p className="mt-3 inline-flex w-fit items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-1.5 text-sm text-white/60">
                <BadgeDollarSign className="h-4 w-4 text-primary" /> No prize posted — win the clout, keep the crown
              </p>
            )}
          </div>
        </div>
      </div>

      {/* join flow — the creation loop */}
      <div className="mb-8 flex flex-col items-start gap-3 rounded-2xl border border-primary/25 bg-zinc-950 p-5 md:flex-row md:items-center">
        <div className="flex-1">
          <h2 className="text-lg font-black text-white">Run the challenge. Keep the bag.</h2>
          <p className="mt-1 text-sm text-white/55">
            Post your entry with <span className="font-bold text-primary">#{challenge.hashtag}</span> and it lands here automatically.
            {canVote && " Rally votes — the community crown decides the winners."}
            {challenge.prize_pool_credits > 0 && ` ${formatBucs(challenge.prize_pool_credits)} on the line, paid straight to winners.`}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {challenge.winners_announced && (
            <Link href={`/challenge/${challenge.slug}/winners`}
              className="flex items-center gap-2 rounded-full border border-primary/50 px-6 py-3 font-bold text-primary hover:bg-primary/10">
              <Crown className="h-5 w-5" /> Winners
            </Link>
          )}
          {challenge.status !== "winners" ? (
            <Link href={joinHref}
              className="flex items-center gap-2 rounded-full bg-primary px-6 py-3 font-bold text-black hover:brightness-110">
              <Plus className="h-5 w-5" /> Join challenge
            </Link>
          ) : (
            <Link href="/shorts"
              className="flex items-center gap-2 rounded-full bg-primary px-6 py-3 font-bold text-black hover:brightness-110">
              <Flame className="h-5 w-5" /> Find the next one
            </Link>
          )}
        </div>
      </div>

      {/* entry grid — vote for the crown */}
      <section className="mb-10">
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <h2 className="text-lg font-black text-white">Entries ({fmt(data.entries.length)})</h2>
          <div className="ml-auto flex rounded-full bg-white/5 p-1 text-xs font-bold">
            <button onClick={() => setSort("votes")}
              className={cn("rounded-full px-3 py-1.5", sort === "votes" ? "bg-primary text-black" : "text-white/60 hover:text-white")}>
              Top voted
            </button>
            <button onClick={() => setSort("views")}
              className={cn("rounded-full px-3 py-1.5", sort === "views" ? "bg-primary text-black" : "text-white/60 hover:text-white")}>
              Most viewed
            </button>
          </div>
        </div>
        {entries.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/15 p-10 text-center">
            <p className="text-white/50">No entries yet. First one in sets the bar — and the price.</p>
            <Link href={joinHref} className="mt-4 inline-block rounded-full bg-primary px-6 py-2.5 font-bold text-black">
              Be the first entry
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-6">
            {entries.map((e, i) => (
              <div key={e.id} className="group relative">
                <Link href={`/shorts?start=${e.id}`}>
                  <div className="relative aspect-[9/16] overflow-hidden rounded-xl bg-zinc-900">
                    {sort === "votes" && i < 3 && canVote && (
                      <span className="absolute left-2 top-2 z-10 rounded-full bg-black/70 px-2 py-0.5 text-xs font-black text-primary">
                        {i === 0 ? "🥇" : i === 1 ? "🥈" : "🥉"} #{i + 1}
                      </span>
                    )}
                    {e.thumbnail_url
                      ? <img src={e.thumbnail_url} alt={e.title} className="h-full w-full object-cover transition group-hover:scale-105" loading="lazy" />
                      : <div className="flex h-full w-full items-center justify-center"><Trophy className="h-8 w-8 text-white/15" /></div>}
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent p-2 pt-6">
                      <p className="truncate text-xs font-bold text-white">{e.title}</p>
                      <Link href={`/artist/${e.creator.slug}`} onClick={(ev) => ev.stopPropagation()}
                        className="text-[11px] text-primary hover:underline">@{e.creator.display_name}</Link>
                      <p className="text-[11px] text-white/50">{fmt(e.view_count)} views · {fmt(e.vote_count)} votes</p>
                    </div>
                  </div>
                </Link>
                {/* vote button — the competitive engine */}
                <button
                  onClick={() => vote(e.id)}
                  disabled={!canVote || votingId === e.id}
                  title={canVote ? (e.viewer_voted ? "Remove your vote" : "Vote for this entry") : "Voting is closed"}
                  className={cn(
                    "absolute bottom-2 right-2 z-10 flex items-center gap-1 rounded-full px-2.5 py-1.5 text-[11px] font-black backdrop-blur transition",
                    e.viewer_voted
                      ? "bg-primary text-black"
                      : "bg-black/60 text-white hover:bg-primary hover:text-black",
                    !canVote && "cursor-not-allowed opacity-40",
                  )}
                >
                  {votingId === e.id
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : <ThumbsUp className={cn("h-3.5 w-3.5", e.viewer_voted && "fill-black")} />}
                  {fmt(e.vote_count)}
                </button>
              </div>
            ))}
          </div>
        )}
        {canVote && (
          <p className="mt-3 text-xs text-white/40">One vote per entry. No voting your own — your fans have to do that. 🦈</p>
        )}
      </section>

      {/* more challenges — the loop never dead-ends */}
      {more.length > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-black text-white">More challenges running</h2>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {more.map((c) => (
              <Link key={c.slug} href={`/challenge/${c.slug}`}
                className="rounded-xl border border-white/10 bg-zinc-950 p-4 hover:border-primary/40">
                <p className="font-bold text-white">{c.title}</p>
                <p className="text-xs text-primary">#{c.hashtag} · {fmt(c.entry_count)} entries</p>
                {(c.prize_pool_credits ?? 0) > 0 ? (
                  <p className="mt-1 text-xs font-bold text-primary">🏆 {formatBucs(c.prize_pool_credits!)} prize pool</p>
                ) : c.prize_text ? (
                  <p className="mt-1 text-xs text-white/60">🏆 {c.prize_text}</p>
                ) : null}
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

/* ─── Lifecycle banner: upcoming → live (countdown) → judging → winners ─── */
function LifecycleBanner({ status, countdown, slug }: { status: Lifecycle; countdown: string | null; slug: string }) {
  if (status === "winners") {
    return (
      <Link href={`/challenge/${slug}/winners`}
        className="mb-6 flex items-center gap-3 rounded-2xl border border-primary/40 bg-primary/10 px-5 py-3.5 hover:bg-primary/15">
        <Crown className="h-5 w-5 shrink-0 text-primary" />
        <p className="text-sm font-bold text-white">The crowns have been handed out — see the winners' circle.</p>
        <ChevronRight className="ml-auto h-4 w-4 text-primary" />
      </Link>
    );
  }
  const copy: Record<Exclude<Lifecycle, "winners">, { label: string; sub: string }> = {
    upcoming: { label: "Drops soon", sub: "Get your entry ready — early birds set the bar." },
    live: { label: "LIVE now", sub: "Entries open, votes counting. Rally your people." },
    judging: { label: "Judging", sub: "Entries are closed — every vote still moves the crown." },
  };
  const c = copy[status];
  return (
    <div className="mb-6 flex flex-wrap items-center gap-3 rounded-2xl border border-primary/25 bg-zinc-950 px-5 py-3.5">
      <span className="relative flex h-2.5 w-2.5">
        {status === "live" && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" />}
        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-primary" />
      </span>
      <p className="text-sm font-black uppercase tracking-widest text-primary">{c.label}</p>
      <p className="text-sm text-white/55">{c.sub}</p>
      {countdown && (
        <span className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-primary/15 px-3 py-1 text-sm font-black text-primary">
          <Timer className="h-4 w-4" /> {countdown}
        </span>
      )}
    </div>
  );
}
