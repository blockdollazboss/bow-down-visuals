import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Trophy, Loader2, ChevronRight, Timer } from "lucide-react";
import { formatBucs } from "@/lib/visual-bucs";

/* ─── ChallengeEnterStrip — "Enter this challenge" CTA for creation tools ──
   Docks the competitive loop into video editor, shorts flow, song maker:
   finish something → one tap → /publish prefilled AND auto-entered into a
   live challenge. Gold/black luxury, prize pool leads (guide them to the
   money). */

interface LiveChallenge {
  slug: string; title: string; hashtag: string; cover_url: string | null;
  status: "upcoming" | "live"; starts_at: string | null; ends_at: string | null;
  entry_count: number; prize_pool_credits: number;
}

interface Props {
  /** Prefilled video URL carried into /publish. */
  videoUrl?: string | null;
  title?: string;
  /** Creation-tool deep link back (e.g. "/video-editor"). */
  from?: string;
  fromLabel?: string;
  /** Max cards to show. */
  limit?: number;
}

function buildEnterUrl(c: LiveChallenge, p: Props): string {
  const q = new URLSearchParams();
  q.set("type", "video");
  q.set("category", "video");
  if (p.videoUrl) q.set("videoUrl", p.videoUrl);
  if (p.title) q.set("title", p.title);
  q.set("challenge", c.slug);
  if (p.from) q.set("from", p.from);
  if (p.fromLabel) q.set("fromLabel", p.fromLabel);
  q.set("description", `#${c.hashtag} — ${c.title}\n`);
  return `/publish?${q.toString()}`;
}

export default function ChallengeEnterStrip({ videoUrl, title, from, fromLabel, limit = 3 }: Props) {
  const [challenges, setChallenges] = useState<LiveChallenge[] | null>(null);
  /* Honest load failure (Stack-200 D2 A19): a failed read used to
     collapse into setChallenges([]) and the strip vanished — a failed
     load was indistinguishable from "no live challenges", right where
     a creator is about to publish. */
  const [loadFailed, setLoadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/challenges/live-now?limit=${limit}`);
        if (!res.ok) throw new Error(String(res.status));
        const j = await res.json();
        if (!cancelled) { setChallenges(j.challenges ?? []); setLoadFailed(false); }
      } catch {
        if (!cancelled) setLoadFailed(true);
      }
    })();
    return () => { cancelled = true; };
  }, [limit, attempt]);

  if (!challenges && loadFailed) {
    return (
      <section className="rounded-2xl border border-primary/25 bg-zinc-950 px-4 py-3 flex items-center gap-2" data-testid="challenge-enter-load-error">
        <Trophy className="h-4 w-4 text-primary shrink-0" />
        <span className="flex-1 text-xs text-white/60">
          Live challenges couldn&rsquo;t load — there may be one running right now.
        </span>
        <button type="button" onClick={() => setAttempt((n) => n + 1)}
          className="text-[11px] font-bold text-amber-200/80 hover:text-amber-200 transition-colors shrink-0">
          Try again
        </button>
      </section>
    );
  }

  if (!challenges || challenges.length === 0) return null;

  return (
    <section className="rounded-2xl border border-primary/25 bg-zinc-950 p-4">
      <div className="mb-3 flex items-center gap-2">
        <Trophy className="h-5 w-5 text-primary" />
        <h3 className="text-sm font-black uppercase tracking-widest text-white">
          Enter a live challenge
        </h3>
        {challenges === null && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
      </div>
      <p className="mb-3 text-xs text-white/50">
        Your creation could take the crown — winners get paid in Visual Bucs.
      </p>
      <div className="grid grid-cols-1 gap-2">
        {challenges.map((c) => (
          <Link key={c.slug} href={buildEnterUrl(c, { videoUrl, title, from, fromLabel })}
            className="group flex items-center gap-3 rounded-xl border border-white/10 bg-black/40 p-3 hover:border-primary/50">
            {c.cover_url ? (
              <img src={c.cover_url} alt={c.title} className="h-11 w-11 shrink-0 rounded-lg object-cover" loading="lazy" />
            ) : (
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary/15">
                <Trophy className="h-5 w-5 text-primary" />
              </span>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold text-white group-hover:text-primary">{c.title}</p>
              <p className="flex items-center gap-2 text-[11px] text-white/50">
                <span className={c.status === "live" ? "font-bold text-emerald-400" : "text-white/50"}>
                  {c.status === "live" ? "● LIVE" : "Upcoming"}
                </span>
                {c.prize_pool_credits > 0 && (
                  <span className="font-bold text-primary">🏆 {formatBucs(c.prize_pool_credits)}</span>
                )}
                {c.ends_at && c.status === "live" && (
                  <span className="inline-flex items-center gap-0.5">
                    <Timer className="h-3 w-3" /> ends {new Date(c.ends_at).toLocaleDateString()}
                  </span>
                )}
              </p>
            </div>
            <span className="flex shrink-0 items-center gap-1 rounded-full bg-primary px-3.5 py-1.5 text-xs font-black text-black group-hover:brightness-110">
              Enter <ChevronRight className="h-3.5 w-3.5" />
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
