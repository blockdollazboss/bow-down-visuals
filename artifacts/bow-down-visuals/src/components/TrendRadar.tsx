import { useIsLightTheme } from "@/hooks/use-is-light-theme";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/contexts/AuthContext";
import { Radar, AlertTriangle, RotateCcw, Music2, Hash, Shapes, ArrowRight } from "lucide-react";
import { Link } from "wouter";

/* ── Trend Radar (UPGRADE #178) ────────────────────────────────────────
   The real-signal rail of the Trends page, docked above the AI
   forecast. Every row is a real play_events count — last 24 hours
   against the prior 7 days, the same windows the charts read. A row
   exists only with real mass AND real lift; a quiet family says so
   plainly instead of padding. One tap on any row lands in Create
   with the trend pre-loaded: the sound attached, or the genre /
   format scaffolded as the concept. Nothing here is predicted. */

interface TrendVelocity {
  currentPlays: number;
  baselineDaily: number;
  velocity: number | null;
  coldStart: boolean;
}

interface SoundTrend {
  mediaId: string;
  title: string;
  genre: string | null;
  slug: string;
  trend: TrendVelocity;
  createLink: string;
}

interface TopicTrend {
  genre: string;
  trend: TrendVelocity;
  createLink: string;
}

interface FormatTrend {
  format: "short" | "duet" | "stitch" | "full";
  trend: TrendVelocity;
  createLink: string;
}

interface TrendFeed {
  generatedAt: string;
  sounds: SoundTrend[];
  topics: TopicTrend[];
  formats: FormatTrend[];
}

export function TrendRadar() {
  const isLight = useIsLightTheme();
  const { t } = useTranslation();
  const { user, getAccessToken } = useAuth();
  const [feed, setFeed] = useState<TrendFeed | null>(null);
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
        const d = (await res.json()) as TrendFeed;
        if (cancelled) return;
        setFeed({
          generatedAt: d.generatedAt,
          sounds: Array.isArray(d.sounds) ? d.sounds : [],
          topics: Array.isArray(d.topics) ? d.topics : [],
          formats: Array.isArray(d.formats) ? d.formats : [],
        });
      } catch {
        if (!cancelled) setLoadError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, getAccessToken, retryNonce]);

  function paceText(trend: TrendVelocity): string {
    return trend.coldStart
      ? t("trends.radar.coldStart", { current: trend.currentPlays })
      : t("trends.radar.pace", {
          current: trend.currentPlays,
          velocity: trend.velocity!.toFixed(1),
        });
  }

  const allEmpty =
    feed !== null && feed.sounds.length === 0 && feed.topics.length === 0 && feed.formats.length === 0;

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
      ) : allEmpty ? (
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
        </div>
      )}
    </section>
  );
}
