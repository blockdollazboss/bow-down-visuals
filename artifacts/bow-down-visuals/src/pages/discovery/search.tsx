import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { Search as SearchIcon, Users, Disc3, Clapperboard, ListMusic, Loader2 } from "lucide-react";
import {
  CreatorCard, TrackRow, VideoCard, SectionHeader,
  CardSkeleton, ChartSkeleton, NoSearchResults,
  type CreatorLite, type TrackLite, type VideoLite,
} from "@/components/discovery/cards";
import { useFollowStates, CreateCta } from "@/components/discovery/FollowButton";
import { ShareMenu } from "@/components/discovery/ShareMenu";
import { VERTICALS, VERTICAL_META, verticalLabel, type VerticalKey } from "@/lib/verticals";
import { resolveMedia, formatCount } from "@/lib/streaming";

/* ─── /search — one box across the whole creator universe ─────────────────
   Creators, audio, videos, playlists. Vertical + genre filter chips.
   Never gated at any star level. */

type SearchType = "all" | "creator" | "track" | "video" | "playlist";

interface PlaylistLite {
  id: string;
  title: string;
  description: string | null;
  cover_url: string | null;
  follower_count: number;
  slug?: string;
  display_name?: string;
}

interface SearchPayload {
  q: string;
  creators?: CreatorLite[];
  tracks?: TrackLite[];
  videos?: VideoLite[];
  playlists?: PlaylistLite[];
}

const TYPE_TABS: Array<{ key: SearchType; label: string; icon: React.ReactNode }> = [
  { key: "all", label: "Everything", icon: <SearchIcon className="h-4 w-4" /> },
  { key: "creator", label: "Creators", icon: <Users className="h-4 w-4" /> },
  { key: "track", label: "Audio", icon: <Disc3 className="h-4 w-4" /> },
  { key: "video", label: "Videos", icon: <Clapperboard className="h-4 w-4" /> },
  { key: "playlist", label: "Playlists", icon: <ListMusic className="h-4 w-4" /> },
];

async function getJson<T>(path: string): Promise<T | null> {
  try {
    const r = await fetch(path, { headers: { Accept: "application/json" } });
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  }
}

function PlaylistCard({ playlist }: { playlist: PlaylistLite }) {
  return (
    <div className="group flex items-center gap-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4 transition-colors hover:border-[#e8c86a]/40">
      <Link href={`/playlist/${playlist.id}`} className="shrink-0 cursor-pointer">
        {playlist.cover_url ? (
          <img src={resolveMedia(playlist.cover_url)} alt="" className="h-16 w-16 rounded-xl object-cover" loading="lazy" />
        ) : (
          <div className="flex h-16 w-16 items-center justify-center rounded-xl bg-gradient-to-b from-[#2a2118] to-[#0b0603]">
            <ListMusic className="h-6 w-6 text-[#e8c86a]" />
          </div>
        )}
      </Link>
      <div className="min-w-0 flex-1">
        <Link href={`/playlist/${playlist.id}`}>
          <h3 className="cursor-pointer truncate font-bold group-hover:text-[#e8c86a]">{playlist.title}</h3>
        </Link>
        <p className="truncate text-xs text-white/40">
          {playlist.display_name ? (
            <Link href={`/artist/${playlist.slug}`} className="hover:text-[#e8c86a]">{playlist.display_name}</Link>
          ) : "Playlist"}
          {` · ${formatCount(playlist.follower_count)} followers`}
        </p>
      </div>
      <ShareMenu path={`/playlist/${playlist.id}`} title={playlist.title} compact />
    </div>
  );
}

export default function Search() {
  const [location] = useLocation();
  const initialQ = useMemo(() => {
    const m = /[?&]q=([^&]*)/.exec(location);
    return m ? decodeURIComponent(m[1].replace(/\+/g, " ")) : "";
  }, [location]);

  const [q, setQ] = useState(initialQ);
  const [committedQ, setCommittedQ] = useState(initialQ);
  const [type, setType] = useState<SearchType>("all");
  const [vertical, setVertical] = useState<VerticalKey | "all">("all");
  const [genre, setGenre] = useState<string | null>(null);
  const [genres, setGenres] = useState<Array<{ genre: string; items: number }>>([]);
  const [data, setData] = useState<SearchPayload | null>(null);
  const [loading, setLoading] = useState(false);

  // Genre chips follow the vertical filter.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const d = await getJson<{ genres: Array<{ genre: string; items: number }> }>(
        `/api/discovery/genres${vertical === "all" ? "" : `?vertical=${vertical}`}`
      );
      if (!cancelled) setGenres((d?.genres ?? []).slice(0, 12));
    })();
    return () => {
      cancelled = true;
    };
  }, [vertical]);

  useEffect(() => {
    if (!committedQ.trim()) {
      setData(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(async () => {
      const params = new URLSearchParams({
        q: committedQ.trim(),
        type,
        ...(vertical !== "all" ? { vertical } : {}),
        ...(genre ? { genre } : {}),
      });
      const d = await getJson<SearchPayload>(`/api/discovery/search?${params}`);
      if (!cancelled) {
        setData(d);
        setLoading(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [committedQ, type, vertical, genre]);

  const creatorIds = useMemo(() => (data?.creators ?? []).map((c) => c.id), [data]);
  const followStates = useFollowStates(creatorIds);

  const hasResults =
    !!data &&
    ((data.creators?.length ?? 0) + (data.tracks?.length ?? 0) + (data.videos?.length ?? 0) + (data.playlists?.length ?? 0) > 0);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 md:px-6">
      <div className="mb-6 text-center">
        <h1 className="text-3xl font-black tracking-tight md:text-4xl">
          Search the <span className="bg-gradient-to-b from-[#ffe9a8] to-[#c9a84c] bg-clip-text text-transparent">creator universe.</span>
        </h1>
        <p className="mt-2 text-sm text-white/50">
          Creators, audio, videos, playlists — one box. The cheat code rewards the curious.
        </p>
      </div>

      {/* Search box */}
      <form
        className="mx-auto mb-5 flex max-w-2xl items-center gap-2 rounded-full border border-[#c9a84c]/30 bg-black/50 p-2 pl-5 focus-within:border-[#e8c86a]/60"
        onSubmit={(e) => {
          e.preventDefault();
          setCommittedQ(q);
        }}
      >
        <SearchIcon className="h-5 w-5 shrink-0 text-[#e8c86a]" />
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setCommittedQ(e.target.value);
          }}
          placeholder="Search creators, tracks, videos, playlists…"
          className="w-full bg-transparent text-white placeholder:text-white/30 focus:outline-none"
        />
        {loading && <Loader2 className="h-5 w-5 shrink-0 animate-spin text-[#e8c86a]" />}
      </form>

      {/* Type tabs */}
      <div className="mb-4 flex flex-wrap justify-center gap-2">
        {TYPE_TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setType(t.key)}
            className={`flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-bold transition-all ${
              type === t.key
                ? "bg-gradient-to-b from-[#e8c86a] to-[#b08d3e] text-black"
                : "border border-white/15 bg-white/5 text-white/60 hover:border-[#e8c86a]/40 hover:text-white"
            }`}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {/* Vertical chips */}
      <div className="mb-3 flex flex-wrap justify-center gap-2">
        <button
          onClick={() => setVertical("all")}
          className={`rounded-full px-3 py-1 text-xs font-bold ${vertical === "all" ? "bg-white/15 text-white" : "text-white/40 hover:text-white"}`}
        >
          All lanes
        </button>
        {VERTICALS.map((v) => (
          <button
            key={v}
            onClick={() => setVertical(vertical === v ? "all" : v)}
            className={`rounded-full px-3 py-1 text-xs font-bold ${
              vertical === v ? "bg-[#e8c86a] text-black" : "text-white/40 hover:text-white"
            }`}
          >
            {VERTICAL_META[v].label}
          </button>
        ))}
      </div>

      {/* Genre chips */}
      {genres.length > 0 && (
        <div className="mb-8 flex flex-wrap justify-center gap-2">
          {genres.map((g) => (
            <button
              key={g.genre}
              onClick={() => setGenre(genre === g.genre ? null : g.genre)}
              className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                genre === g.genre
                  ? "border-[#e8c86a] bg-[#e8c86a]/15 text-[#e8c86a]"
                  : "border-white/10 text-white/40 hover:border-white/25 hover:text-white"
              }`}
            >
              {g.genre}
            </button>
          ))}
        </div>
      )}

      {/* Results */}
      {!committedQ.trim() ? (
        <NoSearchResults q="" />
      ) : loading && !data ? (
        <div className="grid gap-8 lg:grid-cols-2">
          <ChartSkeleton rows={5} />
          <div className="grid grid-cols-2 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <CardSkeleton key={i} />
            ))}
          </div>
        </div>
      ) : !hasResults ? (
        <NoSearchResults q={committedQ.trim()} />
      ) : (
        <div className="grid gap-10 lg:grid-cols-2">
          <div className="space-y-10">
            {(type === "all" || type === "creator") && (data?.creators?.length ?? 0) > 0 && (
              <section>
                <SectionHeader icon={<Users className="h-5 w-5" />} title="Creators" />
                <div className="grid grid-cols-2 gap-4">
                  {data!.creators!.map((c) => (
                    <CreatorCard key={c.id} creator={c} followState={followStates[c.id]} />
                  ))}
                </div>
              </section>
            )}
            {(type === "all" || type === "track") && (data?.tracks?.length ?? 0) > 0 && (
              <section>
                <SectionHeader icon={<Disc3 className="h-5 w-5" />} title="Audio" />
                <div className="grid gap-3">
                  {data!.tracks!.map((t) => (
                    <TrackRow key={t.id} track={t} />
                  ))}
                </div>
              </section>
            )}
          </div>
          <div className="space-y-10">
            {(type === "all" || type === "video") && (data?.videos?.length ?? 0) > 0 && (
              <section>
                <SectionHeader icon={<Clapperboard className="h-5 w-5" />} title="Videos" />
                <div className="grid gap-4 sm:grid-cols-2">
                  {data!.videos!.map((v) => (
                    <VideoCard key={v.id} video={v} />
                  ))}
                </div>
              </section>
            )}
            {(type === "all" || type === "playlist") && (data?.playlists?.length ?? 0) > 0 && (
              <section>
                <SectionHeader icon={<ListMusic className="h-5 w-5" />} title="Playlists" />
                <div className="grid gap-3">
                  {data!.playlists!.map((pl) => (
                    <PlaylistCard key={pl.id} playlist={pl} />
                  ))}
                </div>
              </section>
            )}
          </div>
        </div>
      )}

      {committedQ.trim() && vertical !== "all" && (
        <p className="mt-8 text-center text-sm text-white/40">
          Browsing the {verticalLabel(vertical)} lane?{" "}
          <Link href={`/vertical/${vertical}`} className="font-bold text-[#e8c86a] hover:underline">
            Open the {VERTICAL_META[vertical].label} hub →
          </Link>
        </p>
      )}

      <CreateCta headline="Can't find it? Be it." />
    </div>
  );
}
