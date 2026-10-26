import { useEffect, useState } from "react";
import { Link } from "wouter";
import { MapPin, Users, CalendarDays, ChevronRight } from "lucide-react";
import { useIsLightTheme } from "@/hooks/use-is-light-theme";
import { usePageTitle } from "@/hooks/use-page-title";
import { EmptyState, ChartSkeleton } from "@/components/discovery/cards";
import { fetchSceneDirectory, type SceneCityEntry } from "@/lib/scenes";

/* ─── /scenes — the Local Scenes directory ────────────────────────────────
   Part of the discovery family (charts / browse / genres), rendered in
   the app shell like its siblings. HONESTY IS THE FEATURE: the server
   lists a city ONLY when at least one creator declared it as their
   city — there are no seeded, suggested, or coming-soon cities here.
   An empty directory says exactly that. */

export default function ScenesDirectory() {
  usePageTitle("Local Scenes — Bow Down Visuals");
  const isLight = useIsLightTheme();
  const [cities, setCities] = useState<SceneCityEntry[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchSceneDirectory()
      .then((rows) => {
        if (!cancelled) setCities(rows);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 md:px-6">
      <div className="mb-8 text-center">
        <p className="mb-2 flex items-center justify-center gap-2 text-xs font-bold uppercase tracking-[0.25em] text-[#e8c86a]">
          <MapPin className="h-4 w-4" /> Local Scenes
        </p>
        <h1 className="text-3xl font-black tracking-tight md:text-5xl">
          Every city with a{" "}
          <span className="bg-gradient-to-b from-[#ffe9a8] to-[#c9a84c] bg-clip-text text-transparent">
            real scene.
          </span>
        </h1>
        <p className={`mx-auto mt-3 max-w-xl text-sm md:text-base ${isLight ? "text-[#6B5B36]" : "text-white/50"}`}>
          A city appears here only when creators on the platform declared it as their own —
          its page maps their music, their real shows, and the city's own chart.
        </p>
      </div>

      {cities === null && !failed ? (
        <ChartSkeleton />
      ) : failed ? (
        <EmptyState
          icon={<MapPin className="h-6 w-6" />}
          title="Couldn't load the scenes."
          blurb="Something went wrong on our end — this isn't an empty directory, it's a failed load."
        />
      ) : !cities || cities.length === 0 ? (
        <EmptyState
          icon={<MapPin className="h-6 w-6" />}
          title="No scenes yet."
          blurb="No creator has declared a city yet, so there's no scene to show — a city gets a page the moment a real creator claims it in their profile."
          ctaHref="/charts"
          ctaLabel="Browse the charts"
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {cities.map((city) => (
            <Link
              key={city.slug}
              href={`/scenes/${city.slug}`}
              className={`group flex items-center justify-between rounded-2xl border p-5 transition-colors ${
                isLight
                  ? "border-[#C9A84C]/40 bg-gradient-to-b from-[#FCF7EA] to-[#F4E7C3] hover:border-[#C9A84C]"
                  : "border-primary/25 bg-gradient-to-b from-[#14100a] to-[#0d0a04] hover:border-[#e8c86a]/40"
              }`}
            >
              <span>
                <span className={`block text-xl font-black ${isLight ? "text-[#2A1E07]" : "text-white"}`}>
                  {city.name}
                </span>
                <span className={`mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs font-bold ${isLight ? "text-[#6B5B36]" : "text-white/50"}`}>
                  <span className="inline-flex items-center gap-1">
                    <Users className="h-3.5 w-3.5" /> {city.creator_count} {city.creator_count === 1 ? "creator" : "creators"}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <CalendarDays className="h-3.5 w-3.5" /> {city.show_count} {city.show_count === 1 ? "show" : "shows"} coming up
                  </span>
                </span>
              </span>
              <ChevronRight className={`h-5 w-5 shrink-0 transition-transform group-hover:translate-x-0.5 ${isLight ? "text-[#8a6d2f]" : "text-[#e8c86a]"}`} />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
