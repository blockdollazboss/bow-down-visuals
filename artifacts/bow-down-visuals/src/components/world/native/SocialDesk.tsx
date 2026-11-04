import { apiErrorMessage, plainErrorText } from "../../../lib/api-error";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Send, Check, X, Ban, Plus, Pin, MessageCircle, Star, BarChart3, Loader2,
  Paperclip, Search, Link2, Sparkles, Music2, Clapperboard, Image as ImageIcon,
  Repeat2, Bookmark, Trash2, Clock3, Flame, Radio,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { EmojiTray, KingTokenText, ReactionSticker } from "@/components/social/KingEmoji";
import { insertAtCursor } from "@/lib/king-emoji";
import {
  NativeCard, NativeLoadingState, NativeEmptyState, NativeErrorState,
} from "@/components/world/native";
import type { FeedPost } from "@/lib/social-api";
import { PostAssistBlock } from "./PostAssist";
import { ModerationBench } from "./SocialWave2";
import { appendAssistDraft } from "@/lib/world/post-assist";
import {
  DM_CONVERSATIONS_PATH, DM_START_PATH, DM_ATTACHMENT_UPLOAD_PATH,
  dmMessagesPath, dmSendPath, dmRequestActionPath, profileResolvePath,
  dmConversationName, dmCanChat, dmNeedsAnswer, dmCanSendDraft, dmUnreadTotal,
  dmFindConversation, normalizeDmConversations, DM_DRAFT_MAX,
  dmDraftPath, normalizeDmDraft, dmDraftSaveDecision,
  dmMessageAttachment, dmAttachmentKindForMime, dmAttachmentKindForUrl,
  dmAttachmentNameForUrl, dmWorkLabel, dmFilterMessages, dmConversationMatches,
  dmThreadHighlightSegments,
  COMMUNITY_SUPERFANS_PATH, COMMUNITY_SENTIMENT_PATH,
  GENERATE_COMMUNITY_POST_PATH, COMMUNITY_POST_PLATFORMS_PATH, POSTS_PATH,
  REACT_PATH, reactRemovePath, postRepliesPath, postReplyPath,
  FEED_VIEWS, feedPagePath, feedHasMore, mergeFeedPage,
  DROPS_PATH, normalizeDrops,
  SAVES_PATH, repostPath, saveRemovePath, postDeletePath, pollVotePath,
  pollTotalVotes, pollPercent, pollVotable, feedVerbAllowed, postIsOwn,
  MY_PROFILE_PATH,
  type FeedView, type DropItem,
  postReplyDraftPath, normalizePostReplyDraft, postReplyDraftSaveDecision,
  COMMENT_REPLIES_PATH, COMMENT_REPLIES_META_PATH,
  REPLY_DRAFT_TONES, replyDraftBatch,
  commentsBatchFromPosts, pinTopicReady, postBodyReady,
  BOARD_REACTIONS, nextReactionState, fullThread,
  threadCountOf, threadToggleLabel, mergeThreadChildren, threadReplyAllowed,
  threadReactAllowed,
  type ThreadLoadState,
  type DmConversation, type DmMessage, type DmAttachment, type Superfan,
  type SentimentReport, type CommunityPostVariant, type ReplyDraftTone,
} from "@/lib/world/social-desk";

/* ─── The Social Desk (NATIVE-PLAN §3.4) ─────────────────────────────
   Two instruments, one pattern:
   - PostOfficeDesk (Throne Hall): a writing desk — conversation
     list, open thread, in-world composer, new conversation by
     name, request actions — all on the messages page's own rails.
   - CommunityHallBoard (Courtyard): a notice board — recent posts
     as readable cards with in-world react + full nested threads,
     superfan/sentiment highlights run against the board's own
     posts, and a Pin-a-post composer on the generate-community-
     post family. (Wave II, #82: the admin moderation bench now
     docks at the board's foot — SocialWave2's ModerationBench,
     admin-only and fail-closed, on the admin page's own rails.)
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
  if (!res.ok) throw new Error(apiErrorMessage(data, `Request failed (${res.status})`));
  return data as T;
}

/* Catalog key-maps for the seam's label tables (unit 43): the seam
   word stays the fallback — a type/view/reaction/tone with no
   catalog key renders its English seam label exactly as before. */
const WORK_KEYS: Record<string, string> = {
  audio: "worldSocialDesk.dmWorkBeat",
  video: "worldSocialDesk.dmWorkClip",
  image: "worldSocialDesk.dmWorkArtwork",
};
function workLabel(type: DmAttachment["type"], t: (key: string) => string): string {
  const key = WORK_KEYS[type];
  return key ? t(key) : dmWorkLabel(type);
}
const VIEW_KEYS: Record<string, string> = {
  chrono: "worldSocialDesk.hallViewLatest",
  foryou: "worldSocialDesk.hallViewForYou",
  drops: "worldSocialDesk.hallViewDrops",
};
const REACTION_KEYS: Record<string, string> = {
  like: "worldSocialDesk.hallReactionLike",
  fire: "worldSocialDesk.hallReactionFire",
};
function reactionLabel(r: { emoji: string; label: string }, t: (key: string) => string): string {
  const key = REACTION_KEYS[r.emoji];
  return key ? t(key) : r.label;
}
function viewLabel(v: { key: string; label: string }, t: (key: string) => string): string {
  const key = VIEW_KEYS[v.key];
  return key ? t(key) : v.label;
}
const TONE_KEYS: Record<ReplyDraftTone, string> = {
  hype: "worldSocialDesk.hallToneHype",
  grateful: "worldSocialDesk.hallToneGrateful",
  playful: "worldSocialDesk.hallTonePlayful",
  professional: "worldSocialDesk.hallToneProfessional",
};

const chipBtn = (isLight: boolean) =>
  `inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition bdv-touch-target ${
    isLight
      ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]"
      : "border-white/15 text-white/75 hover:text-white"
  }`;
const goldBtn =
  "inline-flex items-center gap-1.5 rounded-full bg-[#d4af37] px-3.5 py-1.5 text-xs font-bold text-black transition hover:scale-105 disabled:opacity-50 bdv-touch-target";
const inputCls = (isLight: boolean) =>
  `w-full rounded-xl border px-3 py-2 text-sm outline-none transition focus:border-[#d4af37] bdv-touch-target ${
    isLight
      ? "border-[#C9A84C]/40 bg-white/60 text-[#2a1e07] placeholder:text-[#6B5B36]/60"
      : "border-white/10 bg-white/5 text-white placeholder:text-white/35"
  }`;

/* ─── Search hits, lit in place (2.17) ───────────────────────────────
   Thread search lights its matches where they sit — in the words
   and in the work's title — with a pale-gold mark whose black text
   reads on every bubble (my gold one, theirs dark or cream). */
const DM_HIT_CLASS = "rounded-[3px] bg-[#ffe98a] text-black";

function DmLitText({ text, query }: { text: string; query: string }) {
  return (
    <>
      {dmThreadHighlightSegments(text, query).map((seg, i) =>
        seg.hit ? (
          <mark key={i} className={DM_HIT_CLASS} data-testid="world-dm-thread-hit">{seg.text}</mark>
        ) : (
          <span key={i}>{seg.text}</span>
        ),
      )}
    </>
  );
}

/* ─── The hand-off card (owner addendum, Oct 17) ─────────────────────
   A DM attachment is a creator handing their work to another creator —
   it renders as the work itself: titled, framed, and playable in-world
   (a beat you can press play on, a cover you can see, a clip you can
   watch), never as a bare file chip. */
function DmWorkCard({ att, isLight, mine, highlightQuery }: {
  att: DmAttachment; isLight: boolean; mine: boolean; highlightQuery?: string;
}) {
  const { t } = useTranslation();
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
            {highlightQuery?.trim()
              ? <DmLitText text={att.name} query={highlightQuery} />
              : att.name}
          </span>
          <span className={`block text-[10px] font-bold uppercase tracking-[0.14em] ${isLight ? "text-[#7A5A12]" : mine ? "text-black/60" : "text-[#e8c86a]/80"}`}>
            {t("worldSocialDesk.dmHandOff", { work: workLabel(att.type, t) })}
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
  const { t } = useTranslation();
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

  /* ── Reply drafts (STACK-20 #15) ──────────────────────────────────
     The composer's words rest on the server, one draft per thread:
     typed words save (debounced), switching threads flushes the
     outgoing words to THEIR thread and restores the incoming
     thread's saved words, and closing the panel flushes on unmount.
     draftTextRef mirrors the latest text, draftThreadRef the thread
     it belongs to, savedTextRef the last text the server confirmed
     for that thread — the flush and the debounce both consult
     dmDraftSaveDecision against it, so the desk never saves what the
     server already holds and never resurrects cleared words. */
  const draftTextRef = useRef("");
  const draftThreadRef = useRef<string | null>(null);
  const savedTextRef = useRef("");
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const persistDraft = useCallback(async (convId: string, text: string) => {
    try {
      await apiJson(authHeaders, dmDraftPath(convId), { method: "PUT", body: { body: text } });
      if (draftThreadRef.current === convId && draftTextRef.current === text) {
        savedTextRef.current = text.trim().length === 0 ? "" : text;
      }
    } catch { /* the words stay on screen; the next change, switch or close retries */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Debounced save. Declared BEFORE the thread-switch effect so a
     switch commit never schedules the old thread's words into the
     new thread: at that point draftThreadRef still names the old
     thread and this effect stands down. The timer re-validates at
     fire time for the same reason. */
  useEffect(() => {
    if (!activeId || draftThreadRef.current !== activeId) return;
    draftTextRef.current = draft;
    if (dmDraftSaveDecision(draft, savedTextRef.current) === "skip") return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      if (draftThreadRef.current === activeId && draftTextRef.current === draft) {
        void persistDraft(activeId, draft);
      }
    }, 900);
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, [draft, activeId, persistDraft]);

  /* Thread switch: flush the outgoing thread, restore the incoming
     thread's saved draft. Also covers first open and closing a
     thread (activeId → null just flushes). */
  useEffect(() => {
    const prevId = draftThreadRef.current;
    if (prevId && prevId !== activeId) {
      const prevText = draftTextRef.current;
      if (dmDraftSaveDecision(prevText, savedTextRef.current) !== "skip") {
        void persistDraft(prevId, prevText);
      }
    }
    draftThreadRef.current = activeId;
    draftTextRef.current = "";
    savedTextRef.current = "";
    setDraft("");
    if (!activeId) return;
    let cancelled = false;
    void (async () => {
      try {
        const d = await apiJson<unknown>(authHeaders, dmDraftPath(activeId));
        const saved = normalizeDmDraft(d);
        if (cancelled || !saved) return;
        /* Restore only into a composer the walker hasn't already
           started typing in since this thread opened. */
        if (draftThreadRef.current === activeId && draftTextRef.current === "") {
          draftTextRef.current = saved.body;
          savedTextRef.current = saved.body;
          setDraft(saved.body);
        }
      } catch { /* no restored draft — the composer simply starts empty */ }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, persistDraft]);

  /* Panel close: the desk unmounts — flush whatever is unsaved. */
  useEffect(() => {
    return () => {
      const id = draftThreadRef.current;
      if (id && dmDraftSaveDecision(draftTextRef.current, savedTextRef.current) !== "skip") {
        void persistDraft(id, draftTextRef.current);
      }
    };
  }, [persistDraft]);

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
      setNotice(plainErrorText(e, t("worldSocialDesk.dmCreatorNotFound")));
    } finally {
      setStarting(false);
    }
  }

  async function uploadFile(file: File) {
    const kind = dmAttachmentKindForMime(file.type);
    if (!kind) {
      setNotice(t("worldSocialDesk.dmUploadKindError"));
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
        throw new Error(apiErrorMessage(data, t("worldSocialDesk.dmUploadError")));
      }
      /* Send the permanent ref, never the signed URL — the server
         persists the ref and mints fresh URLs on every read. */
      setPendingAtt({ url: data.ref, type: data.type, name: data.name ?? file.name });
    } catch (e) {
      setNotice(plainErrorText(e, t("worldSocialDesk.dmUploadError")));
    } finally {
      setUploading(false);
    }
  }

  function attachByUrl() {
    const url = linkUrl.trim();
    if (!url) return;
    const kind = dmAttachmentKindForUrl(url);
    if (!kind) {
      setNotice(t("worldSocialDesk.dmLinkKindError"));
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
      /* The send cleared my saved draft server-side (STACK-20 #15);
         the local markers agree, so the debounce never re-saves the
         words that just landed in the thread. */
      draftTextRef.current = "";
      savedTextRef.current = "";
      setPendingAtt(null);
      await loadThread(activeId);
      await loadConvs();
    } catch (e) {
      setNotice(plainErrorText(e, t("worldSocialDesk.dmSendError")));
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
      setNotice(plainErrorText(e, t("worldSocialDesk.dmRequestActionError")));
    }
  }

  if (listState === "loading") {
    return <NativeLoadingState isLight={isLight} message={t("worldSocialDesk.dmLoadingDesk")} />;
  }
  if (listState === "failed") {
    return (
      <NativeErrorState
        isLight={isLight}
        title={t("worldSocialDesk.dmDeskErrorTitle")}
        message={t("worldSocialDesk.dmDeskErrorMessage")}
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
          className={`rounded-full px-3.5 py-1.5 text-xs font-bold transition bdv-touch-target ${
            tab === "inbox" ? "bg-[#d4af37] text-black" : chipBtn(isLight)
          }`}
        >
          {t("worldSocialDesk.dmTabInbox")}{dmUnreadTotal(inbox) > 0 ? ` (${dmUnreadTotal(inbox)})` : ""}
        </button>
        <button
          type="button"
          data-testid="world-dm-tab-requests"
          onClick={() => setTab("requests")}
          className={`rounded-full px-3.5 py-1.5 text-xs font-bold transition bdv-touch-target ${
            tab === "requests" ? "bg-[#d4af37] text-black" : chipBtn(isLight)
          }`}
        >
          {t("worldSocialDesk.dmTabRequests")}{requests.length > 0 ? ` (${requests.length})` : ""}
        </button>
        <button
          type="button"
          data-testid="world-dm-new"
          onClick={() => setShowNew((v) => !v)}
          aria-expanded={showNew}
          className={`${chipBtn(isLight)} ml-auto`}
        >
          <Plus className="h-3.5 w-3.5" /> {t("worldSocialDesk.dmNewMessage")}
        </button>
      </div>

      {showNew && (
        <div className="flex gap-2">
          <input
            value={newSlug}
            onChange={(e) => setNewSlug(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void startBySlug()}
            placeholder={t("worldSocialDesk.dmNewSlugPlaceholder")}
            aria-label={t("worldSocialDesk.dmNewSlugPlaceholder")}
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
            {starting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} {t("worldSocialDesk.dmStartButton")}
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
          placeholder={t("worldSocialDesk.dmSearchConversationsPlaceholder")}
          aria-label={t("worldSocialDesk.dmSearchConversationsAria")}
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
                  ? t("worldSocialDesk.dmEmptySearch")
                  : tab === "inbox" ? t("worldSocialDesk.dmEmptyInbox") : t("worldSocialDesk.dmEmptyRequests")
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
                          ? t("worldSocialDesk.dmWorkPreview", { work: workLabel((c.last_message.attachment_type ?? "image") as DmAttachment["type"], t), name: c.last_message.attachment_name })
                          : t("worldSocialDesk.dmNoMessagesYet")}
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
              message={t("worldSocialDesk.dmPickConversation")}
              detail={t("worldSocialDesk.dmPickConversationDetail")}
            />
          ) : (
            <div className="flex min-h-[220px] flex-col">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className={`text-sm font-black ${isLight ? "text-[#2a1e07]" : "text-white"}`}>
                  {dmConversationName(active)}
                </span>
                <span className={`text-[11px] font-semibold ${muted}`}>
                  {threadStatus === "request" ? t("worldSocialDesk.dmStatusRequest") : t("worldSocialDesk.dmTabInbox")}
                </span>
                <button
                  type="button"
                  data-testid="world-dm-block"
                  onClick={() => void requestAction("block")}
                  className={`ml-auto inline-flex items-center gap-1 text-[11px] font-bold bdv-touch-target ${isLight ? "text-red-900/70 hover:text-red-900" : "text-white/40 hover:text-red-300"}`}
                  title={t("worldSocialDesk.dmBlockTitle")}
                >
                  <Ban className="h-3.5 w-3.5" /> {t("worldSocialDesk.dmBlockButton")}
                </button>
              </div>

              <div className="relative mb-2">
                <Search className={`pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 ${muted}`} />
                <input
                  value={threadQuery}
                  onChange={(e) => setThreadQuery(e.target.value)}
                  placeholder={t("worldSocialDesk.dmThreadSearchPlaceholder")}
                  aria-label={t("worldSocialDesk.dmThreadSearchAria")}
                  className={`${inputCls(isLight)} pl-9`}
                  data-testid="world-dm-thread-search"
                />
              </div>

              {threadQuery.trim() && threadState === "ready" && (
                <p className={`mb-2 text-[11px] font-semibold ${muted}`} data-testid="world-dm-thread-search-scope">
                  {t("worldSocialDesk.dmSearchScopeLine", { visible: visibleMsgs.length, total: msgs.length })}
                </p>
              )}

              {needsAnswer && (
                <div
                  className={`mb-2 flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 ${
                    isLight ? "border-[#C9A84C]/40 bg-[#d4af37]/10" : "border-[#d4af37]/25 bg-[#d4af37]/5"
                  }`}
                  data-testid="world-dm-request-rail"
                >
                  <span className={`text-xs font-semibold ${muted}`}>{t("worldSocialDesk.dmRequestPrompt")}</span>
                  <button type="button" data-testid="world-dm-accept" onClick={() => void requestAction("accept")} className={goldBtn}>
                    <Check className="h-3.5 w-3.5" /> {t("collabs.accept")}
                  </button>
                  <button type="button" data-testid="world-dm-decline" onClick={() => void requestAction("decline")} className={chipBtn(isLight)}>
                    <X className="h-3.5 w-3.5" /> {t("collabs.decline")}
                  </button>
                </div>
              )}

              <div className="max-h-[30vh] flex-1 space-y-2 overflow-y-auto pr-1">
                {threadState === "loading" ? (
                  <NativeLoadingState isLight={isLight} message={t("worldSocialDesk.dmThreadLoading")} />
                ) : threadState === "failed" ? (
                  <NativeErrorState
                    isLight={isLight}
                    title={t("worldSocialDesk.dmThreadErrorTitle")}
                    message={t("worldSocialDesk.dmThreadErrorMessage")}
                    onRetry={() => activeId && void loadThread(activeId)}
                  />
                ) : msgs.length === 0 ? (
                  <NativeEmptyState isLight={isLight} message={t("worldSocialDesk.dmThreadEmpty")} />
                ) : visibleMsgs.length === 0 ? (
                  <NativeEmptyState isLight={isLight} message={t("worldSocialDesk.dmThreadSearchEmpty")} />
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
                          {att && <DmWorkCard att={att} isLight={isLight} mine={mine} highlightQuery={threadQuery} />}
                          {m.body && (
                            <p className={`whitespace-pre-wrap text-sm ${att ? "mt-2" : ""}`}>
                              {threadQuery.trim() ? (
                                dmThreadHighlightSegments(m.body, threadQuery).map((seg, i) =>
                                  seg.hit ? (
                                    <mark key={i} className={DM_HIT_CLASS} data-testid="world-dm-thread-hit">
                                      <KingTokenText body={seg.text} theme={isLight ? "light" : "dark"} />
                                    </mark>
                                  ) : (
                                    <KingTokenText key={i} body={seg.text} theme={isLight ? "light" : "dark"} />
                                  ),
                                )
                              ) : (
                                <KingTokenText body={m.body} theme={isLight ? "light" : "dark"} />
                              )}
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
                    {t("worldSocialDesk.dmPendingAttachment", { work: workLabel(pendingAtt.type, t), name: pendingAtt.name })}
                  </span>
                  <button
                    type="button"
                    onClick={() => setPendingAtt(null)}
                    className={`ml-auto inline-flex items-center gap-1 text-[11px] font-bold bdv-touch-target ${muted}`}
                    data-testid="world-dm-attachment-remove"
                  >
                    <X className="h-3.5 w-3.5" /> {t("worldSocialDesk.dmRemoveAttachment")}
                  </button>
                </div>
              )}

              {canChat && showLink && (
                <div className="mt-2 flex gap-2">
                  <input
                    value={linkUrl}
                    onChange={(e) => setLinkUrl(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && attachByUrl()}
                    placeholder={t("worldSocialDesk.dmAttachUrlPlaceholder")}
                    aria-label={t("worldSocialDesk.dmAttachUrlAria")}
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
                    {t("worldSocialDesk.dmAttachButton")}
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
                    title={t("worldSocialDesk.dmAttachTitle")}
                  >
                    {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Paperclip className="h-3.5 w-3.5" />}
                    {uploading ? t("worldSocialDesk.dmUploadingToDesk") : t("worldSocialDesk.dmAttachWork")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowLink((v) => !v)}
                    className={chipBtn(isLight)}
                    data-testid="world-dm-attach-link"
                    aria-label={t("worldSocialDesk.dmAttachLinkTitle")}
                    aria-expanded={showLink}
                    title={t("worldSocialDesk.dmAttachLinkTitle")}
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
                    placeholder={t("worldSocialDesk.dmDraftPlaceholder")}
                    aria-label={t("worldSocialDesk.dmDraftAria")}
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
                    {t("worldSocialDesk.dmSendButton")}
                  </button>
                </div>
              ) : threadStatus === "request" && active.requested_by_me ? (
                <p className={`mt-2 text-center text-xs ${muted}`}>
                  {t("worldSocialDesk.dmRequestSentNote")}
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

/* One reply in a thread (2.18): the site's data nests by reply
   chains — every reply is itself a post with its own server
   reply_count, and its children ride the same replies rail — so a
   reply renders as a node that opens its OWN children in place,
   under the same laws as the thread root: the count is the server's
   plus this session's landed answers, and a failed child load is a
   failed state with a retry, never an empty branch. Members can
   answer and react to any node in place — a reply IS a post row,
   so its reactions ride the card's own rail and its counts/viewer
   state arrive on the replies DTO; guests read only. */
function ThreadReplyNode({
  reply, depth, isLight, isGuest, authHeaders,
}: {
  reply: FeedPost;
  depth: number;
  isLight: boolean;
  isGuest: boolean;
  authHeaders: () => Promise<Record<string, string>>;
}) {
  const { t } = useTranslation();
  const [children, setChildren] = useState<FeedPost[] | null>(null);
  const [childState, setChildState] = useState<ThreadLoadState>("idle");
  const [open, setOpen] = useState(false);
  const [landed, setLanded] = useState<FeedPost[]>([]);
  const [composerOpen, setComposerOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const count = threadCountOf(reply.reply_count, landed.length);
  const canReply = threadReplyAllowed(isGuest);
  const canReact = threadReactAllowed(isGuest);
  /* Reaction state is the server's: the replies DTO enriches every
     row with reaction_counts + viewer_emoji, exactly like the card. */
  const [emoji, setEmoji] = useState<string | null>(reply.viewer_emoji);
  const [counts, setCounts] = useState<Record<string, number>>(reply.reaction_counts ?? {});
  const [reactNote, setReactNote] = useState<string | null>(null);

  /* Same optimistic shape as the card's react(): apply the seam's
     next state, confirm against /api/react (POST to set/swap,
     DELETE to remove), and on failure roll back AND say so — a
     reaction that didn't land never stands. The target is the
     reply's own id under target_kind "post": a reply is a post row,
     so the rail stores and counts it identically. */
  async function react(next: string) {
    const prev = { emoji, counts };
    const state = nextReactionState(emoji, counts, next);
    setEmoji(state.emoji);
    setCounts(state.counts);
    setReactNote(null);
    try {
      if (state.emoji === null) {
        const res = await fetch(reactRemovePath(reply.id), {
          method: "DELETE",
          headers: await authHeaders(),
        });
        if (!res.ok) throw new Error("react");
      } else {
        await apiJson(authHeaders, REACT_PATH, {
          method: "POST",
          body: { target_kind: "post", target_id: reply.id, emoji: next },
        });
      }
    } catch {
      setEmoji(prev.emoji);
      setCounts(prev.counts);
      setReactNote(t("worldSocialDesk.hallReactionFailed"));
    }
  }

  async function loadChildren() {
    setChildState("loading");
    try {
      const d = await apiJson<{ replies: FeedPost[] }>(authHeaders, postRepliesPath(reply.id));
      const fetched = Array.isArray(d.replies) ? d.replies : [];
      setChildren(mergeThreadChildren(fetched, landed));
      setChildState("ready");
    } catch {
      setChildState("failed");
    }
  }

  function toggleChildren() {
    if (childState === "loading") return;
    if (childState === "ready") {
      setOpen((v) => !v);
      return;
    }
    setOpen(true);
    void loadChildren();
  }

  async function sendNodeReply() {
    if (sending || !postBodyReady(draft)) return;
    setSending(true);
    setNote(null);
    try {
      const d = await apiJson<{ post: FeedPost }>(authHeaders, postReplyPath(reply.id), {
        method: "POST", body: { body: draft.trim() },
      });
      if (d.post) {
        setLanded((prev) => [...prev, d.post]);
        setChildren((prev) => (prev === null ? prev : mergeThreadChildren(prev, [d.post])));
        if (childState === "failed") void loadChildren();
        setOpen(true);
      }
      setDraft("");
      setComposerOpen(false);
    } catch (e) {
      setNote(plainErrorText(e, t("worldSocialDesk.hallReplyFailed")));
    } finally {
      setSending(false);
    }
  }

  return (
    <div data-testid="world-community-reply-node">
      <p className={`rounded-lg px-2.5 py-1.5 text-xs ${isLight ? "bg-[#C9A84C]/10 text-[#2a1e07]" : "bg-white/5 text-white/75"}`}>
        <span className="font-bold">{reply.author?.display_name ?? t("worldSocialDesk.hallCreatorFallback")}:</span>{" "}
        <KingTokenText body={reply.body} theme={isLight ? "light" : "dark"} />
      </p>
      <div className="mt-1 flex flex-wrap items-center gap-1.5 pl-1">
        {BOARD_REACTIONS.map((r) =>
          canReact ? (
            <button
              key={r.emoji}
              type="button"
              data-testid={`world-community-node-react-${r.emoji}`}
              onClick={() => void react(r.emoji)}
              aria-pressed={emoji === r.emoji}
              className={`${chipBtn(isLight)} ${emoji === r.emoji ? "border-[#d4af37] bg-[#d4af37]/15" : ""}`}
            >
              <ReactionSticker reaction={r.emoji} className="h-[18px] w-[18px] object-contain" />
              {reactionLabel(r, t)}
              {(counts[r.emoji] ?? 0) > 0 ? ` ${counts[r.emoji]}` : ""}
            </button>
          ) : (counts[r.emoji] ?? 0) > 0 ? (
            /* Guests look, never tap: the counts render as plain
               chips — the rail is requireAuth regardless. */
            <span
              key={r.emoji}
              data-testid={`world-community-node-react-count-${r.emoji}`}
              className={chipBtn(isLight)}
            >
              <ReactionSticker reaction={r.emoji} className="h-[18px] w-[18px] object-contain" />
              {reactionLabel(r, t)} {counts[r.emoji]}
            </span>
          ) : null,
        )}
        {(count > 0 || childState !== "idle") && (
          <button
            type="button"
            onClick={() => toggleChildren()}
            className={chipBtn(isLight)}
            data-testid="world-community-node-toggle"
          >
            <MessageCircle className="h-3 w-3" />
            {threadToggleLabel(count, open && childState === "ready", {
              replies: t("worldSocialDesk.hallThreadReplies"),
              hide: t("worldSocialDesk.hallThreadHide"),
              show: t("worldSocialDesk.hallThreadShow"),
              replyOne: t("worldSocialDesk.hallThreadReplyOne"),
              replyMany: t("worldSocialDesk.hallThreadReplyMany"),
            })}
          </button>
        )}
        {canReply && (
          <button
            type="button"
            onClick={() => setComposerOpen((v) => !v)}
            className={chipBtn(isLight)}
            data-testid="world-community-node-reply-open" aria-expanded={composerOpen}
          >
            <Send className="h-3 w-3" /> {t("worldSocialDesk.hallReplyButton")}
          </button>
        )}
      </div>
      {reactNote && (
        <p
          className={`mt-1.5 pl-1 text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}
          data-testid="world-community-node-react-note"
        >
          {reactNote}
        </p>
      )}
      {composerOpen && canReply && (
        <div className="mt-1.5 pl-1">
          <div className="flex gap-2">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void sendNodeReply()}
              placeholder={t("worldSocialDesk.hallAnswerPlaceholder")}
              aria-label={t("worldSocialDesk.hallAnswerAria")}
              maxLength={500}
              className={inputCls(isLight)}
              data-testid="world-community-node-reply-draft"
            />
            <button
              type="button"
              onClick={() => void sendNodeReply()}
              disabled={sending || !postBodyReady(draft)}
              className={goldBtn}
              data-testid="world-community-node-reply-send"
            >
              {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              {t("worldSocialDesk.hallReplyButton")}
            </button>
          </div>
          {note && (
            <p className={`mt-1.5 text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>{note}</p>
          )}
        </div>
      )}
      {open && (
        <div
          className={`mt-1.5 space-y-1.5 ${depth < 4 ? "ml-3 border-l pl-3" : ""} ${
            isLight ? "border-[#C9A84C]/40" : "border-white/10"
          }`}
        >
          {childState === "loading" ? (
            <NativeLoadingState isLight={isLight} message={t("worldSocialDesk.hallThreadLoadingReplies")} />
          ) : childState === "failed" ? (
            <div data-testid="world-community-node-failed">
              <NativeErrorState
                isLight={isLight}
                title={t("worldSocialDesk.hallNodeErrorTitle")}
                message={t("worldSocialDesk.dmThreadErrorMessage")}
                onRetry={() => void loadChildren()}
              />
            </div>
          ) : childState === "ready" && children !== null && children.length === 0 ? (
            <p className={`text-xs ${muted}`}>
              {count === 0
                ? t("worldSocialDesk.hallBranchEmptyZero")
                : t("worldSocialDesk.hallBranchNotShowing")}
            </p>
          ) : childState === "ready" && children !== null ? (
            fullThread(children).map((r) => (
              <ThreadReplyNode
                key={r.id}
                reply={r}
                depth={depth + 1}
                isLight={isLight}
                isGuest={isGuest}
                authHeaders={authHeaders}
              />
            ))
          ) : null}
        </div>
      )}
    </div>
  );
}

function NoticePostCard({
  post, isLight, isGuest, authHeaders, myProfileId, onDeleted, onReposted,
}: {
  post: FeedPost;
  isLight: boolean;
  isGuest: boolean;
  authHeaders: () => Promise<Record<string, string>>;
  myProfileId: string | null;
  onDeleted: (id: string) => void;
  onReposted: () => void;
}) {
  const { t } = useTranslation();
  const [emoji, setEmoji] = useState<string | null>(post.viewer_emoji);
  const [counts, setCounts] = useState<Record<string, number>>(post.reaction_counts ?? {});
  const [replies, setReplies] = useState<FeedPost[] | null>(null);
  const [threadState, setThreadState] = useState<ThreadLoadState>("idle");
  const [repliesOpen, setRepliesOpen] = useState(false);
  const [landedRoot, setLandedRoot] = useState<FeedPost[]>([]);
  /* The stated count is the server's count plus this session's
     landed replies — never a client-side guess (seam: threadCountOf). */
  const replyCount = threadCountOf(post.reply_count, landedRoot.length);
  const [replyDraft, setReplyDraft] = useState("");
  const [replyTone, setReplyTone] = useState<ReplyDraftTone>("hype");
  const [replying, setReplying] = useState(false);
  const [replyNote, setReplyNote] = useState<string | null>(null);
  /* ── The reply-drafts bench (STACK-20 R2 #8, 2.19) ──────────────
     The composer's words rest on the server, one draft per member
     per post, in the tone they were drafted in: typed words save
     (debounced), opening the thread restores the saved words, and a
     landed reply retires the row server-side — the local markers
     below agree with that, so nothing resurrects. draftState is the
     honest save line: it only ever says "saved" for words the server
     confirmed holding; a failed save keeps the words in the composer
     and says so. */
  const [draftState, setDraftState] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const savedReplyRef = useRef<{ body: string; tone: ReplyDraftTone } | null>(null);
  const replyWordsRef = useRef<{ text: string; tone: ReplyDraftTone }>({ text: "", tone: "hype" });
  const replySaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";

  const persistReplyDraft = useCallback(async (text: string, tone: ReplyDraftTone) => {
    const decision = postReplyDraftSaveDecision(text, tone, savedReplyRef.current);
    if (decision === "skip") return;
    setDraftState("saving");
    try {
      if (decision === "clear") {
        await apiJson(authHeaders, postReplyDraftPath(post.id), { method: "PUT", body: { body: "" } });
        savedReplyRef.current = null;
        /* Nothing is saved now — the bench is empty, so the line
           retires instead of claiming a save. */
        if (replyWordsRef.current.text.trim().length === 0) setDraftState("idle");
      } else {
        const d = await apiJson<unknown>(authHeaders, postReplyDraftPath(post.id), {
          method: "PUT", body: { body: text, tone },
        });
        const saved = normalizePostReplyDraft(d);
        savedReplyRef.current = saved ? { body: saved.body, tone: saved.tone } : { body: text, tone };
        /* Claim "saved" only while the composer still holds what the
           server just confirmed — newer keystrokes own the state line. */
        if (replyWordsRef.current.text === text && replyWordsRef.current.tone === tone) {
          setDraftState("saved");
        }
      }
    } catch {
      /* Never fake a save, never lose the words: they stay in the
         composer, the line says the save failed, and the next change
         (or the close/unmount flush) retries. */
      setDraftState("failed");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [post.id]);

  /* Restore the saved draft when the thread first opens — into a
     composer the walker hasn't already started typing in. */
  const restoreReplyDraft = useCallback(async () => {
    try {
      const d = await apiJson<unknown>(authHeaders, postReplyDraftPath(post.id));
      const saved = normalizePostReplyDraft(d);
      if (!saved) return;
      savedReplyRef.current = { body: saved.body, tone: saved.tone };
      if (replyWordsRef.current.text === "") {
        replyWordsRef.current = { text: saved.body, tone: saved.tone };
        setReplyDraft(saved.body);
        setReplyTone(saved.tone);
        setDraftState("saved");
      }
    } catch { /* no restored draft — the composer simply starts empty */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [post.id]);

  /* Debounced save — the timer re-validates at fire time so a send
     or a restore in between is never overwritten by stale words. */
  useEffect(() => {
    if (isGuest || !repliesOpen) return;
    replyWordsRef.current = { text: replyDraft, tone: replyTone };
    if (postReplyDraftSaveDecision(replyDraft, replyTone, savedReplyRef.current) === "skip") return;
    if (replySaveTimerRef.current) clearTimeout(replySaveTimerRef.current);
    replySaveTimerRef.current = setTimeout(() => {
      const cur = replyWordsRef.current;
      if (cur.text === replyDraft && cur.tone === replyTone) {
        void persistReplyDraft(cur.text, cur.tone);
      }
    }, 900);
    return () => { if (replySaveTimerRef.current) clearTimeout(replySaveTimerRef.current); };
  }, [replyDraft, replyTone, repliesOpen, isGuest, persistReplyDraft]);

  /* Card unmount (the Hall closes, the board refreshes): flush
     whatever is unsaved, the Post Office desk's own habit. */
  useEffect(() => {
    return () => {
      const cur = replyWordsRef.current;
      if (postReplyDraftSaveDecision(cur.text, cur.tone, savedReplyRef.current) !== "skip") {
        void persistReplyDraft(cur.text, cur.tone);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  /* ── Feed verbs (#80) — PostCard's exact rails ──────────────────
     Repost, save/bookmark, delete-own and poll vote, in-world.
     Optimistic where the card is optimistic (save), confirmed where
     the card confirms (repost lands once; a failed verb says so and
     never stands). Delete is offered only on the walker's own post
     (postIsOwn) and still rides the author-only server gate. */
  const [saved, setSaved] = useState(post.viewer_saved);
  const [reposted, setReposted] = useState(false);
  const [repostCount, setRepostCount] = useState(post.repost_count);
  const [poll, setPoll] = useState(post.poll);
  const [voting, setVoting] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [verbNote, setVerbNote] = useState<string | null>(null);
  const canVerb = feedVerbAllowed(isGuest);
  const own = postIsOwn(post, myProfileId);
  const removed = !!post.moderation_removed;

  async function toggleSave() {
    const next = !saved;
    setSaved(next);
    setVerbNote(null);
    try {
      if (next) {
        await apiJson(authHeaders, SAVES_PATH, {
          method: "POST", body: { kind: "post", target_id: post.id },
        });
      } else {
        const res = await fetch(saveRemovePath(post.id), {
          method: "DELETE", headers: await authHeaders(),
        });
        if (!res.ok) throw new Error("unsave");
      }
    } catch {
      setSaved(!next);
      setVerbNote(t("worldSocialDesk.hallSaveDidntLand"));
    }
  }

  async function doRepost() {
    if (reposted) return;
    setVerbNote(null);
    try {
      await apiJson(authHeaders, repostPath(post.id), { method: "POST" });
      setReposted(true);
      setRepostCount((n) => n + 1);
      onReposted();
    } catch {
      setVerbNote(t("worldSocialDesk.hallRepostDidntLand"));
    }
  }

  async function vote(optionId: string) {
    if (voting || !pollVotable(poll, isGuest)) return;
    setVoting(true);
    setVerbNote(null);
    try {
      const d = await apiJson<{ poll: NonNullable<FeedPost["poll"]> }>(
        authHeaders, pollVotePath(post.id),
        { method: "POST", body: { option_id: optionId } },
      );
      if (d.poll) setPoll(d.poll);
    } catch {
      setVerbNote(t("worldSocialDesk.hallVoteDidntLand"));
    } finally {
      setVoting(false);
    }
  }

  async function doDelete() {
    if (deleting) return;
    setDeleting(true);
    setVerbNote(null);
    try {
      const res = await fetch(postDeletePath(post.id), {
        method: "DELETE", headers: await authHeaders(),
      });
      if (!res.ok) throw new Error("delete");
      onDeleted(post.id);
    } catch {
      setVerbNote(t("worldSocialDesk.hallDeleteDidntLand"));
      setConfirmingDelete(false);
    } finally {
      setDeleting(false);
    }
  }

  /* Load (or reload) the thread. A failure lands in the failed
     state — the thread renders a failure with a retry, NEVER the
     "no replies yet" copy: an unloaded thread is not an empty one. */
  async function loadThread() {
    setThreadState("loading");
    try {
      const d = await apiJson<{ replies: FeedPost[] }>(authHeaders, postRepliesPath(post.id));
      const fetched = Array.isArray(d.replies) ? d.replies : [];
      setReplies(mergeThreadChildren(fetched, landedRoot));
      setThreadState("ready");
    } catch {
      setThreadState("failed");
    }
  }

  function toggleReplies() {
    if (threadState === "loading") return;
    if (threadState === "ready") {
      setRepliesOpen((v) => !v);
      return;
    }
    setRepliesOpen(true);
    void loadThread();
    /* First open also restores the walker's saved reply draft
       (STACK-20 R2 #8) — the restore fills only an untouched
       composer, so re-opening never overwrites live words. */
    if (!isGuest) void restoreReplyDraft();
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
        setLandedRoot((prev) => [...prev, d.post]);
        setReplies((prev) => (prev === null ? prev : mergeThreadChildren(prev, [d.post])));
        /* If the thread itself failed to load, the landed reply is
           the reason to fetch again — the refetch carries it too,
           and the merge dedupes it against landedRoot. */
        if (threadState === "failed") void loadThread();
      }
      setReplyDraft("");
      /* The reply landed — the server retired the saved draft in the
         same request; the local markers agree so the words can never
         resurrect into the composer. (On a FAILED send nothing here
         runs: the text and its draft stay exactly as they were.) */
      savedReplyRef.current = null;
      replyWordsRef.current = { text: "", tone: replyTone };
      setDraftState("idle");
    } catch (e) {
      setReplyNote(plainErrorText(e, t("worldSocialDesk.hallReplyFailed")));
    } finally {
      setReplying(false);
    }
  }

  return (
    <NativeCard isLight={isLight}>
      <div data-testid="world-community-post">
        <p className="flex flex-wrap items-center gap-2">
          <span className={`text-sm font-bold ${isLight ? "text-[#2a1e07]" : "text-white"}`}>
            {post.author?.display_name ?? t("worldSocialDesk.hallCreatorFallback")}
          </span>
          {post.author?.slug && <span className={`text-xs ${muted}`}>@{post.author.slug}</span>}
        </p>
        {post.body && (
          <p className={`mt-1 whitespace-pre-wrap text-sm ${isLight ? "text-[#2a1e07]" : "text-white/85"}`}>
            <KingTokenText body={post.body} theme={isLight ? "light" : "dark"} />
          </p>
        )}
        {post.why && (
          <p className={`mt-1 text-[11px] ${muted}`} data-testid="world-feed-why">{post.why.label}</p>
        )}
        {removed && (
          <p
            className={`mt-2 rounded-lg border px-2.5 py-1.5 text-xs font-semibold ${
              isLight ? "border-red-700/40 bg-red-500/10 text-red-800" : "border-red-400/40 bg-red-400/10 text-red-300"
            }`}
            data-testid="world-feed-removed"
          >
            {t("worldSocialDesk.hallRemovedPrefix")}{post.removal_reason ? t("worldSocialDesk.hallRemovedReasonSegment", { reason: post.removal_reason }) : ""}{t("worldSocialDesk.hallRemovedSuffix")}
          </p>
        )}
        {/* The poll (#80): vote in-world on the card's own rail; a
            member who already voted (or a guest) reads the standing. */}
        {!removed && poll && (
          <div className="mt-2 space-y-1.5" data-testid="world-feed-poll">
            {poll.options.map((o) => {
              const pct = pollPercent(poll, o.id);
              const mine = poll.viewer_option_id === o.id;
              const votable = pollVotable(poll, isGuest);
              return (
                <button
                  key={o.id}
                  type="button"
                  disabled={!votable || voting}
                  onClick={() => void vote(o.id)}
                  data-testid="world-feed-poll-option"
                  aria-pressed={mine}
                  className={`relative w-full overflow-hidden rounded-xl border px-3 py-1.5 text-left text-xs bdv-touch-target ${
                    mine
                      ? "border-[#d4af37] text-[#e8c86a]"
                      : isLight ? "border-[#C9A84C]/40 text-[#2a1e07]" : "border-white/10 text-white/80"
                  } ${votable ? "hover:border-[#d4af37]/70" : ""}`}
                >
                  <span className="absolute inset-y-0 left-0 bg-[#d4af37]/15" style={{ width: `${pct}%` }} />
                  <span className="relative flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5">
                      {mine && <Check className="h-3.5 w-3.5" />}
                      {o.option_text}
                    </span>
                    <span className={muted}>{pct}%</span>
                  </span>
                </button>
              );
            })}
            <p className={`text-[11px] ${muted}`}>
              {pollTotalVotes(poll) === 1
                ? t("worldSocialDesk.hallPollVotesOne", { count: pollTotalVotes(poll) })
                : t("worldSocialDesk.hallPollVotesMany", { count: pollTotalVotes(poll) })}
              {isGuest ? t("worldSocialDesk.hallPollGuestSuffix") : poll.viewer_option_id ? t("worldSocialDesk.hallPollVotedSuffix") : ""}
            </p>
          </div>
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
              {reactionLabel(r, t)}
              {(counts[r.emoji] ?? 0) > 0 ? ` ${counts[r.emoji]}` : ""}
            </button>
          ))}
          <button type="button" onClick={() => toggleReplies()} className={chipBtn(isLight)} data-testid="world-community-thread-toggle">
            <MessageCircle className="h-3.5 w-3.5" />
            {threadToggleLabel(replyCount, repliesOpen && threadState === "ready", {
              replies: t("worldSocialDesk.hallThreadReplies"),
              hide: t("worldSocialDesk.hallThreadHide"),
              show: t("worldSocialDesk.hallThreadShow"),
              replyOne: t("worldSocialDesk.hallThreadReplyOne"),
              replyMany: t("worldSocialDesk.hallThreadReplyMany"),
            })}
          </button>
          {/* Feed verbs (#80): members only — guests never see a
              dead button; the rails are requireAuth regardless. */}
          {!removed && canVerb && (
            <>
              <button
                type="button"
                onClick={() => void doRepost()}
                disabled={reposted}
                data-testid="world-feed-repost"
                aria-pressed={reposted}
                className={`${chipBtn(isLight)} ${reposted ? "border-[#d4af37] bg-[#d4af37]/15" : ""}`}
              >
                <Repeat2 className="h-3.5 w-3.5" />
                {t("worldSocialDesk.hallRepostButton")}{repostCount > 0 ? ` ${repostCount}` : ""}
              </button>
              <button
                type="button"
                onClick={() => void toggleSave()}
                data-testid="world-feed-save"
                aria-pressed={saved}
                className={`${chipBtn(isLight)} ${saved ? "border-[#d4af37] bg-[#d4af37]/15" : ""}`}
              >
                <Bookmark className="h-3.5 w-3.5" />
                {saved ? t("worldSocialDesk.hallSavedButton") : t("worldSocialDesk.hallSaveButton")}
              </button>
              {own && !confirmingDelete && (
                <button
                  type="button"
                  onClick={() => setConfirmingDelete(true)}
                  data-testid="world-feed-delete"
                  className={chipBtn(isLight)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {t("worldSocialDesk.hallDeleteButton")}
                </button>
              )}
              {own && confirmingDelete && (
                <>
                  <button
                    type="button"
                    onClick={() => void doDelete()}
                    disabled={deleting}
                    data-testid="world-feed-delete-confirm"
                    className={`${chipBtn(isLight)} border-red-400/60 font-black text-red-400`}
                  >
                    {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                    {t("worldSocialDesk.hallDeleteConfirm")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmingDelete(false)}
                    data-testid="world-feed-delete-cancel"
                    className={chipBtn(isLight)}
                  >
                    {t("worldSocialDesk.hallKeepIt")}
                  </button>
                </>
              )}
            </>
          )}
          {/* A removed post's only verb is its author's delete. */}
          {removed && canVerb && own && !confirmingDelete && (
            <button
              type="button"
              onClick={() => setConfirmingDelete(true)}
              data-testid="world-feed-delete"
              className={chipBtn(isLight)}
            >
              <Trash2 className="h-3.5 w-3.5" />
              {t("worldSocialDesk.hallDeleteButton")}
            </button>
          )}
          {removed && canVerb && own && confirmingDelete && (
            <>
              <button
                type="button"
                onClick={() => void doDelete()}
                disabled={deleting}
                data-testid="world-feed-delete-confirm"
                className={`${chipBtn(isLight)} border-red-400/60 font-black text-red-400`}
              >
                {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                {t("worldSocialDesk.hallDeleteConfirm")}
              </button>
              <button
                type="button"
                onClick={() => setConfirmingDelete(false)}
                data-testid="world-feed-delete-cancel"
                className={chipBtn(isLight)}
              >
                {t("worldSocialDesk.hallKeepIt")}
              </button>
            </>
          )}
        </div>
        {verbNote && (
          <p
            className={`mt-1.5 text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}
            data-testid="world-feed-verb-note"
          >
            {verbNote}
          </p>
        )}
        {repliesOpen && (
          <div className="mt-2 space-y-1.5" data-testid="world-community-thread">
            {threadState === "loading" ? (
              <NativeLoadingState isLight={isLight} message={t("worldSocialDesk.dmThreadLoading")} />
            ) : threadState === "failed" ? (
              <div data-testid="world-community-thread-failed">
                <NativeErrorState
                  isLight={isLight}
                  title={t("worldSocialDesk.dmThreadErrorTitle")}
                  message={t("worldSocialDesk.hallThreadErrorMessageLong")}
                  onRetry={() => void loadThread()}
                />
              </div>
            ) : threadState === "ready" && replies !== null && replies.length === 0 ? (
              <p className={`text-xs ${muted}`}>
                {replyCount === 0
                  ? t("worldSocialDesk.hallCardThreadEmptyZero")
                  : t("worldSocialDesk.hallThreadNotShowing")}
              </p>
            ) : threadState === "ready" && replies !== null ? (
              fullThread(replies).map((r) => (
                <ThreadReplyNode
                  key={r.id}
                  reply={r}
                  depth={0}
                  isLight={isLight}
                  isGuest={isGuest}
                  authHeaders={authHeaders}
                />
              ))
            ) : null}
            {!threadReplyAllowed(isGuest) ? (
              <p className={`text-[11px] ${muted}`}>
                {t("worldSocialDesk.hallGuestThreadNote")}
              </p>
            ) : (
              <div className="pt-1">
                {/* The bench's tone (2.19): the voice this reply is
                    being drafted in — saved WITH the draft, so the
                    words come back in their tone on any device. */}
                <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                  {REPLY_DRAFT_TONES.map((toneOpt) => (
                    <button
                      key={toneOpt.key}
                      type="button"
                      data-testid={`world-community-reply-tone-${toneOpt.key}`}
                      onClick={() => setReplyTone(toneOpt.key)}
                      aria-pressed={replyTone === toneOpt.key}
                      className={`${chipBtn(isLight)} ${replyTone === toneOpt.key ? "border-[#d4af37] bg-[#d4af37]/15" : ""}`}
                    >
                      {t(TONE_KEYS[toneOpt.key])}
                    </button>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input
                    value={replyDraft}
                    onChange={(e) => setReplyDraft(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && void sendReply()}
                    placeholder={t("worldSocialDesk.hallAnswerInHallPlaceholder")}
                    aria-label={t("worldSocialDesk.hallAnswerInHallAria")}
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
                    {t("worldSocialDesk.hallReplyButton")}
                  </button>
                </div>
                {draftState !== "idle" && (
                  <p
                    className={`mt-1.5 text-[11px] ${draftState === "failed" ? `font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}` : muted}`}
                    data-testid="world-community-reply-draft-state"
                  >
                    {draftState === "saving"
                      ? t("worldSocialDesk.hallDraftSaving")
                      : draftState === "saved"
                        ? t("worldSocialDesk.hallDraftSaved")
                        : t("worldSocialDesk.hallDraftSaveFailed")}
                  </p>
                )}
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
  const { t } = useTranslation();
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
      if (replies.length === 0) setNote(t("worldSocialDesk.hallBenchNothingBack"));
    } catch (e) {
      setNote(plainErrorText(e, t("worldSocialDesk.hallBenchDraftError")));
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
      setNote(t("worldSocialDesk.hallBenchPostedNote"));
      onPosted();
    } catch (e) {
      setNote(plainErrorText(e, t("worldSocialDesk.hallBenchPostError")));
    } finally {
      setPosting(null);
    }
  }

  return (
    <NativeCard isLight={isLight} title={t("worldSocialDesk.hallBenchTitle")}>
      <div data-testid="world-community-reply-bench">
        <textarea
          value={commentsText}
          onChange={(e) => setCommentsText(e.target.value)}
          placeholder={t("worldSocialDesk.hallBenchCommentsPlaceholder")}
          aria-label={t("worldSocialDesk.hallBenchCommentsAria")}
          rows={3}
          className={inputCls(isLight)}
          data-testid="world-community-bench-comments"
        />
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {REPLY_DRAFT_TONES.map((toneOpt) => (
            <button
              key={toneOpt.key}
              type="button"
              data-testid={`world-community-bench-tone-${toneOpt.key}`}
              onClick={() => setTone(toneOpt.key)}
              aria-pressed={tone === toneOpt.key}
              className={`${chipBtn(isLight)} ${tone === toneOpt.key ? "border-[#d4af37] bg-[#d4af37]/15" : ""}`}
            >
              {t(TONE_KEYS[toneOpt.key])}
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
            {t("worldSocialDesk.hallBenchDraftButton")}{cost !== null ? t("worldSocialDesk.hallBenchCostSuffix", { cost }) : ""}
          </button>
        </div>
        <p className={`mt-1.5 text-[11px] ${muted}`}>
          {batch.length > 0
            ? batch.length === 1
              ? t("worldSocialDesk.hallBenchBatchOne", { count: batch.length, costPart: cost !== null ? t("worldSocialDesk.hallBenchCostPart", { cost }) : "" })
              : t("worldSocialDesk.hallBenchBatchMany", { count: batch.length, costPart: cost !== null ? t("worldSocialDesk.hallBenchCostPart", { cost }) : "" })
            : t("worldSocialDesk.hallBenchBatchEmpty")}
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
                  {t("worldSocialDesk.hallBenchForPrefix")}<span className="font-semibold">{batch[i] ?? ""}</span>
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
                  aria-label={t("worldSocialDesk.hallBenchDraftAria")}
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
                    {t("worldSocialDesk.hallBenchPostButton")}
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

/* ─── The feed composer (with Post Assist, #58) ──────────────────────
   The Hall's own post box: write, or let "Write It For Me" draft
   into the box (POST /api/posts/assist, 100 VB, confirmed), then
   post on the feed's own rail (POST /api/posts, free). The assist
   never posts — the member's tap on Post does. */
function FeedComposerCard({
  isLight, authHeaders, onPosted,
}: {
  isLight: boolean;
  authHeaders: () => Promise<Record<string, string>>;
  onPosted: () => void;
}) {
  const { t } = useTranslation();
  const [body, setBody] = useState("");
  const [posting, setPosting] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";

  async function post() {
    if (posting || !postBodyReady(body)) return;
    setPosting(true);
    setNote(null);
    try {
      await apiJson(authHeaders, POSTS_PATH, { method: "POST", body: { body: body.trim() } });
      setBody("");
      setNote(t("worldSocialDesk.hallComposerPostedNote"));
      onPosted();
    } catch (e) {
      setNote(plainErrorText(e, t("worldSocialDesk.hallBenchPostError")));
    } finally {
      setPosting(false);
    }
  }

  return (
    <NativeCard isLight={isLight} title={t("worldSocialDesk.hallComposerTitle")}>
      <div data-testid="world-feed-composer">
        <PostAssistBlock isLight={isLight} onDraft={(draft) => setBody((b) => appendAssistDraft(b, draft))} />
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={t("worldSocialDesk.hallComposerPlaceholder")}
          aria-label={t("worldSocialDesk.hallComposerAria")}
          rows={3}
          maxLength={500}
          className={`${inputCls(isLight)} mt-2`}
          data-testid="world-feed-composer-body"
        />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className={`text-[11px] ${muted}`}>{t("worldSocialDesk.hallComposerCountLine", { count: body.length })}</span>
          <button
            type="button"
            onClick={() => void post()}
            disabled={posting || !postBodyReady(body)}
            className={`${goldBtn} ml-auto`}
            data-testid="world-feed-composer-post"
          >
            {posting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            {t("worldSocialDesk.hallBenchPostButton")}
          </button>
        </div>
        {note && (
          <p className={`mt-2 text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>{note}</p>
        )}
      </div>
    </NativeCard>
  );
}

export function CommunityHallBoard({ isLight, isGuest }: { isLight: boolean; isGuest: boolean }) {
  const { t, i18n } = useTranslation();
  const authHeaders = useAuthHeaders();
  const [posts, setPosts] = useState<FeedPost[] | null>(null);
  const [feedFailed, setFeedFailed] = useState(false);
  const [tick, setTick] = useState(0);
  /* Feed parity (#79): the 2D feed's three views — Latest (chrono),
     For You (ranked, every post says why) and New Drops (the
     discovery releases wire) — with the page's own cursor
     pagination (limit 20, `before` = last post's created_at). */
  const [view, setView] = useState<FeedView>("chrono");
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [drops, setDrops] = useState<DropItem[] | null>(null);
  const [dropsFailed, setDropsFailed] = useState(false);
  /* My own profile id unlocks the delete verb on my own posts
     (#80) — read from the owner rail; a failure just means the
     verb isn't offered (the server gate stands regardless). */
  const [myProfileId, setMyProfileId] = useState<string | null>(null);
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
    if (isGuest) return;
    let cancelled = false;
    (async () => {
      try {
        const d = await apiJson<{ id?: unknown }>(authHeaders, MY_PROFILE_PATH);
        if (!cancelled && typeof d.id === "string") setMyProfileId(d.id);
      } catch { /* no profile yet, or the read slipped — no own-verbs offered */ }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGuest]);

  /* First page of the current view. A view switch (or a board
     refresh via tick) restarts the river from the top. */
  useEffect(() => {
    let cancelled = false;
    setFeedFailed(false);
    if (view === "drops") {
      setDrops(null);
      setDropsFailed(false);
      (async () => {
        try {
          const d = await apiJson<unknown>(authHeaders, DROPS_PATH);
          if (!cancelled) setDrops(normalizeDrops(d));
        } catch {
          if (!cancelled) setDropsFailed(true);
        }
      })();
      return () => { cancelled = true; };
    }
    setPosts(null);
    setHasMore(false);
    (async () => {
      try {
        const d = await apiJson<{ posts: FeedPost[] }>(authHeaders, feedPagePath(view));
        if (!cancelled) {
          const page = Array.isArray(d.posts) ? d.posts : [];
          setPosts(page);
          setHasMore(feedHasMore(page.length));
        }
      } catch {
        if (!cancelled) setFeedFailed(true);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, view]);

  /* The next page: cursor = the last loaded post's created_at,
     exactly feed.tsx's load(false). Only the post views paginate —
     the Drops wire is one 40-row read, like its 2D home. */
  async function loadMore() {
    if (loadingMore || view === "drops" || !posts || posts.length === 0) return;
    setLoadingMore(true);
    try {
      const before = posts[posts.length - 1]!.created_at;
      const d = await apiJson<{ posts: FeedPost[] }>(authHeaders, feedPagePath(view, before));
      const page = Array.isArray(d.posts) ? d.posts : [];
      setPosts((prev) => mergeFeedPage(prev ?? [], page));
      setHasMore(feedHasMore(page.length));
    } catch {
      setScanNote(t("worldSocialDesk.hallLoadMoreError"));
    } finally {
      setLoadingMore(false);
    }
  }

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
      setScanNote(t("worldSocialDesk.hallScanEmptyBoard"));
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
      setScanNote(plainErrorText(e, t("worldSocialDesk.hallScanError")));
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
        setPinNote(t("worldSocialDesk.hallPinNothingBack"));
      }
    } catch (e) {
      setPinNote(plainErrorText(e, t("worldSocialDesk.hallPinDraftError")));
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
      setPinNote(t("worldSocialDesk.hallPinPostedNote"));
      setVariants([]);
      setTopic("");
      setTick((n) => n + 1);
    } catch (e) {
      setPinNote(plainErrorText(e, t("worldSocialDesk.hallPinError")));
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
      <NativeCard isLight={isLight} title={t("worldSocialDesk.hallHighlightsTitle")}>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            data-testid="world-community-scan-superfans"
            onClick={() => void runScan("superfans")}
            disabled={scanBusy !== null || posts === null}
            className={chipBtn(isLight)}
          >
            {scanBusy === "superfans" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Star className="h-3.5 w-3.5 text-[#d4af37]" />}
            {t("worldSocialDesk.hallScanSuperfans")}
          </button>
          <button
            type="button"
            data-testid="world-community-scan-sentiment"
            onClick={() => void runScan("sentiment")}
            disabled={scanBusy !== null || posts === null}
            className={chipBtn(isLight)}
          >
            {scanBusy === "sentiment" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <BarChart3 className="h-3.5 w-3.5 text-[#d4af37]" />}
            {t("worldSocialDesk.hallScanSentiment")}
          </button>
          <span className={`text-[11px] ${muted}`}>
            {isGuest
              ? t("worldSocialDesk.hallScanGuestNote")
              : t("worldSocialDesk.hallScanMemberNote")}
          </span>
        </div>
        {scanNote && (
          <p className={`mt-2 text-xs font-semibold ${isLight ? "text-[#92600a]" : "text-amber-300"}`}>{scanNote}</p>
        )}
        {superfans !== null && (
          <div className="mt-2 space-y-1.5">
            {superfans.length === 0 ? (
              <p className={`text-xs ${muted}`}>{t("worldSocialDesk.hallNoSuperfans")}</p>
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
              ? t("worldSocialDesk.hallSentimentThemes", { themes: sentiment.themes.map((th) => th.theme).slice(0, 3).join(" · ") })
              : ""}
          </p>
        )}
      </NativeCard>

      {/* The feed composer — your own words, posted straight to the
          board (POST /api/posts), with Post Assist ("Write It For
          Me", #58) drafting into it on the website composer's rail.
          Members only: guests read the board, they don't post. */}
      {!isGuest && <FeedComposerCard isLight={isLight} authHeaders={authHeaders} onPosted={() => setTick((n) => n + 1)} />}

      {/* Pin a post — draft with the generate-community-post family,
          then pin the chosen words to the board (POST /api/posts). */}
      <NativeCard isLight={isLight} title={t("worldSocialDesk.hallPinTitle")}>
        <div className="flex gap-2">
          <input
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void generatePin()}
            placeholder={t("worldSocialDesk.hallPinTopicPlaceholder")}
            aria-label={t("worldSocialDesk.hallPinTopicAria")}
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
            {t("worldSocialDesk.hallPinDraft")}{pinCost !== null ? t("worldSocialDesk.hallBenchCostSuffix", { cost: pinCost }) : ""}
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
                  {t("worldSocialDesk.hallPinButton")}
                </button>
              </div>
            ))}
            <p className={`text-[11px] ${muted}`}>
              {t("worldSocialDesk.hallPinCheckNote")}
            </p>
          </div>
        )}
      </NativeCard>

      {/* Reply drafts bench — members only (drafting charges credits,
          and guests never reach a paid rail). */}
      {!isGuest && (
        <ReplyDraftsBench isLight={isLight} authHeaders={authHeaders} onPosted={() => setTick((n) => n + 1)} />
      )}

      {/* The notice board itself — with the feed's own views (#79):
          Latest / For You / New Drops, switched in place. */}
      <div>
        <div className="mb-1.5 flex flex-wrap items-center gap-1.5 px-1">
          <p className={`mr-1 text-xs font-black uppercase tracking-[0.14em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
            {t("worldSocialDesk.hallBoardHeading")}
          </p>
          {FEED_VIEWS.map((v) => {
            const Icon = v.key === "chrono" ? Clock3 : v.key === "foryou" ? Flame : Radio;
            return (
              <button
                key={v.key}
                type="button"
                role="tab"
                aria-selected={view === v.key}
                onClick={() => setView(v.key)}
                data-testid={`world-feed-view-${v.key}`}
                className={`${chipBtn(isLight)} ${view === v.key ? "border-[#d4af37] bg-[#d4af37]/15" : ""}`}
              >
                <Icon className="h-3.5 w-3.5" />
                {viewLabel(v, t)}
              </button>
            );
          })}
        </div>
        <p className={`mb-2 px-1 text-[11px] ${muted}`}>
          {view === "drops"
            ? t("worldSocialDesk.hallViewDropsNote")
            : view === "chrono"
              ? t("worldSocialDesk.hallViewChronoNote")
              : t("worldSocialDesk.hallViewForYouNote")}
        </p>
        {view === "drops" ? (
          dropsFailed ? (
            <NativeErrorState
              isLight={isLight}
              title={t("worldSocialDesk.hallDropsErrorTitle")}
              message={
                isGuest
                  ? t("worldSocialDesk.hallDropsErrorGuest")
                  : t("worldSocialDesk.hallDropsErrorMember")
              }
              onRetry={() => setTick((n) => n + 1)}
            />
          ) : drops === null ? (
            <NativeLoadingState isLight={isLight} message={t("worldSocialDesk.hallDropsLoading")} />
          ) : drops.length === 0 ? (
            <NativeEmptyState
              isLight={isLight}
              message={t("worldSocialDesk.hallDropsEmptyMessage")}
              detail={t("worldSocialDesk.hallDropsEmptyDetail")}
            />
          ) : (
            <div className="space-y-2" data-testid="world-feed-drops">
              {drops.map((d) => (
                <NativeCard key={`${d.kind}-${d.id}`} isLight={isLight}>
                  <div className="flex items-center gap-3" data-testid="world-feed-drop">
                    {d.thumb ? (
                      <img src={d.thumb} alt="" className="h-11 w-11 shrink-0 rounded-lg object-cover" />
                    ) : (
                      <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg ${isLight ? "bg-[#C9A84C]/15" : "bg-white/5"}`}>
                        {d.kind === "video" ? <Clapperboard className="h-5 w-5 text-[#d4af37]" /> : <Music2 className="h-5 w-5 text-[#d4af37]" />}
                      </span>
                    )}
                    <div className="min-w-0">
                      <p className={`truncate text-sm font-bold ${isLight ? "text-[#2a1e07]" : "text-white"}`}>
                        {d.title}
                        {d.source === "discovery" && (
                          <span className="ml-2 rounded-full border border-[#d4af37]/60 px-1.5 py-px text-[9px] font-black uppercase text-[#e8c86a]">
                            {t("worldSocialDesk.hallDiscoveryBadge")}
                          </span>
                        )}
                      </p>
                      <p className={`truncate text-xs ${muted}`}>
                        {d.display_name ?? t("worldSocialDesk.hallCreatorFallback")}
                        {d.why ? ` · ${d.why.label}` : ""}
                        {` · ${new Date(d.created_at).toLocaleDateString(i18n.language, { month: "short", day: "numeric" })}`}
                      </p>
                    </div>
                  </div>
                </NativeCard>
              ))}
            </div>
          )
        ) : feedFailed ? (
          <NativeErrorState
            isLight={isLight}
            title={t("worldSocialDesk.hallBoardErrorTitle")}
            message={
              isGuest
                ? t("worldSocialDesk.hallBoardErrorGuest")
                : t("worldSocialDesk.hallBoardErrorMember")
            }
            onRetry={() => setTick((n) => n + 1)}
          />
        ) : posts === null ? (
          <NativeLoadingState isLight={isLight} message={t("worldSocialDesk.hallBoardLoading")} />
        ) : posts.length === 0 ? (
          <NativeEmptyState
            isLight={isLight}
            message={t("worldSocialDesk.hallBoardEmptyMessage")}
            detail={t("worldSocialDesk.hallBoardEmptyDetail")}
          />
        ) : (
          <>
            <div className="space-y-2">
              {posts.map((p) => (
                <NoticePostCard
                  key={p.id}
                  post={p}
                  isLight={isLight}
                  isGuest={isGuest}
                  authHeaders={authHeaders}
                  myProfileId={myProfileId}
                  onDeleted={(id) => setPosts((prev) => (prev ?? []).filter((x) => x.id !== id))}
                  onReposted={() => { /* the repost landed on the author's board; this river keeps its order */ }}
                />
              ))}
            </div>
            {hasMore ? (
              <div className="mt-3 text-center">
                <button
                  type="button"
                  onClick={() => void loadMore()}
                  disabled={loadingMore}
                  className={chipBtn(isLight)}
                  data-testid="world-feed-load-more"
                >
                  {loadingMore ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                  {t("worldSocialDesk.hallLoadMoreButton")}
                </button>
              </div>
            ) : (
              <p className={`mt-3 text-center text-[11px] ${muted}`} data-testid="world-feed-caught-up">
                {t("worldSocialDesk.hallCaughtUp")}
              </p>
            )}
          </>
        )}
      </div>

      {/* The moderation bench (#82) — ADMIN-ONLY: it renders only
          on a confirmed admin status and every verb rides the
          admin rails, which re-check server-side regardless. */}
      {!isGuest && <ModerationBench isLight={isLight} />}
    </div>
  );
}
