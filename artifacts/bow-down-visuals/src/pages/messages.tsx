import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { Send, Check, X, Ban, Plus, Store, HeartHandshake, Paperclip, Link2, Search, Music2, Clapperboard, Image as ImageIcon, File as FileIcon } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import {
  useCommunityApi, Loading, ErrorBox, profileLink, timeAgo,
  goldInput, goldButton, ghostButton,
  friendlyLoadError,
} from "@/lib/community-ui";
import { usePageTitle } from "@/hooks/use-page-title";
import { EmojiTray, KingTokenText } from "@/components/social/KingEmoji";
import { insertAtCursor } from "@/lib/king-emoji";
import { MessageDraftSync, messageDraftPath } from "@/lib/message-drafts";
import {
  DM_ATTACHMENT_UPLOAD_PATH, type PageDmAttachment,
  dmAttachmentOf, dmAttachmentRenderKind, dmWorkLabel, dmPreviewLine,
  dmKindForMime, dmKindForUrl, dmNameForUrl, dmCanSend,
  dmMessageHit, dmConversationHit, dmHighlightSegments,
} from "@/lib/dm-attachments";

/* ─── /messages — DMs ──────────────────────────────────────────────────────
   Inbox + requests tabs, thread view, rate-limited sends. Every thread
   header links to the other person's profile AND their store (money path:
   DMs surface the creator's store link). Chat is never gated. */

interface ProfileCard { slug: string; displayName: string; avatarUrl: string | null }
interface Conv {
  id: string; status: string; requested_by_me: boolean;
  other: { user_id: string; profile: ProfileCard | null };
  last_message: {
    body: string; createdAt: string; senderUserId: string;
    attachment_type?: string | null; attachment_name?: string | null;
  } | null;
  unread: number; last_message_at: string | null;
}
interface Msg {
  id: string; senderUserId: string; body: string; created_at: string;
  attachment_url?: string | null; attachment_type?: string | null; attachment_name?: string | null;
}

/* A message body with an active thread search's matches lit up in
   place. Segments still pass through KingTokenText so stickers/GIFs
   render as ever (a query that slices a :token: just leaves that one
   as literal text while searching — the words stay readable). */
function HighlightedBody({ body, query, mine }: { body: string; query: string; mine: boolean }) {
  if (!query.trim()) return <KingTokenText body={body} />;
  return (
    <>
      {dmHighlightSegments(body, query).map((seg, i) =>
        seg.hit ? (
          <mark key={i} className={`rounded-sm px-0.5 ${mine ? "bg-black/25 text-inherit" : "bg-[#e8c86a]/50 text-inherit"}`}>
            <KingTokenText body={seg.text} />
          </mark>
        ) : (
          <KingTokenText key={i} body={seg.text} />
        ),
      )}
    </>
  );
}

/* The piece of work riding with a message: a player per kind (beat,
   clip, artwork), a named openable row for anything else — an
   attachment is never silently dropped. */
function MsgAttachment({ att, mine, query }: { att: PageDmAttachment; mine: boolean; query: string }) {
  const kind = dmAttachmentRenderKind(att);
  const labelCls = mine ? "text-black/60" : "text-white/50";
  const header = (
    <p className={`mb-1 flex items-center gap-1.5 text-[11px] font-semibold ${labelCls}`}>
      {kind === "audio" ? <Music2 className="h-3.5 w-3.5" />
        : kind === "video" ? <Clapperboard className="h-3.5 w-3.5" />
        : kind === "image" ? <ImageIcon className="h-3.5 w-3.5" />
        : <FileIcon className="h-3.5 w-3.5" />}
      <span>{dmWorkLabel(att.type)} — </span>
      <span className="min-w-0 truncate">
        <HighlightedBody body={att.name} query={query} mine={mine} />
      </span>
    </p>
  );
  return (
    <div data-testid="dm-attachment" className={kind === "image" ? "" : "min-w-56"}>
      {header}
      {kind === "audio" ? (
        <audio controls src={att.url} className="w-full" data-testid="dm-attachment-audio" />
      ) : kind === "video" ? (
        <video controls src={att.url} className="max-h-52 w-full rounded-lg" data-testid="dm-attachment-video" />
      ) : kind === "image" ? (
        <img src={att.url} alt={att.name} className="max-h-52 w-full rounded-lg object-cover" data-testid="dm-attachment-image" />
      ) : (
        <a href={att.url} target="_blank" rel="noreferrer" data-testid="dm-attachment-file"
          className={`text-sm font-semibold underline ${mine ? "text-black" : "text-[#e8c86a]"}`}>
          Open {att.name}
        </a>
      )}
    </div>
  );
}

export default function Messages() {
  usePageTitle("Messages", "Your Bow Down Visuals messages — chat with creators, collaborators and brands.");
  const api = useCommunityApi();
  const { user, getAccessToken } = useAuth();
  const [inbox, setInbox] = useState<Conv[]>([]);
  const [requests, setRequests] = useState<Conv[]>([]);
  const [tab, setTab] = useState<"inbox" | "requests">("inbox");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [status, setStatus] = useState<string>("inbox");
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [threadLoading, setThreadLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [threadError, setThreadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [newSlug, setNewSlug] = useState("");
  const [showNew, setShowNew] = useState(false);
  /* Attachments + search (STACK-20 R2 #6, 2.17 website half): the rail
     and the World desk shipped in Ring 2 — this page renders and sends
     what the shared DTO already carries. A pending attachment is
     composer-local (server drafts hold words only) and per-thread: it
     resets whenever the open thread changes. */
  const [pendingAtt, setPendingAtt] = useState<PageDmAttachment | null>(null);
  const [uploading, setUploading] = useState(false);
  const [showLink, setShowLink] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [convQuery, setConvQuery] = useState("");
  const [threadQuery, setThreadQuery] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const draftRef = useRef<HTMLInputElement>(null);
  const threadReqRef = useRef(0);

  /* Server-backed composer drafts (STACK-20 #20): the words rest on
     the server, one draft per conversation — switching threads
     flushes the outgoing words to THEIR thread and restores the
     incoming thread's, and a reload no longer loses them. The sync
     controller (lib/message-drafts) owns the lifecycle; every rail
     failure degrades silently to the old in-memory behavior. */
  const apiRef = useRef(api);
  apiRef.current = api;
  const draftSyncRef = useRef<MessageDraftSync | null>(null);
  if (!draftSyncRef.current) {
    draftSyncRef.current = new MessageDraftSync({
      rail: {
        load: (id) => apiRef.current.get(messageDraftPath(id)),
        save: (id, body) => apiRef.current.put(messageDraftPath(id), { body }),
        clear: (id) => apiRef.current.del(messageDraftPath(id)),
      },
      onRestore: (_id, body) => setDraft(body),
    });
  }

  /* Every composer edit flows through here so the draft sync hears
     about it. Restores and the post-send clear use setDraft directly:
     a restore is the sync's own doing, and a landed send retires the
     draft through sent() — neither is a fresh edit to save. */
  function updateDraft(value: string) {
    setDraft(value);
    draftSyncRef.current?.type(value);
  }

  async function loadConvs() {
    try {
      const d = (await api.get("/api/dm/conversations")) as { inbox: Conv[]; requests: Conv[] };
      setInbox(d.inbox); setRequests(d.requests);
    } catch (e) {
      setError(friendlyLoadError(e, "your messages"));
    } finally { setLoading(false); }
  }

  async function loadThread(id: string) {
    const reqId = ++threadReqRef.current;
    setMsgs([]); setStatus("inbox"); setThreadError(null);
    setThreadLoading(true);
    try {
      const d = (await api.get(`/api/dm/${id}/messages`)) as { messages: Msg[]; status: string };
      if (reqId !== threadReqRef.current) return;
      setMsgs(d.messages); setStatus(d.status); setThreadError(null);
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    } catch (e) {
      if (reqId !== threadReqRef.current) return;
      setThreadError(friendlyLoadError(e, "these messages"));
    } finally {
      if (reqId === threadReqRef.current) setThreadLoading(false);
    }
  }

  useEffect(() => {
    loadConvs();
    const params = new URLSearchParams(window.location.search);
    const to = params.get("to");
    if (to) startByUserId(to);
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, []);

  useEffect(() => {
    draftSyncRef.current?.open(activeId);
    setDraft("");
    /* Per-thread composer/search state never follows you next door. */
    setPendingAtt(null);
    setShowLink(false);
    setLinkUrl("");
    setThreadQuery("");
    if (activeId) loadThread(activeId);
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [activeId]);

  /* Leaving the page: flush whatever draft is still unsaved. */
  useEffect(() => () => { draftSyncRef.current?.dispose(); }, []);

  async function startByUserId(targetId: string) {
    try {
      const d = (await api.post("/api/dm/start", { user_id: targetId })) as { conversation: Conv };
      await loadConvs();
      setActiveId(d.conversation.id);
      setTab(d.conversation.status === "request" ? "requests" : "inbox");
    } catch (e) { setNotice(e instanceof Error ? e.message : "Couldn't start the conversation."); }
  }

  async function startBySlug() {
    if (!newSlug.trim()) return;
    try {
      const r = (await api.get(`/api/profiles/resolve?slug=${encodeURIComponent(newSlug.trim().toLowerCase())}`)) as { user_id: string };
      setNewSlug(""); setShowNew(false);
      await startByUserId(r.user_id);
    } catch (e) { setNotice(e instanceof Error ? e.message : "Creator not found."); }
  }

  /* King tray: stickers + GIFs ride as :shortcode: text in the body —
     the bubble renderer lights them up; no DM schema change. */
  function insertDraftToken(token: string) {
    const el = draftRef.current;
    const next = insertAtCursor(draft, token, el?.selectionStart ?? null, el?.selectionEnd ?? null, 2000);
    updateDraft(next.value);
    requestAnimationFrame(() => {
      if (el) {
        el.focus();
        el.setSelectionRange(next.caret, next.caret);
      }
    });
  }

  /* Attach a file: it lands in permanent storage under MY prefix via
     the DM upload rail (the publish pipeline), and the permanent ref —
     never the signed URL — is what the send carries; the server
     settles it and mints fresh URLs on every read. */
  async function uploadFile(file: File) {
    if (!dmKindForMime(file.type)) {
      setNotice("Only audio, video, or image files can ride in a message.");
      return;
    }
    setUploading(true);
    setNotice(null);
    try {
      const token = await getAccessToken();
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(DM_ATTACHMENT_UPLOAD_PATH, {
        method: "POST",
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: form,
      });
      const data = (await res.json().catch(() => ({}))) as {
        ref?: string; type?: string; name?: string; error?: string; message?: string;
      };
      if (!res.ok || !data.ref || !data.type) {
        throw new Error(data.message || data.error || "The upload didn't land.");
      }
      setPendingAtt({ url: data.ref, type: data.type, name: data.name ?? file.name });
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "The upload didn't land.");
    } finally { setUploading(false); }
  }

  /* Attach by link: a URL to my own file elsewhere — the server
     mirrors it into permanent storage at send time (mirror-on-save). */
  function attachByUrl() {
    const url = linkUrl.trim();
    if (!url) return;
    const kind = dmKindForUrl(url);
    if (!kind) {
      setNotice("That link doesn't name a beat, cover, or clip file — check the ending (.mp3, .jpg, .mp4…).");
      return;
    }
    setPendingAtt({ url, type: kind, name: dmNameForUrl(url) });
    setLinkUrl("");
    setShowLink(false);
    setNotice(null);
  }

  async function send() {
    if (!activeId || !dmCanSend(draft, pendingAtt !== null)) return;
    try {
      await api.post(`/api/dm/${activeId}/send`, {
        body: draft.trim(),
        ...(pendingAtt
          ? { attachment: { url: pendingAtt.url, type: pendingAtt.type, name: pendingAtt.name } }
          : {}),
      });
      draftSyncRef.current?.sent();
      setDraft("");
      setPendingAtt(null);
      await loadThread(activeId);
      await loadConvs();
    } catch (e) { setNotice(e instanceof Error ? e.message : "Couldn't send."); }
  }

  async function accept() {
    if (!activeId) return;
    try { await api.post(`/api/dm/${activeId}/accept`); await loadConvs(); await loadThread(activeId); }
    catch (e) { setNotice(e instanceof Error ? e.message : "Couldn't accept."); }
  }
  async function decline() {
    if (!activeId || !window.confirm("Decline this message request?")) return;
    try { await api.post(`/api/dm/${activeId}/decline`); setActiveId(null); await loadConvs(); }
    catch (e) { setNotice(e instanceof Error ? e.message : "Couldn't decline."); }
  }
  async function block() {
    if (!activeId || !window.confirm("Block this conversation?")) return;
    try { await api.post(`/api/dm/${activeId}/block`); setActiveId(null); await loadConvs(); }
    catch (e) { setNotice(e instanceof Error ? e.message : "Couldn't block."); }
  }

  const list = tab === "inbox" ? inbox : requests;
  const visibleList = list.filter((c) => dmConversationHit(c, convQuery));
  const visibleMsgs = msgs.filter((m) => dmMessageHit(m, threadQuery));
  const active = [...inbox, ...requests].find((c) => c.id === activeId) ?? null;
  const other = active?.other;
  const canChat = active && (status === "inbox" || (status === "request" && active.requested_by_me));

  function convRow(c: Conv) {
    const name = c.other.profile?.displayName ?? "Creator";
    return (
      <button key={c.id} type="button" onClick={() => setActiveId(c.id)}
        className={`w-full rounded-xl border p-3 text-left transition ${activeId === c.id ? "border-[#e8c86a]/50 bg-[#e8c86a]/10" : "border-white/10 bg-[#0d0a02] hover:border-white/25"}`}>
        <div className="flex items-center gap-3">
          {c.other.profile?.avatarUrl
            ? <img src={c.other.profile.avatarUrl} onError={(e) => { e.currentTarget.style.display = "none"; }} alt="" className="h-10 w-10 rounded-full object-cover" />
            : <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#e8c86a]/20 text-[#e8c86a] font-bold">{name[0]}</div>}
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-2 font-semibold">
              <span className="truncate">{name}</span>
              {c.unread > 0 && <span className="rounded-full bg-[#e8c86a] px-2 py-0.5 text-[10px] font-bold text-black">{c.unread}</span>}
            </p>
            <p className="truncate text-xs text-white/50">{dmPreviewLine(c.last_message)}</p>
          </div>
        </div>
      </button>
    );
  }

  if (loading) return <div className="min-h-screen bg-black text-white"><Loading label="Loading DMs" /></div>;
  if (error) return <div className="min-h-screen bg-black px-6 py-16 text-white"><ErrorBox message={error} onRetry={() => { setError(null); setLoading(true); loadConvs(); }} /></div>;

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="mx-auto max-w-6xl px-6 py-10">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#e8c86a]">Slide in (respectfully)</p>
            <h1 className="mt-1 text-3xl font-bold">Messages</h1>
          </div>
          <button type="button" onClick={() => setShowNew(!showNew)} className={ghostButton}>
            <span className="inline-flex items-center gap-1.5"><Plus className="h-4 w-4" /> New message</span>
          </button>
        </div>

        {showNew && (
          <div className="mb-4 flex gap-2">
            <input value={newSlug} onChange={(e) => setNewSlug(e.target.value)} placeholder="Creator slug (e.g. shark-king)"
              className={goldInput} onKeyDown={(e) => e.key === "Enter" && startBySlug()} />
            <button type="button" onClick={startBySlug} className={goldButton}>Start</button>
          </div>
        )}

        {notice && (
          <div className="mb-4 rounded-lg border border-[#e8c86a]/30 bg-[#e8c86a]/10 px-4 py-2 text-sm text-[#e8c86a]">{notice}</div>
        )}

        <div className="grid gap-4 md:grid-cols-[320px_1fr]">
          <div className="space-y-3">
            <div className="flex gap-2">
              <button type="button" onClick={() => setTab("inbox")}
                className={`rounded-full px-4 py-1.5 text-sm font-semibold ${tab === "inbox" ? "bg-[#e8c86a] text-black" : "border border-white/20 text-white/70"}`}>
                Inbox {inbox.reduce((n, c) => n + c.unread, 0) > 0 && `(${inbox.reduce((n, c) => n + c.unread, 0)})`}
              </button>
              <button type="button" onClick={() => setTab("requests")}
                className={`rounded-full px-4 py-1.5 text-sm font-semibold ${tab === "requests" ? "bg-[#e8c86a] text-black" : "border border-white/20 text-white/70"}`}>
                Requests {requests.length > 0 && `(${requests.length})`}
              </button>
            </div>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35" />
              <input value={convQuery} onChange={(e) => setConvQuery(e.target.value)}
                placeholder="Search conversations — a name, a word, a piece of work…"
                data-testid="dm-conv-search"
                className="w-full rounded-full border border-white/15 bg-[#0d0a02] py-2 pl-9 pr-8 text-sm text-white placeholder:text-white/35 focus:border-[#e8c86a]/60 focus:outline-none" />
              {convQuery && (
                <button type="button" onClick={() => setConvQuery("")} title="Clear search"
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-white/40 hover:text-white">
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
            <div className="max-h-[60vh] space-y-2 overflow-y-auto pr-1">
              {visibleList.map(convRow)}
              {list.length === 0 && (
                <p className="py-8 text-center text-sm text-white/40">
                  {tab === "inbox" ? "No conversations yet — go meet some creators." : "No requests. You're all clear."}
                </p>
              )}
              {list.length > 0 && visibleList.length === 0 && (
                <p className="py-8 text-center text-sm text-white/40">No conversation matches that search.</p>
              )}
            </div>
          </div>

          <div className="flex min-h-[60vh] flex-col rounded-xl border border-white/10 bg-[#0d0a02]">
            {!active ? (
              <div className="flex flex-1 items-center justify-center p-10 text-center text-white/40">
                <p>Pick a conversation — or start a new one.<br />Mutual followers land straight in the inbox; everyone else goes to requests.</p>
              </div>
            ) : (
              <>
                {/* Thread header: profile link + money path (store / tip) */}
                <div className="flex items-center justify-between border-b border-white/10 p-4">
                  <div className="flex items-center gap-3">
                    {other?.profile?.avatarUrl && <img src={other.profile.avatarUrl} onError={(e) => { e.currentTarget.style.display = "none"; }} alt="" className="h-10 w-10 rounded-full object-cover" />}
                    <div>
                      {other?.profile
                        ? <Link href={profileLink(other.profile.slug)} className="font-bold text-[#e8c86a] hover:underline">{other.profile.displayName}</Link>
                        : <span className="font-bold text-white/70">Creator</span>}
                      <p className="text-xs text-white/40">{status === "request" ? "Message request" : "Inbox"}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {other?.profile && (
                      <>
                        <Link href={profileLink(other.profile.slug)} className={ghostButton} title="Their profile, store & tip jar live here">
                          <span className="inline-flex items-center gap-1.5"><Store className="h-3.5 w-3.5" /> Store</span>
                        </Link>
                        <Link href="/tips" className={ghostButton} title="Tip them for the work">
                          <span className="inline-flex items-center gap-1.5"><HeartHandshake className="h-3.5 w-3.5" /> Tip</span>
                        </Link>
                      </>
                    )}
                    <button type="button" onClick={block} className="text-white/40 hover:text-red-400" title="Block">
                      <Ban className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                {/* Thread search: filters the messages loaded in this
                    thread, matches lit up in place; the scope line
                    states the loaded window out loud. */}
                <div className="border-b border-white/10 px-4 py-2.5">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35" />
                    <input value={threadQuery} onChange={(e) => setThreadQuery(e.target.value)}
                      placeholder="Search this thread…"
                      data-testid="dm-thread-search"
                      className="w-full rounded-full border border-white/15 bg-black/40 py-1.5 pl-9 pr-8 text-sm text-white placeholder:text-white/35 focus:border-[#e8c86a]/60 focus:outline-none" />
                    {threadQuery && (
                      <button type="button" onClick={() => setThreadQuery("")} title="Clear search"
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-white/40 hover:text-white">
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                  {threadQuery.trim() && !threadLoading && !threadError && (
                    <p className="mt-1.5 text-[11px] text-white/40" data-testid="dm-thread-search-scope">
                      {visibleMsgs.length} of {msgs.length} loaded messages match — search covers the latest 50 messages in this thread.
                    </p>
                  )}
                </div>

                {status === "request" && !active.requested_by_me && (
                  <div className="flex items-center justify-center gap-3 border-b border-white/10 bg-[#e8c86a]/5 p-3 text-sm">
                    <span className="text-white/70">They want to chat — accept?</span>
                    <button type="button" onClick={accept} className={goldButton}>
                      <span className="inline-flex items-center gap-1.5"><Check className="h-4 w-4" /> Accept</span>
                    </button>
                    <button type="button" onClick={decline} className={ghostButton}>
                      <span className="inline-flex items-center gap-1.5"><X className="h-4 w-4" /> Decline</span>
                    </button>
                  </div>
                )}

                <div className="flex-1 space-y-3 overflow-y-auto p-4">
                  {threadLoading ? <Loading label="Loading thread" /> : threadError ? (
                    <ErrorBox message={threadError} onRetry={() => activeId && loadThread(activeId)} />
                  ) : threadQuery.trim() && visibleMsgs.length === 0 ? (
                    <p className="py-8 text-center text-sm text-white/40">Nothing in this thread matches that search.</p>
                  ) : visibleMsgs.map((m) => {
                    const mine = m.senderUserId === user?.id;
                    const att = dmAttachmentOf(m);
                    return (
                      <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                        <div className={`max-w-[75%] rounded-2xl px-4 py-2 ${mine ? "bg-[#e8c86a] text-black" : "bg-white/10 text-white"}`}>
                          {att && (
                            <div className={m.body ? "mb-2" : ""}>
                              <MsgAttachment att={att} mine={mine} query={threadQuery} />
                            </div>
                          )}
                          {m.body && (
                            <p className="whitespace-pre-wrap text-sm">
                              <HighlightedBody body={m.body} query={threadQuery} mine={mine} />
                            </p>
                          )}
                          <p className={`mt-1 text-[10px] ${mine ? "text-black/50" : "text-white/40"}`}>{timeAgo(m.created_at)}</p>
                        </div>
                      </div>
                    );
                  })}
                  <div ref={bottomRef} />
                </div>

                {canChat ? (
                  <div className="space-y-2 border-t border-white/10 p-4">
                    {uploading && (
                      <p className="text-xs text-white/50" data-testid="dm-attachment-uploading">Uploading your work…</p>
                    )}
                    {pendingAtt && (
                      <div className="flex items-center gap-2 rounded-lg border border-[#e8c86a]/30 bg-[#e8c86a]/10 px-3 py-2 text-sm"
                        data-testid="dm-pending-attachment">
                        {pendingAtt.type === "audio" ? <Music2 className="h-4 w-4 shrink-0 text-[#e8c86a]" />
                          : pendingAtt.type === "video" ? <Clapperboard className="h-4 w-4 shrink-0 text-[#e8c86a]" />
                          : pendingAtt.type === "image" ? <ImageIcon className="h-4 w-4 shrink-0 text-[#e8c86a]" />
                          : <FileIcon className="h-4 w-4 shrink-0 text-[#e8c86a]" />}
                        <span className="min-w-0 flex-1 truncate">
                          {dmWorkLabel(pendingAtt.type)} ready to hand off: {pendingAtt.name}
                        </span>
                        <button type="button" onClick={() => setPendingAtt(null)} title="Remove attachment"
                          data-testid="dm-pending-attachment-remove" className="shrink-0 text-white/50 hover:text-white">
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    )}
                    {showLink && (
                      <div className="flex gap-2">
                        <input value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)}
                          placeholder="Link to your file (https://…/beat.mp3)"
                          data-testid="dm-attach-link-input"
                          className={goldInput} onKeyDown={(e) => e.key === "Enter" && attachByUrl()} />
                        <button type="button" onClick={attachByUrl} disabled={!linkUrl.trim()} className={goldButton}
                          data-testid="dm-attach-link-confirm">
                          Attach
                        </button>
                      </div>
                    )}
                    <div className="flex items-center gap-2">
                      <EmojiTray onPickToken={insertDraftToken} />
                      <input ref={fileRef} type="file" accept="audio/*,video/*,image/*" className="hidden"
                        data-testid="dm-attach-input"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          e.target.value = "";
                          if (f) void uploadFile(f);
                        }} />
                      <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading}
                        title="Attach a beat, cover, or clip (images up to 10 MB, audio/video up to 80 MB)"
                        data-testid="dm-attach-button"
                        className="shrink-0 rounded-full border border-white/20 p-2 text-white/70 transition hover:border-[#e8c86a]/60 hover:text-[#e8c86a] disabled:opacity-40">
                        <Paperclip className="h-4 w-4" />
                      </button>
                      <button type="button" onClick={() => setShowLink((s) => !s)} disabled={uploading}
                        title="Attach by link — a file of yours hosted elsewhere; it's mirrored into your storage when it sends"
                        data-testid="dm-attach-link-toggle"
                        className="shrink-0 rounded-full border border-white/20 p-2 text-white/70 transition hover:border-[#e8c86a]/60 hover:text-[#e8c86a] disabled:opacity-40">
                        <Link2 className="h-4 w-4" />
                      </button>
                      <input ref={draftRef} value={draft} onChange={(e) => updateDraft(e.target.value)} placeholder="Type a message…"
                        maxLength={2000} className={goldInput} onKeyDown={(e) => e.key === "Enter" && send()} />
                      <button type="button" onClick={send} disabled={!dmCanSend(draft, pendingAtt !== null) || uploading} className={goldButton}>
                        <Send className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                ) : status === "request" && active.requested_by_me ? (
                  <p className="border-t border-white/10 p-4 text-center text-sm text-white/40">
                    Request sent — they'll see it in their requests. 🤝
                  </p>
                ) : null}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
