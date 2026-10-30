import { Music } from "lucide-react";
import {
  formatClock,
  nowPlayingElapsedSec,
  nowPlayingProgress,
  type NowPlayingData,
} from "@/lib/now-playing-client";

/* ─── Overlay now-playing card (stack900 lane D3) ───────────────────────
   The card a creator's OBS / Streamlabs overlay shows while a track
   plays on their stream — fed by the studio's own reports (lane
   D3's feed), never by a guess. Same family rules as lane C2's
   alert card and goal bar:
     - explicit hex colors, never theme classes — a browser source
       doesn't carry the site's light/dark remaps;
     - the honest empty state is NOTHING: no track reported (or its
       expiry lapsed) renders no card at all, so the program output
       stays clean;
     - the progress bar exists only when the track's length is
       known — an unknown length shows the title and artist alone,
       never an invented bar. */

export function NowPlayingCard({
  nowPlaying,
  style,
  nowMs,
}: {
  nowPlaying: NowPlayingData | null;
  style: "dark" | "light";
  nowMs: number;
}) {
  if (!nowPlaying) return null;
  const light = style === "light";
  const percent = nowPlayingProgress(nowPlaying, nowMs);
  const elapsed = nowPlayingElapsedSec(nowPlaying, nowMs);
  return (
    <div
      data-testid="overlay-now-playing-card"
      className="pointer-events-none w-[min(92vw,430px)] rounded-2xl border-2 px-5 py-4 shadow-2xl"
      style={{
        backgroundColor: light ? "#FBF6E9" : "#12100C",
        borderColor: light ? "#C9A84C" : "#D4AF37",
        color: light ? "#2A1E07" : "#F7EFDB",
      }}
    >
      <div className="flex items-center gap-2">
        <Music
          className="h-5 w-5"
          style={{ color: light ? "#7A5A12" : "#E8C86A" }}
          aria-hidden
        />
        <span
          className="text-[11px] font-black uppercase tracking-[0.18em]"
          style={{ color: light ? "#7A5A12" : "#E8C86A" }}
        >
          Now playing
        </span>
        {percent !== null && (
          <span data-testid="overlay-now-playing-percent" className="ml-auto text-sm font-black">
            {percent}%
          </span>
        )}
      </div>
      <p className="mt-1.5 truncate text-lg font-black leading-snug">{nowPlaying.title}</p>
      <p
        className="truncate text-sm font-semibold leading-snug"
        style={{ color: light ? "#6B5B36" : "#CFC4A5" }}
      >
        {nowPlaying.artist}
      </p>
      {percent !== null && nowPlaying.durationSec !== null && elapsed !== null && (
        <>
          <div
            className="mt-3 h-3.5 overflow-hidden rounded-full"
            style={{ backgroundColor: light ? "#E7DCC0" : "#2A251B" }}
            role="progressbar"
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Track progress"
          >
            <div
              data-testid="overlay-now-playing-fill"
              className="h-full rounded-full transition-all duration-700"
              style={{
                width: `${percent}%`,
                backgroundColor: light ? "#7A5A12" : "#D4AF37",
              }}
            />
          </div>
          <p
            className="mt-1.5 text-[11px] font-bold"
            style={{ color: light ? "#6B5B36" : "#CFC4A5" }}
          >
            {formatClock(elapsed)} / {formatClock(nowPlaying.durationSec)}
          </p>
        </>
      )}
    </div>
  );
}
