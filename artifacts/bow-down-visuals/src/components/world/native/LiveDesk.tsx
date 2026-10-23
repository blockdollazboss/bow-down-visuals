import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  Radio, Square, Loader2, Video, VideoOff, KeyRound, RefreshCw, Ban, Copy, Check,
  Eye, Trophy, UserPlus, Trash2, ArrowUpCircle, ArrowDownCircle, UserX, Send,
  LogOut, Link2, ShieldCheck,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { NativeLoadingState, NativeEmptyState } from "@/components/world/native";
import { pendingRedemptionsFromPayload } from "@/lib/reach-watch";
import { apiJson } from "@/lib/social-api";
import { reachApi, type LoyaltyState, type SavedDestination } from "@/lib/reach-api";
import {
  createStreamTransport, SITE_DESTINATION, WhipTransport, OwnServerTransport,
  TransportError, type StreamTransport,
} from "@/lib/stream-kit/transport";
import {
  mintGuestInvite, listGuestInvites, revokeGuestInvite, promoteGuest, demoteGuest,
  removeGuest, hostBackstageHistory, hostBackstagePost,
  readInvite, joinAsGuest, guestSession, guestHeartbeat, guestLeave,
  guestBackstageHistory, guestBackstagePost, GuestApiError,
  type GuestInviteDto, type GuestSessionDto, type BackstageMessageDto, type InviteInfoDto,
} from "@/lib/go-live/guest-api";
import { BackstageClient, type BackstagePeer } from "@/lib/go-live/backstage-client";
import {
  LIVE_STATUS_PATH, LIVE_STREAM_PATH, LIVE_STREAM_END_PATH,
  INGEST_KEY_PATH, INGEST_KEY_REVEAL_PATH, INGEST_KEY_REGENERATE_PATH, INGEST_KEY_REVOKE_PATH,
  MY_PROFILE_PATH,
  LOYALTY_WATCH_MENU, LOYALTY_CHAT_MENU, LOYALTY_TIP_MENU, LOYALTY_CUSTOM_COST_MENU,
  INVITE_EXPIRY_OPTIONS, BACKSTAGE_SAY_MAX,
  normalizeLiveStatus, streamTitleReady, ingestKeyShownOnce,
  normalizeGuestRoster, inviteShareUrl, backstageDraftReady,
  extractInviteToken, guestStorageKey, guestNameReady, guestSessionActive,
  type LiveStatusView,
} from "@/lib/world/live-desk";

/* ─── Live Wave I (stack-100 #85–#87) ───────────────────────────────
   The Go Live studio, its guests & backstage, and the guest door —
   docked in the hall's Screen panel, on the 2D studio's exact rails:
   - LiveStudioDesk (#85): /api/live-streams/status + the stream-kit
     transport (the site's own pipe — WHIP or own-server chunks) for
     go-live/end, the ingest-key doors, the saved destination keys
     (reachApi) and channel loyalty (reachApi) — BroadcastStudio,
     IngestKeyPanel, DestinationKeysPanel and LoyaltySettingsPanel,
     in-world. The camera feed here is the member's own camera,
     published through the same transport; the 2D studio's scene
     compositing/effects kit is not rebuilt (that's #89's deck).
   - LiveBackstageDesk (#86): GuestPanel's host doors via guest-api
     + the BackstageClient socket.
   - LiveGuestJoinDesk (#87): live-guest.tsx's guest doors via
     guest-api + BackstageClient with the guest token, for a
     signed-in member joining a stream as its guest participant.
   The Screen panel itself is members-only, so palace guests never
   reach these desks — no voice is given to them anywhere here. */

function useToken() {
  const { getAccessToken } = useAuth();
  return useCallback(async () => (await getAccessToken()) ?? "", [getAccessToken]);
}

function useAuthHeaders() {
  const { getAccessToken } = useAuth();
  return async (): Promise<Record<string, string>> => {
    const token = await getAccessToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  };
}

function LiveCard({ isLight, testId, children }: { isLight: boolean; testId: string; children: ReactNode }) {
  return (
    <div data-testid={testId} className={`rounded-2xl border px-4 py-3 ${isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"}`}>
      {children}
    </div>
  );
}

const chipBtn = (isLight: boolean) =>
  `inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition disabled:opacity-50 ${
    isLight
      ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]"
      : "border-white/15 text-white/75 hover:text-white"
  }`;
const goldBtn =
  "inline-flex items-center gap-1.5 rounded-full bg-[#d4af37] px-3.5 py-1.5 text-xs font-bold text-black transition hover:scale-105 disabled:opacity-50 disabled:hover:scale-100";
const redBtn =
  "inline-flex items-center gap-1.5 rounded-full bg-red-500 px-3.5 py-1.5 text-xs font-bold text-white transition hover:scale-105 disabled:opacity-50 disabled:hover:scale-100";
const inputCls = (isLight: boolean) =>
  `w-full rounded-xl border px-3 py-2 text-sm outline-none transition focus:border-[#d4af37] ${
    isLight
      ? "border-[#C9A84C]/40 bg-white/60 text-[#2a1e07] placeholder:text-[#6B5B36]/60"
      : "border-white/10 bg-white/5 text-white placeholder:text-white/35"
  }`;
const selectCls = (isLight: boolean) =>
  `rounded-lg border px-2 py-1.5 text-sm focus:border-[#d4af37] focus:outline-none ${
    isLight ? "border-[#C9A84C]/40 bg-white/70 text-[#2a1e07]" : "border-white/15 bg-black text-white"
  }`;

function RemoteVideo({ stream, label }: { stream: MediaStream; label: string }) {
  const ref = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);
  return (
    <div className="relative overflow-hidden rounded-xl border border-white/10 bg-black">
      <video ref={ref} autoPlay playsInline className="aspect-video w-full object-cover" data-testid="world-live-remote-video" />
      <span className="absolute bottom-1.5 left-1.5 rounded-full bg-black/70 px-2 py-0.5 text-[10px] font-bold text-white">{label}</span>
    </div>
  );
}

function BackstageChat({
  isLight, messages, draft, setDraft, onSend, sending, testid,
}: {
  isLight: boolean;
  messages: BackstageMessageDto[];
  draft: string;
  setDraft: (v: string) => void;
  onSend: () => void;
  sending: boolean;
  testid: string;
}) {
  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  return (
    <div>
      <div className="max-h-44 space-y-1.5 overflow-y-auto pr-1" data-testid={`${testid}-list`}>
        {messages.length === 0 ? (
          <p className={`text-sm ${muted}`}>Nothing backstage yet — this chat is private to the host and guests; the audience never sees it.</p>
        ) : (
          messages.map((m) => (
            <p key={m.id} className={`text-sm ${isLight ? "text-[#2a1e07]" : "text-white/85"}`}>
              <span className="font-bold text-[#b8912c]">{m.author_name}</span>
              {m.guest ? <span className={`ml-1 text-[10px] font-black uppercase ${muted}`}>guest</span> : null}{" "}
              <span className="break-words">{m.body}</span>
            </p>
          ))
        )}
      </div>
      <div className="mt-2 flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") onSend(); }}
          placeholder="Message backstage…"
          maxLength={BACKSTAGE_SAY_MAX}
          className={inputCls(isLight)}
          data-testid={`${testid}-input`}
        />
        <button type="button" onClick={onSend} disabled={sending || !backstageDraftReady(draft)} className={goldBtn} data-testid={`${testid}-send`}>
          {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Send
        </button>
      </div>
    </div>
  );
}

/* ═══ #85 The studio ════════════════════════════════════════════════ */

export function LiveStudioDesk({ isLight, onStreamChange }: { isLight: boolean; onStreamChange?: () => void }) {
  const token = useToken();
  const authHeaders = useAuthHeaders();
  const { getAccessToken } = useAuth();
  const [status, setStatus] = useState<LiveStatusView | null>(null);
  const [failed, setFailed] = useState(false);
  const [title, setTitle] = useState("");
  const [phase, setPhase] = useState<"off" | "camera" | "connecting" | "live">("off");
  const [liveId, setLiveId] = useState<string | null>(null);
  const [viewers, setViewers] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  const [endingLeftover, setEndingLeftover] = useState(false);
  const camRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const transportRef = useRef<StreamTransport | null>(null);

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch(LIVE_STATUS_PATH, { headers: await authHeaders() });
      if (!res.ok) throw new Error("status");
      setStatus(normalizeLiveStatus(await res.json()));
      setFailed(false);
    } catch {
      setFailed(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    WhipTransport.api.getAccessToken = getAccessToken;
    OwnServerTransport.api.getAccessToken = getAccessToken;
    void loadStatus();
  }, [getAccessToken, loadStatus]);

  /* Viewer count while broadcasting from here — BroadcastStudio's
     10-second poll of the public stream DTO. */
  useEffect(() => {
    if (phase !== "live" || !liveId) return;
    const id = setInterval(async () => {
      try {
        const res = await fetch(LIVE_STREAM_PATH(liveId));
        if (res.ok) {
          const d = (await res.json()) as { stream?: { viewer_count?: number } };
          if (typeof d.stream?.viewer_count === "number") setViewers(d.stream.viewer_count);
        }
      } catch { /* next poll retries */ }
    }, 10_000);
    return () => clearInterval(id);
  }, [phase, liveId]);

  useEffect(
    () => () => {
      camRef.current?.getTracks().forEach((t) => t.stop());
    },
    [],
  );

  async function startCamera() {
    setNote(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      camRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      setPhase("camera");
    } catch {
      setNote("Camera and mic couldn't start — check the browser's permission for this site, then try again.");
    }
  }

  function stopCamera() {
    if (phase === "live" || phase === "connecting") return;
    camRef.current?.getTracks().forEach((t) => t.stop());
    camRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setPhase("off");
  }

  async function goLive() {
    const cam = camRef.current;
    if (!cam) { setNote("Start your camera first — that's the feed your stream is built from."); return; }
    if (!streamTitleReady(title)) { setNote("Give your stream a title — viewers find you by it in the Live rail."); return; }
    setPhase("connecting");
    setNote(null);
    const transport = createStreamTransport(status?.transport ?? "own");
    transportRef.current = transport;
    try {
      await transport.start(cam, { title: title.trim(), destinations: [{ ...SITE_DESTINATION }] });
      setLiveId(transport.streamId ?? null);
      setViewers(0);
      setPhase("live");
      setNote("You're live — your stream is on your profile and in the Live rail. Take the stage above to put it on the hall's big screen.");
      await loadStatus();
      onStreamChange?.();
    } catch (err) {
      setPhase("camera");
      const msg = err instanceof TransportError && (err.code === "NOT_CONFIGURED" || err.code === "STREAM_NOT_CONFIGURED")
        ? "Live streaming isn't switched on yet on this site. Your camera works — broadcasting turns on the moment the owner enables it."
        : err instanceof Error ? err.message : "Couldn't go live. Try again in a moment.";
      setNote(msg);
    }
  }

  async function endLive() {
    const transport = transportRef.current;
    if (!transport) return;
    await transport.stop();
    transportRef.current = null;
    setLiveId(null);
    setPhase("camera");
    setNote("You're off air. The replay saves to your clips when the stage finishes it.");
    await loadStatus();
    onStreamChange?.();
  }

  async function endLeftover() {
    if (!status?.liveStream) return;
    setEndingLeftover(true);
    try {
      await fetch(LIVE_STREAM_END_PATH(status.liveStream.id), { method: "POST", headers: await authHeaders() });
      await loadStatus();
      onStreamChange?.();
    } finally {
      setEndingLeftover(false);
    }
  }

  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const strong = isLight ? "text-[#2a1e07]" : "text-white";
  const broadcastingHere = phase === "live" || phase === "connecting";
  const leftover = !broadcastingHere ? status?.liveStream ?? null : null;

  return (
    <div className="space-y-4" data-testid="world-live-studio">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`inline-flex items-center gap-2 text-sm font-black ${strong}`}>
          <Radio className="h-4 w-4 text-[#d4af37]" /> Go Live — the studio, right here
        </span>
        {phase === "live" && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-red-500/40 bg-red-500/10 px-3 py-1 text-xs font-bold text-red-300">
            <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" /> LIVE · {viewers} watching
          </span>
        )}
      </div>

      {failed ? (
        <p className={`text-sm ${muted}`}>The studio status couldn&rsquo;t load. <button type="button" className="font-bold underline" onClick={() => void loadStatus()}>Try again</button></p>
      ) : status === null ? (
        <NativeLoadingState isLight={isLight} message="Checking the studio…" />
      ) : (
        <>
          {!status.configured && (
            <p className={`text-sm ${muted}`}>
              Live streaming isn&rsquo;t switched on yet on this site — your camera check below still works, and broadcasting turns on the moment the owner enables it.
            </p>
          )}
          {leftover && (
            <div className="flex flex-wrap items-center gap-2" data-testid="world-live-leftover">
              <span className={`text-sm ${strong}`}>You&rsquo;re already live: <b>{leftover.title}</b> ({leftover.viewerCount} watching)</span>
              <button type="button" onClick={() => void endLeftover()} disabled={endingLeftover} className={redBtn} data-testid="world-live-end-leftover">
                {endingLeftover ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Square className="h-3.5 w-3.5" />} End that stream
              </button>
              <span className={`text-xs ${muted}`}>Its guests &amp; backstage are in the panel below.</span>
            </div>
          )}

          <div className="grid gap-3 md:grid-cols-[1fr_240px]">
            <div className="relative overflow-hidden rounded-xl border border-white/10 bg-black">
              <video ref={videoRef} autoPlay playsInline muted className="aspect-video w-full object-cover" data-testid="world-live-camera" />
              {phase === "off" && (
                <span className={`absolute inset-0 flex items-center justify-center text-sm ${muted}`}>Your camera is off</span>
              )}
            </div>
            <div className="space-y-2">
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Stream title — viewers find you by it"
                maxLength={200}
                className={inputCls(isLight)}
                data-testid="world-live-title"
              />
              {phase === "off" ? (
                <button type="button" onClick={() => void startCamera()} className={goldBtn} data-testid="world-live-camera-start">
                  <Video className="h-3.5 w-3.5" /> Start camera
                </button>
              ) : (
                <button type="button" onClick={stopCamera} disabled={broadcastingHere} className={chipBtn(isLight)} data-testid="world-live-camera-stop">
                  <VideoOff className="h-3.5 w-3.5" /> Stop camera
                </button>
              )}
              {phase === "camera" && (
                <button type="button" onClick={() => void goLive()} disabled={!status.configured} className={redBtn} data-testid="world-live-go">
                  <Radio className="h-3.5 w-3.5" /> Go live
                </button>
              )}
              {phase === "connecting" && (
                <span className={`inline-flex items-center gap-2 text-sm ${muted}`}><Loader2 className="h-4 w-4 animate-spin" /> Connecting…</span>
              )}
              {phase === "live" && (
                <button type="button" onClick={() => void endLive()} className={redBtn} data-testid="world-live-end">
                  <Square className="h-3.5 w-3.5" /> End stream
                </button>
              )}
              <p className={`text-xs ${muted}`}>Broadcasting to: your profile (the site destination). Other platforms ride the destination keys below and join at fan-out, exactly as in the 2D studio.</p>
            </div>
          </div>
          {note && <p className={`text-sm ${isLight ? "text-[#92600a]" : "text-amber-300"}`} data-testid="world-live-note">{note}</p>}

          <IngestKeySection isLight={isLight} />
          <DestinationKeysSection isLight={isLight} />
          <LoyaltySection isLight={isLight} token={token} />
        </>
      )}
    </div>
  );
}

/* ── #85 ingest key (IngestKeyPanel's doors) ─────────────────────── */

interface IngestDto {
  enabled: boolean;
  ingest_url: string | null;
  has_key: boolean;
  key_hint: string | null;
  stream_title: string | null;
  revoked: boolean;
}

function IngestKeySection({ isLight }: { isLight: boolean }) {
  const { getAccessToken } = useAuth();
  const [ingest, setIngest] = useState<IngestDto | null>(null);
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [notReshown, setNotReshown] = useState(false);
  const [title, setTitle] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmingRegen, setConfirmingRegen] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await apiJson<{ ingest: IngestDto }>(getAccessToken, INGEST_KEY_PATH);
      setIngest(res.ingest);
      setTitle(res.ingest.stream_title ?? "");
    } catch {
      setNote("Your stream key status couldn't load. Try again in a moment.");
    }
  }, [getAccessToken]);

  useEffect(() => { void load(); }, [load]);

  const run = async (action: string, fn: () => Promise<void>) => {
    setBusy(action);
    setNote(null);
    try { await fn(); } catch (err) {
      setNote(err instanceof Error ? err.message : "Something went wrong. Try again.");
    } finally { setBusy(null); }
  };

  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const strong = isLight ? "text-[#2a1e07]" : "text-white";

  return (
    <LiveCard isLight={isLight} testId="world-live-ingest">
      <p className={`inline-flex items-center gap-2 text-sm font-black ${strong}`}>
        <KeyRound className="h-4 w-4 text-[#d4af37]" /> Stream key (for other software)
      </p>
      {ingest === null ? (
        <p className={`mt-1 text-sm ${muted}`}>Loading your key status…</p>
      ) : !ingest.enabled ? (
        <p className={`mt-1 text-sm ${muted}`}>
          Streaming from other software isn&rsquo;t open yet — it arrives with the launch setup. Your built-in studio above works today.
          {ingest.has_key ? ` You do have a key (…${ingest.key_hint ?? ""}) — revoke and title controls stay live below.` : ""}
        </p>
      ) : (
        <p className={`mt-1 text-sm ${muted}`}>
          Point your encoder at <span className="font-mono">{ingest.ingest_url ?? "the ingest address"}</span> with your personal key.
          {ingest.has_key ? ` Current key ends …${ingest.key_hint ?? ""}.` : " You don't have a key yet."}
        </p>
      )}
      {ingest && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={busy !== null || !ingest.enabled}
            onClick={() => void run("reveal", async () => {
              const res = await apiJson<{ stream_key: string | null; ingest: IngestDto }>(getAccessToken, INGEST_KEY_REVEAL_PATH, { method: "POST" });
              setIngest(res.ingest);
              if (ingestKeyShownOnce(res.stream_key)) { setRevealedKey(res.stream_key); setNotReshown(false); }
              else setNotReshown(true);
            })}
            className={chipBtn(isLight)}
            data-testid="world-live-ingest-reveal"
          >
            {busy === "reveal" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />}
            {ingest.has_key ? "Show my key" : "Create my key"}
          </button>
          {ingest.has_key && !confirmingRegen && (
            <button type="button" disabled={busy !== null || !ingest.enabled} onClick={() => setConfirmingRegen(true)} className={chipBtn(isLight)} data-testid="world-live-ingest-regen-ask">
              <RefreshCw className="h-3.5 w-3.5" /> Regenerate
            </button>
          )}
          {ingest.has_key && confirmingRegen && (
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void run("regenerate", async () => {
                const res = await apiJson<{ stream_key: string | null; ingest: IngestDto }>(getAccessToken, INGEST_KEY_REGENERATE_PATH, { method: "POST" });
                setIngest(res.ingest);
                setRevealedKey(res.stream_key);
                setNotReshown(false);
                setConfirmingRegen(false);
                setNote("New key created — copy it now, because it can't be shown again. The old key stopped working the moment this one was made.");
              })}
              className={redBtn}
              data-testid="world-live-ingest-regen-confirm"
            >
              {busy === "regenerate" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Yes — new key, old one dies
            </button>
          )}
          {ingest.has_key && (
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void run("revoke", async () => {
                const res = await apiJson<{ ingest: IngestDto }>(getAccessToken, INGEST_KEY_REVOKE_PATH, { method: "POST" });
                setIngest(res.ingest);
                setRevealedKey(null);
                setNotReshown(false);
                setConfirmingRegen(false);
                setNote("Key revoked. Nothing can stream with it now.");
              })}
              className={chipBtn(isLight)}
              data-testid="world-live-ingest-revoke"
            >
              {busy === "revoke" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Ban className="h-3.5 w-3.5" />} Revoke
            </button>
          )}
        </div>
      )}
      {revealedKey && (
        <div className="mt-2 flex flex-wrap items-center gap-2" data-testid="world-live-ingest-key">
          <code className={`rounded-lg px-3 py-1.5 font-mono text-xs ${isLight ? "bg-[#C9A84C]/15 text-[#2a1e07]" : "bg-white/10 text-white"}`}>{revealedKey}</code>
          <button
            type="button"
            className={chipBtn(isLight)}
            onClick={() => { void navigator.clipboard?.writeText(revealedKey).then(() => setCopied(true)).catch(() => undefined); }}
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} {copied ? "Copied" : "Copy"}
          </button>
          <span className={`text-xs ${muted}`}>Shown once — it can never be displayed again.</span>
        </div>
      )}
      {notReshown && (
        <p className={`mt-2 text-sm ${muted}`}>Your key exists, but it&rsquo;s stored as a one-way hash — it can never be shown again. Regenerate to get a fresh one you can copy.</p>
      )}
      {ingest?.has_key && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Standing stream title for key broadcasts" maxLength={120} className={`${inputCls(isLight)} max-w-sm`} data-testid="world-live-ingest-title" />
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void run("title", async () => {
              const res = await apiJson<{ ingest: IngestDto }>(getAccessToken, INGEST_KEY_PATH, { method: "PATCH", body: JSON.stringify({ stream_title: title.trim() || null }) });
              setIngest(res.ingest);
              setNote("Standing title saved.");
            })}
            className={chipBtn(isLight)}
            data-testid="world-live-ingest-title-save"
          >
            Save title
          </button>
        </div>
      )}
      {note && <p className={`mt-2 text-sm ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>{note}</p>}
    </LiveCard>
  );
}

/* ── #85 destination keys (DestinationKeysPanel's doors) ─────────── */

function DestinationKeysSection({ isLight }: { isLight: boolean }) {
  const { getAccessToken } = useAuth();
  const [destinations, setDestinations] = useState<SavedDestination[] | null>(null);
  const [platform, setPlatform] = useState("");
  const [ingestUrl, setIngestUrl] = useState("");
  const [streamKey, setStreamKey] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await reachApi.listDestinations(getAccessToken);
      setDestinations(res.destinations);
    } catch {
      setDestinations([]);
      setNote("Your destinations couldn't load. Try again in a moment.");
    }
  }, [getAccessToken]);

  useEffect(() => { void load(); }, [load]);

  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const strong = isLight ? "text-[#2a1e07]" : "text-white";

  return (
    <LiveCard isLight={isLight} testId="world-live-destinations">
      <p className={`inline-flex items-center gap-2 text-sm font-black ${strong}`}>
        <Link2 className="h-4 w-4 text-[#d4af37]" /> Destination keys — stream to other platforms too
      </p>
      <p className={`mt-1 text-sm ${muted}`}>Save a platform&rsquo;s ingest address + key once; add the platform to a broadcast and the fan-out carries your show there. Keys are stored server-side and never shown back.</p>
      {destinations === null ? (
        <p className={`mt-2 text-sm ${muted}`}>Loading your destinations…</p>
      ) : destinations.length === 0 ? (
        <p className={`mt-2 text-sm ${muted}`}>No destinations saved yet.</p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {destinations.map((d) => (
            <li key={d.platform} className="flex flex-wrap items-center gap-2 text-sm" data-testid="world-live-destination-row">
              <b className={`capitalize ${strong}`}>{d.platform}</b>
              <span className={`font-mono text-xs ${muted}`}>{d.ingestUrl}</span>
              <span className={`text-xs ${muted}`}>{d.hasKey ? "key saved" : "no key"}</span>
              <button
                type="button"
                className={chipBtn(isLight)}
                onClick={() => { void reachApi.deleteDestination(getAccessToken, d.platform).then(() => load()).catch(() => undefined); }}
                data-testid={`world-live-destination-delete-${d.platform}`}
              >
                <Trash2 className="h-3.5 w-3.5" /> Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3 grid gap-2 md:grid-cols-3">
        <input value={platform} onChange={(e) => setPlatform(e.target.value)} placeholder="Platform (e.g. youtube)" className={inputCls(isLight)} data-testid="world-live-dest-platform" />
        <input value={ingestUrl} onChange={(e) => setIngestUrl(e.target.value)} placeholder="Ingest URL (rtmp://…)" className={inputCls(isLight)} data-testid="world-live-dest-url" />
        <input value={streamKey} onChange={(e) => setStreamKey(e.target.value)} placeholder="Stream key" type="password" className={inputCls(isLight)} data-testid="world-live-dest-key" />
      </div>
      <button
        type="button"
        disabled={busy || !platform.trim() || !ingestUrl.trim() || !streamKey.trim()}
        onClick={async () => {
          setBusy(true);
          setNote(null);
          try {
            await reachApi.saveDestination(getAccessToken, platform.trim().toLowerCase(), ingestUrl.trim(), streamKey.trim());
            setPlatform(""); setIngestUrl(""); setStreamKey("");
            setNote("Saved. This platform will pick up your next broadcast when you add it to the stream's destinations.");
            await load();
          } catch (err) {
            setNote(err instanceof Error ? err.message : "That destination couldn't be saved.");
          } finally { setBusy(false); }
        }}
        className={`${goldBtn} mt-2`}
        data-testid="world-live-dest-save"
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Save destination
      </button>
      {note && <p className={`mt-2 text-sm ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>{note}</p>}
    </LiveCard>
  );
}

/* ── #85 loyalty (LoyaltySettingsPanel's doors) ──────────────────── */

function LoyaltySection({ isLight, token }: { isLight: boolean; token: () => Promise<string> }) {
  void token;
  const { getAccessToken } = useAuth();
  const [profileId, setProfileId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [state, setState] = useState<LoyaltyState | null>(null);
  const [queue, setQueue] = useState<Array<{ id: string; perkLabel: string; pointsCost: number; status: string }>>([]);
  const [note, setNote] = useState<string | null>(null);
  const [form, setForm] = useState({ enabled: true, watch: 10, chat: 2, tip: 5, customLabel: "", customCost: 1000 });

  const load = useCallback(async (pid: string) => {
    const [s, q] = await Promise.all([
      reachApi.loyalty(getAccessToken, pid),
      reachApi.redemptionQueue(getAccessToken, pid).catch(() => ({ redemptions: [] as Array<{ id: string; perkLabel: string; pointsCost: number; status: string }> })),
    ]);
    setState(s);
    setForm({
      enabled: s.enabled,
      watch: s.watchPointsPer10Min,
      chat: s.chatPoints,
      tip: s.tipPointsPer100Vb,
      customLabel: s.customRewardLabel ?? "",
      customCost: s.customRewardCost ?? 1000,
    });
    setQueue(pendingRedemptionsFromPayload(q));
  }, [getAccessToken]);

  useEffect(() => {
    (async () => {
      try {
        const me = await apiJson<{ id?: string }>(getAccessToken, MY_PROFILE_PATH).catch(() => null);
        const pid = me?.id ?? null;
        setProfileId(pid);
        if (pid) await load(pid);
      } catch { /* no profile → the card explains itself */ }
      setLoaded(true);
    })();
  }, [getAccessToken, load]);

  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const strong = isLight ? "text-[#2a1e07]" : "text-white";
  const rowCls = `flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-sm ${isLight ? "border-[#C9A84C]/30" : "border-white/10"}`;

  return (
    <LiveCard isLight={isLight} testId="world-live-loyalty">
      <p className={`inline-flex items-center gap-2 text-sm font-black ${strong}`}>
        <Trophy className="h-4 w-4 text-[#d4af37]" /> Channel loyalty
      </p>
      {!loaded ? (
        <p className={`mt-1 text-sm ${muted}`}>Loading your loyalty program…</p>
      ) : !profileId ? (
        <p className={`mt-1 text-sm ${muted}`}>Create your creator profile first — loyalty points live on your channel.</p>
      ) : (
        <>
          <p className={`mt-1 text-sm ${muted}`}>Fans earn your channel&rsquo;s points for watching, chatting and tipping, and spend them on perks you fulfill. Points are not Visual Bucs and can&rsquo;t be turned into Visual Bucs or money.</p>
          <form
            className="mt-3 grid gap-2 md:grid-cols-3"
            onSubmit={async (e) => {
              e.preventDefault();
              setNote(null);
              try {
                await reachApi.saveLoyaltySettings(getAccessToken, profileId, {
                  enabled: form.enabled,
                  watchPointsPer10Min: form.watch,
                  chatPoints: form.chat,
                  tipPointsPer100Vb: form.tip,
                  customRewardLabel: form.customLabel.trim() || null,
                  customRewardCost: form.customLabel.trim() ? form.customCost : null,
                });
                setNote("Saved. Your fans earn at these rates from now on.");
                await load(profileId);
              } catch (err) {
                setNote(err instanceof Error ? err.message : "Settings couldn't be saved.");
              }
            }}
          >
            <label className={rowCls}>Program on
              <input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} className="h-4 w-4 accent-[#d4af37]" data-testid="world-live-loyalty-enabled" />
            </label>
            <label className={rowCls}>Points per 10 min watched
              <select value={form.watch} onChange={(e) => setForm({ ...form, watch: Number(e.target.value) })} className={selectCls(isLight)} data-testid="world-live-loyalty-watch">
                {LOYALTY_WATCH_MENU.map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </label>
            <label className={rowCls}>Points per chat message
              <select value={form.chat} onChange={(e) => setForm({ ...form, chat: Number(e.target.value) })} className={selectCls(isLight)} data-testid="world-live-loyalty-chat">
                {LOYALTY_CHAT_MENU.map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </label>
            <label className={rowCls}>Points per 100 VB tipped
              <select value={form.tip} onChange={(e) => setForm({ ...form, tip: Number(e.target.value) })} className={selectCls(isLight)} data-testid="world-live-loyalty-tip">
                {LOYALTY_TIP_MENU.map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </label>
            <label className={`${rowCls} md:col-span-2`}>Custom reward (you fulfill it)
              <input value={form.customLabel} onChange={(e) => setForm({ ...form, customLabel: e.target.value })} placeholder="e.g. Pick next stream's game" className={`${inputCls(isLight)} min-w-0 flex-1`} data-testid="world-live-loyalty-custom-label" />
              <select value={form.customCost} onChange={(e) => setForm({ ...form, customCost: Number(e.target.value) })} className={selectCls(isLight)} data-testid="world-live-loyalty-custom-cost">
                {LOYALTY_CUSTOM_COST_MENU.map((v) => <option key={v} value={v}>{v} pts</option>)}
              </select>
            </label>
            <button type="submit" className={goldBtn} data-testid="world-live-loyalty-save">Save loyalty settings</button>
          </form>
          {note && <p className={`mt-2 text-sm ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>{note}</p>}
          {state && <p className={`mt-2 text-xs ${muted}`}>Perks on your menu: {state.perks.map((p) => `${p.label} (${p.cost})`).join(" · ")}</p>}

          <p className={`mt-4 text-xs font-black uppercase tracking-wider ${muted}`}>Redemption queue</p>
          {queue.length === 0 ? (
            <p className={`mt-1 text-sm ${muted}`}>Nothing waiting. When a fan redeems a perk it lands here.</p>
          ) : (
            <ul className="mt-2 space-y-1.5">
              {queue.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 text-sm" data-testid="world-live-redemption-row">
                  <span className={strong}>{r.perkLabel} <span className={muted}>({r.pointsCost} pts)</span></span>
                  <span className="flex gap-1.5">
                    {(["fulfilled", "declined"] as const).map((d) => (
                      <button
                        key={d}
                        type="button"
                        className={d === "fulfilled" ? goldBtn : chipBtn(isLight)}
                        onClick={async () => {
                          await reachApi.resolveRedemption(getAccessToken, r.id, d).catch(() => undefined);
                          await load(profileId);
                        }}
                        data-testid={`world-live-redemption-${d}`}
                      >
                        {d === "fulfilled" ? "Mark fulfilled" : "Decline (refunds points)"}
                      </button>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </LiveCard>
  );
}

/* ═══ #86 Guests & backstage (host) ═════════════════════════════════ */

export function LiveBackstageDesk({ isLight }: { isLight: boolean }) {
  const token = useToken();
  const authHeaders = useAuthHeaders();
  const [stream, setStream] = useState<{ id: string; title: string } | null>(null);
  const [invites, setInvites] = useState<GuestInviteDto[]>([]);
  const [guests, setGuests] = useState<GuestSessionDto[]>([]);
  const [label, setLabel] = useState("");
  const [expiry, setExpiry] = useState<string>("240");
  const [maxJoins, setMaxJoins] = useState<string>("");
  const [minting, setMinting] = useState(false);
  const [freshLink, setFreshLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [inBackstage, setInBackstage] = useState(false);
  const [peers, setPeers] = useState<BackstagePeer[]>([]);
  const [remoteStreams, setRemoteStreams] = useState<Map<string, MediaStream>>(new Map());
  const [messages, setMessages] = useState<BackstageMessageDto[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const clientRef = useRef<BackstageClient | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const streamIdRef = useRef<string | null>(null);

  /* GuestPanel's status poll: invites attach to the live stream. */
  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const res = await fetch(LIVE_STATUS_PATH, { headers: await authHeaders() });
        if (!res.ok) return;
        const data = (await res.json()) as { live_stream: { id: string; title: string } | null };
        if (cancelled) return;
        setStream(data.live_stream ? { id: data.live_stream.id, title: data.live_stream.title } : null);
      } catch { /* best-effort; next tick retries */ }
    };
    void check();
    const id = setInterval(check, 15_000);
    return () => { cancelled = true; clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshRoster = useCallback(async () => {
    const sid = streamIdRef.current;
    if (!sid) return;
    try {
      const data = await listGuestInvites(sid, await token());
      setInvites(data.invites);
      setGuests(data.guests.filter((g) => g.state === "backstage" || g.state === "on_stage"));
    } catch { /* best-effort refresh */ }
  }, [token]);

  useEffect(() => {
    streamIdRef.current = stream?.id ?? null;
    if (!stream) { setInvites([]); setGuests([]); return; }
    void refreshRoster();
    const id = setInterval(refreshRoster, 20_000);
    return () => clearInterval(id);
  }, [stream, refreshRoster]);

  const leaveBackstage = useCallback(() => {
    clientRef.current?.close();
    clientRef.current = null;
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    setInBackstage(false);
    setPeers([]);
    setRemoteStreams(new Map());
  }, []);

  useEffect(() => {
    if (!stream) leaveBackstage();
  }, [stream, leaveBackstage]);

  useEffect(() => () => {
    clientRef.current?.close();
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
  }, []);

  async function handleMint() {
    if (!stream) return;
    setMinting(true);
    setNote(null);
    try {
      const data = await mintGuestInvite(stream.id, await token(), {
        label: label.trim() || undefined,
        expires_in_minutes: expiry ? Number(expiry) : undefined,
        max_joins: maxJoins ? Number(maxJoins) : undefined,
      });
      setFreshLink(inviteShareUrl(window.location.origin, data.invite_path));
      setCopied(false);
      setLabel("");
      await refreshRoster();
      setNote("Invite ready — share the link. It's shown once; a lost link is replaced by minting a new one (and revoking the old).");
    } catch (e) {
      setNote(e instanceof Error ? e.message : "That invite couldn't be made.");
    } finally { setMinting(false); }
  }

  async function handleRevoke(invite: GuestInviteDto) {
    if (!stream) return;
    try {
      const data = await revokeGuestInvite(stream.id, invite.id, await token());
      setFreshLink(null);
      await refreshRoster();
      setNote(data.sessions_ended ? `Link revoked — ${data.sessions_ended} guest session(s) ended with it.` : "Link revoked.");
    } catch (e) {
      setNote(e instanceof Error ? e.message : "That invite couldn't be revoked.");
    }
  }

  async function handlePromote(guest: GuestSessionDto) {
    if (!stream) return;
    try {
      const data = await promoteGuest(stream.id, guest.id, await token());
      setGuests((gs) => gs.map((g) => (g.id === guest.id ? data.guest : g)));
    } catch (e) { setNote(e instanceof Error ? e.message : "That guest couldn't be brought on stage."); }
  }

  async function handleDemote(guest: GuestSessionDto) {
    if (!stream) return;
    try {
      const data = await demoteGuest(stream.id, guest.id, await token());
      setGuests((gs) => gs.map((g) => (g.id === guest.id ? data.guest : g)));
    } catch (e) { setNote(e instanceof Error ? e.message : "That guest couldn't be moved backstage."); }
  }

  async function handleRemove(guest: GuestSessionDto) {
    if (!stream) return;
    try {
      await removeGuest(stream.id, guest.id, await token());
      setGuests((gs) => gs.filter((g) => g.id !== guest.id));
    } catch (e) { setNote(e instanceof Error ? e.message : "That guest couldn't be removed."); }
  }

  async function enterBackstage() {
    if (!stream || clientRef.current) return;
    let local: MediaStream | null = null;
    try {
      local = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    } catch {
      setNote("Camera/mic unavailable — you're in backstage without media; chat and guest controls still work.");
    }
    localStreamRef.current = local;
    if (localVideoRef.current && local) localVideoRef.current.srcObject = local;
    const t = await token();
    const client = new BackstageClient({
      streamId: stream.id,
      token: t,
      events: {
        onPeers: (next) => { setPeers(next); void refreshRoster(); },
        onChat: (message) => setMessages((ms) => (ms.some((m) => m.id === message.id) ? ms : [...ms, message])),
        onRemoteStream: (sessionId, peerId, mediaStream) => {
          setRemoteStreams((prev) => new Map(prev).set(sessionId ?? peerId, mediaStream));
        },
        onRemoteGone: (sessionId, peerId) => {
          setRemoteStreams((prev) => {
            const next = new Map(prev);
            next.delete(sessionId ?? peerId);
            return next;
          });
        },
        onBackstageClosed: () => setNote("The stream ended — backstage is closed."),
      },
    });
    clientRef.current = client;
    client.connect(local);
    if (local) client.joinMedia();
    setInBackstage(true);
    try {
      const data = await hostBackstageHistory(stream.id, t);
      setMessages(data.messages);
    } catch { /* live frames still land */ }
  }

  async function handleSend() {
    if (!stream || !backstageDraftReady(draft)) return;
    setSending(true);
    try {
      const data = await hostBackstagePost(stream.id, await token(), draft.trim());
      setMessages((ms) => (ms.some((m) => m.id === data.message.id) ? ms : [...ms, data.message]));
      setDraft("");
    } catch (e) {
      setNote(e instanceof Error ? e.message : "That message couldn't be sent.");
    } finally { setSending(false); }
  }

  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const strong = isLight ? "text-[#2a1e07]" : "text-white";
  const roster = normalizeGuestRoster(guests);

  return (
    <div className="space-y-3" data-testid="world-live-backstage">
      <p className={`inline-flex items-center gap-2 text-sm font-black ${strong}`}>
        <ShieldCheck className="h-4 w-4 text-[#d4af37]" /> Guests &amp; backstage
      </p>
      {!stream ? (
        <NativeEmptyState
          isLight={isLight}
          message="No live stream, no backstage"
          detail="Backstage hangs off your live stream. Go live in the studio above and this panel wakes up — invite links, the guest roster and the private backstage chat all live here."
        />
      ) : (
        <>
          <p className={`text-sm ${muted}`}>Live now: <b className={strong}>{stream.title}</b>. Guests join backstage first — private greenroom, the audience sees and hears none of it — and only reach the audience when you bring them on stage.</p>

          <div className="flex flex-wrap items-end gap-2">
            <label className="min-w-40 flex-1">
              <span className={`text-xs font-bold ${muted}`}>Invite label (optional)</span>
              <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Tonight's co-host" maxLength={60} className={inputCls(isLight)} data-testid="world-live-invite-label" />
            </label>
            <label>
              <span className={`text-xs font-bold ${muted}`}>Expires</span>
              <select value={expiry} onChange={(e) => setExpiry(e.target.value)} className={`${selectCls(isLight)} block`} data-testid="world-live-invite-expiry">
                {INVITE_EXPIRY_OPTIONS.map((o) => <option key={o.minutes} value={o.minutes}>{o.label}</option>)}
              </select>
            </label>
            <label className="w-28">
              <span className={`text-xs font-bold ${muted}`}>Max joins</span>
              <input value={maxJoins} onChange={(e) => setMaxJoins(e.target.value.replace(/[^0-9]/g, ""))} placeholder="No cap" inputMode="numeric" className={inputCls(isLight)} data-testid="world-live-invite-maxjoins" />
            </label>
            <button type="button" onClick={() => void handleMint()} disabled={minting} className={goldBtn} data-testid="world-live-invite-mint">
              {minting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserPlus className="h-3.5 w-3.5" />} Mint invite link
            </button>
          </div>

          {freshLink && (
            <div className="flex flex-wrap items-center gap-2" data-testid="world-live-invite-fresh">
              <code className={`max-w-full truncate rounded-lg px-3 py-1.5 font-mono text-xs ${isLight ? "bg-[#C9A84C]/15 text-[#2a1e07]" : "bg-white/10 text-white"}`}>{freshLink}</code>
              <button
                type="button"
                className={chipBtn(isLight)}
                onClick={() => { void navigator.clipboard?.writeText(freshLink).then(() => setCopied(true)).catch(() => undefined); }}
                data-testid="world-live-invite-copy"
              >
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} {copied ? "Copied" : "Copy link"}
              </button>
            </div>
          )}

          {invites.filter((i) => !i.revoked_at).length > 0 && (
            <ul className="space-y-1.5">
              {invites.filter((i) => !i.revoked_at).map((i) => (
                <li key={i.id} className="flex flex-wrap items-center gap-2 text-sm" data-testid="world-live-invite-row">
                  <span className={strong}>{i.label ?? "Guest invite"}</span>
                  <span className={muted}>…{i.token_hint} · {i.join_count} joined{i.max_joins ? ` of ${i.max_joins}` : ""}{i.expires_at ? ` · expires ${new Date(i.expires_at).toLocaleString()}` : ""}</span>
                  <button type="button" className={chipBtn(isLight)} onClick={() => void handleRevoke(i)} data-testid="world-live-invite-revoke">
                    <Ban className="h-3.5 w-3.5" /> Revoke
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div>
            <p className={`text-xs font-black uppercase tracking-wider ${muted}`}>In the room ({roster.length})</p>
            {roster.length === 0 ? (
              <p className={`mt-1 text-sm ${muted}`}>No guests yet — share an invite link and they&rsquo;ll land here.</p>
            ) : (
              <ul className="mt-1.5 space-y-1.5">
                {roster.map((g) => (
                  <li key={g.id} className="flex flex-wrap items-center gap-2 text-sm" data-testid="world-live-guest-row">
                    <span className={strong}>{g.displayName}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase ${g.onStage ? "bg-red-500/15 text-red-300" : "bg-white/10 text-white/60"}`}>
                      {g.onStage ? "On stage" : "Backstage"}
                    </span>
                    {g.onStage ? (
                      <button type="button" className={chipBtn(isLight)} onClick={() => void handleDemote(guests.find((x) => x.id === g.id)!)} data-testid="world-live-guest-demote">
                        <ArrowDownCircle className="h-3.5 w-3.5" /> Back to backstage
                      </button>
                    ) : (
                      <button type="button" className={chipBtn(isLight)} onClick={() => void handlePromote(guests.find((x) => x.id === g.id)!)} data-testid="world-live-guest-promote">
                        <ArrowUpCircle className="h-3.5 w-3.5" /> Bring on stage
                      </button>
                    )}
                    <button type="button" className={chipBtn(isLight)} onClick={() => void handleRemove(guests.find((x) => x.id === g.id)!)} data-testid="world-live-guest-remove">
                      <UserX className="h-3.5 w-3.5" /> Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            {!inBackstage ? (
              <button type="button" onClick={() => void enterBackstage()} className={goldBtn} data-testid="world-live-backstage-enter">
                <Video className="h-3.5 w-3.5" /> Step into backstage
              </button>
            ) : (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`text-sm ${muted}`}>You&rsquo;re backstage — {peers.length} peer{peers.length === 1 ? "" : "s"} connected.</span>
                  <button type="button" onClick={leaveBackstage} className={chipBtn(isLight)} data-testid="world-live-backstage-leave">
                    <LogOut className="h-3.5 w-3.5" /> Leave backstage
                  </button>
                </div>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  <div className="relative overflow-hidden rounded-xl border border-white/10 bg-black">
                    <video ref={localVideoRef} autoPlay playsInline muted className="aspect-video w-full object-cover" data-testid="world-live-backstage-local" />
                    <span className="absolute bottom-1.5 left-1.5 rounded-full bg-black/70 px-2 py-0.5 text-[10px] font-bold text-white">You (host)</span>
                  </div>
                  {[...remoteStreams.entries()].map(([key, s]) => (
                    <RemoteVideo key={key} stream={s} label={peers.find((p) => p.guestSessionId === key)?.displayName ?? "Guest"} />
                  ))}
                </div>
                <BackstageChat isLight={isLight} messages={messages} draft={draft} setDraft={setDraft} onSend={() => void handleSend()} sending={sending} testid="world-live-backstage-chat" />
              </div>
            )}
            {!inBackstage && (
              <div className="mt-2">
                <BackstageChat isLight={isLight} messages={messages} draft={draft} setDraft={setDraft} onSend={() => void handleSend()} sending={sending} testid="world-live-backstage-chat" />
              </div>
            )}
          </div>
          {note && <p className={`text-sm ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>{note}</p>}
        </>
      )}
    </div>
  );
}

/* ═══ #87 Join a stream as a guest ══════════════════════════════════ */

export function LiveGuestJoinDesk({ isLight }: { isLight: boolean }) {
  const [pasted, setPasted] = useState("");
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [info, setInfo] = useState<InviteInfoDto | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [joining, setJoining] = useState(false);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [session, setSession] = useState<GuestSessionDto | null>(null);
  const [endedReason, setEndedReason] = useState<string | null>(null);
  const [peers, setPeers] = useState<BackstagePeer[]>([]);
  const [remoteStreams, setRemoteStreams] = useState<Map<string, MediaStream>>(new Map());
  const [messages, setMessages] = useState<BackstageMessageDto[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [mediaNote, setMediaNote] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const clientRef = useRef<BackstageClient | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const sessionTokenRef = useRef<string | null>(null);

  const joined = session !== null && guestSessionActive(session.state);

  const endWith = useCallback((reason: string) => {
    clientRef.current?.close();
    clientRef.current = null;
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    sessionTokenRef.current = null;
    setSessionToken(null);
    setSession(null);
    setEndedReason(reason);
  }, []);

  const startBackstage = useCallback(async (sessToken: string, sess: GuestSessionDto) => {
    sessionTokenRef.current = sessToken;
    setSessionToken(sessToken);
    setSession(sess);
    setEndedReason(null);
    let local: MediaStream | null = null;
    try {
      local = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      setMediaNote(null);
    } catch {
      setMediaNote("Camera/mic couldn't start — you're backstage without media; you can still chat, and the host can still bring you on stage.");
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
          if (inviteToken) {
            try { sessionStorage.removeItem(guestStorageKey(inviteToken)); } catch { /* private mode */ }
          }
          endWith(reason);
        },
        onBackstageClosed: (reason) => endWith(reason),
      },
    });
    clientRef.current = client;
    client.connect(local);
    if (local) client.joinMedia();
    try {
      const data = await guestBackstageHistory(sessToken);
      setMessages(data.messages);
    } catch { /* live frames still land */ }
  }, [endWith, inviteToken]);

  /* Heartbeat — live-guest.tsx's 25-second beat, verbatim purpose:
     keeps the pass warm and learns the end fast. */
  useEffect(() => {
    if (!joined) return;
    const id = setInterval(async () => {
      const tok = sessionTokenRef.current;
      if (!tok) return;
      try {
        const beat = await guestHeartbeat(tok);
        if (beat.stream_status !== "live") endWith("That stream has ended — thanks for being part of the show.");
        else setSession((s) => (s ? { ...s, state: beat.state } : s));
      } catch (e) {
        if (e instanceof GuestApiError && (e.status === 401 || e.status === 404)) endWith(e.message);
      }
    }, 25_000);
    return () => clearInterval(id);
  }, [joined, endWith]);

  useEffect(() => () => {
    clientRef.current?.close();
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
  }, []);

  async function checkInvite() {
    const tok = extractInviteToken(pasted);
    if (!tok) { setCheckError("Paste a guest invite link (or its token) — it looks like …/live/guest/…"); return; }
    setChecking(true);
    setCheckError(null);
    setInfo(null);
    setEndedReason(null);
    try {
      const data = await readInvite(tok);
      setInviteToken(tok);
      setInfo(data);
      if (data.stream.status !== "live") {
        setEndedReason("That stream has ended — the backstage is closed.");
        return;
      }
      /* Resume a stored pass after a refresh, like the guest page. */
      let stored: string | null = null;
      try { stored = sessionStorage.getItem(guestStorageKey(tok)); } catch { /* private mode */ }
      if (stored) {
        try {
          const resumed = await guestSession(stored);
          if (guestSessionActive(resumed.session.state)) {
            await startBackstage(stored, resumed.session);
          }
        } catch { /* a dead stored pass just means joining fresh */ }
      }
    } catch (e) {
      setCheckError(e instanceof Error ? e.message : "That invite couldn't be checked.");
    } finally { setChecking(false); }
  }

  async function handleJoin() {
    if (!inviteToken || !guestNameReady(name)) return;
    setJoining(true);
    setNote(null);
    try {
      const data = await joinAsGuest(inviteToken, name.trim());
      try { sessionStorage.setItem(guestStorageKey(inviteToken), data.session_token); } catch { /* private mode */ }
      await startBackstage(data.session_token, data.session);
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Backstage couldn't let you in.");
    } finally { setJoining(false); }
  }

  async function handleLeave() {
    const tok = sessionTokenRef.current;
    if (inviteToken) {
      try { sessionStorage.removeItem(guestStorageKey(inviteToken)); } catch { /* private mode */ }
    }
    if (tok) await guestLeave(tok).catch(() => undefined);
    endWith("You left backstage.");
  }

  async function handleSend() {
    const tok = sessionTokenRef.current;
    if (!tok || !backstageDraftReady(draft)) return;
    setSending(true);
    try {
      const data = await guestBackstagePost(tok, draft.trim());
      setMessages((ms) => (ms.some((m) => m.id === data.message.id) ? ms : [...ms, data.message]));
      setDraft("");
    } catch (e) {
      setNote(e instanceof Error ? e.message : "That message couldn't be sent.");
    } finally { setSending(false); }
  }

  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const strong = isLight ? "text-[#2a1e07]" : "text-white";

  return (
    <div className="space-y-3" data-testid="world-live-guest-join">
      <p className={`inline-flex items-center gap-2 text-sm font-black ${strong}`}>
        <UserPlus className="h-4 w-4 text-[#d4af37]" /> Join a stream as a guest
      </p>
      <p className={`text-sm ${muted}`}>
        Got a guest invite from another creator? Paste the link here — you step into THEIR backstage as a guest participant (your member account stays yours; the pass is the invite&rsquo;s, exactly like the guest page). The audience only sees you if that host brings you on stage.
      </p>

      {!joined && (
        <>
          <div className="flex flex-wrap gap-2">
            <input value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder="Paste the invite link — …/live/guest/…" className={`${inputCls(isLight)} min-w-56 flex-1`} data-testid="world-live-join-paste" />
            <button type="button" onClick={() => void checkInvite()} disabled={checking || !pasted.trim()} className={goldBtn} data-testid="world-live-join-check">
              {checking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />} Check invite
            </button>
          </div>
          {checkError && <p className={`text-sm ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>{checkError}</p>}
          {endedReason && !info && <p className={`text-sm ${muted}`}>{endedReason}</p>}
          {info && !endedReason && (
            <div className="space-y-2" data-testid="world-live-join-info">
              <p className={`text-sm ${strong}`}>
                <b>{info.host.display_name}</b> invited you to <b>“{info.stream.title}”</b>
                {info.invite.label ? <span className={muted}> · {info.invite.label}</span> : null}
              </p>
              <div className="flex flex-wrap gap-2">
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="The name the host will see" maxLength={40} className={`${inputCls(isLight)} min-w-48 flex-1`} data-testid="world-live-join-name" />
                <button type="button" onClick={() => void handleJoin()} disabled={joining || !guestNameReady(name)} className={goldBtn} data-testid="world-live-join-join">
                  {joining ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Video className="h-3.5 w-3.5" />} Step into backstage
                </button>
              </div>
            </div>
          )}
          {info && endedReason && <p className={`text-sm ${muted}`}>{endedReason}</p>}
        </>
      )}

      {joined && session && (
        <div className="space-y-2" data-testid="world-live-guest-room">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-black uppercase ${session.state === "on_stage" ? "bg-red-500/15 text-red-300" : "bg-white/10 text-white/60"}`}>
              {session.state === "on_stage" ? "You're on stage — the audience can see and hear you" : "Backstage — the audience can't see or hear you yet"}
            </span>
            <span className={`text-sm ${muted}`}>{peers.length} peer{peers.length === 1 ? "" : "s"} backstage</span>
            <button type="button" onClick={() => void handleLeave()} className={chipBtn(isLight)} data-testid="world-live-guest-leave">
              <LogOut className="h-3.5 w-3.5" /> Leave backstage
            </button>
          </div>
          {mediaNote && <p className={`text-sm ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>{mediaNote}</p>}
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <div className="relative overflow-hidden rounded-xl border border-white/10 bg-black">
              <video ref={localVideoRef} autoPlay playsInline muted className="aspect-video w-full object-cover" data-testid="world-live-guest-local" />
              <span className="absolute bottom-1.5 left-1.5 rounded-full bg-black/70 px-2 py-0.5 text-[10px] font-bold text-white">You (guest)</span>
            </div>
            {[...remoteStreams.entries()].map(([peerId, s]) => (
              <RemoteVideo key={peerId} stream={s} label={peers.find((p) => p.peerId === peerId)?.displayName ?? "Backstage"} />
            ))}
          </div>
          <BackstageChat isLight={isLight} messages={messages} draft={draft} setDraft={setDraft} onSend={() => void handleSend()} sending={sending} testid="world-live-guest-chat" />
        </div>
      )}
      {note && <p className={`text-sm ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>{note}</p>}
      {sessionToken && !joined && endedReason && <p className={`text-sm ${muted}`}>{endedReason}</p>}
    </div>
  );
}
