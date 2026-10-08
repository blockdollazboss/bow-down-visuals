import { useEffect, useState } from "react";
import { Link, useRoute } from "wouter";
import { Ticket, Radio, CalendarPlus, Download, BarChart3 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import {
  useCommunityApi, ShareButton, Countdown, Loading, ErrorBox, profileLink,
  goldButton, ghostButton,
} from "@/lib/community-ui";

/* ─── /events/:id — event detail ────────────────────────────────────────────
   RSVP (never gated), live countdown, .ics add-to-calendar, host profile
   link, ticket + stream destination links. Host analytics at 4+ stars.
   Money path: ticket_url front and center; hosts without one get the
   store-builder nudge. */

interface EventDetail {
  id: string; title: string; description: string; starts_at: string; kind: string;
  cover_url: string | null; destination_url: string | null; ticket_url: string | null;
  rsvp_count: number;
}
interface Host { slug: string; display_name: string; avatar_url: string | null }

function downloadIcs(ev: EventDetail) {
  const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
  const start = new Date(ev.starts_at);
  const end = new Date(start.getTime() + 2 * 3600 * 1000);
  const ics = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Bow Down Visuals//Events//EN",
    "BEGIN:VEVENT",
    `UID:${ev.id}@bowdownvisuals.com`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(start)}`,
    `DTEND:${stamp(end)}`,
    `SUMMARY:${ev.title.replace(/[\n,;]/g, " ")}`,
    `DESCRIPTION:${(ev.description || "").slice(0, 200).replace(/[\n,;]/g, " ")}`,
    `URL:${window.location.origin}/events/${ev.id}`,
    "END:VEVENT", "END:VCALENDAR",
  ].join("\r\n");
  const blob = new Blob([ics], { type: "text/calendar" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${ev.title.slice(0, 40).replace(/[^\w]+/g, "-")}.ics`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export default function EventDetailPage() {
  const [, params] = useRoute("/events/:id");
  const id = params?.id ?? "";
  const api = useCommunityApi();
  const { user } = useAuth();
  const [event, setEvent] = useState<EventDetail | null>(null);
  const [host, setHost] = useState<Host | null>(null);
  const [rsvped, setRsvped] = useState(false);
  const [hostIsViewer, setHostIsViewer] = useState(false);
  const [stats, setStats] = useState<{ total: number; by_day: { day: string; count: number }[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try {
      const d = (await api.get(`/api/events/${id}`)) as {
        event: EventDetail; host: Host; rsvped: boolean; host_is_viewer: boolean;
      };
      setEvent(d.event); setHost(d.host); setRsvped(d.rsvped); setHostIsViewer(d.host_is_viewer);
      if (d.host_is_viewer) {
        try {
          const s = (await api.get(`/api/events/${id}/stats`)) as { total: number; by_day: { day: string; count: number }[] };
          setStats(s);
        } catch { /* stats are a bonus, not a blocker */ }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load the event.");
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id]);

  async function rsvp() {
    setBusy(true);
    try {
      await api.post(`/api/events/${id}/rsvp`);
      setRsvped(true);
      setNotice("You're on the list — reminder's in your bell. 🔔");
      await load();
    } catch (e) { setNotice(e instanceof Error ? e.message : "Couldn't RSVP."); }
    finally { setBusy(false); }
  }
  async function unrsvp() {
    setBusy(true);
    try { await api.post(`/api/events/${id}/unrsvp`); setRsvped(false); await load(); }
    catch (e) { setNotice(e instanceof Error ? e.message : "Couldn't cancel."); }
    finally { setBusy(false); }
  }

  if (loading) return <div className="min-h-screen bg-black text-white"><Loading label="Loading event" /></div>;
  if (error || !event) return (
    <div className="min-h-screen bg-black px-6 py-16 text-white"><ErrorBox message={error ?? "Event not found."} /></div>
  );

  return (
    <div className="min-h-screen bg-black text-white">
      {event.cover_url && <img src={event.cover_url} alt="" className="h-64 w-full object-cover" />}
      <div className="mx-auto max-w-3xl px-6 py-10">
        <span className="inline-block rounded-full bg-[#e8c86a]/15 px-3 py-1 text-xs font-bold uppercase tracking-wider text-[#e8c86a]">
          {event.kind}
        </span>
        <h1 className="mt-3 text-4xl font-bold">{event.title}</h1>
        <p className="mt-2 text-white/60">
          {new Date(event.starts_at).toLocaleString()} · {event.rsvp_count.toLocaleString()} going
        </p>
        {host && (
          <p className="mt-1 text-white/60">
            Hosted by <Link href={profileLink(host.slug)} className="text-[#e8c86a] hover:underline">{host.display_name}</Link>
          </p>
        )}

        <div className="mt-6"><Countdown to={event.starts_at} /></div>

        <div className="mt-6 flex flex-wrap gap-3">
          {user && !rsvped && (
            <button type="button" onClick={rsvp} disabled={busy} className={goldButton}>
              {busy ? "…" : "RSVP — I'm in"}
            </button>
          )}
          {user && rsvped && (
            <button type="button" onClick={unrsvp} disabled={busy} className={ghostButton}>Cancel RSVP</button>
          )}
          <button type="button" onClick={() => downloadIcs(event)} className={ghostButton}>
            <span className="inline-flex items-center gap-1.5"><Download className="h-3.5 w-3.5" /> Add to calendar</span>
          </button>
          <ShareButton path={`/events/${event.id}`} />
        </div>

        {notice && (
          <div className="mt-4 rounded-lg border border-[#e8c86a]/30 bg-[#e8c86a]/10 px-4 py-2 text-sm text-[#e8c86a]">{notice}</div>
        )}

        {/* Money path: tickets + destination */}
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          {event.ticket_url ? (
            <a href={event.ticket_url} target="_blank" rel="noreferrer"
              className="flex items-center justify-center gap-2 rounded-xl bg-[#e8c86a] px-5 py-3 font-bold text-black hover:bg-[#f5d67e]">
              <Ticket className="h-5 w-5" /> Get tickets
            </a>
          ) : hostIsViewer ? (
            <Link href="/storefronts/builder"
              className="flex items-center justify-center gap-2 rounded-xl border border-[#e8c86a]/40 bg-[#e8c86a]/10 px-5 py-3 font-semibold text-[#e8c86a] hover:bg-[#e8c86a]/20">
              <Ticket className="h-5 w-5" /> 💰 Link ticket sales
            </Link>
          ) : null}
          {event.destination_url && (
            <a href={event.destination_url} target="_blank" rel="noreferrer"
              className="flex items-center justify-center gap-2 rounded-xl border border-white/20 px-5 py-3 font-semibold text-white hover:border-[#e8c86a]/50 hover:text-[#e8c86a]">
              {event.kind === "stream" ? <Radio className="h-5 w-5" /> : <CalendarPlus className="h-5 w-5" />}
              {event.kind === "stream" ? "Join the stream" : "Go to the drop"}
            </a>
          )}
        </div>

        {event.description && (
          <p className="mt-8 whitespace-pre-wrap text-white/80">{event.description}</p>
        )}

        {/* Host analytics — 4+ star power tool */}
        {hostIsViewer && stats && (
          <div className="mt-8 rounded-xl border border-white/10 bg-[#0d0a02] p-5" data-min-stars="4">
            <p className="flex items-center gap-2 font-semibold text-[#e8c86a]">
              <BarChart3 className="h-4 w-4" /> RSVP analytics <span className="text-xs font-normal text-white/40">(4★)</span>
            </p>
            <p className="mt-2 text-3xl font-bold">{stats.total.toLocaleString()} <span className="text-sm font-normal text-white/50">total RSVPs</span></p>
            {stats.by_day.length > 0 && (
              <div className="mt-4 flex items-end gap-1">
                {stats.by_day.map((b) => {
                  const max = Math.max(...stats.by_day.map((x) => x.count), 1);
                  return (
                    <div key={b.day} className="flex flex-col items-center gap-1" title={`${b.day}: ${b.count}`}>
                      <div className="w-6 rounded-t bg-[#e8c86a]/70" style={{ height: `${Math.max(4, (b.count / max) * 80)}px` }} />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        <div className="mt-10 flex flex-wrap gap-3 text-sm">
          <Link href="/events" className="text-[#e8c86a]/80 hover:text-[#e8c86a]">← All events</Link>
          <Link href="/explore" className="text-[#e8c86a]/80 hover:text-[#e8c86a]">→ Explore everything</Link>
        </div>
      </div>
    </div>
  );
}
