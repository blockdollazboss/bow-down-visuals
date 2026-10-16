import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { AlertTriangle, ChevronDown, ChevronUp, Loader2, RotateCcw, Send, Trash2, VolumeX, Volume2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { apiFetch } from "@/lib/social-api";
import {
  LiveChatClient,
  composerState,
  defaultSocketUrl,
  type ChatMessage,
  type ChatSocketLike,
} from "@/lib/live-chat-client";

/* ─── Live chat panel ─────────────────────────────────────────────────────
   ONE panel for the watch page and the studio: same messages, same
   moderation. The brain lives in lib/live-chat-client.ts (history,
   socket delivery with polling fallback, dedupe, honest composer
   states); this component is its shell. Message bodies render as
   plain text — React escapes them; links stay text, nothing is ever
   injected as HTML. The panel is dark-styled by design (it sits on
   streaming surfaces) and carries data-dark-lock so the light theme
   never repaints it. */

export default function LiveChatPanel({ streamId, className = "" }: { streamId: string; className?: string }) {
  const { user, getAccessToken } = useAuth();
  const [, setTick] = useState(0);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const clientRef = useRef<LiveChatClient | null>(null);
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

  useEffect(() => {
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

  return (
    <section
      data-dark-lock
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
        <>
          <div
            ref={listRef}
            onScroll={(e) => {
              const el = e.currentTarget;
              stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 90;
            }}
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
            {client.loadState === "ready" && client.messages.length === 0 && (
              <p className="py-6 text-center text-sm text-white/45" data-testid="chat-empty">
                {ended ? "No chat was saved from this stream." : "Be the first to say something."}
              </p>
            )}
            {client.loadState === "ready" &&
              client.messages.map((m) => (
                <ChatRow
                  key={m.id}
                  message={m}
                  mine={!!user && m.userId === user.id}
                  isOwner={isOwner}
                  authorIsOwner={!!client.ownerId && m.userId === client.ownerId}
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
              <form onSubmit={onSend} className="flex items-center gap-2">
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  maxLength={500}
                  placeholder="Say something…"
                  className="min-w-0 flex-1 rounded-full border border-white/15 bg-white/5 px-4 py-2.5 text-sm text-white placeholder:text-white/35 focus:border-[#C9A84C]/70 focus:outline-none"
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
  mine,
  isOwner,
  authorIsOwner,
  muted,
  onDelete,
  onMute,
  onUnmute,
}: {
  message: ChatMessage;
  mine: boolean;
  isOwner: boolean;
  authorIsOwner: boolean;
  muted: boolean;
  onDelete: () => void;
  onMute: () => void;
  onUnmute: () => void;
}) {
  const canDelete = mine || isOwner;
  const canMute = isOwner && !mine && !authorIsOwner;
  const time = new Date(message.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return (
    <div className="group flex gap-2.5" data-testid="chat-message">
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
          {authorIsOwner && (
            <span className="rounded-full bg-[#C9A84C]/20 px-1.5 py-px text-[10px] font-black uppercase tracking-wide text-[#e8c86a]">
              Host
            </span>
          )}
          <span className="text-white/30">{time}</span>
          {(canDelete || canMute) && (
            <span className="ml-auto inline-flex gap-1 opacity-0 transition group-hover:opacity-100">
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
        <p className="mt-0.5 break-words text-sm leading-snug text-white/90">{message.body}</p>
      </div>
    </div>
  );
}
