import { useEffect, useRef, useState } from "react";
import {
  ALERT_DISPLAY_MS,
  buildOverlayWsUrl,
  enqueueAlert,
  parseOverlayMessage,
  type OverlayAlertData,
  type OverlayStateData,
  type QueuedAlert,
} from "./stream-overlay-client";

/**
 * use-overlay-feed.ts — the live half of the stream overlays
 * (stack900 lane C2). One hook feeds both overlay pages:
 *
 *   - state: GET /api/overlay/state on mount, again on every socket
 *     "refresh" nudge and every alert (a tip moves the goal), plus a
 *     slow poll so the goal bar can never sit stale for long;
 *   - alerts: the /api/overlay/ws socket, token-keyed. A dropped
 *     socket reconnects on a timer; a 401 state answer marks the
 *     token dead and the page goes quiet instead of spinning.
 *
 * The display pump lives here too: the head alert shows for
 * ALERT_DISPLAY_MS, then the queue advances.
 */
export interface OverlayFeed {
  state: OverlayStateData | null;
  currentAlert: OverlayAlertData | null;
  /** Changes per alert — the card keys on it to restart its pop. */
  currentKey: number;
  /** "dead" = the token stopped resolving (it was reset). */
  status: "connecting" | "live" | "dead";
}

export function useOverlayFeed(token: string | null): OverlayFeed {
  const [state, setState] = useState<OverlayStateData | null>(null);
  const [queue, setQueue] = useState<QueuedAlert[]>([]);
  const [status, setStatus] = useState<OverlayFeed["status"]>("connecting");
  const keyRef = useRef(0);

  useEffect(() => {
    if (!token) {
      setStatus("dead");
      return;
    }
    let cancelled = false;
    let socket: WebSocket | null = null;
    let retry: number | undefined;

    const fetchState = async () => {
      try {
        const res = await fetch(`/api/overlay/state?token=${encodeURIComponent(token)}`);
        if (res.ok) {
          const dto = (await res.json()) as OverlayStateData;
          if (!cancelled) setState(dto);
        } else if (res.status === 401) {
          if (!cancelled) setStatus("dead");
        }
      } catch {
        /* a missed poll is not a story — the next one lands */
      }
    };

    void fetchState();
    const poll = window.setInterval(() => void fetchState(), 20_000);

    const connect = () => {
      if (cancelled) return;
      socket = new WebSocket(buildOverlayWsUrl(window.location, token));
      socket.onopen = () => {
        if (!cancelled) setStatus("live");
      };
      socket.onmessage = (event) => {
        const message = parseOverlayMessage(String(event.data));
        if (!message || cancelled) return;
        if (message.type === "state") {
          setState(message.state);
        } else if (message.type === "alert") {
          keyRef.current += 1;
          const key = keyRef.current;
          setQueue((q) => enqueueAlert(q, message.alert, key));
          void fetchState();
        } else {
          void fetchState();
        }
      };
      socket.onclose = () => {
        if (!cancelled) {
          setStatus("connecting");
          retry = window.setTimeout(connect, 3000);
        }
      };
    };
    connect();

    return () => {
      cancelled = true;
      window.clearInterval(poll);
      if (retry !== undefined) window.clearTimeout(retry);
      socket?.close();
    };
  }, [token]);

  const current = queue[0] ?? null;
  const currentKey = current?.key ?? 0;
  useEffect(() => {
    if (!current) return;
    const timer = window.setTimeout(() => {
      setQueue((q) => q.slice(1));
    }, ALERT_DISPLAY_MS);
    return () => window.clearTimeout(timer);
  }, [currentKey, current]);

  return {
    state,
    currentAlert: current?.alert ?? null,
    currentKey,
    status,
  };
}

/**
 * A browser source must show the streamer's program output through
 * the page — so while an overlay page is mounted, the document's
 * own backgrounds go transparent, and come back on unmount. Inline
 * styles only (no global CSS), restored exactly.
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
