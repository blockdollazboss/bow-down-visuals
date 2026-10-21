import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useRoute } from "wouter";
import {
  Loader2, Radio, Send, Mic, MicOff, Video, VideoOff, LogOut, ShieldCheck, Eye,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePageTitle } from "@/hooks/use-page-title";
import {
  readInvite, joinAsGuest, guestSession, guestHeartbeat, guestLeave,
  guestBackstageHistory, guestBackstagePost, GuestApiError,
  type InviteInfoDto, type GuestSessionDto, type BackstageMessageDto,
} from "@/lib/go-live/guest-api";
import { BackstageClient, type BackstagePeer } from "@/lib/go-live/backstage-client";

/* ─── Guest backstage door (/live/guest/:token, 0202) ────────────────────
   Where an invite link lands. No account, no sign-up: the link IS the
   pass. The guest picks the name the host will see, steps into
   backstage (private — the audience sees and hears none of it), and
   only reaches the audience if the host brings them on stage. Every
   label here says "Guest" because that's what they are — this page
   never dresses a guest up as a member. */

type Phase =
  | "loading"
  | "ready"
  | "joining"
  | "backstage"
  | "ended";

export default function LiveGuest() {
  const { t } = useTranslation();
  usePageTitle(t("liveGuests.pageTitle"), t("liveGuests.pageDescription"));
  const [, params] = useRoute("/live/guest/:token");
  const inviteToken = params?.token ?? "";
  const [phase, setPhase] = useState<Phase>("loading");
  const [info, setInfo] = useState<InviteInfoDto | null>(null);
  const [error, setError] = useState("");
  const [endedReason, setEndedReason] = useState("");
  const [name, setName] = useState("");
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [session, setSession] = useState<GuestSessionDto | null>(null);
  const [peers, setPeers] = useState<BackstagePeer[]>([]);
  const [remoteStreams, setRemoteStreams] = useState<Map<string, MediaStream>>(new Map());
  const [messages, setMessages] = useState<BackstageMessageDto[]>([]);
  const [draft, setDraft] = useState("");
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [mediaNote, setMediaNote] = useState("");
  const clientRef = useRef<BackstageClient | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const sessionTokenRef = useRef<string | null>(null);

  const storageKey = `bdv-guest:${inviteToken}`;

  const endWith = useCallback((reason: string) => {
    clientRef.current?.close();
    clientRef.current = null;
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    setEndedReason(reason);
    setPhase("ended");
  }, []);

  const startBackstage = useCallback(
    async (sessToken: string, sess: GuestSessionDto, withMedia: boolean) => {
      sessionTokenRef.current = sessToken;
      setSessionToken(sessToken);
      setSession(sess);
      let local: MediaStream | null = null;
      if (withMedia) {
        try {
          local = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
          setMediaNote("");
        } catch {
          setMediaNote(t("liveGuests.mediaDeniedNote"));
        }
      }
      localStreamRef.current = local;
      if (localVideoRef.current && local) localVideoRef.current.srcObject = local;
      const client = new BackstageClient({
        streamId: sess.stream_id,
        guestToken: sessToken,
        events: {
          onPeers: (next) => setPeers(next),
          onChat: (message) => setMessages((ms) => (ms.some((m) => m.id === message.id) ? ms : [...ms, message])),
          onRemoteStream: (_sessionId, peerId, stream) => {
            setRemoteStreams((prev) => new Map(prev).set(peerId, stream));
          },
          onRemoteGone: (_sessionId, peerId) => {
            setRemoteStreams((prev) => {
              const next = new Map(prev);
              next.delete(peerId);
              return next;
            });
          },
          onGuestState: (_sessionId, state) => {
            setSession((s) => (s ? { ...s, state } : s));
          },
          onSessionEnded: (reason) => {
            try {
              sessionStorage.removeItem(storageKey);
            } catch {
              /* private mode */
            }
            endWith(reason);
          },
          onBackstageClosed: (reason) => endWith(reason),
        },
      });
      clientRef.current = client;
      client.connect(local);
      if (local) client.joinMedia();
      setPhase("backstage");
      try {
        const data = await guestBackstageHistory(sessToken);
        setMessages(data.messages);
      } catch {
        /* live frames still land */
      }
    },
    [endWith, storageKey, t],
  );

  /* Load the invite; resume a stored session after a refresh. */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await readInvite(inviteToken);
        if (cancelled) return;
        setInfo(data);
        if (data.stream.status !== "live") {
          setEndedReason(t("liveGuests.streamEndedClosed"));
          setPhase("ended");
          return;
        }
        let stored: string | null = null;
        try {
          stored = sessionStorage.getItem(storageKey);
        } catch {
          stored = null;
        }
        if (stored) {
          try {
            const me = await guestSession(stored);
            if (cancelled) return;
            if (me.stream.id === data.stream.id) {
              await startBackstage(stored, me.session, true);
              return;
            }
          } catch {
            try {
              sessionStorage.removeItem(storageKey);
            } catch {
              /* ignore */
            }
          }
        }
        setPhase("ready");
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : t("liveGuests.inviteOpenFailed"));
        setPhase("ended");
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inviteToken]);

  /* Heartbeat: keeps the pass warm and learns the end fast. */
  useEffect(() => {
    if (phase !== "backstage") return;
    const id = setInterval(async () => {
      const tok = sessionTokenRef.current;
      if (!tok) return;
      try {
        const beat = await guestHeartbeat(tok);
        if (beat.stream_status !== "live") endWith(t("liveGuests.streamEndedThanks"));
      } catch (e) {
        if (e instanceof GuestApiError && (e.status === 401 || e.status === 404)) {
          endWith(e.message);
        }
      }
    }, 25_000);
    return () => clearInterval(id);
  }, [phase, endWith]);

  useEffect(
    () => () => {
      clientRef.current?.close();
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
    },
    [],
  );

  useEffect(() => {
    if (localVideoRef.current && localStreamRef.current) {
      localVideoRef.current.srcObject = localStreamRef.current;
    }
  }, [phase]);

  async function handleJoin() {
    if (!name.trim()) return;
    setPhase("joining");
    try {
      const data = await joinAsGuest(inviteToken, name.trim());
      try {
        sessionStorage.setItem(storageKey, data.session_token);
      } catch {
        /* private mode — refresh will ask for the name again */
      }
      setInfo((prev) =>
        prev ? prev : { invite: { label: null, expires_at: null }, stream: data.stream, host: data.host },
      );
      await startBackstage(data.session_token, data.session, true);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("liveGuests.joinFailed"));
      setPhase("ready");
    }
  }

  async function handleLeave() {
    const tok = sessionTokenRef.current;
    if (tok) {
      try {
        await guestLeave(tok);
      } catch {
        /* leaving anyway */
      }
      try {
        sessionStorage.removeItem(storageKey);
      } catch {
        /* ignore */
      }
    }
    endWith(t("liveGuests.leftBackstage"));
  }

  async function handleSend() {
    const tok = sessionTokenRef.current;
    if (!tok || !draft.trim()) return;
    try {
      const data = await guestBackstagePost(tok, draft.trim());
      setMessages((ms) => (ms.some((m) => m.id === data.message.id) ? ms : [...ms, data.message]));
      setDraft("");
    } catch (e) {
      if (e instanceof GuestApiError && e.status === 401) endWith(e.message);
    }
  }

  function toggleMic() {
    const next = !micOn;
    setMicOn(next);
    localStreamRef.current?.getAudioTracks().forEach((t) => (t.enabled = next));
  }
  function toggleCam() {
    const next = !camOn;
    setCamOn(next);
    localStreamRef.current?.getVideoTracks().forEach((t) => (t.enabled = next));
  }

  const onStage = session?.state === "on_stage";
  const hostName = info?.host.display_name ?? t("liveGuests.hostFallback");
  const others = peers.filter((p) => p.peerId !== clientRef.current?.myPeerId);

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="mx-auto max-w-3xl px-5 py-10">
        <p className="inline-flex items-center gap-1.5 rounded-full border border-[#d4a017]/40 bg-[#d4a017]/10 px-3 py-1 text-[11px] font-black uppercase tracking-widest text-[#fbbf24]">
          <Radio className="h-3 w-3" /> {t("liveGuests.badge")}
        </p>

        {phase === "loading" && (
          <div className="flex items-center gap-2 py-16 text-white/60">
            <Loader2 className="h-5 w-5 animate-spin" /> {t("liveGuests.checkingInvite")}
          </div>
        )}

        {phase === "ended" && (
          <div className="py-12" data-testid="guest-ended">
            <h1 className="text-2xl font-black">{t("liveGuests.endedTitle")}</h1>
            <p className="mt-2 max-w-md text-sm text-white/50">{endedReason || error || t("liveGuests.endedFallback")}</p>
            {info?.stream.watch_path && (
              <Link href={info.stream.watch_path} className="mt-5 inline-flex items-center gap-1.5 rounded-xl bg-[#d4a017] px-4 py-2 text-sm font-bold text-black">
                <Eye className="h-4 w-4" /> {t("liveGuests.watchInstead")}
              </Link>
            )}
          </div>
        )}

        {(phase === "ready" || phase === "joining") && info && (
          <div className="py-8" data-testid="guest-join">
            <h1 className="text-3xl font-black tracking-tight">
              {t("liveGuests.invitedHeading", { host: hostName })}
            </h1>
            <p className="mt-2 max-w-lg text-sm text-white/50">
              <span className="font-semibold text-white/80">“{info.stream.title}”</span> {t("liveGuests.joinIntro")}
            </p>
            <div className="mt-4 flex items-start gap-2 rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs text-white/50">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#fbbf24]" />
              <span>
                {t("liveGuests.joinNoteBefore")}{" "}
                <strong className="text-white/80">{t("liveGuests.joinNoteGuestWord")}</strong>{" "}
                {t("liveGuests.joinNoteAfter")}
              </span>
            </div>
            <label className="mt-6 block max-w-sm">
              <span className="text-xs font-bold uppercase tracking-wider text-white/60">{t("liveGuests.nameLabel")}</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={40}
                placeholder={t("liveGuests.namePlaceholder")}
                className="mt-1.5 w-full rounded-xl border border-white/10 bg-black/60 px-4 py-2.5 text-sm placeholder:text-white/25 focus:border-amber-400/60 focus:outline-none"
                data-testid="input-guest-name"
              />
            </label>
            {error && <p className="mt-3 text-sm font-semibold text-red-300">{error}</p>}
            <Button
              onClick={() => void handleJoin()}
              disabled={phase === "joining" || !name.trim()}
              className="gold-glow mt-5 gap-2 bg-gradient-to-r from-[#fbbf24] to-[#d4a017] font-bold text-black hover:brightness-110"
              data-testid="btn-join-backstage"
            >
              {phase === "joining" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Video className="h-4 w-4" />}
              {t("liveGuests.joinButton")}
            </Button>
          </div>
        )}

        {phase === "backstage" && session && (
          <div data-testid="guest-backstage">
            <h1 className="text-2xl font-black">{info?.stream.title ?? t("liveGuests.backstageFallbackTitle")}</h1>
            <div
              className={`mt-3 rounded-xl border p-3 text-sm font-semibold ${
                onStage
                  ? "border-red-400/50 bg-red-500/10 text-red-200"
                  : "border-emerald-400/30 bg-emerald-400/[0.07] text-emerald-200"
              }`}
              role="status"
            >
              {onStage
                ? t("liveGuests.onStageBanner")
                : t("liveGuests.backstageBanner")}
            </div>
            {mediaNote && <p className="mt-2 text-xs text-amber-300">{mediaNote}</p>}

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="relative overflow-hidden rounded-xl border border-[#fbbf24]/40 bg-zinc-950">
                <video ref={localVideoRef} autoPlay muted playsInline className="aspect-video w-full object-cover" />
                <span className="absolute bottom-2 left-2 rounded-full bg-black/70 px-2 py-0.5 text-[11px] font-bold">
                  {t("liveGuests.youWord")}{t("liveGuests.suffixGuest")}{onStage ? t("liveGuests.suffixOnStage") : ""}
                </span>
              </div>
              {others.map((peer) => (
                <RemoteTile key={peer.peerId} peer={peer} stream={remoteStreams.get(peer.peerId) ?? null} />
              ))}
              {others.length === 0 && (
                <div className="flex aspect-video items-center justify-center rounded-xl border border-dashed border-white/15 text-xs text-white/40">
                  {t("liveGuests.waitingHost")}
                </div>
              )}
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <Button onClick={toggleMic} variant="outline" size="sm" className="gap-1.5 border-white/15" data-testid="btn-guest-mic">
                {micOn ? <Mic className="h-3.5 w-3.5" /> : <MicOff className="h-3.5 w-3.5" />} {micOn ? t("liveGuests.mute") : t("liveGuests.unmute")}
              </Button>
              <Button onClick={toggleCam} variant="outline" size="sm" className="gap-1.5 border-white/15" data-testid="btn-guest-cam">
                {camOn ? <Video className="h-3.5 w-3.5" /> : <VideoOff className="h-3.5 w-3.5" />} {camOn ? t("liveGuests.hideCamera") : t("liveGuests.showCamera")}
              </Button>
              {info?.stream.watch_path && (
                <Link href={info.stream.watch_path} className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 px-3 py-1.5 text-xs font-bold text-white/70 hover:text-white">
                  <Eye className="h-3.5 w-3.5" /> {t("liveGuests.watchShow")}
                </Link>
              )}
              <Button onClick={() => void handleLeave()} variant="outline" size="sm" className="ml-auto gap-1.5 border-red-400/40 text-red-300" data-testid="btn-guest-leave">
                <LogOut className="h-3.5 w-3.5" /> {t("liveGuests.leave")}
              </Button>
            </div>

            <div className="mt-5 rounded-xl border border-white/[0.07] p-3">
              <p className="text-xs font-black uppercase tracking-widest text-[#fbbf24]">{t("liveGuests.chatTitle")}</p>
              <div className="mt-2 max-h-44 space-y-1.5 overflow-y-auto pr-1">
                {messages.length === 0 ? (
                  <p className="text-xs text-white/35">{t("liveGuests.chatEmptyGuest")}</p>
                ) : (
                  messages.map((m) => (
                    <p key={m.id} className="text-sm">
                      <span className="font-bold text-[#fbbf24]">
                        {m.author_name}
                        {m.guest ? t("liveGuests.suffixGuest") : t("liveGuests.suffixHost")}
                      </span>{" "}
                      <span className="text-white/80">{m.body}</span>
                    </p>
                  ))
                )}
              </div>
              <div className="mt-2 flex gap-2">
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void handleSend();
                  }}
                  placeholder={t("liveGuests.chatPlaceholder")}
                  maxLength={500}
                  className="flex-1 rounded-xl border border-white/10 bg-black/60 px-3 py-2 text-sm placeholder:text-white/25 focus:border-amber-400/60 focus:outline-none"
                  data-testid="input-guest-chat"
                />
                <Button onClick={() => void handleSend()} disabled={!draft.trim()} size="sm" className="gap-1.5 bg-gradient-to-r from-[#fbbf24] to-[#d4a017] font-bold text-black" data-testid="btn-guest-send">
                  <Send className="h-3.5 w-3.5" /> {t("liveGuests.send")}
                </Button>
              </div>
            </div>

            <p className="mt-3 text-[11px] text-white/30">
              {t("liveGuests.guestFooterNote")}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function RemoteTile({ peer, stream }: { peer: BackstagePeer; stream: MediaStream | null }) {
  const { t } = useTranslation();
  const hostRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const host = hostRef.current;
    if (!host || !stream) return undefined;
    const video = document.createElement("video");
    video.srcObject = stream;
    video.autoplay = true;
    video.playsInline = true;
    video.className = "aspect-video w-full object-cover";
    host.appendChild(video);
    void video.play().catch(() => undefined);
    return () => {
      if (video.parentElement === host) host.removeChild(video);
    };
  }, [stream]);
  return (
    <div className="relative overflow-hidden rounded-xl border border-white/10 bg-zinc-950">
      {stream ? (
        <div ref={hostRef} className="aspect-video w-full" />
      ) : (
        <div className="flex aspect-video w-full items-center justify-center text-xs text-white/40">{t("liveGuests.connecting")}</div>
      )}
      <span className="absolute bottom-2 left-2 rounded-full bg-black/70 px-2 py-0.5 text-[11px] font-bold">
        {peer.displayName}
        {peer.kind === "host" ? t("liveGuests.suffixHost") : t("liveGuests.suffixGuest")}
        {peer.guestState === "on_stage" ? t("liveGuests.suffixOnStage") : ""}
      </span>
    </div>
  );
}
