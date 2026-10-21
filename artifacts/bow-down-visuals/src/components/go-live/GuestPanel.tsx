import { useCallback, useEffect, useRef, useState } from "react";
import {
  UserPlus, Copy, Check, Trash2, ArrowUpCircle, ArrowDownCircle, UserX,
  Loader2, Send, Video, VideoOff, Link2, ShieldCheck,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { useIsLightTheme } from "@/hooks/use-is-light-theme";
import {
  mintGuestInvite, listGuestInvites, revokeGuestInvite, promoteGuest, demoteGuest, removeGuest,
  hostBackstageHistory, hostBackstagePost,
  type GuestInviteDto, type GuestSessionDto, type BackstageMessageDto,
} from "@/lib/go-live/guest-api";
import { BackstageClient, type BackstagePeer } from "@/lib/go-live/backstage-client";
import { guestFeeds } from "@/lib/go-live/guest-feeds";
import { putGuestOnStage, takeGuestOffStage, attachGuestAudio, clearAllGuestsFromStage } from "@/lib/go-live/studio-bridge";

/* ─── Guests & Backstage (Go Live, 0202) ─────────────────────────────────
   Docked under the Broadcast studio in the Go Live hub. The host
   mints invite links for the CURRENT live stream; guests join
   backstage (private greenroom: mesh video + its own chat — the
   audience sees and hears none of it). Promote puts a guest ON
   STAGE: their tile lands in the program scene and their audio
   joins the program mix, which is the only way a guest ever reaches
   the audience. Demote/remove reverse it completely — no ghost
   tiles, no hot mics. */

interface LiveStreamLite {
  id: string;
  title: string;
}

export default function GuestPanel() {
  const isLight = useIsLightTheme();
  const { getAccessToken } = useAuth();
  const { toast } = useToast();
  const [stream, setStream] = useState<LiveStreamLite | null>(null);
  const [invites, setInvites] = useState<GuestInviteDto[]>([]);
  const [guests, setGuests] = useState<GuestSessionDto[]>([]);
  const [label, setLabel] = useState("");
  const [expiry, setExpiry] = useState<string>("240");
  const [maxJoins, setMaxJoins] = useState<string>("");
  const [minting, setMinting] = useState(false);
  const [freshLink, setFreshLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [inBackstage, setInBackstage] = useState(false);
  const [peers, setPeers] = useState<BackstagePeer[]>([]);
  const [messages, setMessages] = useState<BackstageMessageDto[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [, setFeedsVersion] = useState(0);
  const clientRef = useRef<BackstageClient | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const streamIdRef = useRef<string | null>(null);

  const panel = isLight ? "border-[#C9A84C]/40 bg-[#F7ECD2]/60" : "border-white/10 bg-[#0a0a0a]";
  const inputCls = `rounded-xl border px-3 py-2 text-sm focus:outline-none focus:border-amber-400/60 ${
    isLight ? "border-[#C9A84C]/40 bg-white/70 text-zinc-900 placeholder:text-zinc-400" : "border-white/10 bg-black/60 text-white placeholder:text-white/25"
  }`;

  const token = useCallback(async () => (await getAccessToken()) ?? "", [getAccessToken]);

  /* Which stream is live right now (the panel's whole world hangs
     off it — invites attach to a stream, not to the creator). */
  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const t = await token();
        const res = await fetch("/api/live-streams/status", {
          headers: t ? { Authorization: `Bearer ${t}` } : {},
        });
        if (!res.ok) return;
        const data = (await res.json()) as { live_stream: { id: string; title: string } | null };
        if (cancelled) return;
        setStream(data.live_stream ? { id: data.live_stream.id, title: data.live_stream.title } : null);
      } catch {
        /* status is best-effort; the next tick retries */
      }
    };
    void check();
    const id = setInterval(check, 15_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [token]);

  const refreshRoster = useCallback(async () => {
    const sid = streamIdRef.current;
    if (!sid) return;
    try {
      const t = await token();
      const data = await listGuestInvites(sid, t);
      setInvites(data.invites);
      const active = data.guests.filter((g) => g.state === "backstage" || g.state === "on_stage");
      setGuests(active);
      guestFeeds.setRoster(active);
      /* Keep the stage honest with the DB: an on-stage guest always
         has their tile + channel; anyone else never does. */
      for (const g of active) {
        if (g.state === "on_stage") putGuestOnStage({ id: g.id, display_name: g.display_name });
      }
    } catch {
      /* roster refresh is best-effort */
    }
  }, [token]);

  useEffect(() => {
    streamIdRef.current = stream?.id ?? null;
    if (!stream) {
      setInvites([]);
      setGuests([]);
      return;
    }
    void refreshRoster();
    const id = setInterval(refreshRoster, 20_000);
    return () => clearInterval(id);
  }, [stream, refreshRoster]);

  useEffect(() => guestFeeds.subscribe(() => setFeedsVersion((v) => v + 1)), []);

  /* Teardown when the panel unmounts or the stream ends. */
  useEffect(() => {
    if (stream) return;
    clientRef.current?.close();
    clientRef.current = null;
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    setInBackstage(false);
    setPeers([]);
    clearAllGuestsFromStage();
    guestFeeds.clear();
  }, [stream]);

  useEffect(
    () => () => {
      clientRef.current?.close();
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
    },
    [],
  );

  async function handleMint() {
    if (!stream) return;
    setMinting(true);
    try {
      const t = await token();
      const data = await mintGuestInvite(stream.id, t, {
        label: label.trim() || undefined,
        expires_in_minutes: expiry ? Number(expiry) : undefined,
        max_joins: maxJoins ? Number(maxJoins) : undefined,
      });
      setFreshLink(`${window.location.origin}${data.invite_path}`);
      setCopied(false);
      setLabel("");
      await refreshRoster();
      toast({ title: "Invite link ready", description: "Share it with your guest — the full link is shown only now, so copy it somewhere safe." });
    } catch (e) {
      toast({ title: "Couldn't make the invite", description: e instanceof Error ? e.message : "Try again.", variant: "destructive" });
    } finally {
      setMinting(false);
    }
  }

  async function handleCopy() {
    if (!freshLink) return;
    try {
      await navigator.clipboard.writeText(freshLink);
      setCopied(true);
    } catch {
      toast({ title: "Copy didn't work", description: "Select the link text and copy it by hand.", variant: "destructive" });
    }
  }

  async function handleRevoke(invite: GuestInviteDto) {
    if (!stream) return;
    try {
      const t = await token();
      const data = await revokeGuestInvite(stream.id, invite.id, t);
      setFreshLink(null);
      await refreshRoster();
      toast({
        title: "Invite revoked",
        description: data.sessions_ended
          ? `The link is dead and ${data.sessions_ended} guest pass${data.sessions_ended === 1 ? "" : "es"} ended with it.`
          : "The link is dead — nobody new can join through it.",
      });
    } catch (e) {
      toast({ title: "Couldn't revoke", description: e instanceof Error ? e.message : "Try again.", variant: "destructive" });
    }
  }

  async function handlePromote(guest: GuestSessionDto) {
    if (!stream) return;
    try {
      const t = await token();
      const data = await promoteGuest(stream.id, guest.id, t);
      guestFeeds.setState(guest.id, "on_stage");
      putGuestOnStage({ id: guest.id, display_name: data.guest.display_name });
      setGuests((gs) => gs.map((g) => (g.id === guest.id ? data.guest : g)));
    } catch (e) {
      toast({ title: "Couldn't bring them on stage", description: e instanceof Error ? e.message : "Try again.", variant: "destructive" });
    }
  }

  async function handleDemote(guest: GuestSessionDto) {
    if (!stream) return;
    try {
      const t = await token();
      const data = await demoteGuest(stream.id, guest.id, t);
      takeGuestOffStage(guest.id);
      guestFeeds.setState(guest.id, "backstage");
      setGuests((gs) => gs.map((g) => (g.id === guest.id ? data.guest : g)));
    } catch (e) {
      toast({ title: "Couldn't move them backstage", description: e instanceof Error ? e.message : "Try again.", variant: "destructive" });
    }
  }

  async function handleRemove(guest: GuestSessionDto) {
    if (!stream) return;
    try {
      const t = await token();
      await removeGuest(stream.id, guest.id, t);
      takeGuestOffStage(guest.id);
      guestFeeds.drop(guest.id);
      setGuests((gs) => gs.filter((g) => g.id !== guest.id));
    } catch (e) {
      toast({ title: "Couldn't remove them", description: e instanceof Error ? e.message : "Try again.", variant: "destructive" });
    }
  }

  async function enterBackstage() {
    if (!stream || clientRef.current) return;
    let local: MediaStream | null = null;
    try {
      local = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    } catch {
      toast({
        title: "Camera/mic not available",
        description: "You can still enter backstage to talk by chat — guests just won't see or hear you there.",
        variant: "destructive",
      });
    }
    localStreamRef.current = local;
    if (localVideoRef.current && local) {
      localVideoRef.current.srcObject = local;
    }
    const t = await token();
    const client = new BackstageClient({
      streamId: stream.id,
      token: t,
      events: {
        onPeers: (next) => {
          setPeers(next);
          void refreshRoster();
        },
        onChat: (message) => {
          setMessages((ms) => (ms.some((m) => m.id === message.id) ? ms : [...ms, message]));
        },
        onRemoteStream: (sessionId, _peerId, mediaStream) => {
          if (!sessionId) return;
          guestFeeds.setStream(sessionId, mediaStream);
          if (guestFeeds.get(sessionId)?.state === "on_stage") attachGuestAudio(sessionId, mediaStream);
        },
        onRemoteGone: (sessionId) => {
          if (!sessionId) return;
          guestFeeds.setStream(sessionId, null);
          attachGuestAudio(sessionId, null);
        },
        onGuestState: (sessionId, state) => {
          guestFeeds.setState(sessionId, state);
          if (state === "on_stage") {
            const feed = guestFeeds.get(sessionId);
            if (feed) putGuestOnStage({ id: sessionId, display_name: feed.name });
          } else {
            takeGuestOffStage(sessionId);
          }
        },
        onBackstageClosed: () => {
          toast({ title: "Backstage closed", description: "The stream ended, so the greenroom wrapped up." });
        },
      },
    });
    clientRef.current = client;
    client.connect(local);
    if (local) client.joinMedia();
    setInBackstage(true);
    try {
      const data = await hostBackstageHistory(stream.id, t);
      setMessages(data.messages);
    } catch {
      /* history is best-effort; live frames still land */
    }
  }

  function leaveBackstage() {
    clientRef.current?.close();
    clientRef.current = null;
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    setInBackstage(false);
    setPeers([]);
  }

  async function handleSend() {
    if (!stream || !draft.trim()) return;
    setSending(true);
    try {
      const t = await token();
      const data = await hostBackstagePost(stream.id, t, draft.trim());
      setMessages((ms) => (ms.some((m) => m.id === data.message.id) ? ms : [...ms, data.message]));
      setDraft("");
      /* If the host hasn't entered backstage, the socket isn't there
         to deliver — guests who ARE in will pick it up on their next
         history load; when we are in, deliverChat already echoed. */
      if (!inBackstage) {
        toast({ title: "Sent to backstage", description: "Enter backstage to chat live with your guests." });
      }
    } catch (e) {
      toast({ title: "Couldn't send", description: e instanceof Error ? e.message : "Try again.", variant: "destructive" });
    } finally {
      setSending(false);
    }
  }

  const liveInvites = invites.filter((i) => !i.revoked_at);
  const peerBySession = new Map(peers.filter((p) => p.guestSessionId).map((p) => [p.guestSessionId, p]));

  return (
    <section className={`relative mx-auto mb-6 w-full max-w-5xl rounded-2xl border p-5 md:p-6 ${panel}`} data-testid="guest-panel">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-1.5 text-xs font-black uppercase tracking-widest text-[#fbbf24]">
            <UserPlus className="h-3.5 w-3.5" /> Guests &amp; backstage
          </p>
          <h3 className="mt-1 text-lg font-black">Bring someone on your show</h3>
          <p className={`mt-1 max-w-xl text-sm ${isLight ? "text-[#6B5B36]" : "text-white/50"}`}>
            Invite links drop guests into your private backstage — they get ready with you there, and only
            come on air when you bring them on stage. The audience never sees or hears backstage.
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-[11px] font-bold text-emerald-300">
          <ShieldCheck className="h-3 w-3" /> Free — no credits, ever
        </span>
      </div>

      {!stream ? (
        <div className={`mt-4 rounded-xl border border-dashed px-4 py-6 text-center ${isLight ? "border-[#C9A84C]/40" : "border-white/15"}`}>
          <Video className="mx-auto mb-2 h-7 w-7 text-[#fbbf24]/60" />
          <p className="text-sm font-bold">Start your broadcast first</p>
          <p className={`mx-auto mt-1 max-w-sm text-xs ${isLight ? "text-[#6B5B36]" : "text-white/40"}`}>
            Guest invites belong to a live stream. Go live in the studio above and this panel wakes up —
            mint a link, send it to your guest, and they'll land backstage.
          </p>
        </div>
      ) : (
        <>
          {/* ── Mint ── */}
          <div className="mt-5 grid gap-3 md:grid-cols-[1fr_auto_auto_auto] md:items-end">
            <label className="block">
              <span className="text-xs font-bold uppercase tracking-wider opacity-60">Link label (optional)</span>
              <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="For the band" className={`${inputCls} mt-1.5 w-full`} data-testid="input-invite-label" />
            </label>
            <label className="block">
              <span className="text-xs font-bold uppercase tracking-wider opacity-60">Link expires</span>
              <select value={expiry} onChange={(e) => setExpiry(e.target.value)} className={`${inputCls} mt-1.5 w-full`} data-testid="select-invite-expiry">
                <option value="60">in 1 hour</option>
                <option value="240">in 4 hours</option>
                <option value="1440">in 24 hours</option>
                <option value="">when the stream ends</option>
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-bold uppercase tracking-wider opacity-60">Guests per link</span>
              <select value={maxJoins} onChange={(e) => setMaxJoins(e.target.value)} className={`${inputCls} mt-1.5 w-full`} data-testid="select-invite-max">
                <option value="">up to the room limit (10)</option>
                <option value="1">1 guest</option>
                <option value="3">3 guests</option>
                <option value="5">5 guests</option>
              </select>
            </label>
            <Button onClick={handleMint} disabled={minting} className="gap-2 bg-gradient-to-r from-[#fbbf24] to-[#d4a017] font-bold text-black hover:brightness-110" data-testid="btn-mint-invite">
              {minting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
              Make invite link
            </Button>
          </div>

          {freshLink && (
            <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-[#fbbf24]/40 bg-[#fbbf24]/[0.07] px-3 py-2.5">
              <code className="min-w-0 flex-1 truncate text-xs">{freshLink}</code>
              <Button size="sm" variant="outline" onClick={handleCopy} className="gap-1.5 border-[#fbbf24]/40" data-testid="btn-copy-invite">
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? "Copied" : "Copy link"}
              </Button>
              <span className="w-full text-[11px] opacity-60">Shown in full only now — we store a fingerprint, never the link itself. Lose it? Mint a new one and revoke this invite below.</span>
            </div>
          )}

          {liveInvites.length > 0 && (
            <div className="mt-3 space-y-1.5">
              {liveInvites.map((inv) => (
                <div key={inv.id} className={`flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-xs ${isLight ? "border-[#C9A84C]/30" : "border-white/[0.07]"}`}>
                  <span className="font-bold">{inv.label || "Invite link"}</span>
                  <span className="opacity-50">···{inv.token_hint}</span>
                  <span className="opacity-50">{inv.join_count} joined{inv.max_joins ? ` of ${inv.max_joins}` : ""}</span>
                  <span className="opacity-50">{inv.expires_at ? `expires ${new Date(inv.expires_at).toLocaleString()}` : "until stream ends"}</span>
                  <button onClick={() => void handleRevoke(inv)} className="ml-auto inline-flex items-center gap-1 font-bold text-red-300 hover:text-red-200" data-testid={`btn-revoke-${inv.id}`}>
                    <Trash2 className="h-3.5 w-3.5" /> Revoke
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* ── Backstage door ── */}
          <div className="mt-5 flex flex-wrap items-center gap-3">
            {!inBackstage ? (
              <Button onClick={() => void enterBackstage()} className="gap-2 bg-gradient-to-r from-[#fbbf24] to-[#d4a017] font-bold text-black hover:brightness-110" data-testid="btn-enter-backstage">
                <Video className="h-4 w-4" /> Enter backstage
              </Button>
            ) : (
              <Button onClick={leaveBackstage} variant="outline" className="gap-2 border-white/15" data-testid="btn-leave-backstage">
                <VideoOff className="h-4 w-4" /> Leave backstage
              </Button>
            )}
            <p className={`text-xs ${isLight ? "text-[#6B5B36]" : "text-white/40"}`}>
              {inBackstage
                ? "You're in the greenroom. Guests see and hear you here — the audience doesn't."
                : "Your camera and mic join the greenroom only when you enter. Backstage chat works either way."}
            </p>
          </div>

          {/* ── Tiles ── */}
          {(inBackstage || guests.length > 0) && (
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {inBackstage && (
                <div className="relative overflow-hidden rounded-xl border border-[#fbbf24]/40 bg-black">
                  <video ref={localVideoRef} autoPlay muted playsInline className="aspect-video w-full object-cover" />
                  <span className="absolute bottom-2 left-2 rounded-full bg-black/70 px-2 py-0.5 text-[11px] font-bold text-white">You (host) · backstage</span>
                </div>
              )}
              {guests.map((guest) => {
                const feed = guestFeeds.get(guest.id);
                const peer = peerBySession.get(guest.id);
                return (
                  <div key={guest.id} className={`relative overflow-hidden rounded-xl border bg-black ${guest.state === "on_stage" ? "border-red-400/60" : isLight ? "border-[#C9A84C]/40" : "border-white/10"}`}>
                    <GuestTile feed={feed} />
                    <span className="absolute bottom-2 left-2 rounded-full bg-black/70 px-2 py-0.5 text-[11px] font-bold text-white">
                      {guest.display_name} · Guest · {guest.state === "on_stage" ? "ON STAGE" : "backstage"}
                    </span>
                    {!peer && <span className="absolute right-2 top-2 rounded-full bg-black/70 px-2 py-0.5 text-[10px] text-white/70">not connected</span>}
                    <div className="flex flex-wrap gap-1.5 bg-[#0a0a0a] p-2">
                      {guest.state === "backstage" ? (
                        <button onClick={() => void handlePromote(guest)} className="inline-flex items-center gap-1 rounded-lg bg-red-500/90 px-2.5 py-1.5 text-[11px] font-bold text-white hover:bg-red-500" data-testid={`btn-promote-${guest.id}`}>
                          <ArrowUpCircle className="h-3.5 w-3.5" /> Bring on stage
                        </button>
                      ) : (
                        <button onClick={() => void handleDemote(guest)} className="inline-flex items-center gap-1 rounded-lg border border-white/20 px-2.5 py-1.5 text-[11px] font-bold text-white hover:border-white/40" data-testid={`btn-demote-${guest.id}`}>
                          <ArrowDownCircle className="h-3.5 w-3.5" /> Back to backstage
                        </button>
                      )}
                      <button onClick={() => void handleRemove(guest)} className="inline-flex items-center gap-1 rounded-lg border border-red-400/30 px-2.5 py-1.5 text-[11px] font-bold text-red-300 hover:border-red-400/60" data-testid={`btn-remove-${guest.id}`}>
                        <UserX className="h-3.5 w-3.5" /> Remove
                      </button>
                    </div>
                  </div>
                );
              })}
              {guests.length === 0 && (
                <p className={`text-sm ${isLight ? "text-[#6B5B36]" : "text-white/40"}`}>No guests yet — send someone an invite link and they'll land here.</p>
              )}
            </div>
          )}

          {/* ── Backstage chat ── */}
          <div className={`mt-5 rounded-xl border p-3 ${isLight ? "border-[#C9A84C]/30" : "border-white/[0.07]"}`}>
            <p className="text-xs font-black uppercase tracking-widest text-[#fbbf24]">Backstage chat — audience never sees this</p>
            <div className="mt-2 max-h-44 space-y-1.5 overflow-y-auto pr-1">
              {messages.length === 0 ? (
                <p className={`text-xs ${isLight ? "text-[#6B5B36]" : "text-white/35"}`}>Coordinate the show here — cues, timing, "you're on in two".</p>
              ) : (
                messages.map((m) => (
                  <p key={m.id} className="text-sm">
                    <span className="font-bold text-[#fbbf24]">{m.author_name}{m.guest ? " · Guest" : " · Host"}</span>{" "}
                    <span className={isLight ? "text-zinc-800" : "text-white/80"}>{m.body}</span>
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
                placeholder="Message backstage…"
                maxLength={500}
                className={`${inputCls} flex-1`}
                data-testid="input-backstage-chat"
              />
              <Button onClick={() => void handleSend()} disabled={sending || !draft.trim()} size="sm" className="gap-1.5 bg-gradient-to-r from-[#fbbf24] to-[#d4a017] font-bold text-black" data-testid="btn-backstage-send">
                {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Send
              </Button>
            </div>
          </div>

          <p className={`mt-3 text-[11px] ${isLight ? "text-[#6B5B36]" : "text-white/30"}`}>
            Backstage video is a direct browser-to-browser mesh — on very strict networks a guest's video may not
            connect; their name still shows here and chat still works. On stage, a guest's tile rides your program
            canvas (move and resize it in Scenes &amp; sources) and their voice joins your mix.
          </p>
        </>
      )}
    </section>
  );
}

/** Renders the shared feed element for a guest (the same element the
 *  program canvas draws when the guest is on stage). */
function GuestTile({ feed }: { feed: { video: HTMLVideoElement | null; name: string } | null }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const host = hostRef.current;
    const video = feed?.video ?? null;
    if (host && video) {
      video.className = "aspect-video w-full object-cover";
      host.appendChild(video);
      return () => {
        if (video.parentElement === host) host.removeChild(video);
      };
    }
    return undefined;
  }, [feed?.video]);
  if (!feed?.video) {
    return (
      <div className="flex aspect-video w-full items-center justify-center bg-zinc-900 text-xs text-white/40">
        {feed ? "Connecting…" : "Waiting for their camera…"}
      </div>
    );
  }
  return <div ref={hostRef} className="aspect-video w-full" />;
}
