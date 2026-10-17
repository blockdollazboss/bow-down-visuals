import { useCallback, useEffect, useRef, useState } from "react";
import {
  Send, Check, X, Ban, Plus, Pin, MessageCircle, Star, BarChart3, Loader2,
  Paperclip, Search, Link2, Sparkles, Music2, Clapperboard, Image as ImageIcon,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { EmojiTray, KingTokenText, ReactionSticker } from "@/components/social/KingEmoji";
import { insertAtCursor } from "@/lib/king-emoji";
import {
  NativeCard, NativeLoadingState, NativeEmptyState, NativeErrorState,
} from "@/components/world/native";
import type { FeedPost } from "@/lib/social-api";
import {
  DM_CONVERSATIONS_PATH, DM_START_PATH, DM_ATTACHMENT_UPLOAD_PATH,
  dmMessagesPath, dmSendPath, dmRequestActionPath, profileResolvePath,
  dmConversationName, dmCanChat, dmNeedsAnswer, dmCanSendDraft, dmUnreadTotal,
  dmFindConversation, normalizeDmConversations, DM_DRAFT_MAX,
  dmMessageAttachment, dmAttachmentKindForMime, dmAttachmentKindForUrl,
  dmAttachmentNameForUrl, dmWorkLabel, dmFilterMessages, dmConversationMatches,
  COMMUNITY_SUPERFANS_PATH, COMMUNITY_SENTIMENT_PATH,
  GENERATE_COMMUNITY_POST_PATH, COMMUNITY_POST_PLATFORMS_PATH, POSTS_PATH,
  REACT_PATH, reactRemovePath, feedPath, postRepliesPath, postReplyPath,
  COMMENT_REPLIES_PATH, COMMENT_REPLIES_META_PATH,
  REPLY_DRAFT_TONES, replyDraftBatch,
  commentsBatchFromPosts, pinTopicReady, postBodyReady,
  BOARD_REACTIONS, nextReactionState, fullThread,
  type DmConversation, type DmMessage, type DmAttachment, type Superfan,
  type SentimentReport, type CommunityPostVariant, type ReplyDraftTone,
} from "@/lib/world/social-desk";

/* ─── The Social Desk (NATIVE-PLAN §3.4) ─────────────────────────────
   Two instruments, one pattern:
   - PostOfficeDesk (Throne Hall): a writing desk — conversation
     list, open thread, in-world composer, new conversation by
     name, request actions — all on the messages page's own rails.
   - CommunityHallBoard (Courtyard): a notice board — recent posts
     as readable cards with in-world react + reply preview,
     superfan/sentiment highlights run against the board's own
     posts, and a Pin-a-post composer on the generate-community-
     post family. Moderation stays transfer-only in v1 (the board
     says so, plainly, above its transfer footer).
   Both fetch with the member token (the useAuthHeaders pattern the
   custom panels use) and keep honest loading/empty/failed states. */

function useAuthHeaders() {
  const { getAccessToken } = useAuth();
  return async (): Promise<Record<string, string>> => {
    const token = await getAccessToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  };
}

async function apiJson<T>(
  authHeaders: () => Promise<Record<string, string>>,
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<T> {
  const res = await fetch(path, {
    method: init?.method ?? "GET",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    ...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown> & {
    error?: string; message?: string;
  };
  if (!res.ok) throw new Error(data.message || data.error || `Request failed (${res.status})`);
  return data as T;
}

const chipBtn = (isLight: boolean) =>
  `inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition ${
    isLight
      ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]"
      : "border-white/15 text-white/75 hover:text-white"
  }`;
const goldBtn =
  "inline-flex items-center gap-1.5 rounded-full bg-[#d4af37] px-3.5 py-1.5 text-xs font-bold text-black transition hover:scale-105 disabled:opacity-50";
const inputCls = (isLight: boolean) =>
  `w-full rounded-xl border px-3 py-2 text-sm outline-none transition focus:border-[#d4af37] ${
    isLight
      ? "border-[#C9A84C]/40 bg-white/60 text-[#2a1e07] placeholder:text-[#6B5B36]/60"
      : "border-white/10 bg-white/5 text-white placeholder:text-white/35"
  }`;

/* ─── The hand-off card (owner addendum, Oct 17) ─────────────────────
   A DM attachment is a creator handing their work to another creator —
   it renders as the work itself: titled, framed, and playable in-world
   (a beat you can press play on, a cover you can see, a clip you can
   watch), never as a bare file chip. */
function DmWorkCard({ att, isLight, mine }: { att: DmAttachment; isLight: boolean; mine: boolean }) {
  const Icon = att.type === "audio" ? Music2 : att.type === "video" ? Clapperboard : ImageIcon;
  return (
    <div
      data-testid="world-dm-attachment"
      className={`min-w-[210px] overflow-hidden rounded-xl border ${
        isLight ? "border-[#7A5A12]/40 bg-white/70" : "border-[#d4af37]/35 bg-black/40"
      }`}
    >
      <div className={`flex items-center gap-2 px-3 pt-2.5 ${mine && !isLight ? "text-black" : ""}`}>
        <Icon className="h-4 w-4 shrink-0 text-[#d4af37]" />
        <span className="min-w-0">
          <span className={`block truncate text-sm font-black ${isLight || mine ? "" : "text-white"}`}>
            {att.name}
          </span>
          <span className={`block text-[10px] font-bold uppercase tracking-[0.14em] ${isLight ? "text-[#7A5A12]" : mine ? "text-black/60" : "text-[#e8c86a]/80"}`}>
            {dmWorkLabel(att.type)} · hand-off
          </span>
        </span>
      </div>
      <div className="px-3 pb-3 pt-2">
        {att.type === "audio" ? (
          <audio controls src={att.url} className="w-full" data-testid="world-dm-attachment-audio" />
        ) : att.type === "video" ? (
          <video controls src={att.url} className="max-h-44 w-full rounded-lg" data-testid="world-dm-attachment-video" />
        ) : (
          <img src={att.url} alt={att.name} className="max-h-44 w-full rounded-lg object-cover" data-testid="world-dm-attachment-image" />
        )}
      </div>
    </div>
  );
}

/* ═══ Post Office ═══════════════════════════════════════════════════ */

export function PostOfficeDesk({ isLight }: { isLight: boolean }) {
  const authHeaders = useAuthHeaders();
  const { user } = useAuth();
  const [inbox, setInbox] = useState<DmConversation[]>([]);
  const [requests, setRequests] = useState<DmConversation[]>([]);
  const [tab, setTab] = useState<"inbox" | "requests">("inbox");
  const [listState, setListState] = useState<"loading" | "ready" | "failed">("loading");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<DmMessage[]>([]);
  const [threadStatus, setThreadStatus] = useState<string>("inbox");
  const [threadState, setThreadState] = useState<"idle" | "loading" | "ready" | "failed">("idle");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [newSlug, setNewSlug] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [starting, setStarting] = useState(false);
  /* Attachments (2.17): the staged piece of work + the by-URL rail. */
  const [pendingAtt, setPendingAtt] = useState<DmAttachment | null>(null);
  const [uploading, setUploading] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [showLink, setShowLink] = useState(false);
  /* Thread search (2.17): the desk list + the open thread. */
  const [listQuery, setListQuery] = useState("");
  const [threadQuery, setThreadQuery] = useState("");
  const threadReqRef = useRef(0);
  const bottomRef = useRef<HTMLDivElement>(null);
  const dmDraftRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const loadConvs = useCallback(async () => {
    try {
      const d = await apiJson<unknown>(authHeaders, DM_CONVERSATIONS_PATH);
      const { inbox: ib, requests: rq } = normalizeDmConversations(d);
      setInbox(ib);
      setRequests(rq);
      setListState("ready");
    } catch {
      setListState("failed");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadThread = useCallback(async (id: string) => {
    const reqId = ++threadReqRef.current;
    setThreadState("loading");
    setMsgs([]);
    try {
      const d = await apiJson<{ messages: DmMessage[]; status: string }>(
        authHeaders, dmMessagesPath(id),
      );
      if (reqId !== threadReqRef.current) return;
      setMsgs(Array.isArray(d.messages) ? d.messages : []);
      setThreadStatus(d.status ?? "inbox");
      setThreadState("ready");
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    } catch {
      if (reqId === threadReqRef.current) setThreadState("failed");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { void loadConvs(); }, [loadConvs]);
  useEffect(() => { if (activeId) void loadThread(activeId); }, [activeId, loadThread]);

  const active = dmFindConversation(inbox, requests, activeId);
  const canChat = dmCanChat(threadStatus, active);
  const needsAnswer = dmNeedsAnswer(threadStatus, active);
  const list = (tab === "inbox" ? inbox : requests).filter((c) => dmConversationMatches(c, listQuery));
  const visibleMsgs = dmFilterMessages(msgs, threadQuery);
  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";

  async function startBySlug() {
    if (!newSlug.trim() || starting) return;
    setStarting(true);
    setNotice(null);
    try {
      const r = await apiJson<{ user_id: string }>(authHeaders, profileResolvePath(newSlug));
      const d = await apiJson<{ conversation: DmConversation }>(authHeaders, DM_START_PATH, {
        method: "POST", body: { user_id: r.user_id },
      });
      setNewSlug("");
      setShowNew(false);
      await loadConvs();
      setTab(d.conversation.status === "request" ? "requests" : "inbox");
      setActiveId(d.conversation.id);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Creator not found.");
    } finally {
      setStarting(false);
    }
  }

  async function uploadFile(file: File) {
    const kind = dmAttachmentKindForMime(file.type);
    if (!kind) {
      setNotice("Only audio, video, or image files can ride in a message.");
      return;
    }
    setUploading(true);
    setNotice(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(DM_ATTACHMENT_UPLOAD_PATH, {
        method: "POST",
        headers: { ...(await authHeaders()) },
        body: form,
      });
      const data = (await res.json().catch(() => ({}))) as {
        ref?: string; type?: DmAttachment["type"]; name?: string;
        error?: string; message?: string;
      };
      if (!res.ok || !data.ref || !data.type) {
        throw new Error(data.message || data.error || "The upload didn't land.");
      }
      /* Send the permanent ref, never the signed URL — the server
         persists the ref and mints fresh URLs on every read. */
      setPendingAtt({ url: data.ref, type: data.type, name: data.name ?? file.name });
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "The upload didn't land.");
    } finally {
      setUploading(false);
    }
  }

  function attachByUrl() {
    const url = linkUrl.trim();
    if (!url) return;
    const kind = dmAttachmentKindForUrl(url);
    if (!kind) {
      setNotice("That link doesn't name a beat, cover, or clip file — check the ending (.mp3, .jpg, .mp4…).");
      return;
    }
    setPendingAtt({ url, type: kind, name: dmAttachmentNameForUrl(url) });
    setLinkUrl("");
    setShowLink(false);
    setNotice(null);
  }

  async function send() {
    if (!activeId || !dmCanSendDraft(draft, canChat, pendingAtt !== null) || sending) return;
    setSending(true);
    setNotice(null);
    try {
      await apiJson(authHeaders, dmSendPath(activeId), {
        method: "POST",
        body: {
          body: draft.trim(),
          ...(pendingAtt
            ? { attachment: { url: pendingAtt.url, type: pendingAtt.type, name: pendingAtt.name } }
            : {}),
        },
      });
      setDraft("");
      setPendingAtt(null);
      await loadThread(activeId);
      await loadConvs();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Couldn't send.");
    } finally {
      setSending(false);
    }
  }

  async function requestAction(action: "accept" | "decline" | "block") {
    if (!activeId) return;
    setNotice(null);
    try {
      await apiJson(authHeaders, dmRequestActionPath(activeId, action), { method: "POST", body: {} });
      if (action === "accept") {
        await loadConvs();
        await loadThread(activeId);
      } else {
        setActiveId(null);
        setThreadState("idle");
        await loadConvs();
      }
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "That didn't land — try again.");
    }
  }

  if (listState === "loading") {
    return <NativeLoadingState isLight={isLight} message="Opening the post desk…" />;
  }
  if (listState === "failed") {
    return (
      <NativeErrorState
        isLight={isLight}
        title="The post desk wouldn't open"
        message="Your messages are safe on the real rails — the desk just couldn't fetch them."
        onRetry={() => { setListState("loading"); void loadConvs(); }}
      />
    );
  }

  return (
    <div className="space-y-3" data-testid="world-post-office">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          data-testid="world-dm-tab-inbox"
          onClick={() => setTab("inbox")}
          className={`rounded-full px-3.5 py-1.5 text-xs font-bold transition ${
            tab === "inbox" ? "bg-[#d4af37] text-black" : chipBtn(isLight)
          }`}
        >
          Inbox{dmUnreadTotal(inbox) > 0 ? ` (${dmUnreadTotal(inbox)})` : ""}
        </button>
        <button
          type="button"
          data-testid="world-dm-tab-requests"
          onClick={() => setTab("requests")}
          className={`rounded-full px-3.5 py-1.5 text-xs font-bold transition ${
            tab === "requests" ? "bg-[#d4af37] text-black" : chipBtn(isLight)
          }`}
        >
          Requests{requests.length > 0 ? ` (${requests.length})` : ""}
        </button>
        <button
          type="button"
          data-testid="world-dm-new"
          onClick={() => setShowNew((v) => !v)}
          className={`${chipBtn(isLight)} ml-auto`}
        >
          <Plus className="h-3.5 w-3.5" /> New message
        </button>
      </div>

      {showNew && (
        <div className="flex gap-2">
          <input
            value={newSlug}
            onChange={(e) => setNewSlug(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void startBySlug()}
            placeholder="Creator name (their profile slug)"
            className={inputCls(isLight)}
            data-testid="world-dm-new-slug"
          />
          <button
            type="button"
            onClick={() => void startBySlug()}
            disabled={starting || !newSlug.trim()}
            className={goldBtn}
            data-testid="world-dm-new-start"
          >
            {starting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Start
          </button>
        </div>
      )}

      {notice && (
        <p className={`text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>{notice}</p>
      )}

      <div className="relative">
        <Search className={`pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 ${muted}`} />
        <input
          value={listQuery}
          onChange={(e) => setListQuery(e.target.value)}
          placeholder="Search conversations — a name, a word, a piece of work…"
          className={`${inputCls(isLight)} pl-9`}
          data-testid="world-dm-search"
        />
      </div>

      <div className="grid gap-3 md:grid-cols-[240px_1fr]">
        <div className="max-h-[38vh] space-y-1.5 overflow-y-auto pr-1">
          {list.length === 0 ? (
            <NativeEmptyState
              isLight={isLight}
              message={
                listQuery.trim()
                  ? "No conversation matches that search."
                  : tab === "inbox" ? "No conversations yet — go meet some creators." : "No requests. You're all clear."
              }
            />
          ) : (
            list.map((c) => {
              const name = dmConversationName(c);
              return (
                <button
                  key={c.id}
                  type="button"
                  data-testid="world-dm-conversation"
                  onClick={() => setActiveId(c.id)}
                  className={`flex w-full items-center gap-2.5 rounded-xl border px-3 py-2 text-left transition ${
                    activeId === c.id
                      ? "border-[#d4af37] bg-[#d4af37]/10"
                      : isLight
                        ? "border-[#C9A84C]/40 bg-white/50"
                        : "border-white/10 bg-white/5"
                  }`}
                >
                  {c.other.profile?.avatarUrl ? (
                    <img src={c.other.profile.avatarUrl} alt="" className="h-9 w-9 rounded-full object-cover" />
                  ) : (
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#d4af37]/20 text-sm font-black text-[#e8c86a]">
                      {name.slice(0, 1).toUpperCase()}
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className={`flex items-center gap-2 text-sm font-bold ${isLight ? "text-[#2a1e07]" : "text-white"}`}>
                      <span className="truncate">{name}</span>
                      {c.unread > 0 && (
                        <span className="rounded-full bg-[#d4af37] px-1.5 py-0.5 text-[10px] font-black text-black">{c.unread}</span>
                      )}
                    </span>
                    <span className={`block truncate text-xs ${muted}`}>
                      {c.last_message?.body
                        ? c.last_message.body
                        : c.last_message?.attachment_name
                          ? `${c.last_message.attachment_type === "audio" ? "Beat" : c.last_message.attachment_type === "video" ? "Clip" : "Artwork"}: ${c.last_message.attachment_name}`
                          : "No messages yet"}
                    </span>
                  </span>
                </button>
              );
            })
          )}
        </div>

        <NativeCard isLight={isLight}>
          {!active ? (
            <NativeEmptyState
              isLight={isLight}
              message="Pick a conversation — or start a new one."
              detail="Mutual followers land straight in the inbox; everyone else goes to requests."
            />
          ) : (
            <div className="flex min-h-[220px] flex-col">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className={`text-sm font-black ${isLight ? "text-[#2a1e07]" : "text-white"}`}>
                  {dmConversationName(active)}
                </span>
                <span className={`text-[11px] font-semibold ${muted}`}>
                  {threadStatus === "request" ? "Message request" : "Inbox"}
                </span>
                <button
                  type="button"
                  data-testid="world-dm-block"
                  onClick={() => void requestAction("block")}
                  className={`ml-auto inline-flex items-center gap-1 text-[11px] font-bold ${isLight ? "text-red-900/70 hover:text-red-900" : "text-white/40 hover:text-red-300"}`}
                  title="Block this conversation"
                >
                  <Ban className="h-3.5 w-3.5" /> Block
                </button>
              </div>

              <div className="relative mb-2">
                <Search className={`pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 ${muted}`} />
                <input
                  value={threadQuery}
                  onChange={(e) => setThreadQuery(e.target.value)}
                  placeholder="Search this thread…"
                  className={`${inputCls(isLight)} pl-9`}
                  data-testid="world-dm-thread-search"
                />
                {threadQuery.trim() && threadState === "ready" && (
                  <span className={`absolute right-3 top-1/2 -translate-y-1/2 text-[11px] font-bold ${muted}`}>
                    {visibleMsgs.length} of {msgs.length}
                  </span>
                )}
              </div>

              {needsAnswer && (
                <div
                  className={`mb-2 flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 ${
                    isLight ? "border-[#C9A84C]/40 bg-[#d4af37]/10" : "border-[#d4af37]/25 bg-[#d4af37]/5"
                  }`}
                  data-testid="world-dm-request-rail"
                >
                  <span className={`text-xs font-semibold ${muted}`}>They want to chat — accept?</span>
                  <button type="button" data-testid="world-dm-accept" onClick={() => void requestAction("accept")} className={goldBtn}>
                    <Check className="h-3.5 w-3.5" /> Accept
                  </button>
                  <button type="button" data-testid="world-dm-decline" onClick={() => void requestAction("decline")} className={chipBtn(isLight)}>
                    <X className="h-3.5 w-3.5" /> Decline
                  </button>
                </div>
              )}

              <div className="max-h-[30vh] flex-1 space-y-2 overflow-y-auto pr-1">
                {threadState === "loading" ? (
                  <NativeLoadingState isLight={isLight} message="Fetching the thread…" />
                ) : threadState === "failed" ? (
                  <NativeErrorState
                    isLight={isLight}
                    title="This thread wouldn't open"
                    message="The conversation is fine — the fetch slipped."
                    onRetry={() => activeId && void loadThread(activeId)}
                  />
                ) : msgs.length === 0 ? (
                  <NativeEmptyState isLight={isLight} message="No messages yet — say the first word." />
                ) : visibleMsgs.length === 0 ? (
                  <NativeEmptyState isLight={isLight} message="Nothing in this thread matches that search." />
                ) : (
                  visibleMsgs.map((m) => {
                    const mine = m.senderUserId === user?.id;
                    const att = dmMessageAttachment(m);
                    return (
                      <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                        <div
                          className={`max-w-[78%] rounded-2xl px-3 py-2 ${
                            mine
                              ? "bg-[#d4af37] text-black"
                              : isLight
                                ? "bg-[#C9A84C]/15 text-[#2a1e07]"
                                : "bg-white/10 text-white"
                          }`}
                        >
                          {att && <DmWorkCard att={att} isLight={isLight} mine={mine} />}
                          {m.body && (
                            <p className={`whitespace-pre-wrap text-sm ${att ? "mt-2" : ""}`}>
                              <KingTokenText body={m.body} theme={isLight ? "light" : "dark"} />
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={bottomRef} />
              </div>

              {canChat && pendingAtt && (
                <div
                  className={`mt-2 flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 ${
                    isLight ? "border-[#C9A84C]/40 bg-[#d4af37]/10" : "border-[#d4af37]/25 bg-[#d4af37]/5"
                  }`}
                  data-testid="world-dm-pending-attachment"
                >
                  <span className={`text-xs font-bold ${isLight ? "text-[#2a1e07]" : "text-white"}`}>
                    {dmWorkLabel(pendingAtt.type)} ready to hand off: {pendingAtt.name}
                  </span>
                  <button
                    type="button"
                    onClick={() => setPendingAtt(null)}
                    className={`ml-auto inline-flex items-center gap-1 text-[11px] font-bold ${muted}`}
                    data-testid="world-dm-attachment-remove"
                  >
                    <X className="h-3.5 w-3.5" /> Remove
                  </button>
                </div>
              )}

              {canChat && showLink && (
                <div className="mt-2 flex gap-2">
                  <input
                    value={linkUrl}
                    onChange={(e) => setLinkUrl(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && attachByUrl()}
                    placeholder="Link to your file (…/beat.mp3, …/cover.jpg, …/clip.mp4)"
                    className={inputCls(isLight)}
                    data-testid="world-dm-attach-url"
                  />
                  <button
                    type="button"
                    onClick={attachByUrl}
                    disabled={!linkUrl.trim()}
                    className={goldBtn}
                    data-testid="world-dm-attach-url-add"
                  >
                    Attach
                  </button>
                </div>
              )}

              {canChat ? (
                <div className="mt-2 flex items-center gap-2">
                  <input
                    ref={fileRef}
                    type="file"
                    accept="audio/*,video/*,image/*"
                    className="hidden"
                    data-testid="world-dm-attach-file"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void uploadFile(f);
                      e.target.value = "";
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    disabled={uploading}
                    className={chipBtn(isLight)}
                    data-testid="world-dm-attach"
                    title="Hand off a piece of your work — a beat, a cover, a clip"
                  >
                    {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Paperclip className="h-3.5 w-3.5" />}
                    {uploading ? "Sending to the desk…" : "Attach work"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowLink((v) => !v)}
                    className={chipBtn(isLight)}
                    data-testid="world-dm-attach-link"
                    title="Attach by link instead"
                  >
                    <Link2 className="h-3.5 w-3.5" />
                  </button>
                  <EmojiTray
                    tone={isLight ? "light" : "dark"}
                    onPickToken={(token) => {
                      const el = dmDraftRef.current;
                      const next = insertAtCursor(draft, token, el?.selectionStart ?? null, el?.selectionEnd ?? null, DM_DRAFT_MAX);
                      setDraft(next.value);
                      requestAnimationFrame(() => {
                        if (el) {
                          el.focus();
                          el.setSelectionRange(next.caret, next.caret);
                        }
                      });
                    }}
                  />
                  <input
                    ref={dmDraftRef}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && void send()}
                    placeholder="Write from the desk…"
                    maxLength={DM_DRAFT_MAX}
                    className={inputCls(isLight)}
                    data-testid="world-dm-draft"
                  />
                  <button
                    type="button"
                    onClick={() => void send()}
                    disabled={!dmCanSendDraft(draft, canChat, pendingAtt !== null) || sending}
                    className={goldBtn}
                    data-testid="world-dm-send"
                  >
                    {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                    Send
                  </button>
                </div>
              ) : threadStatus === "request" && active.requested_by_me ? (
                <p className={`mt-2 text-center text-xs ${muted}`}>
                  Request sent — they&rsquo;ll see it in their requests.
                </p>
              ) : null}
            </div>
          )}
        </NativeCard>
      </div>
    </div>
  );
}

/* ═══ Community Hall ════════════════════════════════════════════════ */

function NoticePostCard({
  post, isLight, isGuest, authHeaders,
}: {
  post: FeedPost;
  isLight: boolean;
  isGuest: boolean;
  authHeaders: () => Promise<Record<string, string>>;
}) {
  const [emoji, setEmoji] = useState<string | null>(post.viewer_emoji);
  const [counts, setCounts] = useState<Record<string, number>>(post.reaction_counts ?? {});
  const [replies, setReplies] = useState<FeedPost[] | null>(null);
  const [repliesOpen, setRepliesOpen] = useState(false);
  const [replyCount, setReplyCount] = useState(post.reply_count);
  const [replyDraft, setReplyDraft] = useState("");
  const [replying, setReplying] = useState(false);
  const [replyNote, setReplyNote] = useState<string | null>(null);
  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";

  async function react(next: string) {
    const prev = { emoji, counts };
    const state = nextReactionState(emoji, counts, next);
    setEmoji(state.emoji);
    setCounts(state.counts);
    try {
      if (state.emoji === null) {
        const res = await fetch(reactRemovePath(post.id), {
          method: "DELETE",
          headers: await authHeaders(),
        });
        if (!res.ok) throw new Error("react");
      } else {
        await apiJson(authHeaders, REACT_PATH, {
          method: "POST",
          body: { target_kind: "post", target_id: post.id, emoji: next },
        });
      }
    } catch {
      setEmoji(prev.emoji);
      setCounts(prev.counts);
    }
  }

  async function toggleReplies() {
    if (replies !== null) {
      setRepliesOpen((v) => !v);
      return;
    }
    try {
      const d = await apiJson<{ replies: FeedPost[] }>(authHeaders, postRepliesPath(post.id));
      setReplies(Array.isArray(d.replies) ? d.replies : []);
      setRepliesOpen(true);
    } catch {
      setReplies([]);
      setRepliesOpen(true);
    }
  }

  async function sendReply() {
    if (replying || !postBodyReady(replyDraft)) return;
    setReplying(true);
    setReplyNote(null);
    try {
      const d = await apiJson<{ post: FeedPost }>(authHeaders, postReplyPath(post.id), {
        method: "POST", body: { body: replyDraft.trim() },
      });
      if (d.post) {
        setReplies((prev) => [...(prev ?? []), d.post]);
        setReplyCount((n) => n + 1);
      }
      setReplyDraft("");
    } catch (e) {
      setReplyNote(e instanceof Error ? e.message : "The reply didn't land — try again.");
    } finally {
      setReplying(false);
    }
  }

  return (
    <NativeCard isLight={isLight}>
      <div data-testid="world-community-post">
        <p className="flex flex-wrap items-center gap-2">
          <span className={`text-sm font-bold ${isLight ? "text-[#2a1e07]" : "text-white"}`}>
            {post.author?.display_name ?? "Creator"}
          </span>
          {post.author?.slug && <span className={`text-xs ${muted}`}>@{post.author.slug}</span>}
        </p>
        {post.body && (
          <p className={`mt-1 whitespace-pre-wrap text-sm ${isLight ? "text-[#2a1e07]" : "text-white/85"}`}>
            <KingTokenText body={post.body} theme={isLight ? "light" : "dark"} />
          </p>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {BOARD_REACTIONS.map((r) => (
            <button
              key={r.emoji}
              type="button"
              data-testid={`world-community-react-${r.emoji}`}
              onClick={() => void react(r.emoji)}
              aria-pressed={emoji === r.emoji}
              className={`${chipBtn(isLight)} ${emoji === r.emoji ? "border-[#d4af37] bg-[#d4af37]/15" : ""}`}
            >
              <ReactionSticker reaction={r.emoji} className="h-[18px] w-[18px] object-contain" />
              {r.label}
              {(counts[r.emoji] ?? 0) > 0 ? ` ${counts[r.emoji]}` : ""}
            </button>
          ))}
          <button type="button" onClick={() => void toggleReplies()} className={chipBtn(isLight)} data-testid="world-community-thread-toggle">
            <MessageCircle className="h-3.5 w-3.5" />
            {replyCount > 0 ? `${replyCount} replies` : "Replies"}
          </button>
        </div>
        {repliesOpen && replies !== null && (
          <div className="mt-2 space-y-1.5" data-testid="world-community-thread">
            {replies.length === 0 ? (
              <p className={`text-xs ${muted}`}>No replies yet — the thread starts with the next voice.</p>
            ) : (
              fullThread(replies).map((r) => (
                <p
                  key={r.id}
                  className={`rounded-lg px-2.5 py-1.5 text-xs ${isLight ? "bg-[#C9A84C]/10 text-[#2a1e07]" : "bg-white/5 text-white/75"}`}
                >
                  <span className="font-bold">{r.author?.display_name ?? "Creator"}:</span>{" "}
                  <KingTokenText body={r.body} theme={isLight ? "light" : "dark"} />
                </p>
              ))
            )}
            {isGuest ? (
              <p className={`text-[11px] ${muted}`}>
                You&rsquo;re reading the whole thread — sign in to add your voice to it.
              </p>
            ) : (
              <div className="pt-1">
                <div className="flex gap-2">
                  <input
                    value={replyDraft}
                    onChange={(e) => setReplyDraft(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && void sendReply()}
                    placeholder="Answer in the Hall…"
                    maxLength={500}
                    className={inputCls(isLight)}
                    data-testid="world-community-reply-draft"
                  />
                  <button
                    type="button"
                    onClick={() => void sendReply()}
                    disabled={replying || !postBodyReady(replyDraft)}
                    className={goldBtn}
                    data-testid="world-community-reply-send"
                  >
                    {replying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                    Reply
                  </button>
                </div>
                {replyNote && (
                  <p className={`mt-1.5 text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>{replyNote}</p>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </NativeCard>
  );
}

/* ─── The reply-drafts bench (2.19) ───────────────────────────────────
   The community page's tone drafting bench, docked at the board: paste
   the comments you're answering (one per line), pick a tone, and the
   bench drafts a reply for each. The price on the button comes from
   the server's own meta — never a hardcoded number — and each draft
   is editable before it posts to the board. */
function ReplyDraftsBench({
  isLight, authHeaders, onPosted,
}: {
  isLight: boolean;
  authHeaders: () => Promise<Record<string, string>>;
  onPosted: () => void;
}) {
  const [commentsText, setCommentsText] = useState("");
  const [tone, setTone] = useState<ReplyDraftTone>("hype");
  const [cost, setCost] = useState<number | null>(null);
  const [maxComments, setMaxComments] = useState(10);
  const [drafts, setDrafts] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [posting, setPosting] = useState<number | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const batch = replyDraftBatch(commentsText, maxComments);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const d = await apiJson<{ cost: number; maxComments: number }>(authHeaders, COMMENT_REPLIES_META_PATH);
        if (!cancelled) {
          if (typeof d.cost === "number") setCost(d.cost);
          if (typeof d.maxComments === "number") setMaxComments(d.maxComments);
        }
      } catch { /* price stays unshown rather than guessed — drafting still gates server-side */ }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function draftReplies() {
    if (busy || batch.length === 0) return;
    setBusy(true);
    setNote(null);
    setDrafts(null);
    try {
      const d = await apiJson<{ replies: string[] }>(authHeaders, COMMENT_REPLIES_PATH, {
        method: "POST", body: { comments: batch, tone, voiceNotes: "" },
      });
      const replies = Array.isArray(d.replies) ? d.replies : [];
      setDrafts(replies);
      if (replies.length === 0) setNote("Nothing came back — nothing was charged twice over; try again.");
    } catch (e) {
      setNote(e instanceof Error ? e.message : "The drafts didn't land — try again.");
    } finally {
      setBusy(false);
    }
  }

  async function postDraft(idx: number) {
    const text = drafts?.[idx] ?? "";
    if (posting !== null || !postBodyReady(text)) return;
    setPosting(idx);
    setNote(null);
    try {
      await apiJson(authHeaders, POSTS_PATH, { method: "POST", body: { body: text.trim() } });
      setNote("Posted to the board — your reply is live under the Hall's posts.");
      onPosted();
    } catch (e) {
      setNote(e instanceof Error ? e.message : "The post didn't land — try again.");
    } finally {
      setPosting(null);
    }
  }

  return (
    <NativeCard isLight={isLight} title="Reply drafts bench">
      <div data-testid="world-community-reply-bench">
        <textarea
          value={commentsText}
          onChange={(e) => setCommentsText(e.target.value)}
          placeholder={"Paste the comments you're answering — one per line…"}
          rows={3}
          className={inputCls(isLight)}
          data-testid="world-community-bench-comments"
        />
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {REPLY_DRAFT_TONES.map((t) => (
            <button
              key={t.key}
              type="button"
              data-testid={`world-community-bench-tone-${t.key}`}
              onClick={() => setTone(t.key)}
              aria-pressed={tone === t.key}
              className={`${chipBtn(isLight)} ${tone === t.key ? "border-[#d4af37] bg-[#d4af37]/15" : ""}`}
            >
              {t.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => void draftReplies()}
            disabled={busy || batch.length === 0}
            className={`${goldBtn} ml-auto`}
            data-testid="world-community-bench-draft"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            Draft replies{cost !== null ? ` · ${cost} VB` : ""}
          </button>
        </div>
        <p className={`mt-1.5 text-[11px] ${muted}`}>
          {batch.length > 0
            ? `${batch.length} comment${batch.length === 1 ? "" : "s"} in this batch${cost !== null ? ` — one batch costs ${cost} VB, charged when you draft` : ""}.`
            : "One batch drafts a reply for every pasted comment."}
        </p>
        {note && (
          <p className={`mt-2 text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>{note}</p>
        )}
        {drafts !== null && drafts.length > 0 && (
          <div className="mt-2 space-y-2">
            {drafts.map((draft, i) => (
              <div
                key={i}
                className={`rounded-xl border px-3 py-2 ${isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"}`}
              >
                <p className={`text-[11px] ${muted}`}>
                  For: <span className="font-semibold">{batch[i] ?? ""}</span>
                </p>
                <textarea
                  value={draft}
                  onChange={(e) =>
                    setDrafts((prev) => (prev ?? []).map((d, j) => (j === i ? e.target.value : d)))
                  }
                  rows={2}
                  maxLength={500}
                  className={`${inputCls(isLight)} mt-1.5`}
                  data-testid="world-community-bench-edit"
                />
                <div className="mt-1.5 flex justify-end">
                  <button
                    type="button"
                    onClick={() => void postDraft(i)}
                    disabled={posting !== null || !postBodyReady(draft)}
                    className={goldBtn}
                    data-testid="world-community-bench-post"
                  >
                    {posting === i ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Pin className="h-3.5 w-3.5" />}
                    Post to the board
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </NativeCard>
  );
}

export function CommunityHallBoard({ isLight, isGuest }: { isLight: boolean; isGuest: boolean }) {
  const authHeaders = useAuthHeaders();
  const [posts, setPosts] = useState<FeedPost[] | null>(null);
  const [feedFailed, setFeedFailed] = useState(false);
  const [tick, setTick] = useState(0);
  const [superfans, setSuperfans] = useState<Superfan[] | null>(null);
  const [sentiment, setSentiment] = useState<SentimentReport | null>(null);
  const [scanBusy, setScanBusy] = useState<"superfans" | "sentiment" | null>(null);
  const [scanNote, setScanNote] = useState<string | null>(null);
  const [topic, setTopic] = useState("");
  const [pinCost, setPinCost] = useState<number | null>(null);
  const [variants, setVariants] = useState<CommunityPostVariant[]>([]);
  const [generating, setGenerating] = useState(false);
  const [pinning, setPinning] = useState<string | null>(null);
  const [pinNote, setPinNote] = useState<string | null>(null);
  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";

  useEffect(() => {
    let cancelled = false;
    setFeedFailed(false);
    (async () => {
      try {
        const d = await apiJson<{ posts: FeedPost[] }>(authHeaders, feedPath(12));
        if (!cancelled) setPosts(Array.isArray(d.posts) ? d.posts : []);
      } catch {
        if (!cancelled) setFeedFailed(true);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const d = await apiJson<{ cost: number }>(authHeaders, COMMUNITY_POST_PLATFORMS_PATH);
        if (!cancelled && typeof d.cost === "number") setPinCost(d.cost);
      } catch { /* cost stays "shown when known" — generation still gates server-side */ }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function runScan(kind: "superfans" | "sentiment") {
    if (scanBusy || !posts) return;
    const comments = commentsBatchFromPosts(posts);
    if (comments.length === 0) {
      setScanNote("Nothing on the board to read yet — the scan runs on the board's own posts.");
      return;
    }
    setScanBusy(kind);
    setScanNote(null);
    try {
      if (kind === "superfans") {
        const d = await apiJson<{ superfans: Superfan[] }>(authHeaders, COMMUNITY_SUPERFANS_PATH, {
          method: "POST", body: { comments },
        });
        setSuperfans(Array.isArray(d.superfans) ? d.superfans : []);
      } else {
        const d = await apiJson<{ report: SentimentReport }>(authHeaders, COMMUNITY_SENTIMENT_PATH, {
          method: "POST", body: { comments },
        });
        setSentiment(d.report ?? null);
      }
    } catch (e) {
      setScanNote(e instanceof Error ? e.message : "The scan didn't land — try again.");
    } finally {
      setScanBusy(null);
    }
  }

  async function generatePin() {
    if (generating || !pinTopicReady(topic)) return;
    setGenerating(true);
    setPinNote(null);
    setVariants([]);
    try {
      const d = await apiJson<{ posts: CommunityPostVariant[] }>(
        authHeaders, GENERATE_COMMUNITY_POST_PATH,
        { method: "POST", body: { topic: topic.trim(), platform: "x", tone: "hyped" } },
      );
      setVariants(Array.isArray(d.posts) ? d.posts : []);
      if (!Array.isArray(d.posts) || d.posts.length === 0) {
        setPinNote("Nothing came back — nothing was pinned.");
      }
    } catch (e) {
      setPinNote(e instanceof Error ? e.message : "The draft didn't land — try again.");
    } finally {
      setGenerating(false);
    }
  }

  async function pinVariant(text: string) {
    if (pinning || !postBodyReady(text)) return;
    setPinning(text);
    setPinNote(null);
    try {
      await apiJson(authHeaders, POSTS_PATH, { method: "POST", body: { body: text.trim() } });
      setPinNote("Pinned to the board — it's live on the notice board now.");
      setVariants([]);
      setTopic("");
      setTick((n) => n + 1);
    } catch (e) {
      setPinNote(e instanceof Error ? e.message : "The pin didn't land — try again.");
    } finally {
      setPinning(null);
    }
  }

  return (
    <div className="space-y-3" data-testid="world-community-hall">
      {/* Highlights — superfans + sentiment, run on demand against
          the board's own posts (the community page's exact rails).
          Each run costs 100 Visual Bucs server-side; the price is
          stated before the tap, per house law. */}
      <NativeCard isLight={isLight} title="Hall highlights">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            data-testid="world-community-scan-superfans"
            onClick={() => void runScan("superfans")}
            disabled={scanBusy !== null || posts === null}
            className={chipBtn(isLight)}
          >
            {scanBusy === "superfans" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Star className="h-3.5 w-3.5 text-[#d4af37]" />}
            Superfan radar · 100 VB
          </button>
          <button
            type="button"
            data-testid="world-community-scan-sentiment"
            onClick={() => void runScan("sentiment")}
            disabled={scanBusy !== null || posts === null}
            className={chipBtn(isLight)}
          >
            {scanBusy === "sentiment" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <BarChart3 className="h-3.5 w-3.5 text-[#d4af37]" />}
            Read the room · 100 VB
          </button>
          <span className={`text-[11px] ${muted}`}>
            {isGuest
              ? "Sign in to run a scan — the board below still reads."
              : "Runs read the board's recent posts; the price shows before anything runs."}
          </span>
        </div>
        {scanNote && (
          <p className={`mt-2 text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>{scanNote}</p>
        )}
        {superfans !== null && (
          <div className="mt-2 space-y-1.5">
            {superfans.length === 0 ? (
              <p className={`text-xs ${muted}`}>No superfans stood out in this batch — the room is warming up.</p>
            ) : (
              superfans.map((s, i) => (
                <p key={`${s.author}-${i}`} className={`text-xs ${isLight ? "text-[#2a1e07]" : "text-white/80"}`}>
                  <span className="font-black text-[#e8c86a]">#{i + 1} @{s.author}</span> · {s.score}/100 — {s.why}
                </p>
              ))
            )}
          </div>
        )}
        {sentiment && (
          <p className={`mt-2 text-xs ${isLight ? "text-[#2a1e07]" : "text-white/80"}`}>
            <span className="font-black capitalize text-[#e8c86a]">{sentiment.overall}</span> · {sentiment.score}/100
            {sentiment.themes && sentiment.themes.length > 0
              ? ` — ${sentiment.themes.map((t) => t.theme).slice(0, 3).join(" · ")}`
              : ""}
          </p>
        )}
      </NativeCard>

      {/* Pin a post — draft with the generate-community-post family,
          then pin the chosen words to the board (POST /api/posts). */}
      <NativeCard isLight={isLight} title="Pin a post">
        <div className="flex gap-2">
          <input
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void generatePin()}
            placeholder="What's the word? (a drop, a poll, a hello)"
            className={inputCls(isLight)}
            data-testid="world-community-pin-topic"
          />
          <button
            type="button"
            onClick={() => void generatePin()}
            disabled={generating || !pinTopicReady(topic)}
            className={goldBtn}
            data-testid="world-community-pin-generate"
          >
            {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Pin className="h-3.5 w-3.5" />}
            Draft it{pinCost !== null ? ` · ${pinCost} VB` : ""}
          </button>
        </div>
        {pinNote && (
          <p className={`mt-2 text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>{pinNote}</p>
        )}
        {variants.length > 0 && (
          <div className="mt-2 space-y-1.5">
            {variants.map((v) => (
              <div
                key={v.text}
                className={`flex flex-wrap items-start gap-2 rounded-xl border px-3 py-2 ${
                  isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"
                }`}
              >
                <p className={`min-w-0 flex-1 text-sm ${isLight ? "text-[#2a1e07]" : "text-white/85"}`}>{v.text}</p>
                <button
                  type="button"
                  data-testid="world-community-pin-post"
                  onClick={() => void pinVariant(v.text)}
                  disabled={pinning !== null || !postBodyReady(v.text)}
                  className={goldBtn}
                >
                  {pinning === v.text ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Pin className="h-3.5 w-3.5" />}
                  Pin to the board
                </button>
              </div>
            ))}
            <p className={`text-[11px] ${muted}`}>
              Pinning posts your words to the board as-is — check the draft before it goes up.
            </p>
          </div>
        )}
      </NativeCard>

      {/* Reply drafts bench — members only (drafting charges credits,
          and guests never reach a paid rail). */}
      {!isGuest && (
        <ReplyDraftsBench isLight={isLight} authHeaders={authHeaders} onPosted={() => setTick((n) => n + 1)} />
      )}

      {/* The notice board itself. */}
      <div>
        <p className={`mb-1.5 px-1 text-xs font-black uppercase tracking-[0.14em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
          On the board
        </p>
        {feedFailed ? (
          <NativeErrorState
            isLight={isLight}
            title="The notice board wouldn't open"
            message={
              isGuest
                ? "The board reads for members — sign in on the website and the Hall will show its posts."
                : "The posts are fine — the board just couldn't fetch them."
            }
            onRetry={() => setTick((n) => n + 1)}
          />
        ) : posts === null ? (
          <NativeLoadingState isLight={isLight} message="Pinning up the board…" />
        ) : posts.length === 0 ? (
          <NativeEmptyState
            isLight={isLight}
            message="The board is bare right now."
            detail="Pin the first post above — the Hall notices."
          />
        ) : (
          <div className="space-y-2">
            {posts.map((p) => (
              <NoticePostCard key={p.id} post={p} isLight={isLight} isGuest={isGuest} authHeaders={authHeaders} />
            ))}
          </div>
        )}
      </div>

      <p className={`px-1 text-[11px] ${muted}`}>
        Moderation stays on the website in this version — it&rsquo;s a workbench, not a hangout
        action. The Hall&rsquo;s transfer below opens it.
      </p>
    </div>
  );
}
