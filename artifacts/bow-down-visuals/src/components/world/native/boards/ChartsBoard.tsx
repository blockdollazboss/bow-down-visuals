import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Check, Play, Plus } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import {
  NativeBoard,
  NativeBoardRow,
  NativeEmptyState,
  NativeErrorState,
  NativeLoadingState,
} from "@/components/world/native";
import {
  followStateFromResponse,
  followUrl,
  followRequest,
  jukeboxTrackId,
  normalizeChartCreators,
  normalizeChartTracks,
  normalizeFollowStates,
  type ChartCreatorRow,
  type ChartTrackRow,
} from "@/lib/world/charts-board";
import { jukeboxDeniedCopy } from "@/lib/world/jukebox-sync";
import { formatCount } from "@/lib/streaming";
import { formatMoney } from "@/components/discovery/cards";

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
   (When the Shelf lane's shared player lands, Play can re-point
   at it here — this board's only playback call is onPlayTrack.) */

type ChartsTab = "tracks" | "creators" | "rising" | "earners";

const TABS: Array<{ key: ChartsTab; label: string }> = [
  { key: "tracks", label: "Tracks" },
  { key: "creators", label: "Creators" },
  { key: "rising", label: "Rising" },
  { key: "earners", label: "Earners" },
];

const TAB_TITLES: Record<ChartsTab, string> = {
  tracks: "Top tracks — this week",
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
}

export function ChartsBoard({ isLight, isGuest, jukeboxDenied, onPlayTrack }: ChartsBoardProps) {
  const { getAccessToken } = useAuth();
  const [tab, setTab] = useState<ChartsTab>("tracks");
  const [tracks, setTracks] = useState<ChartTrackRow[] | null>(null);
  const [creators, setCreators] = useState<Partial<Record<ChartsTab, ChartCreatorRow[]>>>({});
  const [failedTab, setFailedTab] = useState<ChartsTab | null>(null);
  const [tick, setTick] = useState(0);
  const [followStates, setFollowStates] = useState<Record<string, boolean>>({});
  const [followBusy, setFollowBusy] = useState<string | null>(null);
  const [queuedId, setQueuedId] = useState<string | null>(null);

  const authHeaders = async (): Promise<Record<string, string>> => {
    const token = await getAccessToken().catch(() => null);
    return token ? { Authorization: `Bearer ${token}` } : {};
  };

  /* Load the active tab's rows (once per tab; the retry tick
     reloads the failed one). */
  useEffect(() => {
    let cancelled = false;
    const loaded = tab === "tracks" ? tracks !== null : creators[tab] !== undefined;
    if (loaded && failedTab !== tab) return;
    (async () => {
      try {
        if (tab === "tracks") {
          const res = await fetch("/api/discovery/charts?window=week&limit=10");
          if (!res.ok) throw new Error("charts");
          const rows = normalizeChartTracks(await res.json());
          if (!cancelled) {
            setTracks(rows);
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
    failedTab !== tab && (tab === "tracks" ? tracks === null : creators[tab] === undefined);

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
                      <button
                        type="button"
                        data-testid="world-charts-play"
                        onClick={() => play(row)}
                        className={actionBtn}
                      >
                        <Play className="h-3.5 w-3.5" /> Play
                      </button>
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
          to put a track on the room or follow a creator.
        </p>
      )}
    </div>
  );
}
