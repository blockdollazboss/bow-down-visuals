import { useEffect, useState } from "react";
import {
  Video, Loader2, Sparkles, Settings2, Inbox, BarChart3, CheckCircle2,
  X, Clock, BadgeDollarSign, AlertTriangle, Megaphone, Send, Wand2, Upload,
} from "lucide-react";
import { MarketingNav } from "@/components/MarketingNav";
import { SiteFooter } from "@/components/layout/footer";
import { useAuth } from "@/contexts/AuthContext";
import { OutOfCredits } from "@/components/OutOfCredits";

/* ─── Fan Shoutouts ─────────────────────────────────────────────────────────
   Creators sell personalized video shoutouts to fans.
   v1 honesty contract: setup + request tracking are real. Payment processing
   is "coming soon" — requests land as "pending_payment", no money moves,
   and nothing is ever reported as paid. The UI says so plainly everywhere. */

interface Creator {
  id: string;
  displayName: string;
  priceDollars: number;
  turnaroundDays: number;
  guidelines: string;
}

interface Settings {
  id: string;
  displayName: string;
  priceDollars: number;
  priceCents: number;
  turnaroundDays: number;
  guidelines: string;
  accepting: boolean;
}

interface ShoutoutRequest {
  id: string;
  fanName: string;
  fanEmail: string;
  occasion: string;
  message: string;
  status: string;
  priceDollars: number;
  priceCents: number;
  deliveryUrl: string;
  createdAt: string;
  deliveredAt: string | null;
}

interface Revenue {
  total: number;
  pendingPayment: number;
  accepted: number;
  inProgress: number;
  delivered: number;
  declined: number;
  grossDollars: number;
  netDollars: number;
  platformFeePct: number;
}

const STATUS_LABEL: Record<string, string> = {
  pending_payment: "Awaiting payment",
  accepted: "Accepted",
  in_progress: "Recording",
  delivered: "Delivered",
  declined: "Declined",
};

const STATUS_CLASS: Record<string, string> = {
  pending_payment: "text-amber-300 border-amber-500/40 bg-amber-500/10",
  accepted: "text-sky-300 border-sky-500/40 bg-sky-500/10",
  in_progress: "text-violet-300 border-violet-500/40 bg-violet-500/10",
  delivered: "text-emerald-300 border-emerald-500/40 bg-emerald-500/10",
  declined: "text-white/40 border-white/15 bg-white/5",
};

const OCCASIONS = ["Birthday", "Anniversary", "Graduation", "Hype-up / motivation", "Wedding", "New baby", "Just because"];

function money(d: number): string {
  return `$${d.toFixed(2)}`;
}

const inputCls = "w-full bg-black border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/25 focus:border-yellow-500/50 focus:outline-none";
const labelCls = "block text-xs font-semibold text-white/50 uppercase tracking-wide mb-1.5";

export default function Shoutouts() {
  const { user, getAccessToken } = useAuth();
  const [tab, setTab] = useState<"request" | "creator">("request");

  /* ── Fan side ── */
  const [creators, setCreators] = useState<Creator[]>([]);
  const [creatorsLoading, setCreatorsLoading] = useState(true);
  const [selected, setSelected] = useState<Creator | null>(null);
  const [fanName, setFanName] = useState("");
  const [fanEmail, setFanEmail] = useState("");
  const [occasion, setOccasion] = useState(OCCASIONS[0]!);
  const [customOccasion, setCustomOccasion] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState("");
  const [outOfCredits, setOutOfCredits] = useState(false);

  /* ── Creator side ── */
  const [settings, setSettings] = useState<Settings | null>(null);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [price, setPrice] = useState("25");
  const [turnaround, setTurnaround] = useState("7");
  const [guidelines, setGuidelines] = useState("");
  const [accepting, setAccepting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [requests, setRequests] = useState<ShoutoutRequest[]>([]);
  const [reqLoading, setReqLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState("");
  const [revenue, setRevenue] = useState<Revenue | null>(null);
  const [deliveryUrls, setDeliveryUrls] = useState<Record<string, string>>({});
  const [acting, setActing] = useState("");
  const [uploading, setUploading] = useState<Record<string, boolean>>({});
  const [uploadError, setUploadError] = useState<Record<string, string>>({});

  async function fetchCreators() {
    setCreatorsLoading(true);
    try {
      const res = await fetch("/api/shoutouts/creators");
      const j = await res.json();
      setCreators(j.creators ?? []);
    } catch {
      setCreators([]);
    } finally {
      setCreatorsLoading(false);
    }
  }

  async function fetchCreatorData() {
    if (!user) return;
    setSettingsLoading(true);
    setReqLoading(true);
    try {
      const [sRes, rRes, vRes] = await Promise.all([
        fetch("/api/shoutouts/settings"),
        fetch(`/api/shoutouts/requests${statusFilter ? `?status=${statusFilter}` : ""}`),
        fetch("/api/shoutouts/revenue"),
      ]);
      const s = await sRes.json();
      const r = await rRes.json();
      const v = await vRes.json();
      setSettings(s.settings ?? null);
      if (s.settings) {
        setDisplayName(s.settings.displayName);
        setPrice(String(s.settings.priceDollars));
        setTurnaround(String(s.settings.turnaroundDays));
        setGuidelines(s.settings.guidelines);
        setAccepting(s.settings.accepting);
      }
      setRequests(r.requests ?? []);
      setRevenue(v);
    } catch {
      /* keep prior state */
    } finally {
      setSettingsLoading(false);
      setReqLoading(false);
    }
  }

  useEffect(() => { fetchCreators(); }, []);
  useEffect(() => { if (tab === "creator") fetchCreatorData(); }, [tab, statusFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  async function submitRequest() {
    if (!selected) return;
    setError("");
    setSubmitting(true);
    try {
      const res = await fetch("/api/shoutouts/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          creatorId: selected.id,
          fanName,
          fanEmail,
          occasion: occasion === "Custom…" ? customOccasion : occasion,
          message,
        }),
      });
      const j = await res.json();
      if (!res.ok) {
        setError(j.error || "Couldn't send your request.");
        return;
      }
      setSubmitted(true);
    } catch {
      setError("Network error — try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function polishMessage() {
    if (!user) {
      setAiError("Sign in to use the AI message helper.");
      return;
    }
    setAiError("");
    setAiBusy(true);
    try {
      const res = await fetch("/api/shoutouts/ai-message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          occasion: occasion === "Custom…" ? customOccasion : occasion,
          notes: message,
          creatorName: selected?.displayName ?? "",
        }),
      });
      const j = await res.json();
      if (res.status === 402) {
        setOutOfCredits(true);
        return;
      }
      if (!res.ok) {
        setAiError(j.error || "Couldn't polish your message.");
        return;
      }
      setMessage(j.message);
    } catch {
      setAiError("Network error — try again.");
    } finally {
      setAiBusy(false);
    }
  }

  async function saveSettings() {
    setSaving(true);
    try {
      const res = await fetch("/api/shoutouts/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName,
          priceDollars: Math.max(0, Math.min(999.99, Number(price) || 0)),
          turnaroundDays: Math.max(1, Math.min(90, parseInt(turnaround) || 7)),
          guidelines,
          accepting,
        }),
      });
      const j = await res.json();
      if (res.ok) {
        setSettings(j.settings);
        fetchCreators();
      }
    } finally {
      setSaving(false);
    }
  }

  async function updateRequest(id: string, status: string) {
    setActing(id + status);
    try {
      const res = await fetch(`/api/shoutouts/requests/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, deliveryUrl: deliveryUrls[id] ?? "" }),
      });
      if (res.ok) fetchCreatorData();
    } finally {
      setActing("");
    }
  }

  /* Upload the finished shoutout video through the backend into the
     self-healing generated-clips bucket (free — no credits). The backend
     persists the stable storage ref and re-signs it on read, so the
     creator's dashboard always plays. After a successful upload the URL is
     attached; if the request is already in progress it's marked delivered
     in the same step. */
  async function uploadDeliveryVideo(id: string, currentStatus: string, file: File) {
    setUploading((u) => ({ ...u, [id]: true }));
    setUploadError((e) => ({ ...e, [id]: "" }));
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("Sign in again to upload.");
      const form = new FormData();
      form.append("clip", file, file.name);
      const upRes = await fetch("/api/upload-clip", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      const upData = (await upRes.json().catch(() => ({}))) as {
        url?: string; ref?: string; error?: string; message?: string;
      };
      if (!upRes.ok) throw new Error(upData.message ?? upData.error ?? `Upload failed (${upRes.status})`);
      const stored = upData.ref ?? upData.url;
      if (!stored) throw new Error("Upload succeeded but returned no video reference.");
      const res = await fetch(`/api/shoutouts/requests/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: currentStatus === "in_progress" ? "delivered" : currentStatus,
          deliveryUrl: stored,
        }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `Could not attach the video (${res.status})`);
      }
      setDeliveryUrls((d) => ({ ...d, [id]: "" }));
      fetchCreatorData();
    } catch (err) {
      setUploadError((e) => ({ ...e, [id]: err instanceof Error ? err.message : "Upload failed" }));
    } finally {
      setUploading((u) => ({ ...u, [id]: false }));
    }
  }

  const tabs = [
    { key: "request" as const, label: "Request a Shoutout", icon: Megaphone },
    { key: "creator" as const, label: "Creator Dashboard", icon: Settings2 },
  ];

  return (
    <div className="min-h-screen bg-black text-white">
      <MarketingNav />
      <main className="max-w-6xl mx-auto px-5 md:px-8 py-10">
        <div className="flex items-center gap-3 mb-2">
          <Video className="w-7 h-7 text-yellow-400" />
          <h1 className="text-3xl md:text-4xl font-black tracking-tight">Fan Shoutouts</h1>
        </div>
        <p className="text-white/50 mb-3 max-w-2xl">
          Personalized video shoutouts from your favorite creators — birthdays, hype-ups,
          celebrations. Creators set their price and turnaround; fans request in seconds.
        </p>
        <div className="flex items-start gap-2 mb-8 p-3 rounded-xl border border-amber-500/25 bg-amber-500/[0.06] text-sm text-amber-200/90">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>Payments are coming soon — requests are recorded now and creators fulfill them once checkout goes live. No money moves yet.</span>
        </div>

        <div className="flex gap-2 mb-8">
          {tabs.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold border transition-colors ${
                tab === t.key
                  ? "bg-yellow-500/15 border-yellow-500/40 text-yellow-200"
                  : "border-white/10 text-white/50 hover:text-white hover:border-white/20"
              }`}>
              <t.icon className="w-4 h-4" /> {t.label}
            </button>
          ))}
        </div>

        {tab === "request" && (
          <>
            {creatorsLoading ? (
              <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-yellow-400" /></div>
            ) : creators.length === 0 ? (
              <div className="text-center py-16 text-white/40">
                <Megaphone className="w-10 h-10 mx-auto mb-3 opacity-40" />
                No creators are offering shoutouts yet. Check back soon — or set yours up in the Creator Dashboard.
              </div>
            ) : !selected ? (
              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                {creators.map((c) => (
                  <button key={c.id} onClick={() => { setSelected(c); setSubmitted(false); setError(""); }}
                    className="text-left rounded-2xl border border-white/10 bg-white/[0.02] p-5 hover:border-yellow-500/40 transition-colors">
                    <h3 className="font-bold text-lg">{c.displayName}</h3>
                    <p className="text-yellow-300 font-bold mt-1">{money(c.priceDollars)} <span className="text-white/40 text-xs font-normal">per shoutout</span></p>
                    <p className="text-xs text-white/40 mt-1 flex items-center gap-1"><Clock className="w-3 h-3" /> ~{c.turnaroundDays}-day turnaround</p>
                    {c.guidelines && <p className="text-xs text-white/50 mt-2 line-clamp-2">{c.guidelines}</p>}
                    <span className="inline-flex items-center gap-1 mt-3 text-sm text-yellow-300 font-semibold">Request <Send className="w-3.5 h-3.5" /></span>
                  </button>
                ))}
              </div>
            ) : submitted ? (
              <div className="max-w-xl mx-auto text-center py-12 rounded-2xl border border-emerald-500/25 bg-emerald-500/[0.05] p-8">
                <CheckCircle2 className="w-12 h-12 mx-auto mb-4 text-emerald-400" />
                <h2 className="text-xl font-bold mb-2">Request sent to {selected.displayName}!</h2>
                <p className="text-white/50 text-sm mb-6">
                  They'll review it and record your shoutout. You'll be notified when payment
                  checkout goes live to complete your {money(selected.priceDollars)} order.
                </p>
                <button onClick={() => { setSelected(null); setFanName(""); setFanEmail(""); setMessage(""); }}
                  className="px-5 py-2 rounded-lg border border-white/15 text-sm hover:border-yellow-500/40">
                  Request another
                </button>
              </div>
            ) : (
              <div className="max-w-xl mx-auto rounded-2xl border border-white/10 bg-white/[0.02] p-6">
                <button onClick={() => setSelected(null)} className="text-xs text-white/40 hover:text-white mb-4">← All creators</button>
                <h2 className="text-xl font-bold mb-1">Shoutout from {selected.displayName}</h2>
                <p className="text-sm text-white/40 mb-6">{money(selected.priceDollars)} · ~{selected.turnaroundDays}-day turnaround</p>
                {selected.guidelines && (
                  <div className="mb-5 p-3 rounded-xl border border-white/10 bg-black/40 text-xs text-white/60">
                    <span className="font-semibold text-white/80">Creator guidelines: </span>{selected.guidelines}
                  </div>
                )}
                <div className="space-y-4">
                  <div>
                    <label className={labelCls}>Your name</label>
                    <input value={fanName} onChange={(e) => setFanName(e.target.value)} placeholder="Who's this shoutout for?" className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>Email (optional)</label>
                    <input value={fanEmail} onChange={(e) => setFanEmail(e.target.value)} placeholder="you@example.com" className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>Occasion</label>
                    <select value={occasion} onChange={(e) => setOccasion(e.target.value)} className={`${inputCls} bg-black`}>
                      {OCCASIONS.map((o) => <option key={o}>{o}</option>)}
                      <option>Custom…</option>
                    </select>
                    {occasion === "Custom…" && (
                      <input value={customOccasion} onChange={(e) => setCustomOccasion(e.target.value)} placeholder="Describe the occasion" className={`${inputCls} mt-2`} />
                    )}
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className={`${labelCls} !mb-0`}>Message for the video</label>
                      <button onClick={polishMessage} disabled={aiBusy}
                        className="inline-flex items-center gap-1.5 text-xs font-semibold text-yellow-300 border border-yellow-500/30 rounded-lg px-2.5 py-1 hover:bg-yellow-500/10 disabled:opacity-50">
                        {aiBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wand2 className="w-3 h-3" />}
                        AI polish · 1 credit
                      </button>
                    </div>
                    <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={4}
                      placeholder="e.g. Tell my brother Marcus happy 21st — he's your biggest fan and just got drafted"
                      className={inputCls} />
                    {aiError && <p className="text-xs text-red-400 mt-1">{aiError}</p>}
                    {outOfCredits && <div className="mt-2"><OutOfCredits /></div>}
                  </div>
                  {error && <p className="text-sm text-red-400">{error}</p>}
                  <button onClick={submitRequest} disabled={submitting || !fanName.trim() || !message.trim()}
                    className="w-full inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-yellow-500 text-black font-bold hover:bg-yellow-400 disabled:opacity-40">
                    {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                    Request shoutout · {money(selected.priceDollars)}
                  </button>
                  <p className="text-[11px] text-white/35 text-center">No charge today — payment checkout is coming soon.</p>
                </div>
              </div>
            )}
          </>
        )}

        {tab === "creator" && (
          <>
            {!user ? (
              <div className="text-center py-16 text-white/40">
                <Settings2 className="w-10 h-10 mx-auto mb-3 opacity-40" />
                Sign in to set up your shoutout page and manage requests.
              </div>
            ) : settingsLoading ? (
              <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-yellow-400" /></div>
            ) : (
              <div className="grid lg:grid-cols-3 gap-6">
                <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5 h-fit">
                  <h2 className="font-bold mb-4 flex items-center gap-2"><Settings2 className="w-4 h-4 text-yellow-400" /> Your shoutout page</h2>
                  <div className="space-y-4">
                    <div>
                      <label className={labelCls}>Display name</label>
                      <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Shark King" className={inputCls} />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className={labelCls}>Price (USD)</label>
                        <input value={price} onChange={(e) => setPrice(e.target.value)} type="number" min="0" max="999.99" step="0.01" className={inputCls} />
                      </div>
                      <div>
                        <label className={labelCls}>Turnaround (days)</label>
                        <input value={turnaround} onChange={(e) => setTurnaround(e.target.value)} type="number" min="1" max="90" className={inputCls} />
                      </div>
                    </div>
                    <div>
                      <label className={labelCls}>Guidelines</label>
                      <textarea value={guidelines} onChange={(e) => setGuidelines(e.target.value)} rows={3}
                        placeholder="What you'll say, video length, what you won't do…" className={inputCls} />
                    </div>
                    <label className="flex items-center gap-2 text-sm cursor-pointer">
                      <input type="checkbox" checked={accepting} onChange={(e) => setAccepting(e.target.checked)}
                        className="w-4 h-4 accent-yellow-500" />
                      <span className="text-white/70">Accepting requests (listed publicly)</span>
                    </label>
                    <button onClick={saveSettings} disabled={saving || !displayName.trim()}
                      className="w-full px-5 py-2.5 rounded-xl bg-yellow-500 text-black font-bold hover:bg-yellow-400 disabled:opacity-40">
                      {saving ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : "Save"}
                    </button>
                    <p className="text-[11px] text-white/35">Free to set up. A {revenue?.platformFeePct ?? 10}% platform fee will apply once payments go live.</p>
                  </div>
                </div>

                <div className="lg:col-span-2 space-y-6">
                  <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
                    <h2 className="font-bold mb-4 flex items-center gap-2"><BarChart3 className="w-4 h-4 text-yellow-400" /> Revenue</h2>
                    {revenue ? (
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        {[
                          { label: "Requests", value: String(revenue.total), icon: Inbox },
                          { label: "Delivered", value: String(revenue.delivered), icon: CheckCircle2 },
                          { label: "Gross", value: money(revenue.grossDollars), icon: BadgeDollarSign },
                          { label: "You keep", value: money(revenue.netDollars), icon: Sparkles },
                        ].map((s) => (
                          <div key={s.label} className="rounded-xl border border-white/10 bg-black/40 p-3">
                            <s.icon className="w-4 h-4 text-yellow-400 mb-1" />
                            <p className="text-xl font-black">{s.value}</p>
                            <p className="text-[11px] text-white/40">{s.label}</p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-white/40">No data yet.</p>
                    )}
                    <p className="text-[11px] text-white/35 mt-3">Tracked from real requests. Payments coming soon — nothing claimed as paid.</p>
                  </div>

                  <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
                    <div className="flex items-center justify-between mb-4">
                      <h2 className="font-bold flex items-center gap-2"><Inbox className="w-4 h-4 text-yellow-400" /> Incoming requests</h2>
                      <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); }}
                        className="bg-black border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white/80">
                        <option value="">All statuses</option>
                        {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </select>
                    </div>
                    {reqLoading ? (
                      <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-yellow-400" /></div>
                    ) : requests.length === 0 ? (
                      <p className="text-sm text-white/40 py-6 text-center">No requests yet. Share your shoutout page to get the first one.</p>
                    ) : (
                      <div className="space-y-3">
                        {requests.map((r) => (
                          <div key={r.id} className="rounded-xl border border-white/10 bg-black/40 p-4">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className="font-semibold">{r.fanName} <span className="text-white/40 font-normal text-sm">· {r.occasion}</span></p>
                                <p className="text-sm text-white/60 mt-1">“{r.message}”</p>
                                <p className="text-[11px] text-white/35 mt-1">{money(r.priceDollars)} · {new Date(r.createdAt).toLocaleDateString()}</p>
                                {r.deliveryUrl && (
                                  <a href={r.deliveryUrl} target="_blank" rel="noreferrer" className="text-xs text-yellow-300 underline mt-1 inline-block">View delivered video</a>
                                )}
                              </div>
                              <span className={`shrink-0 text-[11px] font-semibold border rounded-full px-2.5 py-1 ${STATUS_CLASS[r.status] ?? ""}`}>
                                {STATUS_LABEL[r.status] ?? r.status}
                              </span>
                            </div>
                            <div className="flex flex-wrap items-center gap-2 mt-3">
                              {r.status === "pending_payment" && (
                                <button onClick={() => updateRequest(r.id, "accepted")} disabled={!!acting}
                                  className="px-3 py-1.5 rounded-lg bg-yellow-500/15 border border-yellow-500/40 text-yellow-200 text-xs font-bold hover:bg-yellow-500/25">Accept</button>
                              )}
                              {r.status === "accepted" && (
                                <button onClick={() => updateRequest(r.id, "in_progress")} disabled={!!acting}
                                  className="px-3 py-1.5 rounded-lg bg-violet-500/15 border border-violet-500/40 text-violet-200 text-xs font-bold hover:bg-violet-500/25">Start recording</button>
                              )}
                              {r.status === "in_progress" && (
                                <>
                                  <label className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/15 border border-emerald-500/40 text-emerald-200 text-xs font-bold hover:bg-emerald-500/25 cursor-pointer ${uploading[r.id] ? "opacity-50 pointer-events-none" : ""}`}>
                                    {uploading[r.id] ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                                    {uploading[r.id] ? "Uploading…" : "Upload video & deliver"}
                                    <input type="file" accept="video/*" className="hidden"
                                      onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadDeliveryVideo(r.id, r.status, f); e.target.value = ""; }} />
                                  </label>
                                  <input value={deliveryUrls[r.id] ?? ""} onChange={(e) => setDeliveryUrls({ ...deliveryUrls, [r.id]: e.target.value })}
                                    placeholder="…or paste a video URL, then Mark delivered" className="flex-1 min-w-[180px] bg-black border border-white/10 rounded-lg px-3 py-1.5 text-xs placeholder:text-white/25" />
                                  <button onClick={() => updateRequest(r.id, "delivered")} disabled={!!acting}
                                    className="px-3 py-1.5 rounded-lg bg-emerald-500/15 border border-emerald-500/40 text-emerald-200 text-xs font-bold hover:bg-emerald-500/25">Mark delivered</button>
                                </>
                              )}
                              {uploadError[r.id] && (
                                <p className="w-full text-xs text-red-400">{uploadError[r.id]}</p>
                              )}
                              {r.status !== "delivered" && r.status !== "declined" && (
                                <button onClick={() => updateRequest(r.id, "declined")} disabled={!!acting}
                                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-white/15 text-white/50 text-xs hover:border-red-500/40 hover:text-red-300">
                                  <X className="w-3 h-3" /> Decline
                                </button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
