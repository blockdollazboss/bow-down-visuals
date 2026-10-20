import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/contexts/AuthContext";
import { useIsLightTheme } from "@/hooks/use-is-light-theme";
import {
  Image as ImageIcon, MessageSquareText, Clapperboard, Zap, ArrowRight, Archive, ArchiveRestore,
} from "lucide-react";
import {
  DAILY_DROP_ARCHIVE_PATH,
  DAILY_DROP_CATALOG_PATH,
  DAILY_DROP_UNARCHIVE_PATH,
  applyDropArchive,
  normalizeDailyDropCatalog,
  splitDailyDropCatalog,
  type DailyDropCatalog as DropCatalog,
  type DailyDropCatalogEntry,
  type DailyDropKind,
} from "@/lib/world/daily-drop-catalog";

/* ── The Drop Catalogue, website side ───────────────────────────────
   The whole Daily Drop slate (30 curated template defs rotating one
   per UTC day) lived ONLY in the World's Treasury: the website
   showed today's drop card and nothing else, so a member who never
   entered the World could never browse the slate, use a template
   whose day they missed, or archive one they don't want.

   This is the same catalogue on the website, docked on the
   dashboard directly under the day's drop card — the same dock the
   Treasury uses — and riding the same rails (the shared seam in
   lib/world/daily-drop-catalog + the catalogue routes):
   • USE — every row's Use is the def's real tool href, followed
     with the website's same-tab Link, exactly how the day's drop
     card has always been used here. The tool on the other end
     preloads the template; nothing is applied client-side.
   • ARCHIVE — the same per-member tidy-up (daily_drop_archives,
     migration 0161): a row moves lists only after the server
     confirms the write, and the copy says archiving tidies the
     member's own list only — the shared rotation never changes.
   Honest states throughout: a failed load is a failed state with
   retry (never an empty-looking catalogue), and Daily Drop off in
   the member's prefs closes the catalogue, same as the card. */

const KIND_ICON: Record<DailyDropKind, React.ReactNode> = {
  thumbnail: <ImageIcon className="h-5 w-5" />,
  caption: <MessageSquareText className="h-5 w-5" />,
  video: <Clapperboard className="h-5 w-5" />,
  hook: <Zap className="h-5 w-5" />,
};

const KIND_LABEL_KEY: Record<DailyDropKind, string> = {
  thumbnail: "retention.dailyDrop.kindThumbnail",
  caption: "retention.dailyDrop.kindCaption",
  video: "retention.dailyDrop.kindVideo",
  hook: "retention.dailyDrop.kindHook",
};

export function DailyDropSlate() {
  const isLight = useIsLightTheme();
  const { t } = useTranslation();
  const { user, getAccessToken } = useAuth();
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  const [catalog, setCatalog] = useState<DropCatalog | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function apiJson<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
    const token = await getAccessToken();
    const res = await fetch(path, {
      method: init?.method ?? "GET",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown> & {
      error?: string; message?: string;
    };
    if (!res.ok) throw new Error(data.message || data.error || `Request failed (${res.status})`);
    return data as T;
  }

  const load = async () => {
    setState("loading");
    try {
      const d = await apiJson<unknown>(DAILY_DROP_CATALOG_PATH);
      const normalized = normalizeDailyDropCatalog(d);
      if (!normalized) throw new Error("bad catalogue shape");
      setCatalog(normalized);
      setState("ready");
    } catch {
      setState("failed");
    }
  };

  useEffect(() => {
    if (!user) return;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  async function toggleArchive(entry: DailyDropCatalogEntry) {
    if (busyKey) return;
    setBusyKey(entry.key);
    setNote(null);
    try {
      await apiJson(entry.archived ? DAILY_DROP_UNARCHIVE_PATH : DAILY_DROP_ARCHIVE_PATH, {
        method: "POST",
        body: { key: entry.key },
      });
      /* The server confirmed — only now does the row move lists. */
      setCatalog((prev) =>
        prev ? { ...prev, drops: applyDropArchive(prev.drops, entry.key, !entry.archived) } : prev,
      );
    } catch {
      setNote(t("retention.dropCatalog.saveFailed"));
    } finally {
      setBusyKey(null);
    }
  }

  if (!user) return null;

  const shell = `relative overflow-hidden rounded-3xl border p-5 md:p-6 shadow-[0_0_40px_rgba(218,165,32,0.10)] ${
    isLight
      ? "border-[#C9A84C]/40 bg-gradient-to-b from-[#FCF7EA] to-[#F4E7C3]"
      : "border-primary/25 bg-gradient-to-b from-[#14100a] to-[#0d0a04]"
  }`;

  if (state === "loading") {
    return (
      <section className={shell} data-testid="website-daily-drop-catalog">
        <p className="text-sm text-white/45 font-medium">{t("retention.dropCatalog.loading")}</p>
      </section>
    );
  }
  if (state === "failed") {
    return (
      <section className={shell} data-testid="website-daily-drop-catalog">
        <h3 className="text-lg font-black text-white leading-tight">{t("retention.dropCatalog.failedTitle")}</h3>
        <p className="text-xs md:text-sm text-white/45 mt-1 leading-relaxed">{t("retention.dropCatalog.failedBody")}</p>
        <button
          type="button"
          onClick={() => void load()}
          className="mt-3 inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-primary/40 text-primary font-black text-sm hover:brightness-110 transition-all"
        >
          {t("common.retry")}
        </button>
      </section>
    );
  }
  /* Daily Drop turned off in the member's prefs: the catalogue
     closes with it, same as the day's drop card. */
  if (!catalog || !catalog.enabled) return null;

  const { active, archived } = splitDailyDropCatalog(catalog.drops);

  const row = (entry: DailyDropCatalogEntry) => (
    <div
      key={entry.key}
      className={`flex flex-wrap items-center gap-3 md:gap-4 rounded-2xl border px-4 py-3 ${
        entry.isToday
          ? "border-primary/50 bg-primary/[0.08]"
          : isLight
            ? "border-[#C9A84C]/25 bg-white/40"
            : "border-white/10 bg-white/[0.03]"
      }`}
    >
      <div className="h-10 w-10 rounded-xl bg-primary text-black flex items-center justify-center shrink-0">
        {KIND_ICON[entry.kind]}
      </div>
      <div className="flex-1 min-w-[200px]">
        <p className="text-[10px] font-black tracking-[0.18em] text-primary/70 uppercase">
          {t(KIND_LABEL_KEY[entry.kind])}
          {entry.isToday ? ` · ${t("retention.dropCatalog.today")}` : ""}
        </p>
        <h4 className="text-base font-black text-white leading-tight">
          {t(`retention.drops.${entry.key}.title`)}
        </h4>
        <p className="text-xs text-white/45 mt-0.5 leading-relaxed max-w-xl">
          {t(`retention.drops.${entry.key}.description`)}
        </p>
      </div>
      <span className="inline-flex items-center gap-1.5 shrink-0">
        <Link href={entry.href} className="shrink-0">
          <span
            data-testid={`website-daily-drop-use-${entry.key}`}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-black font-black text-sm hover:brightness-110 transition-all cursor-pointer"
          >
            {t("retention.dropCatalog.use")}<ArrowRight className="h-4 w-4" />
          </span>
        </Link>
        <button
          type="button"
          disabled={busyKey === entry.key}
          onClick={() => void toggleArchive(entry)}
          data-testid={
            entry.archived
              ? `website-daily-drop-unarchive-${entry.key}`
              : `website-daily-drop-archive-${entry.key}`
          }
          className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-bold transition disabled:opacity-50 ${
            isLight
              ? "border-[#7A5A12]/30 text-[#6B5B36] hover:text-[#2a1e07]"
              : "border-white/15 text-white/60 hover:text-white"
          }`}
        >
          {entry.archived ? (
            <><ArchiveRestore className="h-3.5 w-3.5" /> {t("retention.dropCatalog.unarchive")}</>
          ) : (
            <><Archive className="h-3.5 w-3.5" /> {t("retention.dropCatalog.archive")}</>
          )}
        </button>
      </span>
    </div>
  );

  return (
    <section className={shell} data-testid="website-daily-drop-catalog">
      <h3 className="text-lg md:text-xl font-black text-white leading-tight">
        {t("retention.dropCatalog.title")}
      </h3>
      <p className="text-xs md:text-sm text-white/45 mt-1 leading-relaxed max-w-2xl">
        {t("retention.dropCatalog.blurb")}
      </p>
      {active.length === 0 ? (
        <p className="text-sm text-white/45 font-medium mt-4">
          {t(catalog.drops.length === 0 ? "retention.dropCatalog.emptyAll" : "retention.dropCatalog.emptyArchived")}
        </p>
      ) : (
        <div className="mt-4 max-h-[430px] overflow-y-auto pr-1 space-y-2">
          {active.map(row)}
        </div>
      )}
      {note && <p className="text-xs font-semibold text-amber-300 mt-3">{note}</p>}
      {archived.length > 0 && (
        <div className="mt-5">
          <h4 className="text-sm font-black text-white/70 uppercase tracking-[0.14em]">
            {t("retention.dropCatalog.archivedTitle")}
          </h4>
          <div className="mt-2 max-h-[430px] overflow-y-auto pr-1 space-y-2">
            {archived.map(row)}
          </div>
        </div>
      )}
    </section>
  );
}
