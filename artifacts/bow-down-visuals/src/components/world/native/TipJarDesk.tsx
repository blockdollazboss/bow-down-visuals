import { plainErrorText } from "../../../lib/api-error";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Copy, HandCoins, Loader2 } from "lucide-react";
import { NativeCard } from "@/components/world/native/NativeCard";
import { deskInputCls, useDeskAuthHeaders } from "@/components/world/native/CreateDeskLeaf";
import {
  apiErrorLine,
  buildTipSettingsPayload,
  parseTipJarDashboard,
  tipFeedStatusLabel,
  tipSettingsFormFrom,
  type TipJarDashboard,
  type TipSettingsForm,
  type TipStrings,
} from "@/lib/world/money-desks-2";

/* ─── TipJarDesk — your own tip page, run from the Get Paid Room
   (Stack-100 #66, the settings half). The Tip Jar page
   (pages/tips.tsx) is the reference: GET /api/tips/dashboard for
   the totals + recent feed, GET /api/tips/settings for the form,
   POST /api/tips/settings to create/update — its exact body (the
   typed suggested-amounts list parsed the page's way, the
   [5, 10, 25] fallback when it parses empty). The honesty law
   rides along: while paymentsLive is false the desk carries the
   tips status note — tips are live, charged for real in test
   mode, 100% to the creator with no fee — and a
   pending_payment feed row reads "Intent recorded", never as
   money received. The desk renders inside the EarningsBoard,
   which already pitches guests, so it is members-only by
   construction. */

export function TipJarDesk({ isLight }: { isLight: boolean }) {
  const { t, i18n } = useTranslation();
  const authHeaders = useDeskAuthHeaders();
  const [dashboard, setDashboard] = useState<TipJarDashboard | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [form, setForm] = useState<TipSettingsForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedNote, setSavedNote] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const tipStrings: TipStrings = {
    problemPickFirst: t("tipPage.amountRequired"),
    problemMin: t("worldIdentityMisc.tipProblemMin"),
    problemMax: t("worldIdentityMisc.tipProblemMax"),
    feedStatusIntent: t("worldIdentityMisc.jarFeedStatusIntent"),
    feedStatusReceived: t("worldIdentityMisc.jarFeedStatusReceived"),
    feedStatusUnavailable: t("worldIdentityMisc.jarFeedStatusUnavailable"),
  };

  const load = useCallback(async () => {
    try {
      const headers = await authHeaders();
      const res = await fetch("/api/tips/dashboard", { headers });
      if (!res.ok) throw new Error("dashboard");
      const parsed = parseTipJarDashboard(await res.json());
      if (!parsed) throw new Error("dashboard");
      setDashboard(parsed);
      setLoadFailed(false);
      if (parsed.hasPage) {
        /* The settings sub-load stays tolerant, like the page's: a
           failure here never swaps the dashboard into its error
           state — the form simply stays in create dress. */
        try {
          const sres = await fetch("/api/tips/settings", { headers: await authHeaders() });
          if (sres.ok) {
            const settings = tipSettingsFormFrom(await sres.json());
            if (settings) setForm(settings);
          }
        } catch { /* tolerant — the page treats it the same way */ }
      }
    } catch {
      setLoadFailed(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { void load(); }, [load]);

  const save = async () => {
    if (!form || saving) return;
    setSaving(true);
    setSaveError(null);
    setSavedNote(null);
    try {
      const res = await fetch("/api/tips/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify(buildTipSettingsPayload(form)),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new Error(apiErrorLine(data, t("worldIdentityMisc.jarSaveError")));
      setSavedNote(t("worldIdentityMisc.jarSavedNote"));
      await load();
    } catch (e) {
      setSaveError(plainErrorText(e, t("worldIdentityMisc.jarSaveErrorRetry")));
    } finally {
      setSaving(false);
    }
  };

  const muted = isLight ? "text-[#6B5B36]" : "text-white/50";
  const inputCls = deskInputCls(isLight);
  const setF = (patch: Partial<TipSettingsForm>) =>
    setForm((f) => (f ? { ...f, ...patch } : { handle: "", displayName: "", message: "", suggested: "5, 10, 25", goalAmount: "", goalLabel: "", ...patch }));

  if (loadFailed) {
    return (
      <NativeCard isLight={isLight} title={t("worldIdentityMisc.jarTitle")}>
        <p className={`text-xs ${muted}`}>
          {t("worldIdentityMisc.jarLoadFailed")}{" "}
          <button type="button" data-testid="world-tipjar-retry" onClick={() => void load()} className="font-bold text-[#d4af37]">{t("worldIdentityMisc.tryAgain")}</button>
        </p>
      </NativeCard>
    );
  }
  if (dashboard === null) {
    return (
      <NativeCard isLight={isLight} title={t("worldIdentityMisc.jarTitle")}>
        <p className={`inline-flex items-center gap-2 text-xs ${muted}`}>
          <Loader2 className="h-3.5 w-3.5 animate-spin text-[#d4af37]" /> {t("worldIdentityMisc.jarLoading")}
        </p>
      </NativeCard>
    );
  }

  const tipUrl = dashboard.handle ? `/tips/${dashboard.handle}` : null;

  return (
    <NativeCard isLight={isLight} title={t("worldIdentityMisc.jarTitle")}>
      <div data-testid="world-tipjar-desk" className="space-y-3">
        {!dashboard.paymentsLive && (
          <p className={`rounded-xl border border-amber-400/25 bg-amber-400/[0.06] p-3 text-[11px] ${isLight ? "text-[#92600a]" : "text-amber-200/85"}`}>
            {t("worldIdentityMisc.jarStatusNote")}
          </p>
        )}

        {dashboard.hasPage ? (
          <>
            <div className="grid grid-cols-3 gap-2 text-center">
              {[
                { label: t("worldIdentityMisc.jarStatTipped"), value: `$${dashboard.total.toFixed(2)}` },
                { label: t("worldIdentityMisc.jarStatTips"), value: String(dashboard.count) },
                { label: t("worldIdentityMisc.jarStatAverage"), value: `$${dashboard.average.toFixed(2)}` },
              ].map((s) => (
                <div key={s.label} className={`rounded-xl border px-2 py-3 ${isLight ? "border-[#7A5A12]/25 bg-white/50" : "border-white/10 bg-white/5"}`}>
                  <p className={`text-lg font-black ${isLight ? "text-[#2a1e07]" : "text-white"}`}>{s.value}</p>
                  <p className={`text-[10px] uppercase tracking-wider ${muted}`}>{s.label}</p>
                </div>
              ))}
            </div>
            {dashboard.goalAmount !== null && (
              <p className={`text-[11px] ${muted}`}>
                {t("worldIdentityMisc.tipGoalLine", {
                  label: dashboard.goalLabel || t("tips.goalDefault"),
                  raised: (dashboard.goalRaisedDollars ?? dashboard.total).toFixed(2),
                  goal: dashboard.goalAmount.toFixed(2),
                })}
                {dashboard.goalProgress !== null ? t("worldIdentityMisc.tipGoalPercent", { pct: Math.round(dashboard.goalProgress * 100) }) : ""}
              </p>
            )}
            {tipUrl && (
              <button type="button" data-testid="world-tipjar-copy"
                onClick={() => {
                  void navigator.clipboard?.writeText(`${window.location.origin}${tipUrl}`).catch(() => {});
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold bdv-touch-target ${isLight ? "border-[#7A5A12]/30 text-[#6B5B36]" : "border-white/15 text-white/75"}`}>
                {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? t("worldIdentityMisc.jarCopied") : t("worldIdentityMisc.jarCopyLink", { url: tipUrl })}
              </button>
            )}
            <div>
              <p className={`mb-1 text-[11px] font-black uppercase tracking-[0.14em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>{t("tips.recentTips")}</p>
              {dashboard.feed.length === 0 ? (
                <p className={`text-xs ${muted}`}>{t("worldIdentityMisc.jarNoTips")}</p>
              ) : dashboard.feed.map((tip) => (
                <div key={tip.id} className={`border-b py-1.5 text-xs last:border-0 ${isLight ? "border-[#7A5A12]/15" : "border-white/10"}`}>
                  <p className={`flex items-baseline justify-between gap-2 ${isLight ? "text-[#2a1e07]" : "text-white/80"}`}>
                    <span className="font-bold">{tip.fanName || t("tips.anonymousFan")}</span>
                    <span className="font-bold text-[#d4af37]">${tip.amount.toFixed(2)}</span>
                  </p>
                  {tip.message && <p className={`mt-0.5 ${muted}`}>&ldquo;{tip.message}&rdquo;</p>}
                  <p className={`mt-0.5 text-[11px] ${muted}`}>{tipFeedStatusLabel(tip.status, tipStrings)}{tip.createdAt ? ` · ${new Date(tip.createdAt).toLocaleDateString(i18n.language, { month: "short", day: "numeric", year: "numeric" })}` : ""}</p>
                </div>
              ))}
            </div>
          </>
        ) : (
          <p className={`text-xs ${muted}`}>{t("worldIdentityMisc.jarNoPage")}</p>
        )}

        <div className="space-y-2 border-t border-dashed pt-3" data-testid="world-tipjar-settings">
          <p className={`flex items-center gap-1.5 text-[11px] font-black uppercase tracking-[0.14em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
            <HandCoins className="h-3.5 w-3.5" /> {dashboard.hasPage ? t("worldIdentityMisc.jarSettingsTitle") : t("worldIdentityMisc.jarSetupTitle")}
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="block">
              <span className={`text-[11px] ${muted}`}>{t("worldIdentityMisc.jarHandleLabel")}</span>
              <input aria-label={t("worldIdentityMisc.jarHandleAria")} value={form?.handle ?? ""} maxLength={30}
                onChange={(e) => setF({ handle: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, "") })}
                placeholder={t("worldIdentityMisc.jarHandlePlaceholder")} className={inputCls} />
            </label>
            <label className="block">
              <span className={`text-[11px] ${muted}`}>{t("worldIdentityMisc.jarNameLabel")}</span>
              <input aria-label={t("worldIdentityMisc.jarNameAria")} value={form?.displayName ?? ""} maxLength={60}
                onChange={(e) => setF({ displayName: e.target.value })} placeholder={t("worldIdentityMisc.jarNamePlaceholder")} className={inputCls} />
            </label>
          </div>
          <label className="block">
            <span className={`text-[11px] ${muted}`}>{t("worldIdentityMisc.jarMessageLabel")}</span>
            <textarea aria-label={t("worldIdentityMisc.tipMessageLabel")} value={form?.message ?? ""} maxLength={500} rows={2}
              onChange={(e) => setF({ message: e.target.value })} placeholder={t("worldIdentityMisc.jarMessagePlaceholder")} className={inputCls} />
          </label>
          <div className="grid gap-2 sm:grid-cols-3">
            <label className="block">
              <span className={`text-[11px] ${muted}`}>{t("worldIdentityMisc.jarSuggestedLabel")}</span>
              <input aria-label={t("worldIdentityMisc.jarSuggestedAria")} value={form?.suggested ?? "5, 10, 25"}
                onChange={(e) => setF({ suggested: e.target.value })} placeholder={t("worldIdentityMisc.jarSuggestedPlaceholder")} className={inputCls} />
            </label>
            <label className="block">
              <span className={`text-[11px] ${muted}`}>{t("worldIdentityMisc.jarGoalAmountLabel")}</span>
              <input aria-label={t("worldIdentityMisc.jarGoalAmountAria")} value={form?.goalAmount ?? ""} inputMode="decimal"
                onChange={(e) => setF({ goalAmount: e.target.value.replace(/[^0-9.]/g, "") })} placeholder={t("worldIdentityMisc.jarOptionalPlaceholder")} className={inputCls} />
            </label>
            <label className="block">
              <span className={`text-[11px] ${muted}`}>{t("worldIdentityMisc.jarGoalLabel")}</span>
              <input aria-label={t("worldIdentityMisc.jarGoalLabel")} value={form?.goalLabel ?? ""} maxLength={80}
                onChange={(e) => setF({ goalLabel: e.target.value })} placeholder={t("worldIdentityMisc.jarGoalLabelPlaceholder")} className={inputCls} />
            </label>
          </div>
          {saveError && <p className="text-xs font-semibold text-red-400">{saveError}</p>}
          {savedNote && <p className={`text-xs font-semibold ${isLight ? "text-emerald-700" : "text-emerald-300"}`}>{savedNote}</p>}
          <button type="button" data-testid="world-tipjar-save" onClick={() => void save()}
            disabled={saving || !(form?.handle ?? "").trim() || !(form?.displayName ?? "").trim()}
            className="inline-flex items-center gap-1.5 rounded-full bg-[#d4af37] px-4 py-1.5 text-xs font-bold text-black transition hover:scale-105 disabled:opacity-50 bdv-touch-target">
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <HandCoins className="h-3.5 w-3.5" />}
            {saving ? t("worldIdentityMisc.saving") : dashboard.hasPage ? t("worldIdentityMisc.jarUpdate") : t("tips.createButton")}
          </button>
        </div>
      </div>
    </NativeCard>
  );
}
