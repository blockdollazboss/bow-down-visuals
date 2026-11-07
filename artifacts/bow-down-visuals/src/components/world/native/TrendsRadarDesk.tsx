/**
 * TrendsRadarDesk — the Promote Room's native Trend Radar
 * bench (stack200 world parity lane B1, census item 1),
 * stacked under the Trend Predictor desk in the same room.
 *
 * The Predictor next door sells a forecast; this bench is
 * the opposite — what's ACTUALLY rising on Bow Down right
 * now, counted from real plays (last 24 hours against the
 * prior 7 days) behind the rail's verified-count gates.
 * Read-only and free, exactly like the website rail it
 * mirrors (components/TrendRadar.tsx): a quiet family says
 * so plainly, a failed load says so plainly, and nothing is
 * ever padded to fill the bench.
 *
 * C-30's "Heating up outside" family renders below the
 * on-site lanes when — and only when — the rail sends it:
 * YouTube's own chart under YouTube's name, its own numbers
 * on every row, click-throughs to the video on YouTube.
 * Dormant (no key, chart unreachable) the section does not
 * exist — no placeholder, no error, no invented numbers.
 */
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import { Play, SquarePlay } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { NativeEmptyState, NativeErrorState, NativeLoadingState } from "./NativeStates";
import {
  TREND_RADAR_PATH,
  radarAllEmpty,
  trendRadarFeedOf,
  type RadarVelocity,
  type TrendRadarFeed,
} from "@/lib/world/trends-radar";

function GuestGate({ isLight }: { isLight: boolean }) {
  const { t } = useTranslation();
  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const strong = isLight ? "text-[#2a1e07]" : "text-white";
  return (
    <div className="space-y-3" data-testid="world-trends-radar-desk">
      <p className={`text-base font-black ${strong}`}>{t("worldTrendsRadar.title")}</p>
      <p className={`text-sm ${muted}`}>{t("worldTrendsRadar.guestNote")}</p>
      <Link
        href="/login"
        data-testid="world-trends-radar-desk-signin"
        className="bdv-touch-target inline-flex items-center gap-1.5 rounded-full border border-[#d4af37] bg-[#d4af37] px-4 py-2 text-xs font-bold text-black"
      >
        {t("worldTrendsRadar.guestSignIn")}
      </Link>
    </div>
  );
}

export function TrendsRadarDesk({ isLight, isGuest }: { isLight: boolean; isGuest: boolean }) {
  const { t, i18n } = useTranslation();
  const { getAccessToken } = useAuth();
  const [feed, setFeed] = useState<TrendRadarFeed | null>(null);
  const [failed, setFailed] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    if (isGuest) return;
    let cancelled = false;
    (async () => {
      setFailed(false);
      try {
        const token = await getAccessToken().catch(() => null);
        const res = await fetch(TREND_RADAR_PATH, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) throw new Error("trend radar load failed");
        const parsed = trendRadarFeedOf(await res.json().catch(() => null));
        if (!parsed) throw new Error("trend radar payload was not the feed");
        if (!cancelled) setFeed(parsed);
      } catch {
        /* A failed load is an error state with a retry — never
           a quiet bench dressed as an empty radar. */
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isGuest, getAccessToken, retryNonce]);

  if (isGuest) return <GuestGate isLight={isLight} />;

  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const strong = isLight ? "text-[#2a1e07]" : "text-white";
  const cardCls = isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5";
  const familyTitleCls = `text-[11px] font-bold uppercase tracking-widest ${muted}`;

  const paceText = (trend: RadarVelocity): string =>
    trend.coldStart
      ? t("trends.radar.coldStart", { current: trend.currentPlays })
      : t("trends.radar.pace", {
          current: trend.currentPlays,
          velocity: trend.velocity!.toFixed(1),
        });

  const formatOutsideViews = (n: number): string => {
    try {
      return new Intl.NumberFormat(i18n.language, {
        notation: "compact",
        maximumFractionDigits: 1,
      }).format(n);
    } catch {
      return String(n);
    }
  };

  const outsideVideos = feed?.outsideHeat?.videos ?? [];
  const showOutside = outsideVideos.length > 0;
  const allEmpty = feed !== null && radarAllEmpty(feed);

  return (
    <div className="space-y-4" data-testid="world-trends-radar-desk">
      <div>
        <p className={`text-base font-black ${strong}`}>{t("worldTrendsRadar.title")}</p>
        <p className={`text-xs ${muted}`}>{t("worldTrendsRadar.subtitle")}</p>
      </div>

      {failed ? (
        <NativeErrorState
          isLight={isLight}
          message={t("trends.radar.loadError")}
          onRetry={() => setRetryNonce((n) => n + 1)}
        />
      ) : feed === null ? (
        <NativeLoadingState isLight={isLight} message={t("trends.radar.loading")} />
      ) : allEmpty && !showOutside ? (
        <NativeEmptyState isLight={isLight} message={t("trends.radar.allEmpty")} />
      ) : (
        <div className="space-y-5" data-testid="world-trends-radar-feed">
          <div>
            <p className={familyTitleCls}>{t("trends.radar.soundsTitle")}</p>
            {feed.sounds.length === 0 ? (
              <p className={`mt-1 text-sm ${muted}`}>{t("trends.radar.soundsEmpty")}</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {feed.sounds.map((s) => (
                  <li key={s.mediaId} className={`rounded-xl border p-3 ${cardCls}`}>
                    <p className={`truncate text-sm font-bold ${strong}`}>{s.title}</p>
                    <p className={`mt-0.5 text-[11px] ${muted}`}>
                      @{s.slug}
                      {s.genre ? ` · ${s.genre}` : ""} · {paceText(s.trend)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <p className={familyTitleCls}>{t("trends.radar.topicsTitle")}</p>
            {feed.topics.length === 0 ? (
              <p className={`mt-1 text-sm ${muted}`}>{t("trends.radar.topicsEmpty")}</p>
            ) : (
              <div className="mt-2 flex flex-wrap gap-2">
                {feed.topics.map((topic) => (
                  <span key={topic.genre} className={`rounded-2xl border px-3 py-2 ${cardCls}`}>
                    <span className={`text-sm font-bold ${strong}`}>{topic.genre}</span>
                    <span className={`mt-0.5 block text-[11px] ${muted}`}>{paceText(topic.trend)}</span>
                  </span>
                ))}
              </div>
            )}
          </div>

          <div>
            <p className={familyTitleCls}>{t("trends.radar.formatsTitle")}</p>
            {feed.formats.length === 0 ? (
              <p className={`mt-1 text-sm ${muted}`}>{t("trends.radar.formatsEmpty")}</p>
            ) : (
              <div className="mt-2 flex flex-wrap gap-2">
                {feed.formats.map((f) => (
                  <span key={f.format} className={`rounded-2xl border px-3 py-2 ${cardCls}`}>
                    <span className={`text-sm font-bold ${strong}`}>{t(`trends.radar.format.${f.format}`)}</span>
                    <span className={`mt-0.5 block text-[11px] ${muted}`}>{paceText(f.trend)}</span>
                  </span>
                ))}
              </div>
            )}
          </div>

          <p className={`text-[11px] leading-relaxed ${muted}`}>{t("trends.radar.honestNote")}</p>

          {/* ── C-30: Heating up outside (YouTube) — its own
              red lane under the on-site families, rendered
              ONLY when the rail actually sent chart rows. */}
          {showOutside ? (
            <div
              className={`rounded-2xl border p-4 ${
                isLight ? "border-red-900/20 bg-red-500/[0.05]" : "border-red-500/25 bg-red-500/[0.04]"
              }`}
              data-testid="world-trends-radar-outside"
            >
              <div className="flex flex-wrap items-center gap-2.5">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#FF0000] text-white">
                  <SquarePlay className="h-4 w-4" aria-hidden="true" />
                </span>
                <p className={`font-display text-lg font-black ${strong}`}>
                  {t("trends.radar.outsideTitle")}
                </p>
                <span className="rounded-full bg-[#FF0000] px-2.5 py-0.5 text-[10px] font-black uppercase tracking-widest text-white">
                  {t("trends.radar.outsideBadge")}
                </span>
              </div>
              <p className={`mt-2 text-xs leading-relaxed ${muted}`}>
                {t("trends.radar.outsideSubtitle")}
              </p>
              <div className="mt-3 space-y-2.5">
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
                      <span className={`block truncate text-sm font-bold group-hover:underline ${strong}`}>
                        {v.title}
                      </span>
                      <span className={`mt-0.5 block truncate text-[11px] ${muted}`}>{v.channelTitle}</span>
                      <span className="mt-1 block text-[11px] font-semibold text-red-400">
                        {t("trends.radar.outsideViews", { count: formatOutsideViews(v.viewCount) })}
                      </span>
                    </span>
                  </a>
                ))}
              </div>
              <p className={`mt-3 text-[11px] leading-relaxed ${muted}`}>
                {t("trends.radar.outsideNote")}
              </p>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
