import { useCallback, useEffect, useState } from "react";
import { Link } from "wouter";
import { Radio, Users, AlertTriangle, RotateCcw } from "lucide-react";

/* ─── Live now rail — the discovery surface for native broadcasts ─────────
   Self-contained: fetches GET /api/live-streams/live on its own (polls
   every 30s), with its own honest states — a real empty state when nobody
   is broadcasting, and a load error with retry when the fetch fails
   (never a fake-empty). Cards deep-link to the /live/:id watch page and
   the creator's profile. */

export interface LiveRailStream {
  id: string;
  title: string;
  viewer_count: number;
  started_at: string | null;
  creator: { id: string; slug: string; display_name: string; avatar_url: string | null } | null;
}

export default function LiveNowRail() {
  const [streams, setStreams] = useState<LiveRailStream[] | null>(null);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/live-streams/live");
      if (!res.ok) throw new Error("load failed");
      const d = (await res.json()) as { streams: LiveRailStream[] };
      setStreams(d.streams ?? []);
      setError(false);
    } catch {
      setError(true);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [load]);

  return (
    <section className="mb-14" aria-label="Live now">
      <div className="mb-5 flex items-end justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-2xl font-bold">
            <Radio className="h-6 w-6 text-red-500" /> Live now
          </h2>
          <p className="mt-1 text-sm text-white/50">Creators broadcasting on the site right now — jump in.</p>
        </div>
        <Link href="/go-live" className="text-sm text-[#e8c86a]/80 hover:text-[#e8c86a]">Go live →</Link>
      </div>

      {error ? (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-[#0d0a02] p-4">
          <p className="flex items-center gap-2 text-sm text-white/60">
            <AlertTriangle className="h-4 w-4 text-amber-400" /> Couldn't load who's live right now.
          </p>
          <button type="button" onClick={load} className="inline-flex items-center gap-1.5 rounded-full border border-[#e8c86a]/40 px-3 py-1 text-xs font-bold text-[#e8c86a] hover:bg-[#e8c86a]/10">
            <RotateCcw className="h-3.5 w-3.5" /> Retry
          </button>
        </div>
      ) : streams === null ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-28 animate-pulse rounded-xl border border-white/5 bg-white/[0.03]" />
          ))}
        </div>
      ) : streams.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/15 bg-[#0d0a02] px-4 py-8 text-center">
          <Radio className="mx-auto mb-2 h-8 w-8 text-[#e8c86a]/50" />
          <p className="text-sm font-bold text-white/70">Nobody's live right now.</p>
          <p className="mx-auto mt-1 max-w-xs text-xs text-white/40">
            Be the first on air — the studio is in the Go Live hub, and your stream lands right here.
          </p>
          <Link href="/go-live" className="mt-3 inline-block rounded-full bg-[#e8c86a] px-4 py-1.5 text-xs font-bold text-black hover:bg-[#f5d67e]">
            Open the studio
          </Link>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {streams.map((s) => (
            <div key={s.id} className="rounded-xl border border-white/10 bg-[#0d0a02] p-4 transition hover:border-red-400/40">
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-red-600 px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider text-white">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" /> Live
                </span>
                <span className="inline-flex items-center gap-1 text-xs text-white/50">
                  <Users className="h-3.5 w-3.5" /> {s.viewer_count}
                </span>
              </div>
              <Link href={`/live/${s.id}`} className="mt-2 block truncate font-bold hover:text-[#e8c86a]" data-testid={`live-card-${s.id}`}>
                {s.title}
              </Link>
              {s.creator && (
                <p className="mt-1 flex items-center gap-2 text-xs text-white/50">
                  {s.creator.avatar_url ? (
                    <img src={s.creator.avatar_url} alt="" className="h-5 w-5 rounded-full object-cover" />
                  ) : (
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#e8c86a]/20 text-[10px] font-bold text-[#e8c86a]">
                      {s.creator.display_name[0] ?? "?"}
                    </span>
                  )}
                  by{" "}
                  <Link href={`/artist/${s.creator.slug}`} className="text-[#e8c86a] hover:underline">
                    {s.creator.display_name}
                  </Link>
                </p>
              )}
              <Link href={`/live/${s.id}`} className="mt-3 inline-block rounded-full bg-red-600 px-3 py-1 text-xs font-bold text-white hover:bg-red-500">
                Watch
              </Link>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
