import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Users, Plus, Search, Lock, Globe, Crown } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import {
  useCommunityApi, ShareButton, Loading, ErrorBox,
  goldInput, goldButton, ghostButton,
} from "@/lib/community-ui";

/* ─── /groups — browse creator crews ──────────────────────────────────────
   Public grid. Signed-in users can start a group (never gated — 1 star).
   Money path: group owners get a "paid tiers" nudge -> /memberships. */

interface Group {
  id: string; slug: string; name: string; description: string;
  cover_url: string | null; member_count: number; is_public: boolean;
}

export default function Groups() {
  const api = useCommunityApi();
  const { user } = useAuth();
  const [groups, setGroups] = useState<Group[]>([]);
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<"all" | "mine">("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: "", slug: "", description: "", is_public: true });
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [myIds, setMyIds] = useState<Set<string>>(new Set());

  async function load() {
    setLoading(true); setError(null);
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set("q", q.trim());
      if (tab === "mine" && user?.id) params.set("member", user.id);
      const d = (await api.get(`/api/groups${params.toString() ? `?${params}` : ""}`)) as { groups: Group[] };
      setGroups(d.groups);
      if (user?.id) {
        const m = (await api.get(`/api/groups?member=${user.id}`)) as { groups: Group[] };
        setMyIds(new Set(m.groups.map((g) => g.id)));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load groups.");
    } finally { setLoading(false); }
  }

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [tab]);
  useEffect(() => {
    const t = setTimeout(() => load(), 350);
    return () => clearTimeout(t);
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [q]);

  async function create() {
    setCreateError(null); setCreating(true);
    try {
      await api.post("/api/groups", {
        name: form.name.trim(),
        slug: form.slug.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-"),
        description: form.description.trim(),
        is_public: form.is_public,
      });
      setShowCreate(false);
      setForm({ name: "", slug: "", description: "", is_public: true });
      setTab("mine");
      await load();
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : "Couldn't start the group.");
    } finally { setCreating(false); }
  }

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="mx-auto max-w-6xl px-6 py-12">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#e8c86a]">Find your crew</p>
            <h1 className="mt-2 text-4xl font-bold">Groups <span className="text-[#e8c86a]">🦈</span></h1>
            <p className="mt-2 max-w-xl text-white/60">
              Fan crews and creator squads. Join one, run your mouth, build your movement — free to join, always.
            </p>
          </div>
          {user && (
            <button type="button" onClick={() => setShowCreate(true)} className={goldButton}>
              <span className="inline-flex items-center gap-2"><Plus className="h-4 w-4" /> Start a group</span>
            </button>
          )}
        </div>

        <div className="mb-6 flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search groups…"
              className={`${goldInput} pl-9`} />
          </div>
          <div className="flex gap-2">
            {(["all", "mine"] as const).map((t) => (
              <button key={t} type="button" onClick={() => setTab(t)}
                className={`rounded-full px-4 py-1.5 text-sm font-semibold transition ${tab === t ? "bg-[#e8c86a] text-black" : "border border-white/20 text-white/70 hover:border-[#e8c86a]/50"}`}>
                {t === "all" ? "All groups" : "My groups"}
              </button>
            ))}
          </div>
        </div>

        {showCreate && (
          <div className="mb-8 rounded-xl border border-[#e8c86a]/30 bg-[#0d0a02] p-6">
            <h2 className="text-lg font-bold text-[#e8c86a]">Start your crew</h2>
            <p className="mt-1 text-sm text-white/60">You're the owner. Set the vibe, they'll come.</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Group name"
                maxLength={80} className={goldInput} />
              <input value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} placeholder="slug (url-friendly)"
                maxLength={40} className={goldInput} />
              <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="What's this crew about?" maxLength={2000} rows={3} className={`${goldInput} sm:col-span-2`} />
              <label className="flex items-center gap-2 text-sm text-white/70 sm:col-span-2">
                <input type="checkbox" checked={form.is_public} onChange={(e) => setForm({ ...form, is_public: e.target.checked })}
                  className="accent-[#e8c86a]" />
                Public — anyone can find and join
              </label>
            </div>
            {createError && <p className="mt-3 text-sm text-red-300">{createError}</p>}
            <div className="mt-4 flex gap-3">
              <button type="button" onClick={create} disabled={creating || !form.name.trim() || !form.slug.trim()} className={goldButton}>
                {creating ? "Starting…" : "Launch the group"}
              </button>
              <button type="button" onClick={() => setShowCreate(false)} className={ghostButton}>Cancel</button>
            </div>
          </div>
        )}

        {loading ? <Loading label="Finding crews" /> : error ? <ErrorBox message={error} onRetry={load} /> : (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {groups.map((g) => (
              <div key={g.id} className="group rounded-xl border border-white/10 bg-[#0d0a02] p-5 transition hover:border-[#e8c86a]/40">
                {g.cover_url && <img src={g.cover_url} alt="" className="mb-4 h-32 w-full rounded-lg object-cover" />}
                <div className="flex items-start justify-between gap-2">
                  <Link href={`/groups/${g.slug}`} className="text-lg font-bold hover:text-[#e8c86a]">{g.name}</Link>
                  {g.is_public
                    ? <Globe className="h-4 w-4 shrink-0 text-white/40" />
                    : <Lock className="h-4 w-4 shrink-0 text-white/40" />}
                </div>
                <p className="mt-1 line-clamp-2 text-sm text-white/60">{g.description || "No description yet — the vibe speaks for itself."}</p>
                <div className="mt-4 flex items-center justify-between">
                  <span className="inline-flex items-center gap-1.5 text-xs text-white/50">
                    <Users className="h-3.5 w-3.5" /> {g.member_count.toLocaleString()} members
                  </span>
                  <div className="flex items-center gap-2">
                    {myIds.has(g.id) && <Crown className="h-4 w-4 text-[#e8c86a]" />}
                    <ShareButton path={`/groups/${g.slug}`} />
                  </div>
                </div>
                {myIds.has(g.id) && (
                  <Link href="/memberships" className="mt-3 block text-xs text-[#e8c86a]/80 hover:text-[#e8c86a]">
                    💰 Add a paid tier for this crew →
                  </Link>
                )}
              </div>
            ))}
            {groups.length === 0 && (
              <div className="col-span-full rounded-xl border border-white/10 p-10 text-center text-white/50">
                No groups found. {user ? "Start the first one — be the movement." : "Sign in to start one."}
              </div>
            )}
          </div>
        )}

        <div className="mt-12 flex flex-wrap gap-3 text-sm">
          <Link href="/events" className="text-[#e8c86a]/80 hover:text-[#e8c86a]">→ Upcoming events</Link>
          <Link href="/explore" className="text-[#e8c86a]/80 hover:text-[#e8c86a]">→ Explore everything</Link>
        </div>
      </div>
    </div>
  );
}
