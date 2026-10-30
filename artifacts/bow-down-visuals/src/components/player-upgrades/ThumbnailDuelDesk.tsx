import { useCallback, useEffect, useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { useIsLightTheme } from "@/hooks/use-is-light-theme";
import { AlertTriangle, Loader2, RotateCcw, Swords } from "lucide-react";
import {
  buildDuelStartPayload,
  duelProgress,
  duelScoreLine,
  duelWinnerLine,
  type CandidateCover,
  type DuelRecord,
  type DuelResults,
} from "@/lib/thumbnail-duels";

/* ─── Thumbnail Duel desk (#174) — docked in Thumbnail Studio ───
   The studio is where covers are made; this is where they fight. The
   creator picks one of their published showcase videos, ships cover A
   (default: the video's current thumbnail) against a challenger B, and
   the audience decides by real clicks: the showcase grid serves both
   covers in rotation, every serve is a counted view, every
   click-through a counted click (one per audience member per cover,
   enforced on the server). At the view target the click leader takes
   over as the video's thumbnail automatically.

   Results here are ALWAYS the platform's real counts — views and
   clicks as numbers; a click rate may ride along, never alone, and no
   winner is ever declared before the server resolves the duel.
   Starting a duel is free: nothing is charged on any rail. */

interface MyVideo {
  id: string;
  slug: string;
  title: string;
  media_type: string;
  thumbnail_url: string | null;
}

function useDuelAuthFetch() {
  const { getAccessToken } = useAuth();
  return useCallback(
    async (path: string, init?: RequestInit) => {
      const token = await getAccessToken();
      if (!token) return null;
      return fetch(path, {
        ...init,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          ...(init?.headers ?? {}),
        },
      });
    },
    [getAccessToken],
  );
}

function CoverSlot({
  label,
  value,
  onChange,
  candidates,
  placeholder,
  isLight,
}: {
  label: string;
  value: string;
  onChange: (url: string) => void;
  candidates: CandidateCover[];
  placeholder: string;
  isLight: boolean;
}) {
  return (
    <div>
      <p className={`text-xs font-bold uppercase tracking-wider mb-1.5 ${isLight ? "text-black/50" : "text-white/50"}`}>
        {label}
      </p>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        maxLength={2048}
        aria-label={label}
        className={`w-full rounded-lg border px-3 py-2 text-sm focus:outline-none ${
          isLight
            ? "bg-black/[0.04] border-black/10 text-black/80 placeholder:text-black/30 focus:border-[#7A5A12]/50"
            : "bg-white/[0.05] border-white/10 text-white placeholder:text-white/25 focus:border-[#e8c86a]/50"
        }`}
      />
      {candidates.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {candidates.map((c) => (
            <button
              key={c.url}
              type="button"
              onClick={() => onChange(c.url)}
              title={c.label}
              aria-label={`Use ${c.label} as ${label}`}
              className={`relative h-12 w-20 overflow-hidden rounded-md border transition ${
                value === c.url
                  ? "border-[#e8c86a] ring-2 ring-[#e8c86a]/50"
                  : isLight
                    ? "border-black/15 hover:border-black/35"
                    : "border-white/15 hover:border-white/40"
              }`}
            >
              <img src={c.url} alt={c.label} className="h-full w-full object-cover" loading="lazy" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function DuelVideoCard({
  video,
  candidates,
  isLight,
}: {
  video: MyVideo;
  candidates: CandidateCover[];
  isLight: boolean;
}) {
  const authFetch = useDuelAuthFetch();
  const { toast } = useToast();
  const [duel, setDuel] = useState<DuelRecord | null>(null);
  const [results, setResults] = useState<DuelResults | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState("");
  const [coverA, setCoverA] = useState("");
  const [coverB, setCoverB] = useState("");
  const [targetViews, setTargetViews] = useState(100);

  const load = useCallback(async () => {
    try {
      const res = await authFetch(`/api/showcase-items/${video.id}/duel`);
      if (res?.ok) {
        const d = await res.json().catch(() => ({}));
        setDuel(d.duel ?? null);
        setResults(d.results ?? null);
      }
    } catch {
      /* the card keeps its last state; the desk-level retry covers us */
    } finally {
      setLoaded(true);
    }
  }, [authFetch, video.id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(key: string, path: string, init?: RequestInit, okMsg?: string) {
    setBusy(key);
    try {
      const res = await authFetch(path, init);
      const data = await res?.json().catch(() => ({}));
      if (!res || !res.ok) throw new Error(data?.error || "Something went wrong.");
      if (data?.duel) {
        setDuel(data.duel);
        if (data.results) setResults(data.results);
      }
      if (okMsg) toast({ title: okMsg });
      if (!data?.duel) await load();
    } catch (err) {
      toast({
        title: "That didn't work",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setBusy("");
    }
  }

  const cardCls = isLight
    ? "rounded-xl border border-black/10 bg-black/[0.02] p-4"
    : "rounded-xl border border-white/10 bg-white/[0.02] p-4";
  const muted = isLight ? "text-black/50" : "text-white/50";
  const running = duel?.status === "running";
  const resolved = duel?.status === "resolved";
  const payload = buildDuelStartPayload({ coverAUrl: coverA, coverBUrl: coverB, targetViews });
  const winnerLine = duel && results ? duelWinnerLine(duel, results) : null;
  const progress = results ? duelProgress(results) : null;

  return (
    <div className={cardCls}>
      <div className="flex items-center gap-3 mb-3">
        {video.thumbnail_url ? (
          <img src={video.thumbnail_url} alt="" className="h-11 w-[4.9rem] rounded-md object-cover shrink-0" loading="lazy" />
        ) : null}
        <div className="min-w-0">
          <p className={`font-bold truncate ${isLight ? "text-black/80" : "text-white"}`}>{video.title}</p>
          <Link href={`/showcase/${video.slug}`} className={`text-xs underline ${muted}`}>
            View on the showcase
          </Link>
        </div>
        {running && (
          <span className={`ml-auto shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${isLight ? "bg-[#7A5A12]/10 text-[#7A5A12]" : "bg-[#e8c86a]/10 text-[#e8c86a]"}`}>
            Duel running
          </span>
        )}
        {resolved && (
          <span className={`ml-auto shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${isLight ? "bg-emerald-700/10 text-emerald-800" : "bg-emerald-400/10 text-emerald-300"}`}>
            Duel decided
          </span>
        )}
      </div>

      {!loaded ? (
        <p className={`text-sm ${muted}`}>Loading duel state…</p>
      ) : running || resolved ? (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            {(["a", "b"] as const).map((cover) => (
              <div key={cover} className={`rounded-lg border overflow-hidden ${isLight ? "border-black/10" : "border-white/10"}`}>
                <div className="relative aspect-video">
                  <img
                    src={cover === "a" ? duel!.cover_a_url : duel!.cover_b_url}
                    alt={`Cover ${cover.toUpperCase()}`}
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                  {duel!.winner === cover && (
                    <span className="absolute left-2 top-2 rounded-full bg-black/70 px-2 py-0.5 text-[10px] font-bold text-[#e8c86a]">
                      👑 Winner
                    </span>
                  )}
                </div>
                <p className={`px-3 py-2 text-xs ${isLight ? "text-black/60" : "text-white/60"}`}>
                  {results ? duelScoreLine(cover, results) : `Cover ${cover.toUpperCase()}`}
                </p>
              </div>
            ))}
          </div>
          {running && progress && (
            <div>
              <div className={`h-1.5 rounded-full overflow-hidden ${isLight ? "bg-black/10" : "bg-white/10"}`}>
                <div
                  className="h-full bg-[#c9a84c] transition-all"
                  style={{ width: `${progress.pct}%` }}
                />
              </div>
              <p className={`mt-1.5 text-xs ${muted}`}>
                {progress.counted} of {progress.target} views counted so far — the winner takes
                over automatically when the count lands and one cover leads on clicks.
              </p>
            </div>
          )}
          {winnerLine && (
            <p className={`text-sm font-semibold ${isLight ? "text-emerald-800" : "text-emerald-300"}`}>{winnerLine}</p>
          )}
          {running && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy === "cancel"}
              onClick={() => void act("cancel", `/api/showcase-items/${video.id}/duel/cancel`, { method: "POST" }, "Duel cancelled")}
              className={isLight ? "border-black/15 text-black/60 text-xs" : "border-white/15 text-white/70 text-xs"}
            >
              {busy === "cancel" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Cancel duel"}
            </Button>
          )}
          {resolved && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setDuel(null);
                setResults(null);
                setCoverA("");
                setCoverB("");
              }}
              className={`${muted} text-xs`}
            >
              Start a new duel for this video
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <p className={`text-sm ${muted}`}>
            Pit this video's cover against a challenger. The showcase serves both in rotation and
            counts real views and clicks — the winner takes over as the thumbnail automatically.
          </p>
          <div className="grid gap-3 md:grid-cols-2">
            <CoverSlot
              label="Cover A — defending"
              value={coverA}
              onChange={setCoverA}
              candidates={candidates}
              placeholder={video.thumbnail_url ? "Blank = the video's current thumbnail" : "Cover A image URL"}
              isLight={isLight}
            />
            <CoverSlot
              label="Cover B — challenger"
              value={coverB}
              onChange={setCoverB}
              candidates={candidates}
              placeholder="Challenger cover image URL"
              isLight={isLight}
            />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label className={`text-xs ${muted}`}>
              Views before a winner can be called{" "}
              <input
                type="number"
                min={20}
                max={10000}
                value={targetViews}
                onChange={(e) => setTargetViews(Number(e.target.value) || 100)}
                className={`ml-1 w-24 rounded-lg border px-2 py-1.5 text-sm focus:outline-none ${
                  isLight
                    ? "bg-black/[0.04] border-black/10 text-black/80 focus:border-[#7A5A12]/50"
                    : "bg-white/[0.05] border-white/10 text-white focus:border-[#e8c86a]/50"
                }`}
              />
            </label>
            <Button
              size="sm"
              disabled={busy === "start" || !payload}
              onClick={() =>
                payload &&
                void act(
                  "start",
                  `/api/showcase-items/${video.id}/duel`,
                  { method: "POST", body: JSON.stringify(payload) },
                  "Duel started — your audience decides",
                )
              }
              className="bg-gradient-to-b from-[#e8c86a] to-[#b08d3e] text-black hover:brightness-110 text-xs"
            >
              {busy === "start" ? <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" /> : null}
              Start duel — free
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export function ThumbnailDuelDesk({ candidateCovers }: { candidateCovers: CandidateCover[] }) {
  const isLight = useIsLightTheme();
  const authFetch = useDuelAuthFetch();
  const [videos, setVideos] = useState<MyVideo[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    let live = true;
    setLoadError(false);
    authFetch("/api/showcase/mine")
      .then(async (res) => {
        if (!res || !res.ok) throw new Error("load failed");
        const d = await res.json().catch(() => ({}));
        if (!live) return;
        const items = Array.isArray(d.items) ? (d.items as MyVideo[]) : [];
        setVideos(items.filter((i) => i.media_type === "video").slice(0, 24));
      })
      .catch(() => {
        if (live) setLoadError(true);
      });
    return () => {
      live = false;
    };
  }, [authFetch, retryNonce]);

  return (
    <div
      className={
        isLight
          ? "rounded-2xl border border-black/10 bg-[#F7F1E3] p-6 md:p-8"
          : "rounded-2xl border border-white/10 bg-[#0a0a0a] p-6 md:p-8"
      }
    >
      <div className="flex items-center gap-2 mb-1">
        <Swords className={`h-5 w-5 ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`} />
        <h3 className={isLight ? "text-lg font-bold text-black/80" : "text-lg font-bold text-white"}>
          Thumbnail Duels — let your audience decide
        </h3>
      </div>
      <p className={`text-sm mt-1 mb-5 ${isLight ? "text-black/50" : "text-white/50"}`}>
        The AI test above is a prediction. A duel is the real thing: two covers on your published
        video, served in rotation, judged by real audience clicks — and the winner becomes your
        thumbnail on its own. Every result below is the platform's own counts.
      </p>

      {loadError ? (
        <div className={`rounded-xl border p-6 text-center ${isLight ? "border-black/10" : "border-white/10"}`}>
          <AlertTriangle className="mx-auto h-8 w-8 text-primary" />
          <p className={`mt-2 font-bold ${isLight ? "text-black/80" : "text-white"}`}>Couldn't load your videos.</p>
          <p className={`mt-1 text-sm ${isLight ? "text-black/50" : "text-white/50"}`}>
            Your videos and duels are safe — this desk just couldn't reach them.
          </p>
          <button
            type="button"
            onClick={() => setRetryNonce((n) => n + 1)}
            className="mt-3 inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2 text-sm font-bold text-black hover:brightness-110"
          >
            <RotateCcw className="h-4 w-4" /> Try again
          </button>
        </div>
      ) : videos === null ? (
        <p className={`text-sm ${isLight ? "text-black/40" : "text-white/40"}`}>Loading your published videos…</p>
      ) : videos.length === 0 ? (
        <div className={`rounded-xl border p-6 text-center ${isLight ? "border-black/10" : "border-white/10"}`}>
          <p className={isLight ? "text-black/60" : "text-white/60"}>
            No published videos yet — duels run on videos you've published to the showcase.
          </p>
          <p className={`mt-1 text-sm ${isLight ? "text-black/40" : "text-white/40"}`}>
            Publish a video from its page or your creations, then come back and pit its covers
            against each other.
          </p>
          <Link href="/showcase">
            <Button variant="outline" size="sm" className={`mt-3 ${isLight ? "border-black/15 text-black/70" : "border-white/15 text-white/70"}`}>
              Open the showcase
            </Button>
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          {videos.map((v) => (
            <DuelVideoCard key={v.id} video={v} candidates={candidateCovers} isLight={isLight} />
          ))}
        </div>
      )}
    </div>
  );
}
