import { useEffect, useState } from "react";
import { Link, useRoute } from "wouter";
import { MapPin, Users, CalendarDays, Trophy, Disc3, Clapperboard, ArrowLeft } from "lucide-react";
import { useIsLightTheme } from "@/hooks/use-is-light-theme";
import { usePageTitle } from "@/hooks/use-page-title";
import {
  CreatorCard, TrackRow, VideoCard, SectionHeader, EmptyState, ChartSkeleton,
} from "@/components/discovery/cards";
import { useFollowStates } from "@/components/discovery/FollowButton";
import { fetchScene, formatShowDate, type ScenePage } from "@/lib/scenes";

/* ─── /scenes/:slug — one city's scene page ───────────────────────────────
   The house's map of a city's music, from real rows only:
   - the city's creators (they declared this city on their profile),
   - the city's shows (real tour dates in this city, coming up),
   - the Scene Chart (this city's creators' plays, counted by the same
     rails as the main charts).
   A city with no declared creators has NO page — the server 404s and
   this page says so plainly instead of dressing up an empty shell.
   Empty sections say so in plain words; counts shown are real counts. */

type WindowKey = "today" | "week" | "all";
const WINDOWS: Array<{ key: WindowKey; label: string }> = [
  { key: "today", label: "Today" },
  { key: "week", label: "This week" },
  { key: "all", label: "All time" },
];

export default function SceneCityPage() {
  const [, params] = useRoute("/scenes/:slug");
  const slug = params?.slug ?? "";
  const isLight = useIsLightTheme();
  const [windowKey, setWindowKey] = useState<WindowKey>("all");
  const [scene, setScene] = useState<ScenePage | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "noscene">("loading");

  usePageTitle(scene ? `${scene.city.name} Scene — Bow Down Visuals` : "Local Scenes — Bow Down Visuals");

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    fetchScene(slug, windowKey).then((data) => {
      if (cancelled) return;
      if (!data) {
        setScene(null);
        setState("noscene");
        return;
      }
      setScene(data);
      setState("ready");
    });
    return () => {
      cancelled = true;
    };
  }, [slug, windowKey]);

  const followStates = useFollowStates(scene?.creators.map((c) => c.profile_id) ?? []);

  if (state === "loading" && !scene) {
    return (
      <div className="mx-auto w-full max-w-6xl px-4 py-8 md:px-6">
        <ChartSkeleton />
      </div>
    );
  }

  if (state === "noscene" || !scene) {
    return (
      <div className="mx-auto w-full max-w-6xl px-4 py-8 md:px-6">
        <Link href="/scenes" className={`mb-6 inline-flex items-center gap-1.5 text-sm font-bold ${isLight ? "text-[#8a6d2f]" : "text-[#e8c86a]"}`}>
          <ArrowLeft className="h-4 w-4" /> All scenes
        </Link>
        <EmptyState
          icon={<MapPin className="h-6 w-6" />}
          title="No scene here yet."
          blurb="No creator has declared this city, so there's no scene page for it. A city gets a page the moment a real creator claims it in their profile — never before."
          ctaHref="/scenes"
          ctaLabel="See the real scenes"
        />
      </div>
    );
  }

  const { city, creators, shows, chart, counts } = scene;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 md:px-6">
      <Link href="/scenes" className={`mb-6 inline-flex items-center gap-1.5 text-sm font-bold ${isLight ? "text-[#8a6d2f]" : "text-[#e8c86a]"}`}>
        <ArrowLeft className="h-4 w-4" /> All scenes
      </Link>

      {/* Header — the real counts, nothing padded. */}
      <div className="mb-8 text-center">
        <p className="mb-2 flex items-center justify-center gap-2 text-xs font-bold uppercase tracking-[0.25em] text-[#e8c86a]">
          <MapPin className="h-4 w-4" /> Local Scene
        </p>
        <h1 className="text-3xl font-black tracking-tight md:text-5xl">
          {city.name}
        </h1>
        <p className={`mx-auto mt-3 max-w-xl text-sm md:text-base ${isLight ? "text-[#6B5B36]" : "text-white/50"}`}>
          {counts.creators} {counts.creators === 1 ? "creator" : "creators"} declared {city.name} as home.
          {" "}{counts.shows} {counts.shows === 1 ? "show" : "shows"} coming up.
        </p>
      </div>

      {/* The city's creators */}
      <section className="mb-10">
        <SectionHeader icon={<Users className="h-5 w-5" />} title={`${city.name} creators`} blurb="They declared this city on their own profiles." />
        {creators.length === 0 ? (
          <p className={`text-sm ${isLight ? "text-[#6B5B36]" : "text-white/50"}`}>No creators have declared {city.name} yet.</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {creators.map((c, i) => (
              <CreatorCard
                key={c.profile_id}
                creator={{ ...c, id: c.profile_id }}
                rank={i}
                followState={followStates[c.profile_id]}
              />
            ))}
          </div>
        )}
      </section>

      {/* The city's shows — real tour dates only */}
      <section className="mb-10">
        <SectionHeader icon={<CalendarDays className="h-5 w-5" />} title={`Shows in ${city.name}`} blurb="Real dates from creators' own tour calendars." />
        {shows.length === 0 ? (
          <p className={`text-sm ${isLight ? "text-[#6B5B36]" : "text-white/50"}`}>No shows listed for {city.name} yet.</p>
        ) : (
          <div className="space-y-3">
            {shows.map((s) => (
              <div
                key={s.id}
                className={`flex flex-wrap items-center justify-between gap-3 rounded-2xl border p-4 ${
                  isLight
                    ? "border-[#C9A84C]/40 bg-gradient-to-b from-[#FCF7EA] to-[#F4E7C3]"
                    : "border-white/10 bg-white/[0.03]"
                }`}
              >
                <div>
                  <p className={`font-black ${isLight ? "text-[#2A1E07]" : "text-white"}`}>{s.venue}</p>
                  <p className={`text-sm ${isLight ? "text-[#6B5B36]" : "text-white/50"}`}>
                    {formatShowDate(s.show_date)} · {s.status === "confirmed" ? "Confirmed" : "Upcoming"}
                  </p>
                </div>
                <Link
                  href={`/artist/${s.slug}`}
                  className={`text-sm font-bold ${isLight ? "text-[#8a6d2f]" : "text-[#e8c86a]"}`}
                >
                  {s.display_name}
                </Link>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* The Scene Chart — the city's own plays, main-chart counting */}
      <section>
        <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
          <SectionHeader icon={<Trophy className="h-5 w-5" />} title={`The ${city.name} Chart`} blurb="This city's creators, ranked by their real plays — the same counting as the main charts." />
          <div className="flex gap-1 rounded-full border border-white/10 bg-black/40 p-1">
            {WINDOWS.map((w) => (
              <button
                key={w.key}
                onClick={() => setWindowKey(w.key)}
                className={`rounded-full px-4 py-1.5 text-sm font-bold transition-all inline-flex items-center justify-center min-h-[40px] ${
                  windowKey === w.key ? "bg-[#e8c86a] text-black" : "text-white/50 hover:text-white"
                }`}
              >
                {w.label}
              </button>
            ))}
          </div>
        </div>

        {chart.tracks.length === 0 && chart.videos.length === 0 ? (
          <p className={`text-sm ${isLight ? "text-[#6B5B36]" : "text-white/50"}`}>
            No plays charted for {city.name} in this window yet — the chart fills in as the city's creators get heard.
          </p>
        ) : (
          <div className="grid gap-8 lg:grid-cols-2">
            <div>
              <h3 className={`mb-3 flex items-center gap-2 text-sm font-black uppercase tracking-widest ${isLight ? "text-[#8a6d2f]" : "text-[#e8c86a]"}`}>
                <Disc3 className="h-4 w-4" /> Top tracks
              </h3>
              {chart.tracks.length === 0 ? (
                <p className={`text-sm ${isLight ? "text-[#6B5B36]" : "text-white/50"}`}>No charted tracks in this window yet.</p>
              ) : (
                <div className="space-y-2">
                  {chart.tracks.map((t, i) => (
                    <TrackRow key={t.id} track={t} rank={i} />
                  ))}
                </div>
              )}
            </div>
            <div>
              <h3 className={`mb-3 flex items-center gap-2 text-sm font-black uppercase tracking-widest ${isLight ? "text-[#8a6d2f]" : "text-[#e8c86a]"}`}>
                <Clapperboard className="h-4 w-4" /> Top videos
              </h3>
              {chart.videos.length === 0 ? (
                <p className={`text-sm ${isLight ? "text-[#6B5B36]" : "text-white/50"}`}>No charted videos in this window yet.</p>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2">
                  {chart.videos.map((v, i) => (
                    <VideoCard key={v.id} video={v} rank={i} />
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
