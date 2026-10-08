import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { Send, Check, X, Ban, Plus, Store, HeartHandshake } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import {
  useCommunityApi, Loading, ErrorBox, profileLink, timeAgo,
  goldInput, goldButton, ghostButton,
} from "@/lib/community-ui";

/* ─── /messages — DMs ──────────────────────────────────────────────────────
   Inbox + requests tabs, thread view, rate-limited sends. Every thread
   header links to the other person's profile AND their store (money path:
   DMs surface the creator's store link). Chat is never gated. */

interface ProfileCard { slug: string; displayName: string; avatarUrl: string | null }
interface Conv {
  id: string; status: string; requested_by_me: boolean;
  other: { user_id: string; profile: ProfileCard | null };
  last_message: { body: string; createdAt: string; senderUserId: string } | null;
  unread: number; last_message_at: string | null;
}
interface Msg { id: string; senderUserId: string; body: string; created_at: string }

export default function Messages() {
  const api = useCommunityApi();
  const { user } = useAuth();
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
  const [notice, setNotice] = useState<string | null>(null);
  const [newSlug, setNewSlug] = useState("");
  const [showNew, setShowNew] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  async function loadConvs() {
    try {
      const d = (await api.get("/api/dm/conversations")) as { inbox: Conv[]; requests: Conv[] };
      setInbox(d.inbox); setRequests(d.requests);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load your DMs.");
    } finally { setLoading(false); }
  }

  async function loadThread(id: string) {
    setThreadLoading(true);
    try {
      const d = (await api.get(`/api/dm/${id}/messages`)) as { messages: Msg[]; status: string };
      setMsgs(d.messages); setStatus(d.status);
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Couldn't load messages.");
    } finally { setThreadLoading(false); }
  }

  useEffect(() => {
    loadConvs();
    const params = new URLSearchParams(window.location.search);
    const to = params.get("to");
    if (to) startByUserId(to);
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, []);

  useEffect(() => { if (activeId) loadThread(activeId); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [activeId]);

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

  async function send() {
    if (!draft.trim() || !activeId) return;
    try {
      await api.post(`/api/dm/${activeId}/send`, { body: draft.trim() });
      setDraft("");
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
            ? <img src={c.other.profile.avatarUrl} alt="" className="h-10 w-10 rounded-full object-cover" />
            : <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#e8c86a]/20 text-[#e8c86a] font-bold">{name[0]}</div>}
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-2 font-semibold">
              <span className="truncate">{name}</span>
              {c.unread > 0 && <span className="rounded-full bg-[#e8c86a] px-2 py-0.5 text-[10px] font-bold text-black">{c.unread}</span>}
            </p>
            <p className="truncate text-xs text-white/50">{c.last_message?.body ?? "No messages yet"}</p>
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
            <div className="max-h-[60vh] space-y-2 overflow-y-auto pr-1">
              {list.map(convRow)}
              {list.length === 0 && (
                <p className="py-8 text-center text-sm text-white/40">
                  {tab === "inbox" ? "No conversations yet — go meet some creators." : "No requests. You're all clear."}
                </p>
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
                    {other?.profile?.avatarUrl && <img src={other.profile.avatarUrl} alt="" className="h-10 w-10 rounded-full object-cover" />}
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
                  {threadLoading ? <Loading label="Loading thread" /> : msgs.map((m) => {
                    const mine = m.senderUserId === user?.id;
                    return (
                      <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                        <div className={`max-w-[75%] rounded-2xl px-4 py-2 ${mine ? "bg-[#e8c86a] text-black" : "bg-white/10 text-white"}`}>
                          <p className="whitespace-pre-wrap text-sm">{m.body}</p>
                          <p className={`mt-1 text-[10px] ${mine ? "text-black/50" : "text-white/40"}`}>{timeAgo(m.created_at)}</p>
                        </div>
                      </div>
                    );
                  })}
                  <div ref={bottomRef} />
                </div>

                {canChat ? (
                  <div className="flex gap-2 border-t border-white/10 p-4">
                    <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Type a message…"
                      maxLength={2000} className={goldInput} onKeyDown={(e) => e.key === "Enter" && send()} />
                    <button type="button" onClick={send} disabled={!draft.trim()} className={goldButton}>
                      <Send className="h-4 w-4" />
                    </button>
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
