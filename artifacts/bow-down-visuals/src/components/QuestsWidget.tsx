import { useCallback, useEffect, useState } from "react";
import { Link } from "wouter";
import { Target, ChevronDown, X, Check, Loader2, Image as ImageIcon, Music2, Clapperboard, ArrowUpRight } from "lucide-react";
import { useTranslation } from "react-i18next";

interface Quest {
  key: string;
  target: number;
  reward: number;
  progress: number;
  completed: boolean;
  claimed: boolean;
}

interface QuestsData {
  enabled: boolean;
  weekStart: string;
  quests: Quest[];
}

const HIDE_KEY = "bdv-hide-retention-quests";

const QUEST_META: Record<string, { icon: typeof ImageIcon; href: string; titleKey: string; descKey: string }> = {
  "make-thumbnail": { icon: ImageIcon, href: "/thumbnail-maker", titleKey: "retention.quest_make_thumbnail_title", descKey: "retention.quest_make_thumbnail_desc" },
  "generate-song":   { icon: Music2, href: "/make-song", titleKey: "retention.quest_generate_song_title", descKey: "retention.quest_generate_song_desc" },
  "export-video":    { icon: Clapperboard, href: "/video-editor", titleKey: "retention.quest_export_video_title", descKey: "retention.quest_export_video_desc" },
};

export default function QuestsWidget({
  getToken,
  onBalanceChange,
}: {
  getToken: () => Promise<string | null>;
  onBalanceChange?: () => void;
}) {
  const { t } = useTranslation();
  const [data, setData] = useState<QuestsData | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [hidden, setHidden] = useState(() => {
    try { return localStorage.getItem(HIDE_KEY) === "1"; } catch { return false; }
  });
  const [claiming, setClaiming] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const authHeaders = useCallback(async (): Promise<HeadersInit> => {
    const token = await getToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, [getToken]);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/retention/quests", { headers: await authHeaders() });
      if (res.ok) setData((await res.json()) as QuestsData);
    } catch { /* widget stays empty on failure */ }
  }, [authHeaders]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(id);
  }, [toast]);

  const toggleEnabled = useCallback(async () => {
    if (!data) return;
    try {
      const res = await fetch("/api/retention/prefs", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({ quests_enabled: !data.enabled }),
      });
      if (res.ok) void load();
    } catch { /* noop */ }
  }, [data, authHeaders, load]);

  const claim = useCallback(async (questKey: string) => {
    setClaiming(questKey);
    try {
      const res = await fetch("/api/retention/quests/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({ questKey }),
      });
      const body = (await res.json().catch(() => ({}))) as { reward?: number; error?: string };
      if (res.ok && typeof body.reward === "number") {
        setToast(t("retention.claim_success", { reward: body.reward }));
        onBalanceChange?.();
        await load();
      } else {
        setToast(body.error ?? t("retention.claim_failed"));
      }
    } catch {
      setToast(t("retention.claim_failed"));
    } finally {
      setClaiming(null);
    }
  }, [authHeaders, load, onBalanceChange, t]);

  if (hidden) return null;
  if (!data) return null;

  const toggle = (
    <button type="button" onClick={() => void toggleEnabled()} role="switch" aria-checked={data.enabled}
      aria-label={t("retention.toggle_quests")}
      className="flex items-center gap-2 text-[11px] font-bold text-white/50 hover:text-white/80 transition-colors">
      <span>{t("retention.toggle_quests")}</span>
      <span className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${data.enabled ? "bg-primary" : "bg-white/[0.12]"}`}>
        <span className={`inline-block h-3.5 w-3.5 rounded-full bg-black transition-transform ${data.enabled ? "translate-x-[18px]" : "translate-x-[3px]"}`} />
      </span>
    </button>
  );

  /* Disabled: slim bar so the user can always switch it back on. */
  if (!data.enabled) {
    return (
      <section className="rounded-2xl border border-white/[0.08] bg-white/[0.02] px-4 py-3 flex items-center gap-3 opacity-70">
        <Target className="h-5 w-5 text-white/30 shrink-0" />
        <span className="flex-1 text-xs font-bold text-white/40 uppercase tracking-wide">{t("retention.quests_title")}</span>
        {toggle}
      </section>
    );
  }

  const totalReward = data.quests.filter((q) => !q.claimed).reduce((s, q) => s + q.reward, 0);

  return (
    <section className="relative overflow-hidden rounded-3xl border border-primary/25 bg-gradient-to-br from-primary/[0.10] via-primary/[0.04] to-transparent p-5 md:p-6">
      <div className="flex items-center gap-3">
        <div className="h-11 w-11 rounded-2xl bg-primary/[0.12] border border-primary/30 flex items-center justify-center text-primary shrink-0">
          <Target className="h-6 w-6" />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-black tracking-wide text-white uppercase">{t("retention.quests_title")}</h2>
          <p className="text-xs text-white/50">{t("retention.quests_reset")} · <span className="font-bold text-amber-300/90">{t("retention.quests_up_for_grabs", { total: totalReward })}</span></p>
        </div>
        <button type="button" onClick={() => setCollapsed((c) => !c)}
          aria-label={collapsed ? t("retention.expand") : t("retention.collapse")}
          className="p-1.5 rounded-lg text-white/50 hover:text-primary hover:bg-white/[0.05] transition-colors">
          <ChevronDown className={`h-4 w-4 transition-transform ${collapsed ? "" : "rotate-180"}`} />
        </button>
        <button type="button" onClick={() => { try { localStorage.setItem(HIDE_KEY, "1"); } catch {} setHidden(true); }}
          aria-label={t("retention.hide_widget")}
          className="p-1.5 rounded-lg text-white/50 hover:text-white hover:bg-white/[0.05] transition-colors">
          <X className="h-4 w-4" />
        </button>
      </div>

      {!collapsed && (
        <div className="mt-4 space-y-2.5">
          {data.quests.map((q) => {
            const meta = QUEST_META[q.key];
            const Icon = meta?.icon ?? Target;
            const pct = q.target > 0 ? Math.min(100, (q.progress / q.target) * 100) : 0;
            const canClaim = q.completed && !q.claimed;
            return (
              <div key={q.key} className={`rounded-2xl border p-3.5 flex items-center gap-3 transition-colors ${
                canClaim ? "border-primary/50 bg-primary/[0.08]" : "border-white/[0.08] bg-white/[0.02]"
              }`}>
                <div className={`h-10 w-10 rounded-xl border flex items-center justify-center shrink-0 ${
                  q.claimed ? "bg-emerald-500/[0.10] border-emerald-500/25 text-emerald-400"
                  : canClaim ? "bg-primary/[0.12] border-primary/30 text-primary"
                  : "bg-white/[0.04] border-white/[0.08] text-white/50"
                }`}>
                  {q.claimed ? <Check className="h-5 w-5" /> : <Icon className="h-5 w-5" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[13px] font-black text-white truncate">
                      {meta ? t(meta.titleKey) : q.key}
                    </p>
                    <span className="text-[11px] font-bold text-amber-300/90 shrink-0">{q.reward} VB</span>
                  </div>
                  <p className="text-[11px] text-white/45 truncate">{meta ? t(meta.descKey) : ""}</p>
                  <div className="mt-1.5 flex items-center gap-2">
                    <div className="flex-1 h-1.5 rounded-full bg-white/[0.07] overflow-hidden">
                      <div className={`h-full rounded-full transition-all ${q.completed ? "bg-gradient-to-r from-emerald-500 to-emerald-400" : "bg-gradient-to-r from-amber-500 to-primary"}`}
                        style={{ width: `${pct}%` }} />
                    </div>
                    <span className="text-[10px] font-bold text-white/45 shrink-0">{t("retention.quests_progress", { progress: q.progress, target: q.target })}</span>
                  </div>
                </div>
                {q.claimed ? (
                  <span className="text-[10px] font-black text-emerald-400 uppercase tracking-wide shrink-0">{t("retention.quests_claimed")}</span>
                ) : canClaim ? (
                  <button type="button" onClick={() => void claim(q.key)} disabled={claiming === q.key}
                    className="shrink-0 px-3 py-2 rounded-xl bg-primary text-black text-[11px] font-black hover:brightness-110 transition-all disabled:opacity-60">
                    {claiming === q.key ? <Loader2 className="h-4 w-4 animate-spin" /> : t("retention.quests_claim", { reward: q.reward })}
                  </button>
                ) : meta ? (
                  <Link href={meta.href}>
                    <span className="shrink-0 p-2 rounded-xl border border-white/[0.10] text-white/50 hover:text-primary hover:border-primary/40 transition-colors cursor-pointer">
                      <ArrowUpRight className="h-4 w-4" />
                    </span>
                  </Link>
                ) : null}
              </div>
            );
          })}

          <div className="pt-1 flex items-center justify-between">
            <p className="text-[11px] text-white/40">{t("retention.quests_reset")}</p>
            {toggle}
          </div>
        </div>
      )}

      {toast && (
        <div className="mt-3 px-3 py-2 rounded-xl border border-primary/40 bg-primary/[0.12] text-xs font-bold text-amber-200">
          {toast}
        </div>
      )}
    </section>
  );
}
