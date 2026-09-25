import { useState, useEffect, useCallback } from "react";
import {
  Mail, Users, TrendingUp, PenLine, Loader2, Copy, Check, Plus,
  Download, Trash2, Code2, ExternalLink, AlertTriangle, Sparkles,
  Inbox, Send, FileText,
} from "lucide-react";
import { MarketingNav } from "@/components/MarketingNav";
import { SiteFooter } from "@/components/layout/footer";
import { useAuth } from "@/contexts/AuthContext";
import { OutOfCredits } from "@/components/OutOfCredits";
import { CheatCodeName } from "@/components/pixel-headline";

/* ─── Thy Cheat Code's Email List Builder ────────────────────────────────
   Own your audience: hosted landing pages (/join/:handle), embeddable
   signup forms, AI newsletter drafts (1 credit each), subscriber
   dashboard, welcome-email automation, CSV export.

   Pricing rule: lists, subscribers, dashboard, and export are pure
   interface/data — free. Only the AI newsletter writer burns compute
   (1 credit per draft, charged before generation, refunded on failure).

   Honesty (v1): sends go through a simple server-side queue, NOT a
   dedicated email service provider. Deliverability and scale limits are
   disclosed below — never promised. */

type TabKey = "dashboard" | "lists" | "newsletter" | "forms";

interface EmailList {
  id: string;
  name: string;
  handle: string;
  description?: string | null;
  welcomeSubject?: string | null;
  welcomeBody?: string | null;
  createdAt: string;
}

interface Subscriber {
  id: string;
  email: string;
  name?: string | null;
  source: string;
  opens: number;
  unsubscribedAt?: string | null;
  subscribedAt: string;
}

interface ListStats {
  total: number;
  active: number;
  unsubscribed: number;
  openRate: number;
  freeLimit: number;
}

const TONES = [
  { key: "hype", label: "Hype", blurb: "Big-news energy" },
  { key: "behind-the-scenes", label: "Behind the Scenes", blurb: "Studio-diary voice" },
  { key: "personal", label: "Personal", blurb: "Letter to a friend" },
  { key: "announcement", label: "Announcement", blurb: "Facts up front" },
] as const;

const inputClass =
  "w-full rounded-xl border border-white/10 bg-black/60 px-4 py-3 text-sm text-white placeholder:text-white/25 outline-none transition focus:border-primary/60 focus:ring-1 focus:ring-primary/40";

const cardClass =
  "rounded-2xl border border-white/10 bg-white/[0.03] p-5 backdrop-blur";

const tabBtn = (active: boolean) =>
  `flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition ${
    active
      ? "bg-gradient-to-r from-primary to-amber-500 text-black"
      : "border border-white/10 bg-white/[0.03] text-white/60 hover:text-white hover:border-white/20"
  }`;

export default function EmailListBuilder() {
  const { user, getAccessToken, refreshProfile } = useAuth();
  const [tab, setTab] = useState<TabKey>("dashboard");

  const [lists, setLists] = useState<EmailList[]>([]);
  const [activeListId, setActiveListId] = useState<string>("");
  const [subscribers, setSubscribers] = useState<Subscriber[]>([]);
  const [stats, setStats] = useState<ListStats | null>(null);
  const [loading, setLoading] = useState(true);

  /* list creation */
  const [showNewList, setShowNewList] = useState(false);
  const [newName, setNewName] = useState("");
  const [newHandle, setNewHandle] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [creating, setCreating] = useState(false);

  /* newsletter writer */
  const [nlTopic, setNlTopic] = useState("");
  const [nlTone, setNlTone] = useState<string>("hype");
  const [nlCta, setNlCta] = useState("");
  const [nlDraft, setNlDraft] = useState<{ subject: string; body: string } | null>(null);
  const [nlLoading, setNlLoading] = useState(false);

  /* shared */
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  async function authedFetch(path: string, opts: RequestInit = {}) {
    const token = await getAccessToken();
    return fetch(path, {
      ...opts,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(opts.headers ?? {}),
      },
    });
  }

  const loadLists = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await authedFetch("/api/email-list/lists");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Couldn't load your lists.");
      setLists(data.lists ?? []);
      if (data.lists?.length && !activeListId) setActiveListId(data.lists[0].id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load your lists.");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadSubscribers = useCallback(async (listId: string) => {
    if (!listId) return;
    try {
      const res = await authedFetch(`/api/email-list/lists/${listId}/subscribers`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Couldn't load subscribers.");
      setSubscribers(data.subscribers ?? []);
      setStats(data.stats ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load subscribers.");
    }
  }, []);

  useEffect(() => {
    if (user) loadLists();
  }, [user, loadLists]);

  useEffect(() => {
    if (activeListId) loadSubscribers(activeListId);
  }, [activeListId, loadSubscribers]);

  const activeList = lists.find((l) => l.id === activeListId);

  async function createList() {
    if (!newName.trim() || !newHandle.trim()) {
      setError("Give your list a name and a handle.");
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const res = await authedFetch("/api/email-list/lists", {
        method: "POST",
        body: JSON.stringify({
          name: newName.trim(),
          handle: newHandle.trim().toLowerCase(),
          description: newDesc.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Couldn't create the list.");
      setLists((prev) => [data.list, ...prev]);
      setActiveListId(data.list.id);
      setNewName(""); setNewHandle(""); setNewDesc("");
      setShowNewList(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't create the list.");
    } finally {
      setCreating(false);
    }
  }

  async function deleteList(id: string) {
    if (!confirm("Delete this list and all its subscribers? This can't be undone.")) return;
    try {
      const res = await authedFetch(`/api/email-list/lists/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Couldn't delete the list.");
      setLists((prev) => prev.filter((l) => l.id !== id));
      if (activeListId === id) setActiveListId("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't delete the list.");
    }
  }

  async function generateNewsletter() {
    if (!nlTopic.trim()) {
      setError("Tell the AI what the newsletter is about.");
      return;
    }
    setNlLoading(true);
    setError(null);
    setOutOfCredits(false);
    try {
      const res = await authedFetch("/api/email-list/newsletter", {
        method: "POST",
        body: JSON.stringify({
          topic: nlTopic.trim(),
          tone: nlTone,
          creatorName: user?.email?.split("@")[0] ?? "",
          listName: activeList?.name ?? "",
          callToAction: nlCta.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (res.status === 402 || data.error === "out_of_credits") {
        setOutOfCredits(true);
        refreshProfile();
        return;
      }
      if (!res.ok) throw new Error(data.error ?? "Couldn't write the newsletter.");
      setNlDraft({ subject: data.subject, body: data.body });
      refreshProfile();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't write the newsletter.");
    } finally {
      setNlLoading(false);
    }
  }

  function copyText(key: string, text: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(null), 2000);
    });
  }

  const embedSnippet = activeList
    ? `<!-- ${activeList.name} — email signup (Bow Down Visuals) -->\n<form action="https://bowdownvisuals.com/api/email-list/subscribe" method="POST" style="display:flex;gap:8px;max-width:420px">\n  <input type="hidden" name="handle" value="${activeList.handle}" />\n  <input type="email" name="email" required placeholder="you@example.com" style="flex:1;padding:10px 14px;border-radius:10px;border:1px solid #3a2f12;background:#0a0a0a;color:#fff" />\n  <button type="submit" style="padding:10px 18px;border-radius:10px;border:none;background:linear-gradient(135deg,#d4af37,#8a6d1b);color:#000;font-weight:700;cursor:pointer">Join</button>\n</form>`
    : "";

  return (
    <div className="min-h-screen bg-black text-white">
      <MarketingNav />

      <main className="mx-auto max-w-6xl px-5 md:px-8 py-10">
        {/* hero */}
        <div className="text-center">
          <p className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-4 py-1.5 text-xs font-semibold uppercase tracking-widest text-primary">
            <Mail className="h-3.5 w-3.5" /> Own your audience
          </p>
          <h1 className="mt-4 font-display text-4xl md:text-5xl font-black">
            Email List <span className="bg-gradient-to-r from-primary to-amber-300 bg-clip-text text-transparent">Builder</span>
          </h1>
          <p className="mx-auto mt-3 max-w-2xl text-white/55">
            Algorithms change. Your list doesn't. Capture fans, write newsletters
            with AI, and track growth — free up to 1,000 subscribers.
          </p>
        </div>

        {/* tabs */}
        <div className="mt-8 flex flex-wrap justify-center gap-2">
          <button className={tabBtn(tab === "dashboard")} onClick={() => setTab("dashboard")}>
            <TrendingUp className="h-4 w-4" /> Dashboard
          </button>
          <button className={tabBtn(tab === "lists")} onClick={() => setTab("lists")}>
            <Users className="h-4 w-4" /> My Lists
          </button>
          <button className={tabBtn(tab === "newsletter")} onClick={() => setTab("newsletter")}>
            <PenLine className="h-4 w-4" /> AI Newsletter · 1 credit
          </button>
          <button className={tabBtn(tab === "forms")} onClick={() => setTab("forms")}>
            <Code2 className="h-4 w-4" /> Signup Forms
          </button>
        </div>

        {error && (
          <div className="mx-auto mt-6 flex max-w-2xl items-start gap-3 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {outOfCredits && (
          <div className="mx-auto mt-6 max-w-2xl">
            <OutOfCredits />
          </div>
        )}

        {/* ── dashboard ── */}
        {tab === "dashboard" && (
          <div className="mt-8">
            {loading ? (
              <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
            ) : !activeList ? (
              <div className={`${cardClass} text-center`}>
                <Inbox className="mx-auto h-10 w-10 text-white/25" />
                <p className="mt-3 font-semibold">No lists yet</p>
                <p className="mt-1 text-sm text-white/50">Create your first list to start capturing fans.</p>
                <button className={tabBtn(true) + " mt-4"} onClick={() => setTab("lists")}>
                  <Plus className="h-4 w-4" /> Create a list
                </button>
              </div>
            ) : (
              <>
                <div className="mb-4 flex flex-wrap items-center gap-3">
                  <label className="text-sm text-white/50">List:</label>
                  <select
                    value={activeListId}
                    onChange={(e) => setActiveListId(e.target.value)}
                    className="rounded-xl border border-white/10 bg-black/60 px-4 py-2 text-sm text-white outline-none focus:border-primary/60"
                  >
                    {lists.map((l) => (
                      <option key={l.id} value={l.id}>{l.name} (@{l.handle})</option>
                    ))}
                  </select>
                </div>

                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <div className={cardClass}>
                    <p className="flex items-center gap-2 text-xs uppercase tracking-widest text-white/40"><Users className="h-3.5 w-3.5" /> Active subscribers</p>
                    <p className="mt-2 font-display text-3xl font-black text-primary">{stats?.active ?? 0}</p>
                    <p className="mt-1 text-xs text-white/40">of {stats?.freeLimit ?? 1000} free</p>
                  </div>
                  <div className={cardClass}>
                    <p className="flex items-center gap-2 text-xs uppercase tracking-widest text-white/40"><TrendingUp className="h-3.5 w-3.5" /> Total signups</p>
                    <p className="mt-2 font-display text-3xl font-black">{stats?.total ?? 0}</p>
                    <p className="mt-1 text-xs text-white/40">{stats?.unsubscribed ?? 0} unsubscribed</p>
                  </div>
                  <div className={cardClass}>
                    <p className="flex items-center gap-2 text-xs uppercase tracking-widest text-white/40"><Mail className="h-3.5 w-3.5" /> Avg. opens / subscriber</p>
                    <p className="mt-2 font-display text-3xl font-black">{stats?.openRate ?? 0}</p>
                    <p className="mt-1 text-xs text-white/40">best-effort pixel tracking</p>
                  </div>
                  <div className={cardClass}>
                    <p className="flex items-center gap-2 text-xs uppercase tracking-widest text-white/40"><Download className="h-3.5 w-3.5" /> Export</p>
                    <a
                      href={`/api/email-list/lists/${activeListId}/export`}
                      className="mt-3 inline-flex items-center gap-2 rounded-xl border border-primary/40 bg-primary/10 px-4 py-2 text-sm font-semibold text-primary hover:bg-primary/20"
                    >
                      <Download className="h-4 w-4" /> CSV — free
                    </a>
                    <p className="mt-1 text-xs text-white/40">Your data, yours to keep</p>
                  </div>
                </div>

                <div className={`${cardClass} mt-4`}>
                  <h3 className="font-semibold">Recent subscribers</h3>
                  {subscribers.length === 0 ? (
                    <p className="mt-2 text-sm text-white/45">Nobody here yet — share your landing page or embed the form to start growing.</p>
                  ) : (
                    <div className="mt-3 divide-y divide-white/5">
                      {subscribers.slice(0, 10).map((s) => (
                        <div key={s.id} className="flex items-center justify-between py-2.5 text-sm">
                          <div>
                            <p className="font-medium">{s.name || s.email}</p>
                            {s.name && <p className="text-xs text-white/40">{s.email}</p>}
                          </div>
                          <div className="flex items-center gap-3 text-xs text-white/40">
                            <span className="rounded-full border border-white/10 px-2 py-0.5">{s.source}</span>
                            {s.unsubscribedAt && <span className="text-red-300/70">unsubscribed</span>}
                            <span>{new Date(s.subscribedAt).toLocaleDateString()}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {/* ── lists ── */}
        {tab === "lists" && (
          <div className="mt-8">
            <div className="flex justify-end">
              <button className={tabBtn(true)} onClick={() => setShowNewList((v) => !v)}>
                <Plus className="h-4 w-4" /> New list
              </button>
            </div>

            {showNewList && (
              <div className={`${cardClass} mt-4`}>
                <h3 className="font-semibold">Create a list</h3>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <input className={inputClass} placeholder="List name (e.g. Fin Fam)" value={newName} onChange={(e) => setNewName(e.target.value)} />
                  <div>
                    <div className="flex items-center">
                      <span className="rounded-l-xl border border-r-0 border-white/10 bg-white/5 px-3 py-3 text-sm text-white/40">/join/</span>
                      <input className={inputClass + " rounded-l-none"} placeholder="your-handle" value={newHandle} onChange={(e) => setNewHandle(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))} />
                    </div>
                    <p className="mt-1 text-xs text-white/35">Lowercase letters, numbers, hyphens only.</p>
                  </div>
                </div>
                <textarea className={inputClass + " mt-3"} rows={2} placeholder="What do subscribers get? (optional)" value={newDesc} onChange={(e) => setNewDesc(e.target.value)} />
                <button className={tabBtn(true) + " mt-3"} onClick={createList} disabled={creating}>
                  {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  Create list — free
                </button>
              </div>
            )}

            <div className="mt-4 grid gap-4 md:grid-cols-2">
              {lists.map((l) => (
                <div key={l.id} className={cardClass}>
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-semibold">{l.name}</p>
                      <a href={`/join/${l.handle}`} target="_blank" rel="noreferrer" className="mt-0.5 inline-flex items-center gap-1 text-sm text-primary hover:underline">
                        bowdownvisuals.com/join/{l.handle} <ExternalLink className="h-3 w-3" />
                      </a>
                      {l.description && <p className="mt-2 text-sm text-white/50">{l.description}</p>}
                    </div>
                    <button
                      onClick={() => deleteList(l.id)}
                      className="rounded-lg p-2 text-white/30 hover:bg-red-500/10 hover:text-red-300"
                      title="Delete list"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
            {lists.length === 0 && !showNewList && (
              <p className="mt-6 text-center text-sm text-white/45">No lists yet — hit "New list" to create your first one.</p>
            )}
          </div>
        )}

        {/* ── newsletter ── */}
        {tab === "newsletter" && (
          <div className="mt-8 mx-auto max-w-3xl">
            <div className={cardClass}>
              <h3 className="flex items-center gap-2 font-semibold"><Sparkles className="h-4 w-4 text-primary" /> AI newsletter writer</h3>
              <p className="mt-1 text-sm text-white/50">Topic in, full newsletter draft out — subject line, body, and call to action. <span className="text-primary font-semibold">1 credit</span> per draft.</p>

              <textarea className={inputClass + " mt-4"} rows={3} placeholder="What's the newsletter about? (e.g. my new single drops Friday + the story behind it)" value={nlTopic} onChange={(e) => setNlTopic(e.target.value)} />

              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {TONES.map((t) => (
                  <button
                    key={t.key}
                    onClick={() => setNlTone(t.key)}
                    className={`rounded-xl border p-3 text-left transition ${nlTone === t.key ? "border-primary/60 bg-primary/10" : "border-white/10 bg-white/[0.02] hover:border-white/25"}`}
                  >
                    <p className="text-sm font-semibold">{t.label}</p>
                    <p className="text-xs text-white/40">{t.blurb}</p>
                  </button>
                ))}
              </div>

              <input className={inputClass + " mt-3"} placeholder="Call to action (optional — e.g. Pre-save the single)" value={nlCta} onChange={(e) => setNlCta(e.target.value)} />

              <button className={tabBtn(true) + " mt-4"} onClick={generateNewsletter} disabled={nlLoading}>
                {nlLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <PenLine className="h-4 w-4" />}
                Write my newsletter · 1 credit
              </button>
            </div>

            {nlDraft && (
              <div className={`${cardClass} mt-4`}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-widest text-white/40">Subject</p>
                    <p className="mt-1 font-semibold text-primary">{nlDraft.subject}</p>
                  </div>
                  <button onClick={() => copyText("subject", nlDraft.subject)} className="rounded-lg border border-white/10 p-2 text-white/50 hover:text-white" title="Copy subject">
                    {copied === "subject" ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                  </button>
                </div>
                <div className="mt-4 flex items-start justify-between gap-3">
                  <p className="text-xs uppercase tracking-widest text-white/40">Body</p>
                  <button onClick={() => copyText("body", nlDraft.body)} className="rounded-lg border border-white/10 p-2 text-white/50 hover:text-white" title="Copy body">
                    {copied === "body" ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                  </button>
                </div>
                <div className="mt-2 whitespace-pre-wrap rounded-xl bg-black/50 p-4 text-sm leading-relaxed text-white/80">
                  {nlDraft.body}
                </div>
                <p className="mt-3 text-xs text-white/35">AI draft — read it, make it yours, then send it your way.</p>
              </div>
            )}
          </div>
        )}

        {/* ── forms ── */}
        {tab === "forms" && (
          <div className="mt-8 mx-auto max-w-3xl">
            {!activeList ? (
              <div className={`${cardClass} text-center`}>
                <p className="text-sm text-white/50">Create a list first, then grab your signup form and landing page here.</p>
              </div>
            ) : (
              <>
                <div className="mb-4 flex items-center gap-3">
                  <label className="text-sm text-white/50">List:</label>
                  <select
                    value={activeListId}
                    onChange={(e) => setActiveListId(e.target.value)}
                    className="rounded-xl border border-white/10 bg-black/60 px-4 py-2 text-sm text-white outline-none focus:border-primary/60"
                  >
                    {lists.map((l) => (
                      <option key={l.id} value={l.id}>{l.name} (@{l.handle})</option>
                    ))}
                  </select>
                </div>

                <div className={cardClass}>
                  <h3 className="flex items-center gap-2 font-semibold"><ExternalLink className="h-4 w-4 text-primary" /> Hosted landing page</h3>
                  <p className="mt-1 text-sm text-white/50">Send fans here — no website needed.</p>
                  <div className="mt-3 flex items-center gap-2">
                    <code className="flex-1 truncate rounded-xl bg-black/60 px-4 py-3 text-sm text-primary">bowdownvisuals.com/join/{activeList.handle}</code>
                    <button onClick={() => copyText("landing", `https://bowdownvisuals.com/join/${activeList.handle}`)} className="rounded-xl border border-white/10 p-3 text-white/60 hover:text-white" title="Copy link">
                      {copied === "landing" ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                    </button>
                    <a href={`/join/${activeList.handle}`} target="_blank" rel="noreferrer" className="rounded-xl border border-primary/40 bg-primary/10 p-3 text-primary hover:bg-primary/20" title="Open landing page">
                      <Send className="h-4 w-4" />
                    </a>
                  </div>
                </div>

                <div className={`${cardClass} mt-4`}>
                  <h3 className="flex items-center gap-2 font-semibold"><Code2 className="h-4 w-4 text-primary" /> Embed on your own site</h3>
                  <p className="mt-1 text-sm text-white/50">Paste this anywhere — signups land straight in your list. Free.</p>
                  <div className="relative mt-3">
                    <pre className="overflow-x-auto rounded-xl bg-black/60 p-4 text-xs leading-relaxed text-white/70">{embedSnippet}</pre>
                    <button onClick={() => copyText("embed", embedSnippet)} className="absolute right-3 top-3 rounded-lg border border-white/10 bg-black/60 p-2 text-white/60 hover:text-white" title="Copy embed code">
                      {copied === "embed" ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* honesty footer */}
        <div className="mx-auto mt-10 max-w-3xl rounded-2xl border border-white/10 bg-white/[0.02] p-5 text-xs leading-relaxed text-white/40">
          <p className="flex items-start gap-2">
            <FileText className="mt-0.5 h-4 w-4 shrink-0 text-primary/70" />
            <span>
              <span className="font-semibold text-white/60">How sending works (v1):</span> campaigns
              queue through our simple server-side sender — not a dedicated email service provider.
              That means no guaranteed inbox placement, no dedicated IP reputation, and sends are
              best for lists under a few thousand. As your list grows past the free tier, we'll
              graduate you to a proper ESP integration. Open tracking uses a best-effort pixel and
              undercounts privacy-conscious inboxes.
            </span>
          </p>
        </div>

        <p className="relative mt-8 text-center text-sm text-white/40">
          List built? Ask <CheatCodeName /> 🦈 in the
          chat bubble for newsletter ideas that actually get opened.
        </p>
      </main>

      <SiteFooter />
    </div>
  );
}
