import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { CalendarRange, Play, Share2, Sparkles, TrendingUp, Users, Disc3, Check } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useIsLightTheme } from "@/hooks/use-is-light-theme";
import { useToast } from "@/hooks/use-toast";
import {
  buildMonthWrappedShareText,
  fmtCount,
  monthWrappedMetrics,
  type MonthWrappedResponse,
} from "@/lib/month-wrapped";

/* ── Your Month, Wrapped (Stack-200, idea #170) ───────────────────────
   Docked in the Analytics Hub dashboard tab — never a standalone page.
   One recap per creator per month, made server-side from REAL platform
   numbers only: the card renders exactly the metrics the server sent
   (an unsupported metric is absent, never a placeholder). Sharing
   happens ONLY here, on the creator's tap — nothing auto-posts.
   Creators who opted out in Settings get no card at all. */

const METRIC_ICONS = {
  plays: Play,
  newFans: Users,
  sales: TrendingUp,
  newReleases: Disc3,
} as const;

const METRIC_LABEL_KEYS = {
  plays: "monthWrapped.plays",
  newFans: "monthWrapped.newFans",
  sales: "monthWrapped.sales",
  newReleases: "monthWrapped.newReleases",
} as const;

const METRIC_FALLBACKS = {
  plays: "Plays",
  newFans: "New fans",
  sales: "Sales",
  newReleases: "New releases",
} as const;

export function MonthWrappedCard() {
  const isLight = useIsLightTheme();
  const { t } = useTranslation();
  const { user, getAccessToken } = useAuth();
  const { toast } = useToast();
  const [data, setData] = useState<MonthWrappedResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const token = await getAccessToken();
        const res = await fetch("/api/month-wrapped", {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) throw new Error("load failed");
        const d = (await res.json()) as MonthWrappedResponse;
        if (!cancelled) setData(d);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => { cancelled = true; };
  }, [user, getAccessToken]);

  /* Opted out, no creator profile, still loading, or a failed load:
     no card. A failed load must never render as an empty recap. */
  if (!data || !data.enabled || !data.recap) return null;
  if (failed) return null;
  const recap = data.recap;
  const metrics = monthWrappedMetrics(recap);
  const shareText = data.shareText ?? buildMonthWrappedShareText(recap);

  async function share() {
    try {
      if (typeof navigator !== "undefined" && "share" in navigator) {
        await navigator.share({ title: `My ${recap.monthLabel}, Wrapped`, text: shareText });
        return;
      }
      throw new Error("no native share");
    } catch {
      try {
        await navigator.clipboard.writeText(shareText);
        setCopied(true);
        toast({ title: t("monthWrapped.copied", { defaultValue: "Your Wrapped recap is copied — post it anywhere." }) });
        setTimeout(() => setCopied(false), 2500);
      } catch {
        toast({ title: t("monthWrapped.shareFailed", { defaultValue: "Sharing isn't available right now." }), variant: "destructive" });
      }
    }
  }

  return (
    <section
      data-testid="month-wrapped-card"
      className={`relative mx-auto mt-10 max-w-3xl rounded-3xl border p-6 md:p-8 ${
        isLight
          ? "border-[#C9A84C]/40 bg-gradient-to-b from-[#FCF7EA] to-[#F4E7C3]"
          : "border-primary/25 bg-gradient-to-b from-[#14100a] to-[#0d0a04]"
      }`}
    >
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-primary/25 bg-primary/[0.12]">
          <CalendarRange className="h-5 w-5 text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold uppercase tracking-widest text-primary">
            {t("monthWrapped.kicker", { defaultValue: "Your Month, Wrapped" })}
          </p>
          <h2 className="mt-1 font-display text-2xl font-black text-white md:text-3xl">
            {recap.monthLabel}
            {!recap.periodComplete && (
              <span className="ml-2 align-middle text-xs font-bold uppercase tracking-widest text-white/40">
                {t("monthWrapped.soFar", { defaultValue: "so far" })}
              </span>
            )}
          </h2>
          <p className="mt-1 text-sm text-white/50">
            {t("monthWrapped.subtitle", {
              defaultValue: "Your real numbers for the month — plays, sales, new fans and your best moment. Nothing estimated, ever.",
            })}
          </p>
        </div>
      </div>

      {metrics.length > 0 ? (
        <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
          {metrics.map((m) => {
            const Icon = METRIC_ICONS[m.key];
            return (
              <div
                key={m.key}
                className={`rounded-2xl border p-4 ${isLight ? "border-[#C9A84C]/30 bg-white/50" : "border-white/[0.08] bg-white/[0.03]"}`}
              >
                <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-white/40">
                  <Icon className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
                  {t(METRIC_LABEL_KEYS[m.key], { defaultValue: METRIC_FALLBACKS[m.key] })}
                </p>
                <p className="mt-2 font-display text-2xl font-black text-white">{m.value}</p>
              </div>
            );
          })}
        </div>
      ) : null}

      {recap.bestMoment ? (
        <div className={`mt-4 flex items-center gap-3 rounded-2xl border p-4 ${isLight ? "border-[#C9A84C]/30 bg-white/50" : "border-white/[0.08] bg-white/[0.03]"}`}>
          <Sparkles className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-widest text-white/40">
              {t("monthWrapped.bestMoment", { defaultValue: "Best moment" })}
            </p>
            <p className="truncate text-sm font-bold text-white">
              “{recap.bestMoment.title}” · {fmtCount(recap.bestMoment.plays)}{" "}
              {t("monthWrapped.playsLower", { defaultValue: "plays" })}
            </p>
          </div>
        </div>
      ) : !recap.hasActivity ? (
        <p className="mt-4 text-sm text-white/45">
          {t("monthWrapped.quietMonth", {
            defaultValue: "A quiet month on the books — no plays, sales or new fans were recorded. Next month is a fresh page.",
          })}
        </p>
      ) : null}

      <div className="mt-6 flex items-center gap-3">
        <button
          type="button"
          onClick={share}
          data-testid="month-wrapped-share"
          className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-black text-black shadow-[0_2px_16px_rgba(212,175,55,0.4)] transition hover:brightness-110"
        >
          {copied ? <Check className="h-4 w-4" /> : <Share2 className="h-4 w-4" />}
          {t("monthWrapped.share", { defaultValue: "Share my Wrapped" })}
        </button>
        <p className="text-[11px] leading-relaxed text-white/35">
          {t("monthWrapped.shareNote", { defaultValue: "Shares only when you tap — nothing posts itself." })}
        </p>
      </div>
    </section>
  );
}
