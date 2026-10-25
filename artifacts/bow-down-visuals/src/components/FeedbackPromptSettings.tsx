import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, MessageSquareHeart, RotateCcw } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useIsLightTheme } from "@/hooks/use-is-light-theme";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";

/* ─── Feedback prompts settings (Stack-200 UPGRADES 180) ───────────────
   The ON/OFF toggle the automated-behavior law requires, in the house
   settings pattern (twin of SoundPrefsSettings): stored PER ACCOUNT
   (GET/PATCH /api/pitch-fix/feedback-prefs), DEFAULT ON, and a failed
   load is an error state with a retry — never a fake "on". When off,
   no feedback prompt can fire for the account: the server eligibility
   check refuses, and a showing cannot even be stamped. */

export function FeedbackPromptSettings() {
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
        const res = await fetch("/api/pitch-fix/feedback-prefs", {
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
      const res = await fetch("/api/pitch-fix/feedback-prefs", {
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
      toast({ title: t("settings.feedbackPrompts.saved") });
    } catch {
      setEnabled(prev); // revert on failure
      toast({ title: t("settings.feedbackPrompts.saveFailed"), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className={`rounded-3xl border p-5 md:p-6 ${isLight ? "border-[#C9A84C]/40 bg-gradient-to-b from-[#FCF7EA] to-[#F4E7C3]" : "border-primary/25 bg-gradient-to-b from-[#14100a] to-[#0d0a04]"}`} data-testid="feedback-prompt-settings">
      <div className="mb-1 flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-primary/25 bg-primary/[0.12]">
          <MessageSquareHeart className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h2 className={`text-base font-black ${isLight ? "text-[#2A1E07]" : "text-white"}`}>{t("settings.feedbackPrompts.title")}</h2>
          <p className={`mt-0.5 text-xs ${isLight ? "text-[#5c5138]" : "text-white/40"}`}>{t("settings.feedbackPrompts.subtitle")}</p>
        </div>
      </div>
      {loadError ? (
        <div className="mt-4 flex items-center gap-3 rounded-xl border border-red-500/30 bg-red-500/[0.06] p-4 text-sm text-red-200/80">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {t("settings.feedbackPrompts.loadError")}
          <button
            type="button"
            onClick={() => setRetryNonce((n) => n + 1)}
            className="ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-white/15 px-3 py-1.5 text-xs font-bold text-white/80 hover:bg-white/5"
          >
            <RotateCcw className="h-3.5 w-3.5" /> {t("settings.feedbackPrompts.retry")}
          </button>
        </div>
      ) : (
        <div className="mt-4 flex items-center gap-4 py-3.5">
          <div className="min-w-0 flex-1">
            <p className={`text-sm font-bold ${isLight ? "text-[#2A1E07]" : "text-white"}`}>{t("settings.feedbackPrompts.toggleTitle")}</p>
            <p className={`mt-0.5 text-[11px] leading-relaxed ${isLight ? "text-[#5c5138]" : "text-white/35"}`}>{t("settings.feedbackPrompts.toggleDesc")}</p>
          </div>
          <Switch
            checked={enabled ?? true}
            disabled={enabled === null || saving}
            onCheckedChange={(v: boolean) => void toggle(v)}
            aria-label={t("settings.feedbackPrompts.toggleTitle")}
          />
        </div>
      )}
    </section>
  );
}
