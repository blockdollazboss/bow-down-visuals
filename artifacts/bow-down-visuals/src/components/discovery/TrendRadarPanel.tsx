import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Radar, TrendingUp, Flame, ArrowUpRight } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { apiJson } from "@/lib/social-api";

/* ─── Trend Radar (#178) ───────────────────────────────────────────────────
   Docked at the top of /trending. REAL signals only: every blip carries
   its measured count and its source, served by GET /api/trend-radar/feed.
   No predictions live here — forecasts stay in the Trend Predictor. */

export interface RadarSignalView {
  kind: "hashtag" | "spike" | "rising_creator" | "sound";
  key: string;
  label: string;
  currentCount: number;
  baselineCount: number;
  source: string;
  href?: string;
  growth: number;
  score: number;
  movement: "surging" | "rising" | "steady";
}

const KIND_LABEL: Record<RadarSignalView["kind"], string> = {
  hashtag: "Hashtag",
  spike: "Spiking now",
  rising_creator: "Rising creator",
  sound: "Sound",
};

export default function TrendRadarPanel() {
  const { getAccessToken } = useAuth();
  const [feed, setFeed] = useState<RadarSignalView[]>([]);
  const [headline, setHeadline] = useState("");
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    apiJson<{ feed: RadarSignalView[]; headline: string }>(getAccessToken, "/api/trend-radar/feed")
      .then((d) => {
        if (!live) return;
        setFeed(d.feed ?? []);
        setHeadline(d.headline ?? "");
      })
      .catch(() => live && setFailed(true))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (failed) return null; // the plain trending list below still serves the page

  return (
    <section
      aria-label="Trend Radar"
      className="mb-6 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
    >
      <header className="mb-1 flex items-center gap-2">
        <Radar className="h-5 w-5 text-amber-600 dark:text-amber-400" aria-hidden />
        <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-50">Trend Radar</h2>
        <span className="ml-auto rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
          Real signals only
        </span>
      </header>
      <p className="mb-3 text-sm text-zinc-500 dark:text-zinc-400">
        {loading ? "Scanning the last 24 hours…" : headline}
      </p>
      {!loading && feed.length === 0 && (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Nothing verified is moving yet today. Real counts only — the radar never guesses.
        </p>
      )}
      <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
        {feed.map((s) => {
          const inner = (
            <>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="truncate font-medium text-zinc-900 dark:text-zinc-50">{s.label}</span>
                  {s.movement === "surging" ? (
                    <Flame className="h-4 w-4 shrink-0 text-orange-500" aria-label="Surging" />
                  ) : (
                    <TrendingUp className="h-4 w-4 shrink-0 text-emerald-500" aria-label="Rising" />
                  )}
                </span>
                <span className="block text-xs text-zinc-500 dark:text-zinc-400">
                  {KIND_LABEL[s.kind]} · {s.currentCount.toLocaleString()} in 24h
                  {s.baselineCount > 0 ? ` vs ${s.baselineCount.toLocaleString()} prior` : " · brand new"}
                  {" · "}Source: {s.source}
                </span>
              </span>
              <ArrowUpRight className="h-4 w-4 shrink-0 text-zinc-400" aria-hidden />
            </>
          );
          const cls = "flex items-center gap-3 py-2.5";
          return (
            <li key={`${s.kind}:${s.key}`}>
              {s.href ? (
                <Link href={s.href} className={`${cls} hover:opacity-80`}>
                  {inner}
                </Link>
              ) : (
                <div className={cls}>{inner}</div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
