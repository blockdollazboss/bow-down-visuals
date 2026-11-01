import { useIsLightTheme } from "@/hooks/use-is-light-theme";
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Bot, Loader2, RotateCcw } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  filterOperatorActions,
  parseOperatorActions,
  OPERATOR_RESULT_FILTERS,
  shortId,
  type OperatorActionRow,
  type OperatorResultFilter,
} from "@/lib/admin-benches";

/* ─── Admin: Operator Actions — the Cloud Operator's action trail ─────
   The read bench for GET /api/admin/operator-actions (W6 finding F1:
   the rail had no frontend consumer). An AUDIT surface: every action
   the executor ran or refused, newest first, with the daily charged
   cap and the hands kill-switch state riding along from the rail
   itself. Deliberately NO controls — the rows are written by the
   executor from rail results and this bench never edits them. */

const RESULT_CLS: Record<string, string> = {
  done: "border-emerald-400/40 bg-emerald-400/10 text-emerald-300",
  refused: "border-[#C9A84C]/50 bg-[#C9A84C]/10 text-[#e8c86a]",
  failed: "border-red-400/40 bg-red-400/10 text-red-300",
};

const RESULT_KEY: Record<string, string> = {
  done: "admin.operatorActions.result.done",
  refused: "admin.operatorActions.result.refused",
  failed: "admin.operatorActions.result.failed",
};

const FILTER_KEY: Record<OperatorResultFilter, string> = {
  all: "admin.operatorActions.filterAll",
  done: "admin.operatorActions.result.done",
  refused: "admin.operatorActions.result.refused",
  failed: "admin.operatorActions.result.failed",
};

export function OperatorActionsAdmin({ authHeaders }: { authHeaders: () => Promise<HeadersInit> }) {
  const isLight = useIsLightTheme();
  const { t } = useTranslation();
  const [actions, setActions] = useState<OperatorActionRow[]>([]);
  const [cap, setCap] = useState<number | null>(null);
  const [handsEnabled, setHandsEnabled] = useState<boolean | null>(null);
  const [filter, setFilter] = useState<OperatorResultFilter>("all");
  const [loading, setLoading] = useState(true);
  /* Load failures are NOT "no actions" — own error state + retry. */
  const [loadError, setLoadError] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const res = await fetch("/api/admin/operator-actions", { headers: await authHeaders() });
      const parsed = res.ok ? parseOperatorActions(await res.json()) : null;
      if (parsed) {
        setActions(parsed.actions);
        setCap(parsed.dailyChargedCap);
        setHandsEnabled(parsed.handsEnabled);
      } else {
        setLoadError(true);
      }
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authHeaders]);

  useEffect(() => { void load(); }, [load, retryNonce]);

  const visible = filterOperatorActions(actions, filter);

  return (
    <div
      className={`rounded-xl border p-5 mt-4 ${isLight ? "border-[#C9A84C]/40 bg-gradient-to-b from-[#FCF7EA] to-[#F4E7C3]" : "border-primary/25 bg-gradient-to-b from-[#14100a] to-[#0d0a04]"}`}
      data-testid="operator-actions-bench"
    >
      <div className="flex items-center gap-2 mb-1">
        <Bot className="h-4 w-4 text-primary" />
        <p className="text-xs text-white/40 uppercase tracking-wider font-semibold">
          {t("admin.operatorActions.title")}
        </p>
      </div>
      <p className="text-sm text-white/60 mb-4">{t("admin.operatorActions.description")}</p>

      {loading ? (
        <p className="text-sm text-white/40"><Loader2 className="h-4 w-4 animate-spin inline" /></p>
      ) : loadError ? (
        <div className={`rounded-2xl border p-10 text-center ${isLight ? "border-[#C9A84C]/50 bg-[#F7ECD2]" : "border-primary/25 bg-zinc-950"}`}>
          <AlertTriangle className="mx-auto h-10 w-10 text-primary" />
          <p className={`mt-3 font-bold ${isLight ? "text-[#2A1E07]" : "text-white"}`}>
            {t("admin.operatorActions.loadErrorTitle")}
          </p>
          <p className={`mt-1 text-sm ${isLight ? "text-[#6B5B36]" : "text-white/50"}`}>
            {t("admin.operatorActions.loadErrorBody")}
          </p>
          <button
            type="button"
            onClick={() => setRetryNonce((n) => n + 1)}
            className="mt-4 inline-flex items-center gap-2 rounded-full bg-primary px-6 py-2.5 font-bold text-black hover:brightness-110"
          >
            <RotateCcw className="h-4 w-4" /> Try again
          </button>
        </div>
      ) : (
        <>
          {cap !== null && handsEnabled !== null && (
            <div className="mb-4 flex flex-wrap gap-2 text-xs">
              <span className="rounded-full border border-white/10 bg-black/30 px-3 py-1 font-semibold text-white/70">
                {t("admin.operatorActions.capLine", { cap: cap.toLocaleString() })}
              </span>
              <span
                className={`rounded-full border px-3 py-1 font-semibold ${
                  handsEnabled
                    ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-300"
                    : "border-red-400/40 bg-red-400/10 text-red-300"
                }`}
              >
                {handsEnabled ? t("admin.operatorActions.handsOn") : t("admin.operatorActions.handsOff")}
              </span>
            </div>
          )}
          {actions.length === 0 ? (
            <p className="text-sm text-white/40">{t("admin.operatorActions.empty")}</p>
          ) : (
            <>
              <div className="mb-4 flex flex-wrap gap-2">
                {OPERATOR_RESULT_FILTERS.map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setFilter(f)}
                    className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                      filter === f
                        ? "border-primary/60 bg-primary/15 text-[#e8c86a]"
                        : "border-white/10 bg-black/30 text-white/50 hover:text-white"
                    }`}
                  >
                    {t(FILTER_KEY[f])}
                  </button>
                ))}
              </div>
              {visible.length === 0 ? (
                <p className="text-sm text-white/40">{t("admin.operatorActions.emptyFilter")}</p>
              ) : (
                <div className="space-y-3">
                  {visible.map((a) => (
                    <div key={a.id} className="rounded-xl border border-white/[0.08] bg-black/30 p-4">
                      <div className="flex flex-wrap items-center gap-2 justify-between">
                        <p className="min-w-0 text-sm font-semibold text-white">
                          {a.summary || a.toolId || "—"}
                        </p>
                        <span
                          className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${RESULT_CLS[a.result] ?? RESULT_CLS.failed}`}
                        >
                          {t(RESULT_KEY[a.result] ?? "", { defaultValue: a.result })}
                        </span>
                      </div>
                      {a.resultReason && (
                        <p className="mt-1 text-xs text-white/50">
                          {t("admin.operatorActions.reason")}: {a.resultReason}
                        </p>
                      )}
                      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-white/60">
                        {(a.priceQuoted !== null || a.priceCharged !== null) && (
                          <>
                            <span>
                              {t("admin.operatorActions.quoted")}{" "}
                              <span className="text-white/90 font-semibold">
                                {a.priceQuoted !== null ? `${a.priceQuoted.toLocaleString()} VB` : "—"}
                              </span>
                            </span>
                            <span>
                              {t("admin.operatorActions.charged")}{" "}
                              <span className="text-white/90 font-semibold">
                                {a.priceCharged !== null ? `${a.priceCharged.toLocaleString()} VB` : "—"}
                              </span>
                            </span>
                          </>
                        )}
                        {a.adminEmail ? (
                          <span title={a.adminEmail}>
                            {t("admin.operatorActions.ranAs")} {a.adminEmail}
                          </span>
                        ) : a.userId ? (
                          <span title={a.userId}>
                            {t("admin.operatorActions.ranAs")} {shortId(a.userId)}
                          </span>
                        ) : null}
                        {a.toolId && (
                          <span>
                            {t("admin.operatorActions.tool")} {a.toolId}
                          </span>
                        )}
                        {a.channel && <span>{a.channel}</span>}
                        {a.target && (
                          <span className="truncate" title={a.target}>{a.target}</span>
                        )}
                        <span className="text-white/30">{new Date(a.createdAt).toLocaleString()}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </>
      )}
      <p className="mt-3 text-[11px] text-white/30">{t("admin.operatorActions.footerNote")}</p>
    </div>
  );
}
