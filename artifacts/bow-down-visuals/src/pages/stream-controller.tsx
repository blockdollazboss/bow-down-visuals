/**
 * /go-live/controller — the Stream Controller remote.
 *
 * Open it on your phone while the studio runs on your computer: it
 * pairs by account (the relay only ever connects you to YOUR studio)
 * and drives the broadcast — scenes, transitions, mic, camera,
 * record, go live / end stream. Buttons show the studio's confirmed
 * state only; a press that never confirms falls back honestly.
 */
import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { ArrowLeft, Gamepad2, Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useIsLightTheme } from "@/hooks/use-is-light-theme";
import StreamDeck from "@/components/live/StreamDeck";
import {
  ControllerRemoteClient,
  controllerSocketUrl,
  type ControllerSocketLike,
} from "@/lib/stream-controller";

export default function StreamControllerPage() {
  const { user, getAccessToken } = useAuth();
  const isLight = useIsLightTheme();
  const [, setTick] = useState(0);
  const clientRef = useRef<ControllerRemoteClient | null>(null);

  useEffect(() => {
    if (!user) return;
    const client = new ControllerRemoteClient(
      {
        getAccessToken,
        socketUrl: controllerSocketUrl(window.location, "remote"),
        openSocket: (url) => new WebSocket(url) as unknown as ControllerSocketLike,
      },
      () => setTick((n) => n + 1),
    );
    clientRef.current = client;
    void client.start();
    // Sweep expired ack beats even when the studio goes quiet.
    const sweeper = window.setInterval(() => client.sweepPending(), 1000);
    return () => {
      window.clearInterval(sweeper);
      client.stop();
      clientRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const client = clientRef.current;
  const state = client?.state ?? null;
  const stageConnected = !!client?.presence.stageConnected;
  const socketUp = !!client?.socketUp;

  const statusLine = !client
    ? "Connecting…"
    : !socketUp
      ? "Reconnecting…"
      : !stageConnected
        ? "Studio not open"
        : state?.live
          ? `Live — controlling ${state.label}`
          : `Connected — controlling ${state?.label ?? "your studio"}`;

  const unavailableNote = !stageConnected
    ? "Open the studio — this remote connects to it automatically."
    : !socketUp
      ? "Connection dropped — reconnecting. Controls pause until it's back."
      : null;

  return (
    <div className={`mx-auto w-full max-w-2xl px-4 py-6 ${isLight ? "text-[#2A1E07]" : "text-white"}`}>
      <Link
        href="/go-live"
        className={`inline-flex items-center gap-1.5 text-xs font-bold ${isLight ? "text-[#7A5A12]" : "text-[#fbbf24]"}`}
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Back to Go Live
      </Link>

      <div className="mt-3 flex items-center gap-2.5">
        <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${isLight ? "bg-[#C9A84C]/20 text-[#7A5A12]" : "bg-[#fbbf24]/15 text-[#fbbf24]"}`}>
          <Gamepad2 className="h-5 w-5" />
        </span>
        <div>
          <h1 className="text-xl font-black leading-tight">Stream Controller</h1>
          <p className={`flex items-center gap-1.5 text-xs font-semibold ${isLight ? "text-[#6B5B36]" : "text-white/50"}`} role="status">
            <span className={`inline-block h-2 w-2 rounded-full ${stageConnected && socketUp ? (state?.live ? "animate-pulse bg-red-500" : "bg-emerald-500") : "bg-white/30"}`} />
            {statusLine}
            {!client && <Loader2 className="h-3 w-3 animate-spin" />}
          </p>
        </div>
      </div>

      <div
        className={`mt-5 rounded-2xl border p-4 ${
          isLight
            ? "border-[#C9A84C]/40 bg-gradient-to-b from-[#FCF7EA] to-[#F4E7C3]"
            : "border-primary/25 bg-gradient-to-b from-[#14100a] to-[#0d0a04]"
        }`}
      >
        <StreamDeck
          state={state}
          canControl={stageConnected && socketUp}
          unavailableNote={unavailableNote}
          isPending={(cmd, sceneId) => client?.isPending(cmd, sceneId) ?? false}
          notice={client?.notice ?? null}
          onCommand={(cmd, args) => {
            client?.send(cmd, args);
          }}
        />
      </div>

      <p className={`mt-4 text-center text-xs leading-relaxed ${isLight ? "text-[#6B5B36]" : "text-white/40"}`}>
        This remote pairs with the studio signed in as you — nobody else's studio, ever.
        Keep the studio open on your computer and drive the show from here.
      </p>
    </div>
  );
}
