import { useEffect, useState } from "react";
import { Link } from "wouter";
import { CalendarPlus, Ticket, Radio, Package, Sparkles } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import {
  useCommunityApi, ShareButton, Loading, ErrorBox, profileLink,
  goldInput, goldButton, ghostButton,
} from "@/lib/community-ui";

/* ─── /events — upcoming streams, drops, premieres ─────────────────────────
   Public list. Creators can host (never gated). Money path: ticket links
   ride on every card; the create form nudges hosts to link their store. */

const KINDS = [
  { key: "", label: "All", icon: Sparkles },
  { key: "stream", label: "Streams", icon: Radio },
  { key: "drop", label: "Drops", icon: Package },
  { key: "premiere", label: "Premieres", icon: CalendarPlus },
] as const;

interface EventItem {
  id: string; title: string; kind: string; starts_at: string; cover_url: string | null;
  rsvp_count: number; destination_url: string | null; ticket_url: string | null;
  host: { slug: string; display_name: string; avatar_url: string | null };
}

export default function Events() {
  const api = useCommunityApi();
  const { user } = useAuth();
  const [events, setEvents] = useState<EventItem[]>([]);
  const [kind, setKind] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({
    title: "", description: "", starts_at: "", kind: "stream",
    destination_url: "", ticket_url: "",
  });
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try {
      const d = (await api.get("/api/events")) as { events: EventItem[] };
      setEvents(d.events);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load events.");
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const filtered = kind ? events.filter((e) => e.kind === kind) : events;

  async function create() {
    setCreateError(null); setCreating(true);
    try {
      const starts = new Date(form.starts_at);
      if (Number.isNaN(starts.getTime())) throw new Error("Pick a valid date & time.");
      await api.post("/api/events", {
        title: form.title.trim(),
        description: form.description.trim(),
        starts_at: starts.toISOString(),
        kind: form.kind,
        destination_url: form.destination_url.trim() || null,
        ticket_url: form.ticket_url.trim() || null,
      });
      setShowCreate(false);
      setForm({ title: "", description: "", starts_at: "", kind: "stream", destination_url: "", ticket_url: "" });
      await load();
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : "Couldn't create the event.");
    } finally { setCreating(false); }
  }

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="mx-auto max-w-6xl px-6 py-12">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#e8c86a]">Don't miss the moment</p>
            <h1 className="mt-2 text-4xl font-bold">Events <span className="text-[#e8c86a]">🦈</span></h1>
            <p className="mt-2 max-w-xl text-white/60">
              Streams, drops, premieres. RSVP free — show up loud.
            </p>
          </div>
          {user && (
            <button type="button" onClick={() => setShowCreate(true)} className={goldButton}>
              <span className="inline-flex items-center gap-2"><CalendarPlus className="h-4 w-4" /> Host an event</span>
            </button>
          )}
        </div>

        <div className="mb-6 flex gap-2">
          {KINDS.map((k) => (
            <button key={k.key} type="button" onClick={() => setKind(k.key)}
              className={`inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-semibold transition ${kind === k.key ? "bg-[#e8c86a] text-black" : "border border-white/20 text-white/70 hover:border-[#e8c86a]/50"}`}>
              <k.icon className="h-3.5 w-3.5" /> {k.label}
            </button>
          ))}
        </div>

        {showCreate && (
          <div className="mb-8 rounded-xl border border-[#e8c86a]/30 bg-[#0d0a02] p-6">
            <h2 className="text-lg font-bold text-[#e8c86a]">Host an event</h2>
            <p className="mt-1 text-sm text-white/60">
              Streams sell attention. Drops sell product. 💰 Selling tickets? Link your store and get paid.
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Event title"
                maxLength={120} className={goldInput} />
              <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })} className={goldInput}>
                <option value="stream">Stream</option>
                <option value="drop">Drop</option>
                <option value="premiere">Premiere</option>
                <option value="other">Other</option>
              </select>
              <input type="datetime-local" value={form.starts_at} onChange={(e) => setForm({ ...form, starts_at: e.target.value })}
                className={goldInput} />
              <input value={form.destination_url} onChange={(e) => setForm({ ...form, destination_url: e.target.value })}
                placeholder="Stream / drop URL (where it happens)" className={goldInput} />
              <input value={form.ticket_url} onChange={(e) => setForm({ ...form, ticket_url: e.target.value })}
                placeholder="Ticket URL (your store link)" className={`${goldInput} sm:col-span-2`} />
              <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Hype it up…" maxLength={5000} rows={3} className={`${goldInput} sm:col-span-2`} />
            </div>
            <p className="mt-2 text-xs text-white/40">
              No store link yet? <Link href="/storefronts/builder" className="text-[#e8c86a] hover:underline">Build your store →</Link>
            </p>
            {createError && <p className="mt-3 text-sm text-red-300">{createError}</p>}
            <div className="mt-4 flex gap-3">
              <button type="button" onClick={create} disabled={creating || !form.title.trim() || !form.starts_at} className={goldButton}>
                {creating ? "Creating…" : "Publish event"}
              </button>
              <button type="button" onClick={() => setShowCreate(false)} className={ghostButton}>Cancel</button>
            </div>
          </div>
        )}

        {loading ? <Loading label="Loading events" /> : error ? <ErrorBox message={error} onRetry={load} /> : (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((e) => (
              <div key={e.id} className="rounded-xl border border-white/10 bg-[#0d0a02] p-5 transition hover:border-[#e8c86a]/40">
                {e.cover_url && <img src={e.cover_url} alt="" className="mb-4 h-32 w-full rounded-lg object-cover" />}
                <span className="inline-block rounded-full bg-[#e8c86a]/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[#e8c86a]">
                  {e.kind}
                </span>
                <Link href={`/events/${e.id}`} className="mt-2 block text-lg font-bold hover:text-[#e8c86a]">{e.title}</Link>
                <p className="mt-1 text-sm text-white/50">
                  {new Date(e.starts_at).toLocaleString()} · {e.rsvp_count.toLocaleString()} going
                </p>
                <p className="mt-1 text-sm text-white/60">
                  Hosted by <Link href={profileLink(e.host.slug)} className="text-[#e8c86a] hover:underline">{e.host.display_name}</Link>
                </p>
                <div className="mt-4 flex items-center justify-between">
                  {e.ticket_url
                    ? <a href={e.ticket_url} target="_blank" rel="noreferrer" className={goldButton}>
                        <span className="inline-flex items-center gap-1.5"><Ticket className="h-3.5 w-3.5" /> Get tickets</span>
                      </a>
                    : <Link href={`/events/${e.id}`} className={ghostButton}>RSVP free</Link>}
                  <ShareButton path={`/events/${e.id}`} />
                </div>
              </div>
            ))}
            {filtered.length === 0 && (
              <div className="col-span-full rounded-xl border border-white/10 p-10 text-center text-white/50">
                Nothing on the calendar. {user ? "Host the first one." : "Check back soon."}
              </div>
            )}
          </div>
        )}

        <div className="mt-12 flex flex-wrap gap-3 text-sm">
          <Link href="/groups" className="text-[#e8c86a]/80 hover:text-[#e8c86a]">→ Browse groups</Link>
          <Link href="/explore" className="text-[#e8c86a]/80 hover:text-[#e8c86a]">→ Explore everything</Link>
        </div>
      </div>
    </div>
  );
}
