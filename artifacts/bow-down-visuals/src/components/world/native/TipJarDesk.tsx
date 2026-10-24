import { useCallback, useEffect, useState } from "react";
import { Check, Copy, HandCoins, Loader2 } from "lucide-react";
import { NativeCard } from "@/components/world/native/NativeCard";
import { deskInputCls, useDeskAuthHeaders } from "@/components/world/native/CreateDeskShared";
import {
  apiErrorLine,
  buildTipSettingsPayload,
  parseTipJarDashboard,
  tipFeedStatusLabel,
  tipSettingsFormFrom,
  type TipJarDashboard,
  type TipSettingsForm,
} from "@/lib/world/money-desks-2";

/* ─── TipJarDesk — your own tip page, run from the Get Paid Room
   (Stack-100 #66, the settings half). The Tip Jar page
   (pages/tips.tsx) is the reference: GET /api/tips/dashboard for
   the totals + recent feed, GET /api/tips/settings for the form,
   POST /api/tips/settings to create/update — its exact body (the
   typed suggested-amounts list parsed the page's way, the
   [5, 10, 25] fallback when it parses empty). The honesty law
   rides along: while paymentsLive is false the desk says tips are
   recorded as intent only — no charge is ever made — and a
   pending_payment feed row reads "Intent recorded", never as
   money received. The desk renders inside the EarningsBoard,
   which already pitches guests, so it is members-only by
   construction. */

export function TipJarDesk({ isLight }: { isLight: boolean }) {
  const authHeaders = useDeskAuthHeaders();
  const [dashboard, setDashboard] = useState<TipJarDashboard | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [form, setForm] = useState<TipSettingsForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedNote, setSavedNote] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

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
      if (!res.ok) throw new Error(apiErrorLine(data, "Couldn't save your tip page — check the fields and try again."));
      setSavedNote("Your tip page is saved — fans can tip you at its link.");
      await load();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Couldn't save your tip page — try again.");
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
      <NativeCard isLight={isLight} title="Your Tip Jar">
        <p className={`text-xs ${muted}`}>
          Couldn&rsquo;t load your Tip Jar — your tip page is safe, this desk just couldn&rsquo;t reach it.{" "}
          <button type="button" data-testid="world-tipjar-retry" onClick={() => void load()} className="font-bold text-[#d4af37]">Try again</button>
        </p>
      </NativeCard>
    );
  }
  if (dashboard === null) {
    return (
      <NativeCard isLight={isLight} title="Your Tip Jar">
        <p className={`inline-flex items-center gap-2 text-xs ${muted}`}>
          <Loader2 className="h-3.5 w-3.5 animate-spin text-[#d4af37]" /> Opening your tip jar…
        </p>
      </NativeCard>
    );
  }

  const tipUrl = dashboard.handle ? `/tips/${dashboard.handle}` : null;

  return (
    <NativeCard isLight={isLight} title="Your Tip Jar">
      <div data-testid="world-tipjar-desk" className="space-y-3">
        {!dashboard.paymentsLive && (
          <p className={`rounded-xl border border-amber-400/25 bg-amber-400/[0.06] p-3 text-[11px] ${isLight ? "text-[#92600a]" : "text-amber-200/85"}`}>
            Tip payments are coming soon — tips are recorded as intent only, and no charge is ever made. Setup is free.
          </p>
        )}

        {dashboard.hasPage ? (
          <>
            <div className="grid grid-cols-3 gap-2 text-center">
              {[
                { label: "Tipped", value: `$${dashboard.total.toFixed(2)}` },
                { label: "Tips", value: String(dashboard.count) },
                { label: "Average", value: `$${dashboard.average.toFixed(2)}` },
              ].map((s) => (
                <div key={s.label} className={`rounded-xl border px-2 py-3 ${isLight ? "border-[#7A5A12]/25 bg-white/50" : "border-white/10 bg-white/5"}`}>
                  <p className={`text-lg font-black ${isLight ? "text-[#2a1e07]" : "text-white"}`}>{s.value}</p>
                  <p className={`text-[10px] uppercase tracking-wider ${muted}`}>{s.label}</p>
                </div>
              ))}
            </div>
            {dashboard.goalAmount !== null && (
              <p className={`text-[11px] ${muted}`}>
                {dashboard.goalLabel || "Goal"}: ${(dashboard.goalRaisedDollars ?? dashboard.total).toFixed(2)} of ${dashboard.goalAmount.toFixed(2)}
                {dashboard.goalProgress !== null ? ` · ${Math.round(dashboard.goalProgress * 100)}%` : ""}
              </p>
            )}
            {tipUrl && (
              <button type="button" data-testid="world-tipjar-copy"
                onClick={() => {
                  void navigator.clipboard?.writeText(`${window.location.origin}${tipUrl}`).catch(() => {});
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold ${isLight ? "border-[#7A5A12]/30 text-[#6B5B36]" : "border-white/15 text-white/75"}`}>
                {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? "Link copied" : `Copy your link — ${tipUrl}`}
              </button>
            )}
            <div>
              <p className={`mb-1 text-[11px] font-black uppercase tracking-[0.14em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>Recent tips</p>
              {dashboard.feed.length === 0 ? (
                <p className={`text-xs ${muted}`}>No tips yet — share your link and the first one lands here.</p>
              ) : dashboard.feed.map((tip) => (
                <div key={tip.id} className={`border-b py-1.5 text-xs last:border-0 ${isLight ? "border-[#7A5A12]/15" : "border-white/10"}`}>
                  <p className={`flex items-baseline justify-between gap-2 ${isLight ? "text-[#2a1e07]" : "text-white/80"}`}>
                    <span className="font-bold">{tip.fanName || "Anonymous fan"}</span>
                    <span className="font-bold text-[#d4af37]">${tip.amount.toFixed(2)}</span>
                  </p>
                  {tip.message && <p className={`mt-0.5 ${muted}`}>&ldquo;{tip.message}&rdquo;</p>}
                  <p className={`mt-0.5 text-[11px] ${muted}`}>{tipFeedStatusLabel(tip.status)}{tip.createdAt ? ` · ${new Date(tip.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}` : ""}</p>
                </div>
              ))}
            </div>
          </>
        ) : (
          <p className={`text-xs ${muted}`}>No tip page yet — set one up below and fans can tip you from your portrait card, your profile and your shared link.</p>
        )}

        <div className="space-y-2 border-t border-dashed pt-3" data-testid="world-tipjar-settings">
          <p className={`flex items-center gap-1.5 text-[11px] font-black uppercase tracking-[0.14em] ${isLight ? "text-[#7A5A12]" : "text-[#e8c86a]"}`}>
            <HandCoins className="h-3.5 w-3.5" /> {dashboard.hasPage ? "Tip page settings" : "Set up your tip page"}
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="block">
              <span className={`text-[11px] ${muted}`}>Your handle — /tips/…</span>
              <input aria-label="Tip handle" value={form?.handle ?? ""} maxLength={30}
                onChange={(e) => setF({ handle: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, "") })}
                placeholder="yourhandle" className={inputCls} />
            </label>
            <label className="block">
              <span className={`text-[11px] ${muted}`}>Display name</span>
              <input aria-label="Tip display name" value={form?.displayName ?? ""} maxLength={60}
                onChange={(e) => setF({ displayName: e.target.value })} placeholder="The name fans see" className={inputCls} />
            </label>
          </div>
          <label className="block">
            <span className={`text-[11px] ${muted}`}>Message to fans</span>
            <textarea aria-label="Tip message" value={form?.message ?? ""} maxLength={500} rows={2}
              onChange={(e) => setF({ message: e.target.value })} placeholder="Thanks for supporting the music…" className={inputCls} />
          </label>
          <div className="grid gap-2 sm:grid-cols-3">
            <label className="block">
              <span className={`text-[11px] ${muted}`}>Suggested amounts ($)</span>
              <input aria-label="Suggested amounts" value={form?.suggested ?? "5, 10, 25"}
                onChange={(e) => setF({ suggested: e.target.value })} placeholder="5, 10, 25" className={inputCls} />
            </label>
            <label className="block">
              <span className={`text-[11px] ${muted}`}>Goal amount ($)</span>
              <input aria-label="Goal amount" value={form?.goalAmount ?? ""} inputMode="decimal"
                onChange={(e) => setF({ goalAmount: e.target.value.replace(/[^0-9.]/g, "") })} placeholder="Optional" className={inputCls} />
            </label>
            <label className="block">
              <span className={`text-[11px] ${muted}`}>Goal label</span>
              <input aria-label="Goal label" value={form?.goalLabel ?? ""} maxLength={80}
                onChange={(e) => setF({ goalLabel: e.target.value })} placeholder="New microphone" className={inputCls} />
            </label>
          </div>
          {saveError && <p className="text-xs font-semibold text-red-400">{saveError}</p>}
          {savedNote && <p className={`text-xs font-semibold ${isLight ? "text-emerald-700" : "text-emerald-300"}`}>{savedNote}</p>}
          <button type="button" data-testid="world-tipjar-save" onClick={() => void save()}
            disabled={saving || !(form?.handle ?? "").trim() || !(form?.displayName ?? "").trim()}
            className="inline-flex items-center gap-1.5 rounded-full bg-[#d4af37] px-4 py-1.5 text-xs font-bold text-black transition hover:scale-105 disabled:opacity-50">
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <HandCoins className="h-3.5 w-3.5" />}
            {saving ? "Saving…" : dashboard.hasPage ? "Update my tip page" : "Create my tip page"}
          </button>
        </div>
      </div>
    </NativeCard>
  );
}
