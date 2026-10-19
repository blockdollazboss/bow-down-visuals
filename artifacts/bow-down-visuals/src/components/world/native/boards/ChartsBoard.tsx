import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Check, Heart, ListPlus, Play, Plus } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import {
  NativeBoard,
  NativeBoardRow,
  NativeEmptyState,
  NativeErrorState,
  NativeLoadingState,
} from "@/components/world/native";
import {
  chartLikeIdsParam,
  chartLikeKey,
  chartTrackPlayInput,
  chartVideoPlayInput,
  followStateFromResponse,
  followUrl,
  followRequest,
  jukeboxTrackId,
  likeStateFromToggle,
  normalizeChartCreators,
  normalizeChartTracks,
  normalizeChartVideos,
  normalizeFollowStates,
  normalizeLikeStates,
  type ChartCreatorRow,
  type ChartTrackRow,
  type ChartVideoRow,
} from "@/lib/world/charts-board";
import { jukeboxDeniedCopy } from "@/lib/world/jukebox-sync";
import { formatCount, toggleLike, type MediaKind } from "@/lib/streaming";
import { formatMoney } from "@/components/discovery/cards";
import type { ShelfPlayerController } from "@/components/world/native/ShelfPlayer";

/* ─── ChartsBoard — The Charts as a palace board (NATIVE-PLAN §3.1) ──
   The Music Hall's charts desk, rebuilt in-world: climbing tracks
   and creators as board rows (the discovery endpoints the /charts
   page rides), one action per row. A track's Play hands it to the
   room's jukebox through the host's onJukeboxAdd prop — the exact
   seam the Jukebox panel uses (props through StationPanel from
   pages/world.tsx): the pick rides the room socket, the server
   re-verifies the published track, and the room hears it through
   the page's audio element. A creator's Follow rides the same
   follow endpoints the charts page's buttons use. Guests browse
   freely (the station is open); Play and Follow are member acts —
   the jukebox client refuses guests outright, so guests are told,
   not handed dead buttons.
   Ring 2 (2.27): every media row carries a Like on the media rails;
   the Videos tab plays chart videos in-world on the Shelf player
   (the host's shelfPlayer prop — the same one player the Booth
   feeds), and tracks gain Play here / Queue next on that player
   alongside the room-jukebox Play, which stays the shared moment.
   The hearts open on the walker's REAL state: one batched read
   (GET /api/discovery/likes — the follow read's media twin) seeds
   them, so a row already liked shows it before the first tap. */

type ChartsTab = "tracks" | "videos" | "creators" | "rising" | "earners";

const TABS: Array<{ key: ChartsTab; label: string }> = [
  { key: "tracks", label: "Tracks" },
  { key: "videos", label: "Videos" },
  { key: "creators", label: "Creators" },
  { key: "rising", label: "Rising" },
  { key: "earners", label: "Earners" },
];

const TAB_TITLES: Record<ChartsTab, string> = {
  tracks: "Top tracks — this week",
  videos: "Top videos — this week",
  creators: "Top creators — this week",
  rising: "Rising — gaining fastest this week",
  earners: "Rising earners — last 30 days",
};

function fmtClock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export interface ChartsBoardProps {
  isLight: boolean;
  isGuest: boolean;
  jukeboxDenied: string | null;
  /** Put a track on the room's jukebox (the host's jukebox intent,
   *  fed the `track:<uuid>` catalog id — see charts-board.ts). */
  onPlayTrack: (trackId: string) => void;
  /** The one in-world personal player (2.27): chart videos play on
   *  it in-world, and chart tracks can play here / queue next on it.
   *  Optional — without it the board keeps its jukebox + follow
   *  shape exactly as Ring 1 shipped. */
  shelfPlayer?: ShelfPlayerController;
}

export function ChartsBoard({ isLight, isGuest, jukeboxDenied, onPlayTrack, shelfPlayer }: ChartsBoardProps) {
  const { getAccessToken } = useAuth();
  const [tab, setTab] = useState<ChartsTab>("tracks");
  const [tracks, setTracks] = useState<ChartTrackRow[] | null>(null);
  const [videos, setVideos] = useState<ChartVideoRow[] | null>(null);
  const [creators, setCreators] = useState<Partial<Record<ChartsTab, ChartCreatorRow[]>>>({});
  const [failedTab, setFailedTab] = useState<ChartsTab | null>(null);
  const [tick, setTick] = useState(0);
  const [followStates, setFollowStates] = useState<Record<string, boolean>>({});
  const [followBusy, setFollowBusy] = useState<string | null>(null);
  const [queuedId, setQueuedId] = useState<string | null>(null);
  const [likeStates, setLikeStates] = useState<Record<string, { liked: boolean; count: number }>>({});
  const [likeBusy, setLikeBusy] = useState<string | null>(null);
  const [shelfNote, setShelfNote] = useState<string | null>(null);

  const authHeaders = async (): Promise<Record<string, string>> => {
    const token = await getAccessToken().catch(() => null);
    return token ? { Authorization: `Bearer ${token}` } : {};
  };

  /* Load the active tab's rows (once per tab; the retry tick
     reloads the failed one). */
  useEffect(() => {
    let cancelled = false;
    const loaded =
      tab === "tracks" ? tracks !== null : tab === "videos" ? videos !== null : creators[tab] !== undefined;
    if (loaded && failedTab !== tab) return;
    (async () => {
      try {
        if (tab === "tracks" || tab === "videos") {
          /* One payload carries both keys — the tracks and videos
             tabs are two views of the same chart read. */
          const res = await fetch("/api/discovery/charts?window=week&limit=10");
          if (!res.ok) throw new Error("charts");
          const payload = await res.json();
          if (!cancelled) {
            setTracks(normalizeChartTracks(payload));
            setVideos(normalizeChartVideos(payload));
            setFailedTab(null);
          }
        } else {
          const path =
            tab === "creators"
              ? "/api/discovery/charts/creators?window=week&limit=10"
              : tab === "rising"
                ? "/api/discovery/rising?limit=12"
                : "/api/discovery/rising-earners?limit=12";
          const res = await fetch(path);
          if (!res.ok) throw new Error("creators");
          const rows = normalizeChartCreators(await res.json(), tab);
          if (!cancelled) {
            setCreators((prev) => ({ ...prev, [tab]: rows }));
            setFailedTab(null);
          }
        }
      } catch {
        if (!cancelled) setFailedTab(tab);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, tick]);

  /* The walker's follow state for the creator rows on show —
     one batched read, members only (the page's own pattern). */
  const creatorRows = tab === "tracks" ? [] : (creators[tab] ?? []);
  const creatorKey = creatorRows.map((c) => c.id).join(",");
  useEffect(() => {
    if (isGuest || !creatorKey) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/discovery/following?ids=${encodeURIComponent(creatorKey)}`, {
          headers: await authHeaders(),
        });
        if (!res.ok) return;
        const states = normalizeFollowStates(await res.json());
        if (!cancelled) setFollowStates((prev) => ({ ...prev, ...states }));
      } catch {
        /* unknown state — the toggle still works off the response */
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [creatorKey, isGuest]);

  /* The walker's like state for the media rows on show — one
     batched read, members only (the follow read's pattern, media
     twin). Seeds only hearts not already settled this sitting: a
     toggle's server answer is never overwritten by a late seed. */
  const likeIdsParam = chartLikeIdsParam(tracks ?? [], videos ?? []);
  useEffect(() => {
    if (isGuest || !likeIdsParam) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/discovery/likes?ids=${encodeURIComponent(likeIdsParam)}`, {
          headers: await authHeaders(),
        });
        if (!res.ok) return;
        const states = normalizeLikeStates(await res.json());
        if (cancelled) return;
        const countByKey = new Map<string, number>();
        for (const r of tracks ?? []) countByKey.set(chartLikeKey("track", r.id), r.likeCount);
        for (const r of videos ?? []) countByKey.set(chartLikeKey("video", r.id), r.likeCount);
        setLikeStates((prev) => {
          const next = { ...prev };
          for (const [key, liked] of Object.entries(states)) {
            if (!(key in next)) next[key] = { liked, count: countByKey.get(key) ?? 0 };
          }
          return next;
        });
      } catch {
        /* unknown state — hearts open on the chart counts and the
           toggle still settles them from the server's answer */
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [likeIdsParam, isGuest]);

  const toggleFollow = async (row: ChartCreatorRow) => {
    if (followBusy) return;
    const following = followStates[row.id] === true;
    setFollowBusy(row.id);
    try {
      const { method } = followRequest(following);
      const res = await fetch(followUrl(row.id, following), {
        method,
        headers: await authHeaders(),
      });
      const state = followStateFromResponse(await res.json().catch(() => null));
      if (res.ok && state) {
        setFollowStates((prev) => ({ ...prev, [row.id]: state.followed }));
      } else if (res.ok) {
        setFollowStates((prev) => ({ ...prev, [row.id]: !following }));
      }
    } catch {
      /* the button just doesn't flip — no toast spam in-world */
    } finally {
      setFollowBusy(null);
    }
  };

  const play = (row: ChartTrackRow) => {
    onPlayTrack(jukeboxTrackId(row.id));
    setQueuedId(row.id);
  };

  /* Per-row Like (2.27): the media like rails, keyed per kind+id so
     a track and a video never share a heart. The fold takes the
     server's answer (lib/world/charts-board likeStateFromToggle);
     on failure nothing flips — the heart never pretends. A row not
     yet seeded by the batched read opens unlit on its chart count,
     and its first toggle settles it from the server's answer. */
  const toggleRowLike = async (kind: MediaKind, id: string, startCount: number) => {
    const key = chartLikeKey(kind, id);
    if (likeBusy === key) return;
    const current = likeStates[key] ?? { liked: false, count: startCount };
    setLikeBusy(key);
    try {
      const res = await toggleLike(kind, id, current.liked, await authHeaders());
      setLikeStates((prev) => ({ ...prev, [key]: likeStateFromToggle(current, res) }));
    } catch {
      /* the heart just doesn't flip — no toast spam in-world */
    } finally {
      setLikeBusy(null);
    }
  };

  const likeButton = (kind: MediaKind, id: string, startCount: number) => {
    const key = chartLikeKey(kind, id);
    const state = likeStates[key] ?? { liked: false, count: startCount };
    return (
      <button
        type="button"
        data-testid="world-charts-like"
        onClick={() => void toggleRowLike(kind, id, startCount)}
        disabled={likeBusy === key}
        className={
          state.liked
            ? "inline-flex items-center gap-1.5 rounded-full border border-[#d4af37] bg-[#d4af37]/15 px-3 py-1.5 text-xs font-bold text-[#e8c86a] transition disabled:opacity-50"
            : actionBtn
        }
      >
        <Heart className={`h-3.5 w-3.5 ${state.liked ? "fill-[#d4af37] text-[#d4af37]" : ""}`} />
        {formatCount(state.count)}
      </button>
    );
  };

  /* Play-here / queue-next on the Shelf player (2.27): chart rows
     carry their stream URL, so no extra fetch stands between the
     tap and the sound. Videos only ever play this way — the room
     jukebox is audio-only. */
  const playTrackHere = (row: ChartTrackRow) => {
    if (!shelfPlayer) return;
    const input = chartTrackPlayInput(row);
    if (!input) return;
    shelfPlayer.play(input);
    setShelfNote(`“${row.title}” is playing on your player — just you, here in the hall.`);
  };

  const queueTrackNext = (row: ChartTrackRow) => {
    if (!shelfPlayer) return;
    const input = chartTrackPlayInput(row);
    if (!input) return;
    shelfPlayer.queueNext(input);
    setShelfNote(`“${row.title}” is up next on your player.`);
  };

  const playVideoHere = (row: ChartVideoRow) => {
    if (!shelfPlayer) return;
    const input = chartVideoPlayInput(row);
    if (!input) return;
    shelfPlayer.play(input);
    setShelfNote(`“${row.title}” is playing on your player — watch it right here in the hall.`);
  };

  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const tabBtn = (active: boolean) =>
    `rounded-full px-3.5 py-1.5 text-xs font-bold transition ${
      active
        ? "bg-[#d4af37] text-black"
        : isLight
          ? "border border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]"
          : "border border-white/15 text-white/75 hover:text-white"
    }`;
  const actionBtn = `inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition ${
    isLight
      ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]"
      : "border-white/15 text-white/75 hover:text-white"
  }`;

  const loading =
    failedTab !== tab &&
    (tab === "tracks" ? tracks === null : tab === "videos" ? videos === null : creators[tab] === undefined);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Charts">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            data-testid={`world-charts-tab-${t.key}`}
            onClick={() => setTab(t.key)}
            className={tabBtn(tab === t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {failedTab === tab ? (
        <NativeErrorState
          isLight={isLight}
          title="The charts wouldn't open"
          message="The board itself is fine — the kingdom's counts didn't answer. Your place in the room is untouched."
          onRetry={() => setTick((n) => n + 1)}
        />
      ) : loading ? (
        <NativeLoadingState isLight={isLight} message="Reading the charts…" />
      ) : (
        <NativeBoard isLight={isLight} title={TAB_TITLES[tab]}>
          {tab === "tracks" ? (
            (tracks ?? []).length === 0 ? (
              <NativeEmptyState
                isLight={isLight}
                message="Nothing is charting this week — yet."
                detail="The lane is wide open. Publish a track and the first row is yours."
              />
            ) : (
              (tracks ?? []).map((row, i) => (
                <NativeBoardRow
                  key={row.id}
                  isLight={isLight}
                  title={`#${i + 1} ${row.title}`}
                  detail={
                    [row.creatorName, row.genre, row.durationSec ? fmtClock(row.durationSec) : null]
                      .filter(Boolean)
                      .join(" · ") || undefined
                  }
                  meta={`${formatCount(row.plays)} plays`}
                  highlighted={i === 0}
                  action={
                    isGuest ? undefined : (
                      <>
                        {likeButton("track", row.id, row.likeCount)}
                        <button
                          type="button"
                          data-testid="world-charts-play"
                          onClick={() => play(row)}
                          className={actionBtn}
                        >
                          <Play className="h-3.5 w-3.5" /> Play
                        </button>
                        {shelfPlayer && chartTrackPlayInput(row) && (
                          <button
                            type="button"
                            data-testid="world-charts-play-here"
                            onClick={() => playTrackHere(row)}
                            className={actionBtn}
                          >
                            <Play className="h-3.5 w-3.5" /> Play here
                          </button>
                        )}
                        {shelfPlayer && chartTrackPlayInput(row) && (
                          <button
                            type="button"
                            data-testid="world-charts-queue-next"
                            onClick={() => queueTrackNext(row)}
                            className={actionBtn}
                          >
                            <ListPlus className="h-3.5 w-3.5" /> Queue next
                          </button>
                        )}
                      </>
                    )
                  }
                />
              ))
            )
          ) : tab === "videos" ? (
            (videos ?? []).length === 0 ? (
              <NativeEmptyState
                isLight={isLight}
                message="No videos are charting this week — yet."
                detail="Publish a video and the first row is yours."
              />
            ) : (
              (videos ?? []).map((row, i) => (
                <NativeBoardRow
                  key={row.id}
                  isLight={isLight}
                  title={`#${i + 1} ${row.title}`}
                  detail={
                    [row.creatorName, row.genre, row.durationSec ? fmtClock(row.durationSec) : null]
                      .filter(Boolean)
                      .join(" · ") || undefined
                  }
                  meta={`${formatCount(row.plays)} views`}
                  highlighted={i === 0}
                  action={
                    isGuest ? undefined : (
                      <>
                        {likeButton("video", row.id, row.likeCount)}
                        {shelfPlayer && chartVideoPlayInput(row) && (
                          <button
                            type="button"
                            data-testid="world-charts-video-play"
                            onClick={() => playVideoHere(row)}
                            className={actionBtn}
                          >
                            <Play className="h-3.5 w-3.5" /> Watch here
                          </button>
                        )}
                      </>
                    )
                  }
                />
              ))
            )
          ) : creatorRows.length === 0 ? (
            <NativeEmptyState
              isLight={isLight}
              message={
                tab === "rising"
                  ? "Nobody is breaking through this week — yet."
                  : tab === "earners"
                    ? "No earners on the board yet."
                    : "No creators are charting this week — yet."
              }
              detail="Check back as the kingdom plays — or be the name that fills the first row."
            />
          ) : (
            creatorRows.map((row, i) => {
              const following = followStates[row.id] === true;
              return (
                <NativeBoardRow
                  key={row.id}
                  isLight={isLight}
                  title={`#${i + 1} ${row.displayName}`}
                  detail={
                    [
                      row.vertical,
                      `${formatCount(row.followerCount)} followers`,
                      row.newFollowers !== null ? `+${formatCount(row.newFollowers)} this week` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ") || undefined
                  }
                  meta={
                    row.earnedCents30d !== null
                      ? `${formatMoney(row.earnedCents30d)}/mo`
                      : `${formatCount(row.totalPlays)} plays`
                  }
                  highlighted={i === 0}
                  action={
                    isGuest ? undefined : (
                      <button
                        type="button"
                        data-testid="world-charts-follow"
                        onClick={() => void toggleFollow(row)}
                        disabled={followBusy === row.id}
                        className={
                          following
                            ? actionBtn
                            : "inline-flex items-center gap-1.5 rounded-full bg-[#d4af37] px-3 py-1.5 text-xs font-bold text-black transition hover:scale-105 disabled:opacity-50"
                        }
                      >
                        {following ? <Check className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
                        {following ? "Following" : "Follow"}
                      </button>
                    )
                  }
                />
              );
            })
          )}
        </NativeBoard>
      )}

      {queuedId && !jukeboxDenied && (
        <p className={`px-1 text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>
          On the room&rsquo;s jukebox — it plays for everyone in the Music Hall.
        </p>
      )}
      {shelfNote && (
        <p className={`px-1 text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>
          {shelfNote}
        </p>
      )}
      {jukeboxDenied && (
        <p className={`px-1 text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>
          {jukeboxDeniedCopy(jukeboxDenied)}
        </p>
      )}
      {isGuest && (
        <p className={`px-1 text-xs ${muted}`}>
          Guests read the board freely —{" "}
          <Link href="/login" className="font-bold text-[#d4af37] underline underline-offset-2">
            sign in
          </Link>{" "}
          to put a track on the room, play or watch rows here, like a row, or follow a creator.
        </p>
      )}
    </div>
  );
}
