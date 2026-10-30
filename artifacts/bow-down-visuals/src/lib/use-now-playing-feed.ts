import { useEffect, useState } from "react";
import {
  isNowPlayingExpired,
  parseNowPlayingResponse,
  type NowPlayingData,
} from "./now-playing-client";

/**
 * use-now-playing-feed.ts — the live half of the now-playing overlay
 * (stack900 lane D3). The overlay page polls GET
 * /api/overlay/now-playing?token=… — the token-keyed public read —
 * and renders whatever the studio last reported, dropping the track
 * locally the moment its server-set expiry lapses (the 1s tick), so
 * a dead studio tab takes its song off the stream within a second
 * of the bound, not at the next poll. A 401 marks the token dead
 * (it was reset) and the page goes quiet instead of spinning.
 *
 * JOIN NOTE (stack900): lane C2's overlay socket gains a
 * { type: "now-playing" } frame at the join (the seam C2's report
 * names); when it does, this hook folds into C2's useOverlayFeed —
 * the poll stays as the fallback, the socket becomes the fast path.
 * useTransparentStage below is a deliberate copy of C2's (its file
 * is not on this lane's base) — dedupe to C2's export at the join.
 */
export interface NowPlayingFeed {
  nowPlaying: NowPlayingData | null;
  /** A ticking clock (ms) so the card's progress can advance. */
  nowMs: number;
  /** "dead" = the token stopped resolving (it was reset). */
  status: "connecting" | "live" | "dead";
}

const POLL_MS = 5000;

export function useNowPlayingFeed(token: string | null): NowPlayingFeed {
  const [nowPlaying, setNowPlaying] = useState<NowPlayingData | null>(null);
  const [status, setStatus] = useState<NowPlayingFeed["status"]>("connecting");
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const tick = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(tick);
  }, []);

  useEffect(() => {
    if (!token) {
      setStatus("dead");
      return;
    }
    let cancelled = false;

    const fetchState = async () => {
      try {
        const res = await fetch(`/api/overlay/now-playing?token=${encodeURIComponent(token)}`);
        if (res.ok) {
          const dto: unknown = await res.json();
          if (!cancelled) {
            setNowPlaying(parseNowPlayingResponse(dto));
            setStatus("live");
          }
        } else if (res.status === 401) {
          if (!cancelled) {
            setStatus("dead");
            setNowPlaying(null);
          }
        }
      } catch {
        /* a missed poll is not a story — the next one lands */
      }
    };

    void fetchState();
    const poll = window.setInterval(() => void fetchState(), POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(poll);
    };
  }, [token]);

  /* The expiry is enforced locally too: the server's bound is the
     truth, and the tick makes the page honor it between polls. */
  const visible =
    nowPlaying && !isNowPlayingExpired(nowPlaying, nowMs) ? nowPlaying : null;

  return { nowPlaying: visible, nowMs, status };
}

/**
 * A browser source must show the streamer's program output through
 * the page — so while an overlay page is mounted, the document's
 * own backgrounds go transparent, and come back on unmount. Inline
 * styles only (no global CSS), restored exactly. (Copy of lane C2's
 * hook — dedupe at the join; see the note above.)
 */
export function useTransparentStage(): void {
  useEffect(() => {
    const root = document.documentElement;
    const body = document.body;
    const prev = {
      rootBackground: root.style.background,
      bodyBackground: body.style.background,
      bodyBackgroundColor: body.style.backgroundColor,
    };
    root.style.background = "transparent";
    body.style.background = "transparent";
    body.style.backgroundColor = "transparent";
    return () => {
      root.style.background = prev.rootBackground;
      body.style.background = prev.bodyBackground;
      body.style.backgroundColor = prev.bodyBackgroundColor;
    };
  }, []);
}
