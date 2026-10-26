import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, CalendarRange, RotateCcw } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useIsLightTheme } from "@/hooks/use-is-light-theme";
import { useToast } from "@/hooks/use-toast";
import { Switch } from "@/components/ui/switch";

/* ── Your Month, Wrapped — Settings opt-out (idea #170) ───────────────
   Automated-behavior law: the monthly recap is made automatically, so
   its control lives here in Settings, per account (GET/PATCH
   /api/month-wrapped/prefs). Default ON; turning it off stops the
   recap from being made at all — the Analytics Hub card disappears
   and the API returns no recap. A failed load is an error state with
   a retry, never a fake "on". */

export function MonthWrappedSettings() {
  const isLight = useIsLightTheme();
  const { t } = useTranslation();
  const { user, getAccessToken } = useAuth();
  const { toast } = useToast();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      setLoadError(false);
      try {
        const token = await getAccessToken();
        const res = await fetch("/api/month-wrapped/prefs", {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) throw new Error("load failed");
        const d = (await res.json()) as { enabled?: boolean };
        if (!cancelled) setEnabled(d.enabled ?? true);
      } catch {
        if (!cancelled) setLoadError(true);
      }
    })();
    return () => { cancelled = true; };
  }, [user, getAccessToken, retryNonce]);

  async function toggle(nextValue: boolean) {
    if (enabled === null || saving) return;
    const prev = enabled;
    setEnabled(nextValue);
    setSaving(true);
    try {
      const token = await getAccessToken();
      const res = await fetch("/api/month-wrapped/prefs", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ enabled: nextValue }),
      });
      if (!res.ok) throw new Error("save failed");
      const d = (await res.json()) as { enabled?: boolean };
      setEnabled(d.enabled ?? nextValue);
      toast({ title: t("monthWrapped.saved", { defaultValue: "Wrapped preference saved." }) });
    } catch {
      setEnabled(prev);
      toast({ title: t("monthWrapped.saveFailed", { defaultValue: "Couldn't save — try again." }), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <section
      data-testid="month-wrapped-settings"
      className={`rounded-3xl border p-5 md:p-6 ${isLight ? "border-[#C9A84C]/40 bg-gradient-to-b from-[#FCF7EA] to-[#F4E7C3]" : "border-primary/25 bg-gradient-to-b from-[#14100a] to-[#0d0a04]"}`}
    >
      <div className="mb-1 flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-primary/25 bg-primary/[0.12]">
          <CalendarRange className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h2 className="text-base font-black text-white">
            {t("monthWrapped.settingsTitle", { defaultValue: "Your Month, Wrapped" })}
          </h2>
          <p className="mt-0.5 text-xs text-white/40">
            {t("monthWrapped.settingsSubtitle", { defaultValue: "A monthly recap of your real plays, sales and new fans, waiting in Analytics." })}
          </p>
        </div>
      </div>
      {loadError ? (
        <div className="mt-4 flex items-center gap-3 rounded-xl border border-red-500/30 bg-red-500/[0.06] p-4 text-sm text-red-200/80">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {t("monthWrapped.loadError", { defaultValue: "Couldn't load your Wrapped preference." })}
          <button
            type="button"
            onClick={() => setRetryNonce((n) => n + 1)}
            className="ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-white/15 px-3 py-1.5 text-xs font-bold text-white/80 hover:bg-white/5"
          >
            <RotateCcw className="h-3.5 w-3.5" /> {t("monthWrapped.retry", { defaultValue: "Retry" })}
          </button>
        </div>
      ) : (
        <div className="mt-4 flex items-center gap-4 py-3.5">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-white">
              {t("monthWrapped.toggleTitle", { defaultValue: "Make my monthly Wrapped" })}
            </p>
            <p className="mt-0.5 text-[11px] leading-relaxed text-white/35">
              {t("monthWrapped.toggleDesc", {
                defaultValue: "On: one recap per month is made from your real numbers and docked in Analytics — it shares only when you tap Share. Off: no recap is made at all.",
              })}
            </p>
          </div>
          <Switch
            checked={enabled ?? true}
            disabled={enabled === null || saving}
            onCheckedChange={(v: boolean) => toggle(v)}
            aria-label={t("monthWrapped.toggleTitle", { defaultValue: "Make my monthly Wrapped" })}
          />
        </div>
      )}
    </section>
  );
}
