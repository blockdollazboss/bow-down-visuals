import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/contexts/AuthContext";
import {
  Image as ImageIcon, MessageSquareText, Clapperboard, Zap, ArrowRight, Gift, X,
} from "lucide-react";

/* ── Thy Daily Drop card ────────────────────────────────────────────────
   One new template/preset/style per day, deterministic by UTC date (same
   drop for everyone). Dismissible per day — no forced mechanics, content
   only (no VB payouts). Honours the daily_drop_enabled pref server-side. */

type DropKind = "thumbnail" | "caption" | "video" | "hook";

interface Drop {
  key: string;
  kind: DropKind;
  href: string;
}

const KIND_ICON: Record<DropKind, React.ReactNode> = {
  thumbnail: <ImageIcon className="h-5 w-5" />,
  caption: <MessageSquareText className="h-5 w-5" />,
  video: <Clapperboard className="h-5 w-5" />,
  hook: <Zap className="h-5 w-5" />,
};

const KIND_LABEL_KEY: Record<DropKind, string> = {
  thumbnail: "retention.dailyDrop.kindThumbnail",
  caption: "retention.dailyDrop.kindCaption",
  video: "retention.dailyDrop.kindVideo",
  hook: "retention.dailyDrop.kindHook",
};

export function DailyDropCard() {
  const { t } = useTranslation();
  const { user, getAccessToken } = useAuth();
  const [drop, setDrop] = useState<Drop | null>(null);
  const [date, setDate] = useState("");
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const token = await getAccessToken();
        const res = await fetch("/api/retention/daily-drop", {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) return;
        const d = await res.json() as { enabled?: boolean; date?: string; drop?: Drop };
        if (cancelled || !d.enabled || !d.drop) return;
        // Dismissal is per-day: a new drop tomorrow re-shows the card.
        if (localStorage.getItem(`bdv_daily_drop_dismissed_${d.date}`)) {
          setDismissed(true);
          return;
        }
        setDrop(d.drop);
        setDate(d.date ?? "");
      } catch {
        /* silent — the dashboard must never break over a drop */
      }
    })();
    return () => { cancelled = true; };
  }, [user, getAccessToken]);

  function handleDismiss() {
    if (date) localStorage.setItem(`bdv_daily_drop_dismissed_${date}`, "1");
    setDismissed(true);
  }

  if (dismissed || !drop) return null;

  return (
    <section className="relative overflow-hidden rounded-3xl border border-primary/25 bg-gradient-to-br from-primary/[0.14] via-primary/[0.05] to-transparent p-5 md:p-6 shadow-[0_0_40px_rgba(218,165,32,0.10)]">
      <div className="absolute -top-20 -right-20 h-56 w-56 rounded-full bg-primary/[0.12] blur-[80px] pointer-events-none" />
      <button
        onClick={handleDismiss}
        aria-label={t("retention.dailyDrop.dismiss")}
        className="absolute top-3.5 right-3.5 text-white/25 hover:text-white/60 transition-colors"
      >
        <X className="h-4 w-4" />
      </button>
      <div className="flex flex-wrap items-center gap-4 md:gap-5 relative">
        <div className="h-12 w-12 rounded-2xl bg-primary text-black flex items-center justify-center shrink-0 shadow-[0_0_24px_rgba(218,165,32,0.45)]">
          <Gift className="h-6 w-6" />
        </div>
        <div className="flex-1 min-w-[200px]">
          <p className="text-[10px] font-black tracking-[0.22em] text-primary/70 uppercase flex items-center gap-2">
            {t("retention.dailyDrop.title")}
            <span className="inline-flex items-center gap-1 normal-case tracking-normal font-bold text-white/35 text-[10px]">
              <span className="text-primary/60">{KIND_ICON[drop.kind]}</span>
              {t(KIND_LABEL_KEY[drop.kind])}
            </span>
          </p>
          <h3 className="text-lg md:text-xl font-black text-white mt-1 leading-tight">
            {t(`retention.drops.${drop.key}.title`)}
          </h3>
          <p className="text-xs md:text-sm text-white/45 mt-1 leading-relaxed max-w-xl">
            {t(`retention.drops.${drop.key}.description`)}
          </p>
        </div>
        <Link href={drop.href} className="shrink-0">
          <span className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-black font-black text-sm hover:brightness-110 transition-all shadow-[0_0_20px_rgba(218,165,32,0.35)] cursor-pointer">
            {t("retention.dailyDrop.cta")}<ArrowRight className="h-4 w-4" />
          </span>
        </Link>
      </div>
      <p className="relative text-[10px] text-white/25 mt-3 font-medium">{t("retention.dailyDrop.subtitle")}</p>
    </section>
  );
}
