import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/contexts/AuthContext";
import { Switch } from "@/components/ui/switch";
import { BellRing } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

/* ── Retention & nudges settings ────────────────────────────────────────
   One board, every system with an off switch. Flip anything off and the
   system stays silent (each backend system honours its pref). */

type PrefKey =
  | "daily_drop_enabled"
  | "away_digest_enabled"
  | "creation_streaks_enabled"
  | "quests_enabled";

const PREF_KEYS: PrefKey[] = [
  "daily_drop_enabled",
  "away_digest_enabled",
  "creation_streaks_enabled",
  "quests_enabled",
];

const PREF_I18N: Record<PrefKey, string> = {
  daily_drop_enabled: "dailyDropEnabled",
  away_digest_enabled: "awayDigestEnabled",
  creation_streaks_enabled: "creationStreaksEnabled",
  quests_enabled: "questsEnabled",
};

export function RetentionPrefsSettings() {
  const { t } = useTranslation();
  const { user, getAccessToken } = useAuth();
  const { toast } = useToast();
  const [prefs, setPrefs] = useState<Record<PrefKey, boolean> | null>(null);
  const [saving, setSaving] = useState<PrefKey | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const token = await getAccessToken();
        const res = await fetch("/api/retention/prefs", {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) return;
        const d = await res.json() as Record<PrefKey, boolean>;
        if (cancelled) return;
        setPrefs({
          daily_drop_enabled: d.daily_drop_enabled ?? true,
          away_digest_enabled: d.away_digest_enabled ?? true,
          creation_streaks_enabled: d.creation_streaks_enabled ?? true,
          quests_enabled: d.quests_enabled ?? true,
        });
      } catch {
        /* silent — settings shows other sections regardless */
      }
    })();
    return () => { cancelled = true; };
  }, [user, getAccessToken]);

  async function toggle(key: PrefKey, next: boolean) {
    if (!prefs || saving) return;
    const prev = prefs[key];
    setPrefs({ ...prefs, [key]: next });
    setSaving(key);
    try {
      const token = await getAccessToken();
      const res = await fetch("/api/retention/prefs", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ [key]: next }),
      });
      if (!res.ok) throw new Error("save failed");
      const d = await res.json() as Record<PrefKey, boolean>;
      setPrefs({
        daily_drop_enabled: d.daily_drop_enabled ?? next,
        away_digest_enabled: d.away_digest_enabled ?? next,
        creation_streaks_enabled: d.creation_streaks_enabled ?? next,
        quests_enabled: d.quests_enabled ?? next,
      });
      toast({ title: t("retention.prefs.saved") });
    } catch {
      setPrefs({ ...prefs, [key]: prev }); // revert on failure
      toast({ title: t("retention.prefs.saveFailed"), variant: "destructive" });
    } finally {
      setSaving(null);
    }
  }

  return (
    <section className="rounded-3xl border border-white/[0.08] bg-white/[0.02] p-5 md:p-6">
      <div className="flex items-center gap-3 mb-1">
        <div className="h-10 w-10 rounded-xl bg-primary/[0.12] border border-primary/25 flex items-center justify-center shrink-0">
          <BellRing className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h2 className="text-base font-black text-white">{t("retention.prefs.title")}</h2>
          <p className="text-xs text-white/40 mt-0.5">{t("retention.prefs.subtitle")}</p>
        </div>
      </div>
      <div className="mt-4 divide-y divide-white/[0.05]">
        {PREF_KEYS.map((key) => (
          <div key={key} className="flex items-center gap-4 py-3.5">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-white">{t(`retention.prefs.${PREF_I18N[key]}.title`)}</p>
              <p className="text-[11px] text-white/35 mt-0.5 leading-relaxed">{t(`retention.prefs.${PREF_I18N[key]}.desc`)}</p>
            </div>
            <Switch
              checked={prefs ? prefs[key] : true}
              disabled={!prefs || saving !== null}
              onCheckedChange={(v: boolean) => toggle(key, v)}
              aria-label={t(`retention.prefs.${PREF_I18N[key]}.title`)}
            />
          </div>
        ))}
      </div>
    </section>
  );
}
