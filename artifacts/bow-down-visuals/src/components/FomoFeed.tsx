import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity, Film, Sparkles, Gift, Waves, Trophy, TrendingUp,
  Share2, Mic, ChevronDown, X,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useIsLightTheme } from "@/hooks/use-is-light-theme";

interface FeedItem {
  kind: string;
  detail: string | null;
  ts: string;
}

interface FeedResponse {
  items: FeedItem[];
  onlineCount: number;
  onlineWindowMinutes: number;
}

interface PrefsResponse {
  fomo_feed_enabled?: boolean;
}

const HIDE_KEY = "bdv-hide-fomo-feed";
const POLL_MS = 60_000;

const KIND_ICONS: Record<string, typeof Film> = {
  export: Film,
  generation: Sparkles,
  crate: Gift,
  shark_drop: Waves,
  contest_entry: Trophy,
  level_up: TrendingUp,
  publish: Share2,
  lip_sync: Mic,
};

export default function FomoFeed({ getToken }: { getToken: () => Promise<string | null> }) {
  const isLight = useIsLightTheme();
  const { t } = useTranslation();
  const [prefEnabled, setPrefEnabled] = useState<boolean | null>(null);
  const [feed, setFeed] = useState<FeedResponse | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [hidden, setHidden] = useState(() => {
    try { return localStorage.getItem(HIDE_KEY) === "1"; } catch { return false; }
  });
  const hiddenRef = useRef(false);

  const authHeaders = useCallback(async (): Promise<HeadersInit> => {
    const token = await getToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, [getToken]);

  /* Retention toggle: fomo_feed_enabled (sibling worker adds it to
     /api/retention/prefs). Absent key = enabled (default on, like the other
     retention systems). When explicitly off → render nothing. */
  const loadPrefs = useCallback(async () => {
    try {
      const res = await fetch("/api/retention/prefs", { headers: await authHeaders() });
      if (!res.ok) { setPrefEnabled(true); return; }
      const body = (await res.json()) as PrefsResponse;
      setPrefEnabled(body.fomo_feed_enabled !== false);
    } catch {
      setPrefEnabled(true);
    }
  }, [authHeaders]);

  const loadFeed = useCallback(async () => {
    try {
      const res = await fetch("/api/activity/feed", { headers: await authHeaders() });
      if (res.ok) setFeed((await res.json()) as FeedResponse);
    } catch { /* feed keeps last good state on failure */ }
  }, [authHeaders]);

  useEffect(() => {
    hiddenRef.current = document.hidden;
    const onVis = () => {
      hiddenRef.current = document.hidden;
      if (!document.hidden) { void loadPrefs(); void loadFeed(); }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [loadPrefs, loadFeed]);

  useEffect(() => {
    void loadPrefs();
    void loadFeed();
    const id = setInterval(() => {
      if (!hiddenRef.current) void loadFeed(); // pause polling while tab hidden
    }, POLL_MS);
    return () => clearInterval(id);
  }, [loadPrefs, loadFeed]);

  if (hidden) return null;
  if (prefEnabled === false) return null;
  if (!feed) return null;

  const relTime = (iso: string): string => {
    const mins = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
    if (mins < 1) return t("fomoFeed.just_now", { defaultValue: "just now" });
    if (mins < 60) return t("fomoFeed.minutes_ago", { defaultValue: "{{count}}m ago", count: mins });
    return t("fomoFeed.hours_ago", { defaultValue: "{{count}}h ago", count: Math.floor(mins / 60) });
  };

  const itemText = (item: FeedItem): string => {
    switch (item.kind) {
      case "export":
        return t("fomoFeed.item_export", { defaultValue: "A creator just exported a video" });
      case "generation": {
        const d = (item.detail ?? "").toLowerCase();
        if (d === "image") return t("fomoFeed.item_generation_image", { defaultValue: "Someone just generated an image" });
        if (d === "video") return t("fomoFeed.item_generation_video", { defaultValue: "Someone just generated a video" });
        if (d === "song") return t("fomoFeed.item_generation_song", { defaultValue: "Someone just generated a song" });
        if (d === "voice") return t("fomoFeed.item_generation_voice", { defaultValue: "Someone just cloned a voice" });
        return t("fomoFeed.item_generation", { defaultValue: "Someone just created something new" });
      }
      case "crate":
        return t("fomoFeed.item_crate", { defaultValue: "Someone just claimed the hourly crate" });
      case "shark_drop":
        return t("fomoFeed.item_shark_drop", { defaultValue: "Someone claimed a shark drop" });
      case "contest_entry":
        return t("fomoFeed.item_contest_entry", { defaultValue: "A new entry just joined a contest" });
      case "level_up":
        return t("fomoFeed.item_level_up", { defaultValue: "A creator just leveled up" });
      case "publish":
        return t("fomoFeed.item_publish", { defaultValue: "Someone just published a post" });
      case "lip_sync":
        return t("fomoFeed.item_lip_sync", { defaultValue: "Someone started a lip-sync" });
      default:
        return t("fomoFeed.item_generic", { defaultValue: "Something just happened on Bow Down Visuals" });
    }
  };

  return (
    <section aria-live="polite"
      className={`relative overflow-hidden rounded-3xl border p-5 md:p-6 ${isLight ? "border-[#C9A84C]/40 bg-gradient-to-b from-[#FCF7EA] to-[#F4E7C3]" : "border-primary/25 bg-gradient-to-b from-[#14100a] to-[#0d0a04]"}`}>
      <div className="flex items-center gap-3">
        <div className="h-11 w-11 rounded-2xl bg-emerald-500/[0.14] border border-emerald-500/30 flex items-center justify-center text-emerald-400 shrink-0">
          <Activity className="h-6 w-6" />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-black tracking-wide text-white uppercase flex items-center gap-2">
            {t("fomoFeed.title", { defaultValue: "Live Activity" })}
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
            </span>
          </h2>
          <p className="text-xs text-white/50">
            {t("fomoFeed.active_recently", {
              defaultValue: "{{count}} creators active in the last {{mins}} min",
              count: feed.onlineCount,
              mins: feed.onlineWindowMinutes,
            })}
          </p>
        </div>
        <button type="button" onClick={() => setCollapsed((c) => !c)}
          aria-label={collapsed ? t("fomoFeed.expand", { defaultValue: "Expand" }) : t("fomoFeed.collapse", { defaultValue: "Collapse" })}
          className="p-1.5 rounded-lg text-white/50 hover:text-primary hover:bg-white/[0.05] transition-colors">
          <ChevronDown className={`h-4 w-4 transition-transform ${collapsed ? "" : "rotate-180"}`} />
        </button>
        <button type="button"
          onClick={() => { try { localStorage.setItem(HIDE_KEY, "1"); } catch {} setHidden(true); }}
          aria-label={t("fomoFeed.hide_widget", { defaultValue: "Hide activity feed" })}
          className="p-1.5 rounded-lg text-white/50 hover:text-white hover:bg-white/[0.05] transition-colors">
          <X className="h-4 w-4" />
        </button>
      </div>

      {!collapsed && (
        <ul className="mt-4 space-y-2.5 max-h-72 overflow-y-auto pr-1">
          {feed.items.length === 0 && (
            <li className="text-xs text-white/40 italic">
              {t("fomoFeed.empty", { defaultValue: "Quiet right now — be the first to create something today." })}
            </li>
          )}
          {feed.items.map((item, i) => {
            const Icon = KIND_ICONS[item.kind] ?? Activity;
            return (
              <li key={`${item.kind}-${item.ts}-${i}`} className="flex items-center gap-3">
                <span className="h-8 w-8 rounded-xl bg-white/[0.05] border border-white/[0.08] flex items-center justify-center text-primary shrink-0">
                  <Icon className="h-4 w-4" />
                </span>
                <span className="flex-1 min-w-0 text-[13px] text-white/80 truncate">{itemText(item)}</span>
                <span className="text-[11px] text-white/35 shrink-0 font-semibold">{relTime(item.ts)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
