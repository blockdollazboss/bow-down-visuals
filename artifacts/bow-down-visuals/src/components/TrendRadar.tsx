import { useIsLightTheme } from "@/hooks/use-is-light-theme";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/contexts/AuthContext";
import { Radar, AlertTriangle, RotateCcw, Music2, Hash, Shapes, ArrowRight, SquarePlay, Play } from "lucide-react";
import { Link } from "wouter";
import {
  trendRadarFeedOf,
  type TrendRadarFeed,
  type RadarVelocity,
} from "@/lib/world/trends-radar";

/* ── Trend Radar (UPGRADE #178) ────────────────────────────────────────
   The real-signal rail of the Trends page, docked above the AI
   forecast. Every row is a real play_events count — last 24 hours
   against the prior 7 days, the same windows the charts read. A row
   exists only with real mass AND real lift; a quiet family says so
   plainly instead of padding. One tap on any row lands in Create
   with the trend pre-loaded: the sound attached, or the genre /
   format scaffolded as the concept. Nothing here is predicted.

   ── C-30 "Heating up outside" ────────────────────────────────────────
   One additive family lives BELOW the on-site lanes: YouTube's
   current most-popular music chart, served by the API as its own
   labeled `outsideHeat` block. Its numbers are YouTube's own —
   printed under YouTube's name, never mixed into the counted plays
   above it (the honest note stays word-for-word true because this
   section renders after it). It ships dark: with no YouTube key on
   the server the API sends null and this section simply does not
   exist — no placeholder, no error, no invented numbers. */

/* The feed's shape AND its strict parse are the World bench's
   seam (lib/world/trends-radar) — shared since stack300 item
   107: a payload that isn't the feed parses to null and lands
   on this component's own load-error state below; malformed
   rows drop instead of throwing at render; the outside family
   stays null unless honestly-labelable videos survive. The
   C-30 dormancy contract is unchanged — it lives in the seam's
   outsideHeatOf now, and the section below still renders only
   when real chart rows are present. */

export function TrendRadar() {
  const isLight = useIsLightTheme();
  const { t, i18n } = useTranslation();
  const { user, getAccessToken } = useAuth();
  const [feed, setFeed] = useState<TrendRadarFeed | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      setLoadError(false);
      try {
        const token = await getAccessToken();
        const res = await fetch("/api/trend-radar", {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) throw new Error("load failed");
        /* Strict parse (stack300 item 107): a 200 whose body
           isn't the feed — an error body, a shape drift — parses
           to null and lands on the load-error state, never on
           the "nothing heating up" state; malformed rows drop
           inside the seam instead of throwing at render. */
        const parsed = trendRadarFeedOf(await res.json().catch(() => null));
        if (!parsed) throw new Error("load failed");
        if (cancelled) return;
        setFeed(parsed);
      } catch {
        if (!cancelled) setLoadError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, getAccessToken, retryNonce]);

  function paceText(trend: RadarVelocity): string {
    return trend.coldStart
      ? t("trends.radar.coldStart", { current: trend.currentPlays })
      : t("trends.radar.pace", {
          current: trend.currentPlays,
          velocity: trend.velocity!.toFixed(1),
        });
  }

  const allEmpty =
    feed !== null && feed.sounds.length === 0 && feed.topics.length === 0 && feed.formats.length === 0;

  /* C-30: the outside family shows only when the API actually sent
     videos — dormant (null) means the section does not exist. */
  const outsideVideos = feed?.outsideHeat?.videos ?? [];
  const showOutside = outsideVideos.length > 0;

  function formatOutsideViews(n: number): string {
    try {
      return new Intl.NumberFormat(i18n.language, {
        notation: "compact",
        maximumFractionDigits: 1,
      }).format(n);
    } catch {
      return String(n);
    }
  }

  return (
    <section
      className={`relative mt-10 overflow-hidden rounded-3xl border p-6 md:p-10 ${
        isLight
          ? "border-primary/25 bg-gradient-to-b from-[#F7ECD2] to-[#FCF7EA]"
          : "border-primary/25 bg-gradient-to-b from-[#14100a] to-[#0d0a04]"
      }`}
      data-testid="trend-radar"
    >
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-primary/25 bg-primary/[0.12]">
          <Radar className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h2 className="font-display text-2xl font-black">{t("trends.radar.title")}</h2>
          <p className="mt-0.5 text-xs text-white/40">{t("trends.radar.subtitle")}</p>
        </div>
      </div>

      {loadError ? (
        <div className="mt-5 flex items-center gap-3 rounded-xl border border-red-500/30 bg-red-500/[0.06] p-4 text-sm text-red-200/80">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {t("trends.radar.loadError")}
          <button
            type="button"
            onClick={() => setRetryNonce((n) => n + 1)}
            className="ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-white/15 px-3 py-1.5 text-xs font-bold text-white/80 hover:bg-white/5"
          >
            <RotateCcw className="h-3.5 w-3.5" /> {t("trends.radar.retry")}
          </button>
        </div>
      ) : feed === null ? (
        <p className="mt-5 text-sm text-white/40">{t("trends.radar.loading")}</p>
      ) : allEmpty && !showOutside ? (
        <p className="mt-5 text-sm leading-relaxed text-white/50">{t("trends.radar.allEmpty")}</p>
      ) : (
        <div className="mt-6 space-y-8">
          {/* Rising sounds */}
          <div>
            <h3 className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-white/40">
              <Music2 className="h-3.5 w-3.5" /> {t("trends.radar.soundsTitle")}
            </h3>
            {feed.sounds.length === 0 ? (
              <p className="mt-2 text-sm text-white/40">{t("trends.radar.soundsEmpty")}</p>
            ) : (
              <div className="mt-3 divide-y divide-white/[0.05]">
                {feed.sounds.map((s) => (
                  <div key={s.mediaId} className="flex items-center gap-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold text-white">{s.title}</p>
                      <p className="mt-0.5 text-[11px] text-white/35">
                        @{s.slug}
                        {s.genre ? ` · ${s.genre}` : ""} · {paceText(s.trend)}
                      </p>
                    </div>
                    <Link
                      href={s.createLink}
                      className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-black transition hover:brightness-110"
                    >
                      {t("trends.radar.useSound")} <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Rising topics */}
          <div>
            <h3 className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-white/40">
              <Hash className="h-3.5 w-3.5" /> {t("trends.radar.topicsTitle")}
            </h3>
            {feed.topics.length === 0 ? (
              <p className="mt-2 text-sm text-white/40">{t("trends.radar.topicsEmpty")}</p>
            ) : (
              <div className="mt-3 flex flex-wrap gap-2">
                {feed.topics.map((topic) => (
                  <Link
                    key={topic.genre}
                    href={topic.createLink}
                    className="group rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 transition hover:border-primary/40"
                  >
                    <span className="text-sm font-bold text-white">{topic.genre}</span>
                    <span className="mt-0.5 block text-[11px] text-white/35">{paceText(topic.trend)}</span>
                    <span className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-bold text-primary">
                      {t("trends.radar.makeInLane")} <ArrowRight className="h-3 w-3 transition group-hover:translate-x-0.5" />
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </div>

          {/* Rising formats */}
          <div>
            <h3 className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-white/40">
              <Shapes className="h-3.5 w-3.5" /> {t("trends.radar.formatsTitle")}
            </h3>
            {feed.formats.length === 0 ? (
              <p className="mt-2 text-sm text-white/40">{t("trends.radar.formatsEmpty")}</p>
            ) : (
              <div className="mt-3 flex flex-wrap gap-2">
                {feed.formats.map((f) => (
                  <Link
                    key={f.format}
                    href={f.createLink}
                    className="group rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 transition hover:border-primary/40"
                  >
                    <span className="text-sm font-bold text-white">{t(`trends.radar.format.${f.format}`)}</span>
                    <span className="mt-0.5 block text-[11px] text-white/35">{paceText(f.trend)}</span>
                    <span className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-bold text-primary">
                      {t("trends.radar.scaffold")} <ArrowRight className="h-3 w-3 transition group-hover:translate-x-0.5" />
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </div>

          <p className="text-[11px] leading-relaxed text-white/35">{t("trends.radar.honestNote")}</p>

          {/* ── C-30: Heating up outside (YouTube) ───────────────────
              Visually its own lane: a red-accented panel under the
              on-site lanes, YouTube named in the heading, the badge,
              and every card's view count. Renders ONLY when the API
              sent real chart rows — dormant means absent, entirely. */}
          {showOutside && (
            <div
              className={`rounded-2xl border p-4 md:p-5 ${
                isLight
                  ? "border-red-900/20 bg-red-500/[0.05]"
                  : "border-red-500/25 bg-red-500/[0.04]"
              }`}
              data-testid="trend-radar-outside-heat"
            >
              <div className="flex flex-wrap items-center gap-2.5">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#FF0000] text-white">
                  <SquarePlay className="h-4 w-4" aria-hidden="true" />
                </span>
                <h3 className="font-display text-lg font-black">{t("trends.radar.outsideTitle")}</h3>
                <span className="rounded-full bg-[#FF0000] px-2.5 py-0.5 text-[10px] font-black uppercase tracking-widest text-white">
                  {t("trends.radar.outsideBadge")}
                </span>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-white/45">
                {t("trends.radar.outsideSubtitle")}
              </p>
              <div className="mt-4 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                {outsideVideos.map((v) => (
                  <a
                    key={v.videoId}
                    href={v.url}
                    target="_blank"
                    rel="noreferrer"
                    className={`group flex gap-3 rounded-xl border p-2.5 transition ${
                      isLight
                        ? "border-red-900/15 bg-white/60 hover:border-red-500/50"
                        : "border-white/10 bg-black/40 hover:border-red-500/50"
                    }`}
                  >
                    {v.thumbnailUrl ? (
                      <img
                        src={v.thumbnailUrl}
                        alt=""
                        loading="lazy"
                        className="h-16 w-28 shrink-0 rounded-lg object-cover"
                      />
                    ) : (
                      <span className="flex h-16 w-28 shrink-0 items-center justify-center rounded-lg bg-[#FF0000]/15 text-[#FF0000]">
                        <Play className="h-5 w-5" aria-hidden="true" />
                      </span>
                    )}
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-bold text-white group-hover:underline">
                        {v.title}
                      </span>
                      <span className="mt-0.5 block truncate text-[11px] text-white/40">
                        {v.channelTitle}
                      </span>
                      <span className="mt-1 block text-[11px] font-semibold text-red-400">
                        {t("trends.radar.outsideViews", { count: formatOutsideViews(v.viewCount) })}
                      </span>
                    </span>
                  </a>
                ))}
              </div>
              <p className="mt-3 text-[11px] leading-relaxed text-white/35">
                {t("trends.radar.outsideNote")}
              </p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
