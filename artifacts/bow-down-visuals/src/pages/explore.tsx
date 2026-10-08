import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Clapperboard, Users, CalendarPlus, Flame, TrendingUp, MessageSquare } from "lucide-react";
import {
  useCommunityApi, ShareButton, Loading, ErrorBox, profileLink, timeAgo,
} from "@/lib/community-ui";

/* ─── /explore — the best of everything ───────────────────────────────────
   Blended grid: trending shorts, rising creators, hot posts, upcoming
   events, active groups. Every card deep-links to its destination and is
   shareable with ?ref=CODE. No island pages: every card connects somewhere. */

interface Short { id: string; title: string; thumbnail_url: string | null; view_count: number; duration_sec: number; creator: { slug: string; display_name: string; avatar_url: string | null } }
interface Creator { id: string; slug: string; display_name: string; avatar_url: string | null; vertical: string; follower_count: number }
interface HotPost { id: string; body: string; like_count: number; created_at: string; group: { slug: string; name: string }; author: { slug: string; displayName: string } | null }
interface Evt { id: string; title: string; kind: string; starts_at: string; cover_url: string | null; rsvp_count: number; host: { slug: string; display_name: string; avatar_url: string | null } }
interface Grp { id: string; slug: string; name: string; description: string; cover_url: string | null; member_count: number }

interface ExploreData { shorts: Short[]; creators: Creator[]; posts: HotPost[]; events: Evt[]; groups: Grp[] }

function Section({ icon: Icon, title, blurb, children, link, linkLabel }: {
  icon: typeof Flame; title: string; blurb: string; children: React.ReactNode; link: string; linkLabel: string;
}) {
  return (
    <section className="mb-14">
      <div className="mb-5 flex items-end justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-2xl font-bold"><Icon className="h-6 w-6 text-[#e8c86a]" /> {title}</h2>
          <p className="mt-1 text-sm text-white/50">{blurb}</p>
        </div>
        <Link href={link} className="text-sm text-[#e8c86a]/80 hover:text-[#e8c86a]">{linkLabel} →</Link>
      </div>
      {children}
    </section>
  );
}

export default function Explore() {
  const api = useCommunityApi();
  const [data, setData] = useState<ExploreData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try {
      const d = (await api.get("/api/explore")) as unknown as ExploreData;
      setData(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load Explore.");
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  if (loading) return <div className="min-h-screen bg-black text-white"><Loading label="Scouting the scene" /></div>;
  if (error || !data) return <div className="min-h-screen bg-black px-6 py-16 text-white"><ErrorBox message={error ?? "Explore failed."} onRetry={load} /></div>;

  const card = "rounded-xl border border-white/10 bg-[#0d0a02] p-4 transition hover:border-[#e8c86a]/40";

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="mx-auto max-w-6xl px-6 py-12">
        <div className="mb-10 text-center">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#e8c86a]">One page. Everything popping.</p>
          <h1 className="mt-2 text-4xl font-bold sm:text-5xl">Explore <span className="text-[#e8c86a]">🦈</span></h1>
          <p className="mx-auto mt-3 max-w-xl text-white/60">
            The hottest shorts, rising creators, loudest posts, next events, and liveliest groups — all in one place. Share anything; your referral code rides along.
          </p>
        </div>

        <Section icon={Flame} title="Trending shorts" blurb="Short clips pulling the most views right now." link="/explore" linkLabel="More soon">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {data.shorts.slice(0, 6).map((s) => (
              <div key={s.id} className={card}>
                {s.thumbnail_url && <img src={s.thumbnail_url} alt="" className="mb-3 h-36 w-full rounded-lg object-cover" />}
                <Link href={profileLink(s.creator.slug)} className="font-bold hover:text-[#e8c86a]">{s.title}</Link>
                <p className="mt-1 text-xs text-white/50">
                  {s.view_count.toLocaleString()} views · {s.duration_sec}s · by{" "}
                  <Link href={profileLink(s.creator.slug)} className="text-[#e8c86a] hover:underline">{s.creator.display_name}</Link>
                </p>
                <div className="mt-3"><ShareButton path={profileLink(s.creator.slug)} label="Share" /></div>
              </div>
            ))}
            {data.shorts.length === 0 && <p className="text-white/40">No shorts trending yet.</p>}
          </div>
        </Section>

        <Section icon={TrendingUp} title="Rising creators" blurb="Creators climbing the fastest — follow before they blow." link="/explore" linkLabel="All creators soon">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {data.creators.slice(0, 8).map((c) => (
              <div key={c.id} className={`${card} text-center`}>
                {c.avatar_url
                  ? <img src={c.avatar_url} alt="" className="mx-auto h-16 w-16 rounded-full object-cover" />
                  : <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[#e8c86a]/20 text-2xl font-bold text-[#e8c86a]">{c.display_name[0]}</div>}
                <Link href={profileLink(c.slug)} className="mt-2 block font-bold hover:text-[#e8c86a]">{c.display_name}</Link>
                <p className="text-xs text-white/50">{c.vertical} · {c.follower_count.toLocaleString()} followers</p>
                <div className="mt-3 flex items-center justify-center gap-2">
                  <Link href={profileLink(c.slug)} className="rounded-full bg-[#e8c86a] px-3 py-1 text-xs font-bold text-black hover:bg-[#f5d67e]">View</Link>
                  <ShareButton path={profileLink(c.slug)} label="Share" />
                </div>
              </div>
            ))}
            {data.creators.length === 0 && <p className="text-white/40">No creators yet.</p>}
          </div>
        </Section>

        <Section icon={MessageSquare} title="Hot posts" blurb="The loudest takes from group feeds." link="/groups" linkLabel="All groups">
          <div className="grid gap-4 sm:grid-cols-2">
            {data.posts.slice(0, 4).map((p) => (
              <div key={p.id} className={card}>
                <p className="whitespace-pre-wrap text-sm text-white/85">{p.body}</p>
                <p className="mt-2 text-xs text-white/50">
                  {p.like_count} likes · {p.author?.displayName ?? "a member"} ·{" "}
                  <Link href={`/groups/${p.group.slug}`} className="text-[#e8c86a] hover:underline">{p.group.name}</Link> · {timeAgo(p.created_at)}
                </p>
                <div className="mt-3"><ShareButton path={`/groups/${p.group.slug}`} label="Share" /></div>
              </div>
            ))}
            {data.posts.length === 0 && <p className="text-white/40">No posts heating up yet.</p>}
          </div>
        </Section>

        <Section icon={CalendarPlus} title="Upcoming events" blurb="Streams, drops, premieres — RSVP free." link="/events" linkLabel="All events">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {data.events.slice(0, 6).map((e) => (
              <div key={e.id} className={card}>
                {e.cover_url && <img src={e.cover_url} alt="" className="mb-3 h-28 w-full rounded-lg object-cover" />}
                <span className="inline-block rounded-full bg-[#e8c86a]/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[#e8c86a]">{e.kind}</span>
                <Link href={`/events/${e.id}`} className="mt-1 block font-bold hover:text-[#e8c86a]">{e.title}</Link>
                <p className="mt-1 text-xs text-white/50">
                  {new Date(e.starts_at).toLocaleString()} · {e.rsvp_count} going · by{" "}
                  <Link href={profileLink(e.host.slug)} className="text-[#e8c86a] hover:underline">{e.host.display_name}</Link>
                </p>
                <div className="mt-3 flex items-center gap-2">
                  <Link href={`/events/${e.id}`} className="rounded-full bg-[#e8c86a] px-3 py-1 text-xs font-bold text-black hover:bg-[#f5d67e]">RSVP</Link>
                  <ShareButton path={`/events/${e.id}`} label="Share" />
                </div>
              </div>
            ))}
            {data.events.length === 0 && <p className="text-white/40">Nothing scheduled yet.</p>}
          </div>
        </Section>

        <Section icon={Users} title="Active groups" blurb="The liveliest crews on the platform." link="/groups" linkLabel="All groups">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {data.groups.slice(0, 6).map((g) => (
              <div key={g.id} className={card}>
                {g.cover_url && <img src={g.cover_url} alt="" className="mb-3 h-28 w-full rounded-lg object-cover" />}
                <Link href={`/groups/${g.slug}`} className="font-bold hover:text-[#e8c86a]">{g.name}</Link>
                <p className="mt-1 line-clamp-2 text-xs text-white/50">{g.description}</p>
                <p className="mt-1 text-xs text-white/50">{g.member_count.toLocaleString()} members</p>
                <div className="mt-3 flex items-center gap-2">
                  <Link href={`/groups/${g.slug}`} className="rounded-full bg-[#e8c86a] px-3 py-1 text-xs font-bold text-black hover:bg-[#f5d67e]">Join</Link>
                  <ShareButton path={`/groups/${g.slug}`} label="Share" />
                </div>
              </div>
            ))}
            {data.groups.length === 0 && <p className="text-white/40">No groups yet.</p>}
          </div>
        </Section>

        <div className="mt-4 flex items-center gap-2 rounded-xl border border-[#e8c86a]/25 bg-[#0d0a02] p-5 text-sm text-white/60">
          <Clapperboard className="h-5 w-5 shrink-0 text-[#e8c86a]" />
          <p>Want your work on this page? Post in a group, drop a short, host an event — the algorithm is just "what's popping." 🦈</p>
        </div>
      </div>
    </div>
  );
}
