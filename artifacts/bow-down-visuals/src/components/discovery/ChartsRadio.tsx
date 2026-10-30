import { useIsLightTheme } from "@/hooks/use-is-light-theme";
import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { Radio, Play, Pause, SkipForward, AlertTriangle, RotateCcw } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import {
  normalizeRadioPayload,
  nextRadioIndex,
  radioEntryBadge,
  radioResumeHint,
  type RadioStationPayload,
} from "@/lib/charts-radio";
import { formatCount } from "@/lib/streaming";

/* ─── Charts Radio (Stack-200 #156) ───────────────────────────────────
   The house's 24/7 station, docked where listeners already are: the
   Charts page and the World plaza. The rotation is the server's
   (GET /api/discovery/radio — the real week chart interleaved with
   the newest drops); this panel only plays it.

   Smart law: NOTHING here autoplays. The audio element is created
   idle; sound starts only when the listener presses play — on load,
   on resume, on every surface. A signed-in listener's tuned-in
   choice is remembered (PATCH /radio/prefs) purely so the panel can
   offer the resume hint next visit. Listening is free. */

export function ChartsRadioPanel({
  compact = false,
  volumeScale = 1,
}: {
  compact?: boolean;
  /** A host surface's master fader, applied to the station element
   *  in series (the World's master volume passes its gain when the
   *  panel stands in the World). The Charts page passes nothing —
   *  the station sounds at full level there, as it always has. The
   *  radio holds no volume of its own; the scale IS its volume. */
  volumeScale?: number;
}) {
  const isLight = useIsLightTheme();
  const { user, getAccessToken } = useAuth();
  const [station, setStation] = useState<RadioStationPayload | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);
  const [tunedInBefore, setTunedInBefore] = useState(false);
  const [current, setCurrent] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/discovery/radio?limit=24", {
          headers: { Accept: "application/json" },
        });
        if (!r.ok) throw new Error("radio load failed");
        const data = normalizeRadioPayload(await r.json());
        if (!cancelled) {
          setStation(data);
          setLoadError(false);
        }
      } catch {
        if (!cancelled) setLoadError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [retryNonce]);

  /* The resume hint: read the member's remembered choice. Guests
     simply don't get the hint — the station is public to hear. */
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const token = await getAccessToken();
        if (!token) return;
        const r = await fetch("/api/discovery/radio/prefs", {
          headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
        });
        if (!r.ok) return;
        const d = (await r.json()) as { tuned_in?: boolean };
        if (!cancelled) setTunedInBefore(d.tuned_in === true);
      } catch {
        /* the hint is a nicety; its absence is honest silence */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, getAccessToken]);

  const rememberTunedIn = async () => {
    if (!user) return;
    try {
      const token = await getAccessToken();
      if (!token) return;
      await fetch("/api/discovery/radio/prefs", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ tuned_in: true }),
      });
    } catch {
      /* remembering is best-effort; playback never depends on it */
    }
  };

  const rotation = station?.rotation ?? [];

  const startAt = (idx: number) => {
    const entry = rotation[idx];
    if (!entry) return;
    if (!audioRef.current) audioRef.current = new Audio();
    const el = audioRef.current;
    el.volume = Math.min(1, Math.max(0, volumeScale));
    el.src = entry.audioUrl;
    setCurrent(idx);
    void el
      .play()
      .then(() => {
        setPlaying(true);
        void rememberTunedIn();
        /* A real listen counts on the real rail — the same play
           endpoint the chart rows use, so station spins feed the
           charts they came from. */
        void fetch("/api/discovery/play", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind: "track", mediaId: entry.trackId }),
        }).catch(() => undefined);
      })
      .catch(() => setPlaying(false));
  };

  const togglePlay = () => {
    const el = audioRef.current;
    if (playing && el) {
      el.pause();
      setPlaying(false);
      return;
    }
    if (current >= 0 && el && el.src) {
      void el
        .play()
        .then(() => setPlaying(true))
        .catch(() => setPlaying(false));
      return;
    }
    startAt(0);
  };

  const skip = () => {
    const next = nextRadioIndex(rotation, current);
    if (next >= 0) startAt(next);
  };

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const onEnded = () => {
      const next = nextRadioIndex(rotation, current);
      if (next >= 0) startAt(next);
    };
    el.addEventListener("ended", onEnded);
    return () => el.removeEventListener("ended", onEnded);
    // startAt/rotation identity churn is fine: the listener rebinds
    // against the latest closure each render it changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rotation, current]);

  useEffect(
    () => () => {
      audioRef.current?.pause();
      audioRef.current = null;
    },
    [],
  );

  /* The host's fader, live: a level change lands on the element
     mid-song, and the element is born at the current scale. */
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = Math.min(1, Math.max(0, volumeScale));
    }
  }, [volumeScale]);

  const now = current >= 0 ? rotation[current] : undefined;
  const hint = !playing && current < 0 ? radioResumeHint(tunedInBefore) : null;

  const shell = isLight
    ? "border-[#C9A84C]/50 bg-[#FBF6E9] text-[#2A2118]"
    : "border-[#d4af37]/25 bg-black/60 text-white";
  const sub = isLight ? "text-[#2A2118]/60" : "text-white/60";

  return (
    <section
      data-testid="charts-radio"
      /* Compact is the World dock: its lines land asynchronously
         (station load, resume hint, "up next"), so the panel carries
         its own dvh cap + internal scroll — docked, it can never
         grow past the screen's edge (audit §B5). The full Charts
         page keeps natural page flow. */
      className={`rounded-2xl border p-4 sm:p-5 ${
        compact ? "max-h-[calc(100dvh-8rem)] overflow-y-auto overscroll-contain sm:max-h-[calc(100dvh-7rem)]" : ""
      } ${shell}`}
      aria-label="Charts Radio — the house station"
    >
      <div className="flex flex-wrap items-center gap-3">
        <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-b from-[#e8c86a] to-[#b08d3e] text-black">
          <Radio className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-black tracking-tight sm:text-lg">
            Charts Radio{" "}
            <span className={`ml-1 align-middle text-[11px] font-bold uppercase tracking-widest ${station?.onAir ? "text-emerald-500" : sub}`}>
              {station?.onAir ? "● On air" : "24/7 house station"}
            </span>
          </h2>
          <p className={`truncate text-sm ${sub}`}>
            {now
              ? `Now spinning: ${now.title}${now.artistName ? ` — ${now.artistName}` : ""} (${radioEntryBadge(now)})`
              : station?.tagline || "This week's chart and the newest drops, back to back."}
          </p>
        </div>
        {/* Compact (the World dock, 380px): the buttons take a
            full row of their own below the title (stack700). One
            shared row squeezed the title block to a ~50px column
            — "24/7 house station" wrapped a word per line beside
            the buttons (owner's frame, 2026-10-29). The full
            Charts page keeps the one-row header. */}
        <div className={`flex items-center gap-2 ${compact ? "w-full" : ""}`}>
          <button
            type="button"
            data-testid="charts-radio-play"
            onClick={togglePlay}
            disabled={!station?.onAir}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-full bg-gradient-to-b from-[#e8c86a] to-[#b08d3e] px-5 py-2 text-sm font-black text-black transition hover:brightness-110 disabled:opacity-40"
          >
            {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            {playing ? "Pause" : current >= 0 ? "Resume" : "Play the station"}
          </button>
          <button
            type="button"
            data-testid="charts-radio-skip"
            onClick={skip}
            disabled={!station?.onAir}
            className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-full border px-4 py-2 text-sm font-bold transition disabled:opacity-40 ${
              isLight
                ? "border-[#C9A84C]/60 text-[#2A2118] hover:bg-[#C9A84C]/10"
                : "border-white/15 text-white/80 hover:border-[#e8c86a]/40 hover:text-white"
            }`}
          >
            <SkipForward className="h-4 w-4" /> Next
          </button>
        </div>
      </div>

      {hint && <p className={`mt-3 text-sm ${sub}`}>{hint}</p>}

      {loadError && (
        <div className={`mt-3 flex items-center gap-2 text-sm ${sub}`}>
          <AlertTriangle className="h-4 w-4 text-amber-500" />
          The station didn't load.
          <button
            type="button"
            onClick={() => setRetryNonce((n) => n + 1)}
            className="inline-flex items-center gap-1 py-3 -my-3 font-bold text-[#b08d3e] hover:underline"
          >
            <RotateCcw className="h-3.5 w-3.5" /> Retry
          </button>
        </div>
      )}

      {station && !station.onAir && !loadError && (
        <p className={`mt-3 text-sm ${sub}`}>
          Nothing playable is charting yet — the station signs on with the first charting tracks.
        </p>
      )}

      {!compact && station?.onAir && (
        <ol className="mt-4 space-y-1">
          {rotation.slice(0, 8).map((e, i) => (
            <li key={e.trackId}>
              <button
                type="button"
                onClick={() => startAt(i)}
                className={`flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left text-sm transition bdv-touch-target ${
                  i === current
                    ? isLight
                      ? "bg-[#C9A84C]/15 font-bold"
                      : "bg-[#d4af37]/10 font-bold"
                    : isLight
                      ? "hover:bg-[#C9A84C]/10"
                      : "hover:bg-white/5"
                }`}
              >
                <span className={`w-6 shrink-0 text-right font-mono text-xs ${sub}`}>{e.position}</span>
                <span className="min-w-0 flex-1 truncate">
                  {e.title}
                  {e.artistName && <span className={sub}> — {e.artistName}</span>}
                </span>
                <span className={`shrink-0 text-xs font-bold ${sub}`}>{radioEntryBadge(e)}</span>
                {typeof e.plays === "number" && (
                  <span className={`shrink-0 text-xs ${sub}`}>{formatCount(e.plays)} plays</span>
                )}
              </button>
            </li>
          ))}
        </ol>
      )}
      {compact && station?.onAir && (
        <p className={`mt-2 text-xs ${sub}`}>
          Up next:{" "}
          {rotation
            .slice(0, 3)
            .map((e) => e.title)
            .join(" · ")}
          {" — "}
          <Link href="/charts" className="font-bold text-[#b08d3e] hover:underline">
            full station on Charts
          </Link>
        </p>
      )}
    </section>
  );
}
