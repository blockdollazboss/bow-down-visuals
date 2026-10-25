import { useIsLightTheme } from "@/hooks/use-is-light-theme";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/contexts/AuthContext";
import { Switch } from "@/components/ui/switch";
import { Volume2, AlertTriangle, RotateCcw, Play } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  signatureSounds,
  playSignatureSound,
  type SoundKind,
  type SoundPrefs,
} from "@/lib/signature-sounds";

/* ── Sounds settings (Stack-200 UPGRADES 183) ───────────────────────────
   The owner's required control for the signature sounds: a MASTER
   on/off plus per-kind switches, DEFAULT ON, stored PER ACCOUNT
   (GET/PATCH /api/sound-prefs) and respected by every sound the site
   plays — the engine gates on these, so a sound whose switch is off
   cannot play anywhere. Device/browser mute outranks every switch
   here. The test button on each row plays that kind THROUGH the same
   gate: flip a switch off and its test goes silent too. */

type PrefKey = keyof SoundPrefs;

const KIND_ROWS: { key: PrefKey; i18n: string; testKind: SoundKind }[] = [
  { key: "notifications_enabled", i18n: "notifications", testKind: "notification" },
  { key: "messages_enabled", i18n: "messages", testKind: "message" },
  { key: "success_stings_enabled", i18n: "successStings", testKind: "success" },
  { key: "errors_enabled", i18n: "errors", testKind: "error" },
  { key: "ringtone_enabled", i18n: "ringtone", testKind: "ringtone" },
];

const ALL_KEYS: PrefKey[] = [
  "master_enabled",
  "notifications_enabled",
  "messages_enabled",
  "success_stings_enabled",
  "errors_enabled",
  "ringtone_enabled",
];

function pickPrefs(d: Partial<SoundPrefs>, fallback: SoundPrefs): SoundPrefs {
  return {
    master_enabled: d.master_enabled ?? fallback.master_enabled,
    notifications_enabled: d.notifications_enabled ?? fallback.notifications_enabled,
    messages_enabled: d.messages_enabled ?? fallback.messages_enabled,
    success_stings_enabled: d.success_stings_enabled ?? fallback.success_stings_enabled,
    errors_enabled: d.errors_enabled ?? fallback.errors_enabled,
    ringtone_enabled: d.ringtone_enabled ?? fallback.ringtone_enabled,
  };
}

export function SoundPrefsSettings() {
  const isLight = useIsLightTheme();
  const { t } = useTranslation();
  const { user, getAccessToken } = useAuth();
  const { toast } = useToast();
  const [prefs, setPrefs] = useState<SoundPrefs | null>(null);
  const [saving, setSaving] = useState<PrefKey | null>(null);
  /* Same honesty rule as the retention card: a failed load is NOT
     "everything on" — failures get an error state with a retry, and
     the switches render only after a successful load. */
  const [loadError, setLoadError] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      setLoadError(false);
      try {
        const token = await getAccessToken();
        const res = await fetch("/api/sound-prefs", {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) throw new Error("load failed");
        const d = (await res.json()) as Partial<SoundPrefs>;
        if (cancelled) return;
        const next = pickPrefs(d, {
          master_enabled: true,
          notifications_enabled: true,
          messages_enabled: true,
          success_stings_enabled: true,
          errors_enabled: true,
          ringtone_enabled: true,
        });
        setPrefs(next);
        signatureSounds.setPrefs(next);
      } catch {
        if (!cancelled) setLoadError(true);
      }
    })();
    return () => { cancelled = true; };
  }, [user, getAccessToken, retryNonce]);

  async function toggle(key: PrefKey, nextValue: boolean) {
    if (!prefs || saving) return;
    const prev = prefs[key];
    const optimistic = { ...prefs, [key]: nextValue };
    setPrefs(optimistic);
    signatureSounds.setPrefs(optimistic);
    setSaving(key);
    try {
      const token = await getAccessToken();
      const res = await fetch("/api/sound-prefs", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ [key]: nextValue }),
      });
      if (!res.ok) throw new Error("save failed");
      const d = (await res.json()) as Partial<SoundPrefs>;
      const saved = pickPrefs(d, optimistic);
      setPrefs(saved);
      signatureSounds.setPrefs(saved);
      toast({ title: t("settings.sounds.saved") });
    } catch {
      setPrefs({ ...prefs, [key]: prev }); // revert on failure
      signatureSounds.setPrefs({ ...prefs, [key]: prev });
      toast({ title: t("settings.sounds.saveFailed"), variant: "destructive" });
    } finally {
      setSaving(null);
    }
  }

  const masterOn = prefs?.master_enabled ?? true;

  return (
    <section className={`rounded-3xl border p-5 md:p-6 ${isLight ? "border-[#C9A84C]/40 bg-gradient-to-b from-[#FCF7EA] to-[#F4E7C3]" : "border-primary/25 bg-gradient-to-b from-[#14100a] to-[#0d0a04]"}`} data-testid="sound-settings">
      <div className="flex items-center gap-3 mb-1">
        <div className="h-10 w-10 rounded-xl bg-primary/[0.12] border border-primary/25 flex items-center justify-center shrink-0">
          <Volume2 className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h2 className="text-base font-black text-white">{t("settings.sounds.title")}</h2>
          <p className="text-xs text-white/40 mt-0.5">{t("settings.sounds.subtitle")}</p>
        </div>
      </div>
      {loadError ? (
        <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/[0.06] p-4 text-sm text-red-200/80 flex items-center gap-3">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {t("settings.sounds.loadError")}
          <button
            type="button"
            onClick={() => setRetryNonce((n) => n + 1)}
            className="ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-white/15 px-3 py-1.5 text-xs font-bold text-white/80 hover:bg-white/5"
          >
            <RotateCcw className="h-3.5 w-3.5" /> {t("settings.sounds.retry")}
          </button>
        </div>
      ) : (
      <div className="mt-4">
        <div className="flex items-center gap-4 py-3.5 border-b border-white/[0.08]">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-white">{t("settings.sounds.master.title")}</p>
            <p className="text-[11px] text-white/35 mt-0.5 leading-relaxed">{t("settings.sounds.master.desc")}</p>
          </div>
          <Switch
            checked={prefs ? prefs.master_enabled : true}
            disabled={!prefs || saving !== null}
            onCheckedChange={(v: boolean) => toggle("master_enabled", v)}
            aria-label={t("settings.sounds.master.title")}
          />
        </div>
        <div className={`divide-y divide-white/[0.05] ${masterOn ? "" : "opacity-50"}`}>
          {KIND_ROWS.map((row) => (
            <div key={row.key} className="flex items-center gap-4 py-3.5">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-white">{t(`settings.sounds.${row.i18n}.title`)}</p>
                <p className="text-[11px] text-white/35 mt-0.5 leading-relaxed">{t(`settings.sounds.${row.i18n}.desc`)}</p>
              </div>
              <button
                type="button"
                onClick={() => playSignatureSound(row.testKind)}
                aria-label={t("settings.sounds.test")}
                className="inline-flex shrink-0 items-center justify-center h-8 w-8 rounded-full border border-white/15 text-white/60 transition hover:bg-white/5 hover:text-white"
              >
                <Play className="h-3.5 w-3.5" />
              </button>
              <Switch
                checked={prefs ? prefs[row.key] : true}
                disabled={!prefs || saving !== null || !masterOn}
                onCheckedChange={(v: boolean) => toggle(row.key, v)}
                aria-label={t(`settings.sounds.${row.i18n}.title`)}
              />
            </div>
          ))}
        </div>
        <p className="mt-3 text-[11px] text-white/35 leading-relaxed">{t("settings.sounds.deviceNote")}</p>
      </div>
      )}
    </section>
  );
}

export { ALL_KEYS as SOUND_PREF_KEYS };
