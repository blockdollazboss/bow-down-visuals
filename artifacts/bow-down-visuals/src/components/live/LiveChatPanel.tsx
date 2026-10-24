import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { AlertTriangle, ChevronDown, ChevronUp, Loader2, RotateCcw, Send, Trash2, VolumeX, Volume2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { apiFetch } from "@/lib/social-api";
import { formatBucs } from "@/lib/visual-bucs";
import { EmojiTray, KingTokenText } from "@/components/social/KingEmoji";
import { insertAtCursor } from "@/lib/king-emoji";
import {
  LiveChatClient,
  composerState,
  defaultSocketUrl,
  type ChatMessage,
  type ChatSocketLike,
} from "@/lib/live-chat-client";
import {
  SEND_TARGET_NOTE,
  collectMergedMessages,
  collectSourceStates,
  createChatSourceRegistry,
  siteSourceState,
  sourceBadge,
  type ChatSourceId,
  type PlatformAccountLike,
  type SavedDestinationLike,
  type SourceConnection,
} from "@/lib/merged-live-chat";
import { savedDestinationsFromPayload } from "@/lib/destination-keys";

/* ─── Live chat panel ─────────────────────────────────────────────────────
   ONE panel for the watch page and the studio: same messages, same
   moderation. The brain lives in lib/live-chat-client.ts (history,
   socket delivery with polling fallback, dedupe, honest composer
   states); this component is its shell. Message bodies render as
   React nodes — text is escaped, nothing is ever injected as HTML —
   with the King's shortcodes (:king-laugh:, :gif-king-bow:) lit up as
   his sticker/GIF art. Bodies still travel as plain text, so no
   protocol change. The panel follows the house theme like every
   other studio panel: its bg-[#0d0a04] ground is repainted by the
   §18 sweep in light theme (the data-dark-lock it used to carry
   made it stay black on the cream studio — removed Oct 18, 2026).

   MERGED PANEL (Stack-100 #3, feature #12 shell): the message list
   is fed through the source-adapter registry in
   lib/merged-live-chat.ts — the site's own chat is the live adapter,
   Twitch and YouTube are inert seams that light up when their
   platform OAuth approvals land. The strip under the header shows
   each source's honest connection state, read from the platform
   connections the site already keeps (/api/social/accounts +
   /api/reach/destinations). No external message is ever simulated:
   until real ingestion exists, external sources contribute states,
   never messages. Sending posts to Bow Down chat only. */

export default function LiveChatPanel({ streamId, className = "" }: { streamId: string; className?: string }) {
  const { user, getAccessToken } = useAuth();
  const [, setTick] = useState(0);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [tipAmount, setTipAmount] = useState("500");
  const [tipping, setTipping] = useState(false);
  const [tipNote, setTipNote] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const clientRef = useRef<LiveChatClient | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);

  if (clientRef.current && clientRef.current.streamId !== streamId) {
    clientRef.current.stop();
    clientRef.current = null;
  }
  if (!clientRef.current) {
    clientRef.current = new LiveChatClient(
      streamId,
      {
        fetchJson: async (path, init) => {
          const res = await apiFetch(getAccessToken, path, init);
          return { status: res.status, json: await res.json().catch(() => null) };
        },
        getAccessToken,
        selfId: user?.id ?? null,
        socketUrl: (id, token) => defaultSocketUrl(window.location, id, token),
        openSocket: (url) => new WebSocket(url) as unknown as ChatSocketLike,
      },
      () => setTick((t) => t + 1),
    );
  }
  const client = clientRef.current;

  /* Platform-connection inputs for the merged source strip: the
     signed-in user's connected accounts + saved multistream
     destinations — the same state Settings and the destination
     panel read. Guests have no connections to read, so their
     externals honestly read not-connected. A failed read claims
     nothing (check_failed), never "not connected". */
  const [connInputs, setConnInputs] = useState<{
    accounts: PlatformAccountLike[];
    destinations: SavedDestinationLike[];
    loadFailed: boolean;
  } | null>(null);
  useEffect(() => {
    if (!user) {
      setConnInputs({ accounts: [], destinations: [], loadFailed: false });
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const [accRes, destRes] = await Promise.all([
          apiFetch(getAccessToken, "/api/social/accounts"),
          apiFetch(getAccessToken, "/api/reach/destinations"),
        ]);
        if (!accRes.ok) throw new Error("accounts failed");
        const accJson = await accRes.json().catch(() => null);
        const destJson = destRes.ok ? await destRes.json().catch(() => null) : null;
        if (cancelled) return;
        setConnInputs({
          accounts: Array.isArray(accJson?.accounts) ? accJson.accounts : [],
          destinations: savedDestinationsFromPayload(destJson) ?? [],
          loadFailed: false,
        });
      } catch {
        if (!cancelled) setConnInputs({ accounts: [], destinations: [], loadFailed: true });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, getAccessToken]);

  /* The merged feed: adapters are stateless views over the client's
     store, rebuilt per render so the list can never drift from the
     client's own messages. Only the site adapter can ingest today —
     the merge drops anything an inert adapter might hand it. */
  const adapters = createChatSourceRegistry(() => client.messages);
  const mergedMessages = collectMergedMessages(adapters);
  const sourceStates: SourceConnection[] = connInputs
    ? collectSourceStates({
        streamStatus: client.streamStatus,
        accounts: connInputs.accounts,
        destinations: connInputs.destinations,
        loadFailed: connInputs.loadFailed,
      })
    : [siteSourceState(client.streamStatus)];

  useEffect(() => {
    // Alert events (tips / follows) ride the room socket — bridge
    // them to the studio's Program overlay, which listens on window.
    client.onAlert = (alert) => {
      window.dispatchEvent(new CustomEvent("bdv:live-alert", { detail: { ...alert, streamId } }));
    };
    void client.start();
    return () => client.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client]);

  /* Keep the newest message in view when the reader is at the bottom;
     never yank the list while they're reading history. */
  const messageCount = client.messages.length;
  useEffect(() => {
    const el = listRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [messageCount]);

  const isOwner = !!user && !!client.ownerId && user.id === client.ownerId;
  const selfRole = user ? client.selfRole : "viewer";
  const canModerate = selfRole === "owner" || selfRole === "moderator";
  const composer = composerState({
    signedIn: !!user,
    streamStatus: client.streamStatus,
    muted: client.mutedSelf,
  });
  const ended = client.streamStatus === "ended";

  async function onSend(e: React.FormEvent) {
    e.preventDefault();
    if (!composer.enabled || sending || !draft.trim()) return;
    setSending(true);
    const ok = await client.send(draft);
    setSending(false);
    if (ok) setDraft("");
  }

  /* King tray: the token lands in the draft as text at the caret and
     rides the normal send path — the far side renders the art. */
  function insertDraftToken(token: string) {
    const el = inputRef.current;
    const next = insertAtCursor(draft, token, el?.selectionStart ?? null, el?.selectionEnd ?? null, 500);
    setDraft(next.value);
    requestAnimationFrame(() => {
      if (el) {
        el.focus();
        el.setSelectionRange(next.caret, next.caret);
      }
    });
  }

  return (
    <section
      className={`flex min-h-0 flex-col overflow-hidden rounded-2xl border border-[#C9A84C]/25 bg-[#0d0a04] text-white ${className}`}
      data-testid="live-chat-panel"
    >
      <header className="flex items-center justify-between gap-2 border-b border-white/10 px-4 py-3">
        <h3 className="text-sm font-black uppercase tracking-widest text-[#fbbf24]">
          {ended ? "Chat replay" : "Chat"}
        </h3>
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className="inline-flex items-center gap-1 rounded-full border border-white/15 px-2.5 py-1 text-xs font-bold text-white/70 transition hover:border-[#C9A84C]/60 hover:text-white lg:hidden"
          data-testid="chat-collapse"
          aria-expanded={!collapsed}
        >
          {collapsed ? (
            <>
              Show <ChevronDown className="h-3.5 w-3.5" />
            </>
          ) : (
            <>
              Hide <ChevronUp className="h-3.5 w-3.5" />
            </>
          )}
        </button>
      </header>

      {!collapsed && (
        <div className="border-b border-white/10 px-4 py-2" data-testid="chat-source-strip">
          <div className="flex flex-wrap gap-1.5">
            {sourceStates.map((s) => (
              <span
                key={s.source}
                title={s.note}
                data-testid={`chat-source-${s.source}`}
                data-kind={s.kind}
                className="inline-flex items-center gap-1.5 rounded-full border border-white/15 px-2 py-0.5 text-[10px] font-bold text-white/70"
              >
                <span
                  className={`inline-block h-1.5 w-1.5 rounded-full ${s.ingestionLive ? "animate-pulse bg-red-500" : "bg-white/30"}`}
                />
                {sourceBadge(s.source).label}
                <span className="font-semibold text-white/40">
                  {s.kind === "live"
                    ? "Live"
                    : s.kind === "site_idle"
                      ? ended
                        ? "Replay"
                        : "Opens at start"
                      : s.kind === "account_connected"
                        ? "Connected · chat pending approval"
                        : s.kind === "destination_only"
                          ? "Stream key only · no chat back"
                          : s.kind === "check_failed"
                            ? "Couldn't check"
                            : "Not connected"}
                </span>
              </span>
            ))}
          </div>
          {sourceStates
            .filter((s) => s.source !== "site")
            .map((s) => (
              <p key={s.source} className="mt-1 text-[11px] leading-snug text-white/40">
                {s.note}
              </p>
            ))}
        </div>
      )}

      {!collapsed && (
        <>
          {client.pinned && new Date(client.pinned.pinnedUntil).getTime() > Date.now() && (
            <div
              className="border-b border-[#C9A84C]/40 bg-[#C9A84C]/15 px-4 py-2.5"
              data-testid="chat-pin"
            >
              <p className="text-[10px] font-black uppercase tracking-widest text-[#e8c86a]">
                Pinned · {formatBucs(client.pinned.message.tipAmountVb ?? 0)} tip
              </p>
              <p className="mt-0.5 break-words text-sm font-semibold text-white">
                <span className="text-[#fbbf24]">{client.pinned.message.author.displayName}:</span>{" "}
                {client.pinned.message.body ? (
                  <KingTokenText body={client.pinned.message.body} theme="dark" />
                ) : (
                  "—"
                )}
              </p>
            </div>
          )}
          <div
            ref={listRef}
            onScroll={(e) => {
              const el = e.currentTarget;
              stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 90;
            }}
            role="log"
            aria-label="Chat messages"
            aria-live="polite"
            className="min-h-[180px] flex-1 space-y-3 overflow-y-auto px-4 py-3"
            data-testid="chat-list"
          >
            {client.loadState === "loading" && (
              <div className="flex items-center gap-2 py-6 text-sm text-white/50">
                <Loader2 className="h-4 w-4 animate-spin text-amber-400" /> Loading chat…
              </div>
            )}
            {client.loadState === "error" && (
              <div className="py-6 text-center" data-testid="chat-error">
                <AlertTriangle className="mx-auto h-6 w-6 text-amber-400" />
                <p className="mt-2 text-sm font-bold">Chat couldn&rsquo;t load.</p>
                <p className="mx-auto mt-1 max-w-[240px] text-xs text-white/50">
                  Something went wrong on our end — the stream itself is fine.
                </p>
                <button
                  type="button"
                  onClick={() => void client.loadHistory()}
                  className="mt-3 inline-flex items-center gap-2 rounded-full bg-amber-400 px-4 py-1.5 text-xs font-bold text-black transition hover:scale-105"
                >
                  <RotateCcw className="h-3.5 w-3.5" /> Try again
                </button>
              </div>
            )}
            {client.loadState === "ready" && mergedMessages.length === 0 && (
              <p className="py-6 text-center text-sm text-white/45" data-testid="chat-empty">
                {ended ? "No chat was saved from this stream." : "Be the first to say something."}
              </p>
            )}
            {client.loadState === "ready" &&
              mergedMessages.map((m) => (
                <ChatRow
                  key={`${m.source}:${m.id}`}
                  message={m}
                  source={m.source}
                  mine={!!user && m.userId === user.id}
                  isOwner={isOwner}
                  canModerate={canModerate}
                  selfIsMod={selfRole === "moderator"}
                  authorIsOwner={!!client.ownerId && m.userId === client.ownerId}
                  authorIsMod={client.moderatorIds.has(m.userId)}
                  muted={client.mutedUsers.has(m.userId)}
                  onDelete={() => void client.deleteMessage(m.id)}
                  onMute={() => void client.muteUser(m.userId)}
                  onUnmute={() => void client.unmuteUser(m.userId)}
                />
              ))}
          </div>

          <div className="border-t border-white/10 px-4 py-3">
            {client.notice && (
              <p className="mb-2 text-xs font-semibold text-amber-200/90" data-testid="chat-notice" role="alert">
                {client.notice}
              </p>
            )}
            {composer.signIn ? (
              <div className="flex items-center justify-between gap-3" data-testid="chat-guest">
                <p className="text-sm text-white/60">Sign in to join the chat.</p>
                <Link
                  href="/login"
                  className="shrink-0 rounded-full bg-amber-400 px-4 py-2 text-xs font-black text-black transition hover:scale-105"
                >
                  Sign in
                </Link>
              </div>
            ) : composer.enabled ? (
              <>
              {!isOwner && (
                <div className="mb-2.5 rounded-xl border border-[#C9A84C]/25 bg-[#C9A84C]/5 px-3 py-2.5" data-testid="tip-box">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[10px] font-black uppercase tracking-widest text-[#e8c86a]">Tip</span>
                    {[100, 500, 1000].map((n) => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => setTipAmount(String(n))}
                        className={`rounded-full px-2.5 py-1 text-[11px] font-bold transition ${
                          tipAmount === String(n)
                            ? "bg-amber-400 text-black"
                            : "border border-white/15 text-white/70 hover:border-[#C9A84C]/60 hover:text-white"
                        }`}
                      >
                        {n.toLocaleString("en-US")}
                      </button>
                    ))}
                    <input
                      value={tipAmount}
                      onChange={(e) => setTipAmount(e.target.value.replace(/[^0-9]/g, ""))}
                      inputMode="numeric"
                      aria-label="Tip amount in Visual Bucs"
                      className="w-20 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-[11px] font-bold text-white focus:border-[#C9A84C]/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#C9A84C]/60"
                    />
                    <span className="text-[10px] text-white/40">Visual Bucs · 500+ pins your message</span>
                    <button
                      type="button"
                      disabled={tipping || !Number(tipAmount)}
                      onClick={async () => {
                        const amount = Number(tipAmount);
                        if (!amount) return;
                        setTipping(true);
                        setTipNote(null);
                        const key =
                          typeof crypto !== "undefined" && "randomUUID" in crypto
                            ? crypto.randomUUID()
                            : `tip-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
                        const result = await client.sendTip(amount, draft.trim(), key);
                        setTipping(false);
                        if (result.ok) {
                          setDraft("");
                          setTipNote(result.pinned ? "Tipped — your message is pinned to the top of chat." : "Tipped — thank you for backing the stream.");
                        }
                      }}
                      className="ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-full bg-gradient-to-r from-[#fbbf24] to-[#d4a017] px-3.5 py-1.5 text-[11px] font-black text-black transition hover:scale-105 disabled:cursor-not-allowed disabled:opacity-40"
                      data-testid="tip-send"
                    >
                      {tipping ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Tip
                    </button>
                  </div>
                  {tipNote && (
                    <p className="mt-1.5 text-[11px] font-semibold text-amber-200/90" data-testid="tip-note" role="status">
                      {tipNote}
                    </p>
                  )}
                </div>
              )}
              <form onSubmit={onSend} className="flex items-center gap-2">
                <EmojiTray tone="dark" onPickToken={insertDraftToken} />
                <input
                  ref={inputRef}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  maxLength={500}
                  placeholder="Say something…"
                  className="min-w-0 flex-1 rounded-full border border-white/15 bg-white/5 px-4 py-2.5 text-sm text-white placeholder:text-white/50 focus:border-[#C9A84C]/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#C9A84C]/60"
                  data-testid="chat-input"
                  aria-label="Chat message"
                />
                <button
                  type="submit"
                  disabled={sending || !draft.trim()}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-amber-400 px-4 py-2.5 text-sm font-black text-black transition hover:scale-105 disabled:cursor-not-allowed disabled:opacity-40"
                  data-testid="chat-send"
                >
                  {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Send
                </button>
              </form>
              <p className="mt-2 text-[11px] text-white/40" data-testid="chat-send-target">
                {SEND_TARGET_NOTE}
              </p>
              </>
            ) : (
              <p className="text-sm text-white/55" data-testid="chat-composer-note">
                {composer.note}
              </p>
            )}
          </div>
        </>
      )}
    </section>
  );
}

function ChatRow({
  message,
  source,
  mine,
  isOwner,
  canModerate,
  selfIsMod,
  authorIsOwner,
  authorIsMod,
  muted,
  onDelete,
  onMute,
  onUnmute,
}: {
  message: ChatMessage;
  /** Which source this message arrived from — rendered as its badge.
   *  Today every message is the site's own chat; external sources
   *  join only when real ingestion lands behind their adapters. */
  source: ChatSourceId;
  mine: boolean;
  isOwner: boolean;
  canModerate: boolean;
  selfIsMod: boolean;
  authorIsOwner: boolean;
  authorIsMod: boolean;
  muted: boolean;
  onDelete: () => void;
  onMute: () => void;
  onUnmute: () => void;
}) {
  // Moderation rules mirror the server: the owner moderates anyone;
  // a moderator moderates chatters — never the owner, never a
  // fellow moderator.
  const canDelete = mine || isOwner || (canModerate && !authorIsOwner);
  const canMute = canModerate && !mine && !authorIsOwner && !(selfIsMod && authorIsMod);
  const isTip = message.kind === "tip";
  const time = new Date(message.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return (
    <div
      className={`group flex gap-2.5 ${isTip ? "rounded-xl border border-[#C9A84C]/40 bg-[#C9A84C]/10 px-2.5 py-2" : ""}`}
      data-testid={isTip ? "chat-tip-message" : "chat-message"}
    >
      {message.author.avatarUrl ? (
        <img
          src={message.author.avatarUrl}
          alt=""
          className="h-8 w-8 shrink-0 rounded-full object-cover"
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = "none";
          }}
        />
      ) : (
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#e8c86a]/15 text-xs font-bold text-[#e8c86a]">
          {message.author.displayName[0] ?? "?"}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-baseline gap-x-2 text-xs">
          <span className={`font-bold ${authorIsOwner ? "text-[#fbbf24]" : "text-white/85"}`}>
            {message.author.displayName}
          </span>
          <span
            className="rounded-full bg-white/10 px-1.5 py-px text-[10px] font-black uppercase tracking-wide text-white/55"
            data-testid="chat-source-badge"
          >
            {sourceBadge(source).short}
          </span>
          {authorIsOwner && (
            <span className="rounded-full bg-[#C9A84C]/20 px-1.5 py-px text-[10px] font-black uppercase tracking-wide text-[#e8c86a]">
              Host
            </span>
          )}
          {isTip && (
            <span className="rounded-full bg-amber-400 px-1.5 py-px text-[10px] font-black uppercase tracking-wide text-black">
              {formatBucs(message.tipAmountVb ?? 0)} tip
            </span>
          )}
          {authorIsMod && !authorIsOwner && (
            <span
              className="rounded-full bg-sky-400/20 px-1.5 py-px text-[10px] font-black uppercase tracking-wide text-sky-200"
              data-testid="chat-mod-badge"
            >
              Mod
            </span>
          )}
          <span className="text-white/50">{time}</span>
          {(canDelete || canMute) && (
            <span className="ml-auto inline-flex gap-1 opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100 focus-within:opacity-100">
              {canMute &&
                (muted ? (
                  <button
                    type="button"
                    onClick={onUnmute}
                    className="inline-flex items-center gap-1 rounded-full border border-white/15 px-2 py-0.5 text-[10px] font-bold text-white/60 hover:border-[#C9A84C]/60 hover:text-white"
                    data-testid="chat-unmute"
                  >
                    <Volume2 className="h-3 w-3" /> Unmute
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={onMute}
                    className="inline-flex items-center gap-1 rounded-full border border-white/15 px-2 py-0.5 text-[10px] font-bold text-white/60 hover:border-red-400/60 hover:text-red-200"
                    data-testid="chat-mute"
                  >
                    <VolumeX className="h-3 w-3" /> Mute
                  </button>
                ))}
              {canDelete && (
                <button
                  type="button"
                  onClick={onDelete}
                  className="inline-flex items-center gap-1 rounded-full border border-white/15 px-2 py-0.5 text-[10px] font-bold text-white/60 hover:border-red-400/60 hover:text-red-200"
                  data-testid="chat-delete"
                  aria-label="Remove message"
                >
                  <Trash2 className="h-3 w-3" /> Remove
                </button>
              )}
            </span>
          )}
        </p>
        <p className="mt-0.5 break-words text-sm leading-snug text-white/90">
          <KingTokenText body={message.body} theme="dark" />
        </p>
      </div>
    </div>
  );
}
