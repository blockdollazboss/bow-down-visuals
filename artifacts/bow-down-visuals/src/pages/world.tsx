import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import {
  Loader2, ArrowLeft, Users, Mic, MicOff, PhoneOff, AlertTriangle,
  RotateCcw, Glasses, Send, Crown,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { usePageTitle } from "@/hooks/use-page-title";
import {
  WorldClient,
  worldOverlay,
  defaultWorldSocketUrl,
  type WorldStatus,
  type WorldSayEvent,
} from "@/lib/world/world-client";
import {
  VoiceMesh,
  createBrowserPeerConnection,
  createBrowserVoiceSink,
  type VoiceSignalData,
} from "@/lib/world/voice";
import type { KingsHallScene, HallScreenSource } from "@/lib/world/hall-scene";

/* ─── The World — the King's Hall (/world) ──────────────────────────────────
   One shared VR room: a golden black-marble hall with a stage and a
   big screen (the featured reel, or a live stream's picture while one
   is truly live). Creators and fans walk it together as named avatars;
   guests visit look-only. Voice is proximity — walk up to someone to
   talk. The 3D scene (three.js) loads ONLY on this route, behind a
   dynamic import in the init effect.
   The hall is a dark-marble space by design in both themes — the page
   chrome is dark-locked. */

interface ScreenInfo {
  mode: "live" | "featured";
  title: string;
  creatorName: string | null;
  streamId: string | null;
  hlsUrl: string | null;
  videoUrl: string | null;
}

export default function WorldPage() {
  usePageTitle("The World — The King's Hall", "Step into the King's Hall: one shared hall with a stage, a big screen, and your people in it.");
  const { getAccessToken } = useAuth();

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const clientRef = useRef<WorldClient | null>(null);
  const sceneRef = useRef<KingsHallScene | null>(null);
  const meshRef = useRef<VoiceMesh | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const spawnedRef = useRef(false);

  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<WorldStatus>("connecting");
  const [peopleCount, setPeopleCount] = useState(0);
  const [isGuest, setIsGuest] = useState(true);
  const [myName, setMyName] = useState("");
  const [screen, setScreen] = useState<ScreenInfo | null>(null);
  const [sayLog, setSayLog] = useState<WorldSayEvent[]>([]);
  const [draft, setDraft] = useState("");
  const [voiceOn, setVoiceOn] = useState(false);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [muted, setMuted] = useState(false);
  const [voiceNote, setVoiceNote] = useState<string | null>(null);
  const [xrSupported, setXrSupported] = useState<boolean | null>(null);
  const [xrNote, setXrNote] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let peerSync: ReturnType<typeof setInterval> | null = null;
    let screenPoll: ReturnType<typeof setInterval> | null = null;
    let volumeTick: ReturnType<typeof setInterval> | null = null;

    (async () => {
      /* Boot failures BEFORE the socket exists (the scene chunk fails
         to load, or the WebGL2-only renderer throws on a no-WebGL2
         client) used to escape this IIFE uncaught — status stayed
         "connecting" forever and the page's own error card was
         unreachable. Route them to that error state instead. */
      try {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const { KingsHallScene } = await import("@/lib/world/hall-scene");
      if (cancelled) return;
      const scene = new KingsHallScene(canvas);
      sceneRef.current = scene;
      void scene.isVrSupported().then((ok) => {
        if (!cancelled) setXrSupported(ok);
      });

      const client = new WorldClient({
        getAccessToken,
        socketUrl: (token) => defaultWorldSocketUrl(window.location, token),
        openSocket: (url) => new WebSocket(url) as unknown as import("@/lib/world/world-client").WorldSocketLike,
      });
      clientRef.current = client;
      scene.onPose = (x, z, rotY) => client.sendMove(x, z, rotY);

      client.onStatus = (s) => {
        if (cancelled) return;
        setStatus(s);
        if (s === "inside" && client.self) {
          setIsGuest(client.self.guest);
          setMyName(client.self.displayName);
          if (!spawnedRef.current) {
            spawnedRef.current = true;
            scene.setSpawn(client.self.x, client.self.z);
          }
        }
      };
      client.onPeerJoin = (peer) => scene.upsertPeer(peer);
      client.onPeerLeave = (peerId) => scene.removePeer(peerId);
      client.onSay = (ev) => {
        if (!cancelled) setSayLog((log) => [...log.slice(-7), ev]);
      };
      client.onSignal = (from, data) => {
        void meshRef.current?.handleSignal(from, data as VoiceSignalData).catch(() => undefined);
      };
      client.onVoiceState = (ids) => {
        void meshRef.current?.handleVoiceState(ids).catch(() => undefined);
      };
      client.onVoicePeerLeft = (peerId) => meshRef.current?.dropPeer(peerId);
      client.onVoiceNotice = (notice) => {
        if (cancelled) return;
        if (notice === "full") {
          setVoiceNote("Voice is full right now — 12 people are talking. The hall still hears you in text.");
          setVoiceOn(false);
          setVoiceBusy(false);
        }
      };

      /* Keep the scene's avatar targets glued to the client's roster,
         and the headcount honest. */
      peerSync = setInterval(() => {
        for (const peer of client.peers.values()) scene.upsertPeer(peer);
        if (!cancelled) setPeopleCount(client.status === "inside" ? client.peers.size + 1 : 0);
      }, 120);

      /* The big screen: featured reel, or the live picture while a
         stream is truly live — re-checked so a stream starting
         mid-visit takes the screen, and one ending hands it back. */
      const loadScreen = async () => {
        try {
          const res = await fetch("/api/world/screen");
          if (!res.ok) return;
          const data = (await res.json()) as { screen: ScreenInfo };
          if (cancelled) return;
          setScreen(data.screen);
          await scene.setScreenSource(data.screen as HallScreenSource);
        } catch {
          /* the screen keeps its idle card — the room still works */
        }
      };
      await loadScreen();
      screenPoll = setInterval(loadScreen, 45_000);

      /* Proximity voice follows the avatars. */
      volumeTick = setInterval(() => {
        const mesh = meshRef.current;
        if (!mesh || !client.self) return;
        const positions = new Map<string, { x: number; z: number }>();
        for (const peer of client.peers.values()) {
          if (peer.voice) positions.set(peer.peerId, { x: peer.x, z: peer.z });
        }
        const pose = scene.localPose();
        mesh.updateVolumes({ x: pose.x, z: pose.z }, positions);
      }, 250);

      await client.connect();
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();

    return () => {
      cancelled = true;
      if (peerSync) clearInterval(peerSync);
      if (screenPoll) clearInterval(screenPoll);
      if (volumeTick) clearInterval(volumeTick);
      meshRef.current?.leave();
      meshRef.current = null;
      micStreamRef.current?.getTracks().forEach((t) => t.stop());
      micStreamRef.current = null;
      clientRef.current?.disconnect();
      clientRef.current = null;
      sceneRef.current?.dispose();
      sceneRef.current = null;
      spawnedRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  const joinVoice = async () => {
    const client = clientRef.current;
    if (!client || voiceBusy || voiceOn) return;
    setVoiceBusy(true);
    setVoiceNote(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = stream;
      const mesh = new VoiceMesh({
        sendSignal: (to, data) => client.sendSignal(to, data),
        createPeerConnection: createBrowserPeerConnection,
        createSink: createBrowserVoiceSink,
      });
      meshRef.current = mesh;
      mesh.start(stream);
      setMuted(false);
      client.joinVoice();
      setVoiceOn(true);
    } catch {
      setVoiceNote("Your mic was blocked — voice needs mic permission. You can still walk the hall and use text.");
    } finally {
      setVoiceBusy(false);
    }
  };

  const leaveVoice = () => {
    meshRef.current?.leave();
    meshRef.current = null;
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    micStreamRef.current = null;
    clientRef.current?.leaveVoice();
    setVoiceOn(false);
    setMuted(false);
  };

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    meshRef.current?.setMuted(next);
  };

  const enterVr = async () => {
    const scene = sceneRef.current;
    if (!scene) return;
    const ok = await scene.enterVr();
    if (!ok) setXrNote("Couldn't start a VR session here — you can still walk the room on this screen.");
  };

  const sendSay = () => {
    const client = clientRef.current;
    if (!client) return;
    if (client.say(draft)) setDraft("");
  };

  const overlay = worldOverlay(status);

  return (
    <div className="flex min-h-screen flex-col bg-black text-white" data-dark-lock>
      {/* ── Chrome ── */}
      <header className="relative z-20 flex flex-wrap items-center gap-3 border-b border-[#d4af37]/25 bg-[#070605] px-4 py-3">
        <Link href="/go-live" className="inline-flex items-center gap-1.5 text-sm text-white/50 transition hover:text-white">
          <ArrowLeft className="h-4 w-4" /> Go Live
        </Link>
        <h1 className="flex items-center gap-2 text-base font-black tracking-wide sm:text-lg">
          <Crown className="h-5 w-5 text-[#d4af37]" />
          The World <span className="font-semibold text-white/40">· The King's Hall</span>
        </h1>
        {screen?.mode === "live" ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-red-500/40 bg-red-500/10 px-3 py-1 text-xs font-bold text-red-300">
            <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
            LIVE on the big screen: {screen.title}
            {screen.creatorName ? <span className="text-red-300/60">· {screen.creatorName}</span> : null}
          </span>
        ) : (
          <span className="hidden items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold text-white/50 sm:inline-flex">
            On the big screen: The King's Reel
          </span>
        )}
        <span className="ml-auto inline-flex items-center gap-1.5 text-xs font-semibold text-white/60">
          <Users className="h-4 w-4 text-[#d4af37]" />
          {status === "inside" ? `${peopleCount} in the hall` : "—"}
        </span>
      </header>

      {/* ── The room ── */}
      <div className="relative flex-1" style={{ minHeight: "62vh" }}>
        <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full touch-none" data-testid="world-canvas" />

        {overlay === "connecting" && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-black/70 text-center">
            <Loader2 className="h-8 w-8 animate-spin text-[#d4af37]" />
            <p className="text-sm font-semibold text-white/80">Entering the King's Hall…</p>
          </div>
        )}
        {overlay === "room-full" && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/80 px-4">
            <div className="max-w-sm rounded-2xl border border-[#d4af37]/40 bg-[#0a0908] p-6 text-center">
              <Users className="mx-auto h-8 w-8 text-[#d4af37]" />
              <h2 className="mt-3 text-lg font-black">The hall is full</h2>
              <p className="mt-1 text-sm text-white/55">
                30 people are inside right now — that's everyone the hall holds at once. Give it a moment and try the door again.
              </p>
              <div className="mt-4 flex justify-center gap-2">
                <button type="button" onClick={() => setAttempt((n) => n + 1)} className="inline-flex items-center gap-2 rounded-full bg-[#d4af37] px-5 py-2 text-sm font-bold text-black transition hover:scale-105">
                  <RotateCcw className="h-4 w-4" /> Try again
                </button>
                <Link href="/go-live" className="rounded-full border border-white/15 px-5 py-2 text-sm font-bold text-white/80 transition hover:text-white">
                  Back to Go Live
                </Link>
              </div>
            </div>
          </div>
        )}
        {overlay === "error" && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/80 px-4">
            <div className="max-w-sm rounded-2xl border border-[#d4af37]/40 bg-[#0a0908] p-6 text-center">
              <AlertTriangle className="mx-auto h-8 w-8 text-[#d4af37]" />
              <h2 className="mt-3 text-lg font-black">The hall wouldn't open</h2>
              <p className="mt-1 text-sm text-white/55">The connection dropped or never landed. Your place in line isn't saved — just walk back in.</p>
              <button type="button" onClick={() => setAttempt((n) => n + 1)} className="mt-4 inline-flex items-center gap-2 rounded-full bg-[#d4af37] px-5 py-2 text-sm font-bold text-black transition hover:scale-105">
                <RotateCcw className="h-4 w-4" /> Re-enter the hall
              </button>
            </div>
          </div>
        )}

        {/* Say log */}
        {status === "inside" && sayLog.length > 0 && (
          <div className="pointer-events-none absolute bottom-24 left-3 z-10 max-w-xs space-y-1 sm:bottom-20">
            {sayLog.map((ev, i) => (
              <p key={`${ev.peerId}-${i}`} className="rounded-lg bg-black/55 px-2.5 py-1 text-xs text-white/85 backdrop-blur-sm">
                <span className="font-bold text-[#e8c86a]">{ev.displayName}</span>{" "}
                <span className="text-white/70">{ev.body}</span>
              </p>
            ))}
          </div>
        )}

        {/* Controls hint */}
        {status === "inside" && (
          <p className="pointer-events-none absolute right-3 top-3 z-10 hidden rounded-full bg-black/50 px-3 py-1 text-[11px] text-white/55 backdrop-blur-sm md:block">
            WASD to walk · drag or click to look · Shift to hurry
          </p>
        )}
      </div>

      {/* ── Bottom bar: say + voice + VR ── */}
      <footer className="relative z-20 border-t border-[#d4af37]/25 bg-[#070605] px-4 py-3">
        {isGuest && status === "inside" ? (
          <p className="mb-2 text-xs text-white/50">
            You're visiting as a <span className="font-bold text-white/75">guest</span> — look around all you like.{" "}
            <Link href="/login" className="font-bold text-[#e8c86a] underline underline-offset-2">Sign in</Link>{" "}
            to walk in with your name, talk, and be heard.
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          {!isGuest && status === "inside" && (
            <form
              className="flex min-w-[220px] flex-1 items-center gap-2 sm:max-w-md"
              onSubmit={(e) => {
                e.preventDefault();
                sendSay();
              }}
            >
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                maxLength={300}
                placeholder={myName ? `Say something, ${myName.split(" ")[0]}…` : "Say something…"}
                className="min-w-0 flex-1 rounded-full border border-white/12 bg-black/50 px-4 py-2 text-sm text-white outline-none placeholder:text-white/30 focus:border-[#d4af37]/60"
                data-testid="world-say-input"
              />
              <button type="submit" className="rounded-full bg-[#d4af37] p-2.5 text-black transition hover:scale-105" aria-label="Send to the hall">
                <Send className="h-4 w-4" />
              </button>
            </form>
          )}

          <div className="ml-auto flex flex-wrap items-center gap-2">
            {voiceNote && <span className="max-w-xs text-xs font-semibold text-amber-300">{voiceNote}</span>}
            {!isGuest && status === "inside" && !voiceOn && (
              <button type="button" onClick={joinVoice} disabled={voiceBusy} className="inline-flex items-center gap-2 rounded-full bg-[#d4af37] px-4 py-2 text-sm font-bold text-black transition hover:scale-105 disabled:opacity-50">
                {voiceBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mic className="h-4 w-4" />}
                Join voice
              </button>
            )}
            {voiceOn && (
              <>
                <button type="button" onClick={toggleMute} className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-bold transition ${muted ? "bg-red-500/20 text-red-200 border border-red-400/40" : "bg-white/10 text-white border border-white/15"}`}>
                  {muted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                  {muted ? "Muted" : "Mic live"}
                </button>
                <button type="button" onClick={leaveVoice} className="inline-flex items-center gap-2 rounded-full border border-white/15 px-4 py-2 text-sm font-bold text-white/75 transition hover:text-white">
                  <PhoneOff className="h-4 w-4" /> Leave voice
                </button>
                <span className="hidden text-[11px] text-white/40 lg:inline">Voice is by distance — walk up to talk.</span>
              </>
            )}
            {xrSupported ? (
              <button type="button" onClick={enterVr} className="inline-flex items-center gap-2 rounded-full border border-[#d4af37]/50 bg-[#d4af37]/10 px-4 py-2 text-sm font-bold text-[#e8c86a] transition hover:bg-[#d4af37]/20">
                <Glasses className="h-4 w-4" /> Enter VR
              </button>
            ) : xrSupported === false ? (
              <span className="text-[11px] text-white/40">
                {xrNote ?? "No VR headset detected — you can still walk the room on this screen."}
              </span>
            ) : null}
          </div>
        </div>
      </footer>
    </div>
  );
}
