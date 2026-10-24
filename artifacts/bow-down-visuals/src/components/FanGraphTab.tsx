import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Loader2, Search, Users } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

/* ─── One Fan Graph (Stack-100 #3, feature #11) ──────────────────────
   The unified fan view, docked in the Email List desk (PROMOTE).
   One record per fan across followers, email subscribers, fan-club
   members, and buyers — merged server-side by GET
   /api/email-list/fan-graph (see lib/fan-graph for the merge rule).
   Read-only: this tab displays the graph; it never writes it. */

interface FanRecord {
  id: string;
  userId: string | null;
  email: string | null;
  emails: string[];
  displayName: string | null;
  profileSlug: string | null;
  avatarUrl: string | null;
  follows: boolean;
  subscribed: boolean;
  unsubscribed: boolean;
  member: { tierName: string | null; status: string } | null;
  spentUsdCents: number;
  spentVb: number;
  purchaseCount: number;
  lastActivityAt: string | null;
}

interface FanGraphSummary {
  totalFans: number;
  followers: number;
  subscribers: number;
  members: number;
  buyers: number;
  totalSpentUsdCents: number;
  totalSpentVb: number;
}

const cardClass = "rounded-2xl border border-white/10 bg-white/[0.03] p-5 backdrop-blur";
const PAGE_SIZE = 25;

const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export default function FanGraphTab() {
  const { t, i18n } = useTranslation();
  const { getAccessToken } = useAuth();
  const [fans, setFans] = useState<FanRecord[]>([]);
  const [summary, setSummary] = useState<FanGraphSummary | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<"recent" | "spent" | "name">("recent");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [debouncedSearch, setDebouncedSearch] = useState("");

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(1);
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [search]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await getAccessToken();
      const qs = new URLSearchParams({
        sort,
        page: String(page),
        pageSize: String(PAGE_SIZE),
      });
      if (debouncedSearch) qs.set("search", debouncedSearch);
      const res = await fetch(`/api/email-list/fan-graph?${qs.toString()}`, {
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Couldn't load your fan graph.");
      setFans(data.fans ?? []);
      setSummary(data.summary ?? null);
      setTotal(data.total ?? 0);
      if (typeof data.page === "number") setPage(data.page);
    } catch {
      setError(t("email-list.fan_graph_error"));
    } finally {
      setLoading(false);
    }
  }, [getAccessToken, sort, page, debouncedSearch, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const stat = (label: string, value: number) => (
    <div className={cardClass}>
      <p className="flex items-center gap-2 text-xs uppercase tracking-widest text-white/40">
        <Users className="h-3.5 w-3.5" />
        {label}
      </p>
      <p className="mt-2 font-display text-3xl font-black">{value}</p>
    </div>
  );

  const badge = (text: string, cls: string) => (
    <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${cls}`}>{text}</span>
  );

  return (
    <div className="mt-8">
      <p className="mx-auto max-w-2xl text-center text-sm text-white/55">{t("email-list.fan_graph_intro")}</p>

      {summary && (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {stat(t("email-list.fan_graph_total_fans"), summary.totalFans)}
          {stat(t("email-list.fan_graph_followers"), summary.followers)}
          {stat(t("email-list.active_subscribers"), summary.subscribers)}
          {stat(t("email-list.fan_graph_members_label"), summary.members)}
          {stat(t("email-list.fan_graph_buyers"), summary.buyers)}
        </div>
      )}
      {summary && (summary.totalSpentUsdCents > 0 || summary.totalSpentVb > 0) && (
        <p className="mt-3 text-center text-xs text-white/40">
          {t("email-list.fan_graph_spent_label")}: {usd(summary.totalSpentUsdCents)}
          {summary.totalSpentVb > 0 ? ` · ${summary.totalSpentVb.toLocaleString()} Visual Bucs` : ""}
        </p>
      )}

      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/30" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("email-list.fan_graph_search")}
            className="w-72 rounded-xl border border-white/10 bg-black/60 py-2.5 pl-9 pr-4 text-sm text-white placeholder:text-white/25 outline-none focus:border-primary/60"
          />
        </div>
        <select
          value={sort}
          onChange={(e) => {
            setSort(e.target.value as typeof sort);
            setPage(1);
          }}
          className="rounded-xl border border-white/10 bg-black/60 px-4 py-2.5 text-sm text-white outline-none focus:border-primary/60"
        >
          <option value="recent">{t("email-list.fan_graph_sort_recent")}</option>
          <option value="spent">{t("email-list.fan_graph_sort_spent")}</option>
          <option value="name">{t("email-list.fan_graph_sort_name")}</option>
        </select>
      </div>

      {error && (
        <div className="mx-auto mt-6 flex max-w-2xl items-start gap-3 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className={`${cardClass} mt-6`}>
        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : fans.length === 0 ? (
          <p className="py-8 text-center text-sm text-white/45">{t("email-list.fan_graph_empty")}</p>
        ) : (
          <div className="divide-y divide-white/5">
            {fans.map((f) => (
              <div key={f.id} className="flex flex-wrap items-center gap-3 py-3">
                {f.avatarUrl ? (
                  <img src={f.avatarUrl} alt="" className="h-10 w-10 rounded-full object-cover" />
                ) : (
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/15 font-display text-sm font-black text-primary">
                    {(f.displayName ?? f.email ?? "?").slice(0, 1).toUpperCase()}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{f.displayName ?? f.email ?? f.id}</p>
                  {f.displayName && f.email && <p className="truncate text-xs text-white/40">{f.email}</p>}
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {f.follows && badge(t("email-list.fan_graph_follows_badge"), "border-primary/30 bg-primary/10 text-primary")}
                    {f.subscribed &&
                      badge(t("email-list.fan_graph_subscribed_badge"), "border-emerald-400/30 bg-emerald-400/10 text-emerald-300")}
                    {f.unsubscribed &&
                      badge(t("email-list.fan_graph_unsubscribed_badge"), "border-white/15 bg-white/5 text-white/40")}
                    {f.member &&
                      badge(
                        `${t("email-list.fan_graph_member_badge")}${f.member.tierName ? ` · ${f.member.tierName}` : ""}`,
                        "border-amber-400/30 bg-amber-400/10 text-amber-300",
                      )}
                  </div>
                </div>
                <div className="text-right">
                  {(f.spentUsdCents > 0 || f.spentVb > 0) && (
                    <p className="text-sm font-semibold">
                      {t("email-list.fan_graph_spent_label")} {usd(f.spentUsdCents)}
                      {f.spentVb > 0 ? ` · ${f.spentVb.toLocaleString()} VB` : ""}
                    </p>
                  )}
                  {f.lastActivityAt && (
                    <p className="text-xs text-white/40">
                      {t("email-list.fan_graph_last_active")}:{" "}
                      {new Date(f.lastActivityAt).toLocaleDateString(i18n.language)}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {total > PAGE_SIZE && (
        <div className="mt-4 flex items-center justify-center gap-3 text-sm">
          <button
            disabled={page <= 1 || loading}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2 font-semibold text-white/70 transition hover:text-white disabled:opacity-40"
          >
            {t("email-list.fan_graph_prev")}
          </button>
          <span className="text-white/50">
            {page} / {pages}
          </span>
          <button
            disabled={page >= pages || loading}
            onClick={() => setPage((p) => Math.min(pages, p + 1))}
            className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2 font-semibold text-white/70 transition hover:text-white disabled:opacity-40"
          >
            {t("email-list.fan_graph_next")}
          </button>
        </div>
      )}
    </div>
  );
}
