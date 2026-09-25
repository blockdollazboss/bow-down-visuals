import { useEffect, useState } from "react";
import { Link } from "wouter";
import {
  Trophy, Loader2, AlertTriangle, ArrowLeft, Sparkles, Plus,
  Users, CheckCircle2, Dices, Image as ImageIcon, Download,
  ShieldCheck, Copy,
} from "lucide-react";
import { MarketingNav } from "@/components/MarketingNav";
import { SiteFooter } from "@/components/layout/footer";
import { useAuth } from "@/contexts/AuthContext";
import { OutOfCredits } from "@/components/OutOfCredits";
import {
  ENTRY_METHOD_CATALOG,
  shortSeed,
  formatDrawnAt,
  statusLabel,
} from "@/lib/contests";

/* ─── Fan Contests ──────────────────────────────────────────────────────
   Creators run giveaways: prize, rules, entry methods (follow / comment /
   share / purchase), an entry-tracking dashboard, a provably-fair winner
   draw (seeded random + audit log anyone can verify), and an AI
   winner-announcement graphic.

   Money model: contests are FREE to run — building, tracking entries,
   verifying, and drawing the winner are pure interface. Only the AI
   announcement graphic charges (1 credit). */

interface ContestSummary {
  id: string;
  title: string;
  prize: string;
  description: string;
  rules: string;
  entryMethods: string[];
  startsAt: string | null;
  endsAt: string | null;
  status: string;
  winnerEntryId: string | null;
  drawAudit: DrawAudit | null;
  announcementImageUrl: string | null;
  entryCount: number;
  createdAt: string;
}

interface ContestEntry {
  id: string;
  handle: string;
  email: string | null;
  entry_method: string;
  is_verified: boolean;
  created_at: string;
}

interface DrawAudit {
  algorithm?: string;
  seed?: string;
  entryCount?: number;
  entryIds?: string[];
  winnerEntryId?: string;
  winnerIndex?: number;
  drawnAt?: string;
  drawnBy?: string;
}

type View = { name: "list" } | { name: "detail"; id: string };

const STATUS_STYLES: Record<string, string> = {
  draft: "border-white/15 bg-white/5 text-white/60",
  active: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  ended: "border-primary/30 bg-primary/10 text-primary",
};

export default function Contests() {
  const { user } = useAuth();
  const [view, setView] = useState<View>({ name: "list" });
  const [contests, setContests] = useState<ContestSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /* ── Builder form state ── */
  const [showBuilder, setShowBuilder] = useState(false);
  const [title, setTitle] = useState("");
  const [prize, setPrize] = useState("");
  const [description, setDescription] = useState("");
  const [rules, setRules] = useState("");
  const [methods, setMethods] = useState<Set<string>>(new Set(["follow", "comment"]));
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [creating, setCreating] = useState(false);

  /* ── Detail state ── */
  const [detail, setDetail] = useState<ContestSummary | null>(null);
  const [entries, setEntries] = useState<ContestEntry[]>([]);
  const [stats, setStats] = useState<{ total: number; verified: number; byMethod: Record<string, number> } | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  /* ── Add-entry form ── */
  const [entryHandle, setEntryHandle] = useState("");
  const [entryMethod, setEntryMethod] = useState("follow");
  const [addingEntry, setAddingEntry] = useState(false);

  /* ── Draw + announce ── */
  const [drawing, setDrawing] = useState(false);
  const [winner, setWinner] = useState<ContestEntry | null>(null);
  const [announcing, setAnnouncing] = useState(false);
  const [announceUrl, setAnnounceUrl] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const [copied, setCopied] = useState(false);

  async function loadContests() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/contests");
      if (!res.ok) throw new Error("Could not load contests");
      const data = (await res.json()) as { contests?: ContestSummary[] };
      setContests(data.contests ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load contests");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (user) loadContests();
    else setLoading(false);
  }, [user]);

  async function loadDetail(id: string) {
    setDetailLoading(true);
    setError(null);
    setWinner(null);
    try {
      const res = await fetch(`/api/contests/${id}`);
      if (!res.ok) throw new Error("Could not load contest");
      const data = (await res.json()) as {
        contest?: ContestSummary;
        entries?: ContestEntry[];
        stats?: { total: number; verified: number; byMethod: Record<string, number> };
      };
      setDetail(data.contest ?? null);
      setEntries(data.entries ?? []);
      setStats(data.stats ?? null);
      setEntryMethod(data.contest?.entryMethods?.[0] ?? "follow");
      setAnnounceUrl(data.contest?.announcementImageUrl ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load contest");
    } finally {
      setDetailLoading(false);
    }
  }

  function openDetail(id: string) {
    setView({ name: "detail", id });
    loadDetail(id);
  }

  function backToList() {
    setView({ name: "list" });
    setDetail(null);
    loadContests();
  }

  function toggleMethod(key: string) {
    setMethods((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function createContest() {
    if (!title.trim() || !prize.trim() || methods.size === 0 || creating) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/contests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          prize: prize.trim(),
          description: description.trim(),
          rules: rules.trim(),
          entryMethods: [...methods],
          startsAt: startsAt || null,
          endsAt: endsAt || null,
          status: "active",
        }),
      });
      const data = (await res.json()) as { contest?: ContestSummary; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Could not create contest");
      setShowBuilder(false);
      setTitle("");
      setPrize("");
      setDescription("");
      setRules("");
      setStartsAt("");
      setEndsAt("");
      openDetail(data.contest!.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create contest");
    } finally {
      setCreating(false);
    }
  }

  async function addEntry() {
    if (!detail || !entryHandle.trim() || addingEntry) return;
    setAddingEntry(true);
    setError(null);
    try {
      const res = await fetch(`/api/contests/${detail.id}/entries`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ handle: entryHandle.trim(), entryMethod }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Could not add entry");
      setEntryHandle("");
      loadDetail(detail.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add entry");
    } finally {
      setAddingEntry(false);
    }
  }

  async function toggleVerify(entry: ContestEntry) {
    if (!detail) return;
    try {
      const res = await fetch(`/api/contests/${detail.id}/entries/${entry.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isVerified: !entry.is_verified }),
      });
      if (!res.ok) throw new Error("Could not update entry");
      setEntries((prev) =>
        prev.map((e) => (e.id === entry.id ? { ...e, is_verified: !e.is_verified } : e)),
      );
      setStats((s) =>
        s ? { ...s, verified: s.verified + (entry.is_verified ? -1 : 1) } : s,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update entry");
    }
  }

  async function drawWinner() {
    if (!detail || drawing) return;
    if (!window.confirm("Draw the winner now? This ends the contest and locks the audit log.")) return;
    setDrawing(true);
    setError(null);
    try {
      const res = await fetch(`/api/contests/${detail.id}/draw`, { method: "POST" });
      const data = (await res.json()) as {
        winner?: ContestEntry;
        contest?: ContestSummary;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? "Could not draw winner");
      setWinner(data.winner ?? null);
      loadDetail(detail.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not draw winner");
    } finally {
      setDrawing(false);
    }
  }

  async function generateAnnouncement() {
    if (!detail || announcing) return;
    setAnnouncing(true);
    setError(null);
    setOutOfCredits(false);
    try {
      const res = await fetch(`/api/contests/${detail.id}/announce`, { method: "POST" });
      const data = (await res.json()) as { url?: string; error?: string };
      if (res.status === 402) {
        setOutOfCredits(true);
        return;
      }
      if (!res.ok) throw new Error(data.error ?? "Could not generate announcement");
      setAnnounceUrl(data.url ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not generate announcement");
    } finally {
      setAnnouncing(false);
    }
  }

  function copySeed() {
    const seed = detail?.drawAudit?.seed;
    if (!seed) return;
    void navigator.clipboard.writeText(seed).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <div className="min-h-screen bg-black text-white">
      <MarketingNav />
      <main className="mx-auto max-w-5xl px-4 py-10">
        <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-white/40 hover:text-white/70 mb-6">
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>

        <div className="flex items-center gap-3 mb-2">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/15 text-primary">
            <Trophy className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-2xl font-black">Fan Contests</h1>
            <p className="text-sm text-white/45">
              Giveaways with provably-fair winner draws — free to run
            </p>
          </div>
        </div>

        <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-3">
          <Sparkles className="h-4 w-4 text-primary/70 shrink-0 mt-0.5" />
          <p className="text-xs text-white/55 leading-relaxed">
            Run giveaways with entry tracking and a <span className="text-white/80 font-semibold">verifiable random draw</span> —
            the seed, entry list, and algorithm are published in an audit log so anyone can re-run the draw.
            Only the AI winner-announcement graphic costs a credit (1). Everything else is free.
          </p>
        </div>

        {outOfCredits && (
          <div className="mt-4"><OutOfCredits /></div>
        )}

        {error && (
          <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-red-500/25 bg-red-500/5 px-4 py-3">
            <AlertTriangle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
            <p className="text-sm text-red-200/80">{error}</p>
          </div>
        )}

        {!user ? (
          <div className="mt-8 rounded-2xl border border-white/[0.08] bg-white/[0.02] p-8 text-center">
            <p className="text-white/60">Sign in to run contests for your fans.</p>
            <Link href="/login" className="mt-4 inline-block rounded-xl bg-primary px-6 py-2.5 text-sm font-bold text-black hover:brightness-110">
              Sign in
            </Link>
          </div>
        ) : view.name === "list" ? (
          <>
            <div className="mt-6 flex items-center justify-between">
              <h2 className="text-lg font-bold">Your contests</h2>
              <button
                onClick={() => setShowBuilder((s) => !s)}
                className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-bold text-black hover:brightness-110"
              >
                <Plus className="h-4 w-4" /> New contest
              </button>
            </div>

            {showBuilder && (
              <div className="mt-4 rounded-2xl border border-white/[0.08] bg-white/[0.02] p-6 space-y-4">
                <div className="grid sm:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="ct-title" className="text-xs font-bold text-white/40 uppercase tracking-wider">Contest title</label>
                    <input
                      id="ct-title"
                      value={title}
                      onChange={(e) => setTitle(e.target.value.slice(0, 120))}
                      placeholder="e.g. Gold Chain Giveaway"
                      maxLength={120}
                      className="mt-2 w-full rounded-xl border border-white/[0.12] bg-white/[0.03] px-4 py-3 text-white placeholder:text-white/25 outline-none focus:border-primary/60"
                    />
                  </div>
                  <div>
                    <label htmlFor="ct-prize" className="text-xs font-bold text-white/40 uppercase tracking-wider">Prize</label>
                    <input
                      id="ct-prize"
                      value={prize}
                      onChange={(e) => setPrize(e.target.value.slice(0, 200))}
                      placeholder="e.g. 24k gold chain + shoutout"
                      maxLength={200}
                      className="mt-2 w-full rounded-xl border border-white/[0.12] bg-white/[0.03] px-4 py-3 text-white placeholder:text-white/25 outline-none focus:border-primary/60"
                    />
                  </div>
                </div>
                <div>
                  <label htmlFor="ct-desc" className="text-xs font-bold text-white/40 uppercase tracking-wider">Description</label>
                  <textarea
                    id="ct-desc"
                    value={description}
                    onChange={(e) => setDescription(e.target.value.slice(0, 2000))}
                    placeholder="What is this giveaway about?"
                    rows={2}
                    className="mt-2 w-full rounded-xl border border-white/[0.12] bg-white/[0.03] px-4 py-3 text-white placeholder:text-white/25 outline-none focus:border-primary/60"
                  />
                </div>
                <div>
                  <label htmlFor="ct-rules" className="text-xs font-bold text-white/40 uppercase tracking-wider">Rules</label>
                  <textarea
                    id="ct-rules"
                    value={rules}
                    onChange={(e) => setRules(e.target.value.slice(0, 4000))}
                    placeholder="Eligibility, deadlines, how the winner is picked…"
                    rows={2}
                    className="mt-2 w-full rounded-xl border border-white/[0.12] bg-white/[0.03] px-4 py-3 text-white placeholder:text-white/25 outline-none focus:border-primary/60"
                  />
                </div>
                <div>
                  <p className="text-xs font-bold text-white/40 uppercase tracking-wider mb-2">Entry methods</p>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {ENTRY_METHOD_CATALOG.map((m) => (
                      <button
                        key={m.key}
                        onClick={() => toggleMethod(m.key)}
                        className={`rounded-xl border px-3 py-2.5 text-left transition ${
                          methods.has(m.key)
                            ? "border-primary/60 bg-primary/10"
                            : "border-white/[0.12] bg-white/[0.02] hover:border-white/25"
                        }`}
                      >
                        <p className="text-sm font-bold">{m.label}</p>
                        <p className="text-[11px] text-white/45">{m.blurb}</p>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="grid sm:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="ct-start" className="text-xs font-bold text-white/40 uppercase tracking-wider">Starts (optional)</label>
                    <input
                      id="ct-start"
                      type="datetime-local"
                      value={startsAt}
                      onChange={(e) => setStartsAt(e.target.value)}
                      className="mt-2 w-full rounded-xl border border-white/[0.12] bg-white/[0.03] px-4 py-3 text-white outline-none focus:border-primary/60"
                    />
                  </div>
                  <div>
                    <label htmlFor="ct-end" className="text-xs font-bold text-white/40 uppercase tracking-wider">Ends (optional)</label>
                    <input
                      id="ct-end"
                      type="datetime-local"
                      value={endsAt}
                      onChange={(e) => setEndsAt(e.target.value)}
                      className="mt-2 w-full rounded-xl border border-white/[0.12] bg-white/[0.03] px-4 py-3 text-white outline-none focus:border-primary/60"
                    />
                  </div>
                </div>
                <button
                  onClick={createContest}
                  disabled={creating || !title.trim() || !prize.trim() || methods.size === 0}
                  className="inline-flex items-center gap-2 rounded-xl bg-primary px-6 py-2.5 text-sm font-bold text-black hover:brightness-110 disabled:opacity-40"
                >
                  {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trophy className="h-4 w-4" />}
                  Launch contest — free
                </button>
              </div>
            )}

            {loading ? (
              <div className="mt-8 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
            ) : contests.length === 0 ? (
              <div className="mt-8 rounded-2xl border border-white/[0.08] bg-white/[0.02] p-10 text-center">
                <Trophy className="h-8 w-8 text-primary/50 mx-auto mb-3" />
                <p className="text-white/60">No contests yet. Launch your first giveaway — it's free.</p>
              </div>
            ) : (
              <div className="mt-4 grid sm:grid-cols-2 gap-4">
                {contests.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => openDetail(c.id)}
                    className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5 text-left hover:border-primary/40 transition"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="font-bold">{c.title}</h3>
                      <span className={`shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${STATUS_STYLES[c.status] ?? STATUS_STYLES.draft}`}>
                        {statusLabel(c.status)}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-primary/90">🏆 {c.prize}</p>
                    <div className="mt-3 flex items-center gap-4 text-xs text-white/45">
                      <span className="inline-flex items-center gap-1"><Users className="h-3.5 w-3.5" /> {c.entryCount} entries</span>
                      <span>{c.entryMethods.length} entry methods</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </>
        ) : (
          /* ── Detail view ── */
          <div className="mt-6">
            <button onClick={backToList} className="inline-flex items-center gap-1.5 text-sm text-white/40 hover:text-white/70 mb-4">
              <ArrowLeft className="h-4 w-4" /> All contests
            </button>
            {detailLoading || !detail ? (
              <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
            ) : (
              <div className="space-y-6">
                <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-6">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h2 className="text-xl font-black">{detail.title}</h2>
                      <p className="mt-1 text-primary font-semibold">🏆 {detail.prize}</p>
                      {detail.description && <p className="mt-2 text-sm text-white/60">{detail.description}</p>}
                    </div>
                    <span className={`shrink-0 rounded-full border px-3 py-1 text-xs font-bold ${STATUS_STYLES[detail.status] ?? STATUS_STYLES.draft}`}>
                      {statusLabel(detail.status)}
                    </span>
                  </div>
                  {detail.rules && (
                    <div className="mt-4 rounded-xl bg-black/40 border border-white/[0.06] p-4">
                      <p className="text-xs font-bold text-white/40 uppercase tracking-wider mb-1">Rules</p>
                      <p className="text-sm text-white/65 whitespace-pre-wrap">{detail.rules}</p>
                    </div>
                  )}
                  {stats && (
                    <div className="mt-4 grid grid-cols-3 gap-3">
                      <div className="rounded-xl border border-white/[0.08] p-3 text-center">
                        <p className="text-xl font-black text-primary">{stats.total}</p>
                        <p className="text-[11px] text-white/45">Total entries</p>
                      </div>
                      <div className="rounded-xl border border-white/[0.08] p-3 text-center">
                        <p className="text-xl font-black text-emerald-400">{stats.verified}</p>
                        <p className="text-[11px] text-white/45">Verified</p>
                      </div>
                      <div className="rounded-xl border border-white/[0.08] p-3 text-center">
                        <p className="text-xl font-black">{detail.entryMethods.length}</p>
                        <p className="text-[11px] text-white/45">Entry methods</p>
                      </div>
                    </div>
                  )}
                  {stats && Object.keys(stats.byMethod).length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {Object.entries(stats.byMethod).map(([m, n]) => (
                        <span key={m} className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-xs text-white/60">
                          {ENTRY_METHOD_CATALOG.find((c) => c.key === m)?.label ?? m}: <b className="text-white/85">{n}</b>
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* ── Entries ── */}
                {detail.status !== "ended" && (
                  <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-6">
                    <h3 className="font-bold mb-1">Track entries</h3>
                    <p className="text-xs text-white/45 mb-4">Log entries as they come in. Verify each one (fraud check) — only verified entries can win.</p>
                    <div className="flex flex-col sm:flex-row gap-2">
                      <input
                        value={entryHandle}
                        onChange={(e) => setEntryHandle(e.target.value.slice(0, 80))}
                        placeholder="@handle or email"
                        maxLength={80}
                        className="flex-1 rounded-xl border border-white/[0.12] bg-white/[0.03] px-4 py-2.5 text-white placeholder:text-white/25 outline-none focus:border-primary/60"
                      />
                      <select
                        value={entryMethod}
                        onChange={(e) => setEntryMethod(e.target.value)}
                        className="rounded-xl border border-white/[0.12] bg-white/[0.03] px-4 py-2.5 text-white outline-none focus:border-primary/60"
                      >
                        {detail.entryMethods.map((m) => (
                          <option key={m} value={m} className="bg-black">
                            {ENTRY_METHOD_CATALOG.find((c) => c.key === m)?.label ?? m}
                          </option>
                        ))}
                      </select>
                      <button
                        onClick={addEntry}
                        disabled={addingEntry || !entryHandle.trim()}
                        className="rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-black hover:brightness-110 disabled:opacity-40"
                      >
                        {addingEntry ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add entry"}
                      </button>
                    </div>
                    {entries.length > 0 && (
                      <div className="mt-4 divide-y divide-white/[0.06]">
                        {entries.map((e) => (
                          <div key={e.id} className="flex items-center gap-3 py-2.5">
                            <span className="text-sm font-semibold flex-1 truncate">{e.handle}</span>
                            <span className="text-[11px] text-white/40 rounded-full border border-white/10 px-2 py-0.5">
                              {ENTRY_METHOD_CATALOG.find((c) => c.key === e.entry_method)?.label ?? e.entry_method}
                            </span>
                            <button
                              onClick={() => toggleVerify(e)}
                              className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-bold transition ${
                                e.is_verified
                                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                                  : "border-white/15 text-white/45 hover:border-white/30"
                              }`}
                              title={e.is_verified ? "Verified — click to unverify" : "Click to verify (fraud check passed)"}
                            >
                              <ShieldCheck className="h-3 w-3" />
                              {e.is_verified ? "Verified" : "Verify"}
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* ── Winner / audit ── */}
                <div className="rounded-2xl border border-primary/20 bg-primary/[0.04] p-6">
                  <h3 className="font-bold flex items-center gap-2"><Dices className="h-4 w-4 text-primary" /> Winner draw</h3>
                  {detail.winnerEntryId ? (
                    <div className="mt-3 space-y-4">
                      <div className="flex items-center gap-2 text-emerald-300">
                        <CheckCircle2 className="h-5 w-5" />
                        <p className="font-bold">
                          Winner: {winner?.handle ?? entries.find((e) => e.id === detail.winnerEntryId)?.handle ?? "—"}
                        </p>
                      </div>
                      {detail.drawAudit && (
                        <div className="rounded-xl bg-black/40 border border-white/[0.06] p-4 space-y-2">
                          <p className="text-xs font-bold text-white/40 uppercase tracking-wider">Provably-fair audit log</p>
                          <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
                            <p className="text-white/50">Algorithm: <span className="text-white/85 font-mono">{detail.drawAudit.algorithm ?? "—"}</span></p>
                            <p className="text-white/50">Entries in draw: <span className="text-white/85 font-bold">{detail.drawAudit.entryCount ?? "—"}</span></p>
                            <p className="text-white/50">Winner index: <span className="text-white/85 font-bold">{detail.drawAudit.winnerIndex ?? "—"}</span></p>
                            <p className="text-white/50">Drawn: <span className="text-white/85">{formatDrawnAt(detail.drawAudit.drawnAt)}</span></p>
                          </div>
                          <div className="flex items-center gap-2 pt-1">
                            <p className="text-xs text-white/50">Seed: <span className="font-mono text-white/85">{shortSeed(detail.drawAudit.seed)}</span></p>
                            <button
                              onClick={copySeed}
                              className="inline-flex items-center gap-1 rounded-lg border border-white/15 px-2 py-1 text-[11px] text-white/60 hover:border-white/30"
                            >
                              <Copy className="h-3 w-3" /> {copied ? "Copied!" : "Copy full seed"}
                            </button>
                          </div>
                          <p className="text-[11px] text-white/35 leading-relaxed">
                            Anyone can verify: sort the entry IDs, recompute sha256(contestId | entryIds | drawnAt),
                            and re-run the draw — the same seed always picks the same winner.
                          </p>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="mt-3">
                      <p className="text-sm text-white/55 mb-3">
                        Draws only from <b className="text-white/80">verified</b> entries. The draw is seeded and logged —
                        publish the audit so your fans can verify it was fair.
                      </p>
                      <button
                        onClick={drawWinner}
                        disabled={drawing || (stats?.verified ?? 0) === 0}
                        className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-black hover:brightness-110 disabled:opacity-40"
                      >
                        {drawing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Dices className="h-4 w-4" />}
                        Draw winner — free
                      </button>
                      {(stats?.verified ?? 0) === 0 && (
                        <p className="mt-2 text-xs text-white/40">Verify at least one entry first.</p>
                      )}
                    </div>
                  )}
                </div>

                {/* ── Announcement graphic ── */}
                {detail.winnerEntryId && (
                  <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-6">
                    <h3 className="font-bold flex items-center gap-2"><ImageIcon className="h-4 w-4 text-primary" /> Winner announcement</h3>
                    <p className="text-xs text-white/45 mt-1 mb-4">AI-generated gold/black announcement graphic with the winner's handle — 1 credit.</p>
                    {announceUrl ? (
                      <div>
                        <img src={announceUrl} alt="Winner announcement" className="rounded-xl w-full max-w-md border border-white/10" />
                        <a
                          href={announceUrl}
                          download={`contest-winner-${detail.id}.png`}
                          target="_blank"
                          rel="noopener"
                          className="mt-3 inline-flex items-center gap-1.5 rounded-xl border border-white/15 px-4 py-2 text-sm font-semibold text-white/70 hover:border-white/30"
                        >
                          <Download className="h-4 w-4" /> Download
                        </a>
                      </div>
                    ) : (
                      <button
                        onClick={generateAnnouncement}
                        disabled={announcing}
                        className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-black hover:brightness-110 disabled:opacity-40"
                      >
                        {announcing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                        Generate graphic — 1 credit
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
