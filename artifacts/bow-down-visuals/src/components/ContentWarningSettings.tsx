import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, EyeOff, RotateCcw } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useIsLightTheme } from "@/hooks/use-is-light-theme";
import { useToast } from "@/hooks/use-toast";
import { Switch } from "@/components/ui/switch";
import {
  CONTENT_WARNING_LABELS,
  CONTENT_WARNING_DISPLAY_NAMES,
  type ContentWarningLabel,
} from "@/lib/content-warnings";
import {
  getContentWarningPreferences,
  setContentWarningPreferences,
} from "@/lib/social-api";

/* ── Content warnings — the viewer's own shield (Wave 4 #40) ─────────
   Creators label their own posts; labelled media arrives covered until
   the fan taps to reveal that one item. This board is the viewer's one
   personal knob, and it only turns ONE way: pick a label here and posts
   carrying it are hidden from YOUR feeds entirely, reveal included.
   There is no switch that loosens a creator's label — not here, not
   anywhere. */
export function ContentWarningSettings() {
  const isLight = useIsLightTheme();
  const { t } = useTranslation();
  const { user, getAccessToken } = useAuth();
  const { toast } = useToast();
  const [hidden, setHidden] = useState<ContentWarningLabel[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);
  const [saving, setSaving] = useState<ContentWarningLabel | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      setLoadError(false);
      try {
        const labels = await getContentWarningPreferences(getAccessToken);
        if (!cancelled) setHidden(labels);
      } catch {
        if (!cancelled) setLoadError(true);
      }
    })();
    return () => { cancelled = true; };
  }, [user, getAccessToken, retryNonce]);

  async function toggle(label: ContentWarningLabel, next: boolean) {
    if (!hidden || saving) return;
    const prev = hidden;
    const nextList = next ? [...hidden, label] : hidden.filter((l) => l !== label);
    setHidden(nextList);
    setSaving(label);
    try {
      const saved = await setContentWarningPreferences(getAccessToken, nextList);
      setHidden(saved);
      toast({ title: t("settings.contentWarnings.saved", { defaultValue: "Content warning settings saved" }) });
    } catch {
      setHidden(prev);
      toast({ title: t("settings.contentWarnings.saveFailed", { defaultValue: "Couldn't save that — try again" }), variant: "destructive" });
    } finally {
      setSaving(null);
    }
  }

  if (!user) return null;

  return (
    <section
      className={`rounded-3xl border p-5 md:p-6 ${isLight ? "border-[#C9A84C]/40 bg-gradient-to-b from-[#FCF7EA] to-[#F4E7C3]" : "border-primary/25 bg-gradient-to-b from-[#14100a] to-[#0d0a04]"}`}
      data-testid="content-warning-settings"
    >
      <div className="mb-1 flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-primary/25 bg-primary/[0.12]">
          <EyeOff className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h2 className="text-base font-black text-white">
            {t("settings.contentWarnings.title", { defaultValue: "Content warnings" })}
          </h2>
          <p className={`mt-0.5 text-xs ${isLight ? "text-[#6B5B36]" : "text-white/40"}`}>
            {t("settings.contentWarnings.subtitle", {
              defaultValue: "Creators label their own posts. Labelled media stays covered until you tap to reveal it — or hide a label from your feeds completely, for you only.",
            })}
          </p>
        </div>
      </div>
      {loadError ? (
        <div className="mt-4 flex items-center gap-3 rounded-xl border border-red-500/30 bg-red-500/[0.06] p-4 text-sm text-red-200/80">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {t("settings.contentWarnings.loadError", { defaultValue: "Couldn't load your content warning settings." })}
          <button
            type="button"
            onClick={() => setRetryNonce((n) => n + 1)}
            className="ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-white/15 px-3 py-1.5 text-xs font-bold text-white/80 hover:bg-white/5"
          >
            <RotateCcw className="h-3.5 w-3.5" /> {t("settings.contentWarnings.retry", { defaultValue: "Retry" })}
          </button>
        </div>
      ) : (
        <div className="mt-4 divide-y divide-white/[0.05]">
          {CONTENT_WARNING_LABELS.map((label) => (
            <div key={label} className="flex items-center gap-4 py-3.5">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-white">{CONTENT_WARNING_DISPLAY_NAMES[label]}</p>
                <p className={`mt-0.5 text-[11px] leading-relaxed ${isLight ? "text-[#6B5B36]" : "text-white/35"}`}>
                  {t("settings.contentWarnings.hideDesc", {
                    defaultValue: "Always hide posts with this label from my feeds — no cover, no reveal.",
                  })}
                </p>
              </div>
              <Switch
                checked={hidden ? hidden.includes(label) : false}
                disabled={!hidden || saving !== null}
                onCheckedChange={(v: boolean) => toggle(label, v)}
                aria-label={`Always hide: ${CONTENT_WARNING_DISPLAY_NAMES[label]}`}
              />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
