import { useIsLightTheme } from "@/hooks/use-is-light-theme";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/contexts/AuthContext";
import { Switch } from "@/components/ui/switch";
import { Newspaper, AlertTriangle, RotateCcw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

/* ── Group digest settings ──────────────────────────────────────────────
   The user-facing control for the periodic per-group activity digest:
   a master on/off, a frequency (daily / weekly), and an email opt-in
   (OFF by default — the digest lands in the notification bell; email
   only ever goes to members who turn this on). Stored PER ACCOUNT
   (GET/PATCH /api/group-digest-prefs) and honored exactly by the
   digest sweep: off means no digest is ever created for the account.
   Same honesty rule as the other Settings cards: a failed load is an
   error state with a retry, never a fake "everything on". */

interface GroupDigestPrefs {
  enabled: boolean;
  frequency: "daily" | "weekly";
  email_enabled: boolean;
}

const DEFAULT_PREFS: GroupDigestPrefs = {
  enabled: true,
  frequency: "weekly",
  email_enabled: false,
};

function pickPrefs(d: Partial<GroupDigestPrefs>, fallback: GroupDigestPrefs): GroupDigestPrefs {
  return {
    enabled: d.enabled ?? fallback.enabled,
    frequency: d.frequency === "daily" || d.frequency === "weekly" ? d.frequency : fallback.frequency,
    email_enabled: d.email_enabled ?? fallback.email_enabled,
  };
}

export function GroupDigestSettings() {
  const isLight = useIsLightTheme();
  const { t } = useTranslation();
  const { user, getAccessToken } = useAuth();
  const { toast } = useToast();
  const [prefs, setPrefs] = useState<GroupDigestPrefs | null>(null);
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
        const res = await fetch("/api/group-digest-prefs", {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) throw new Error("load failed");
        const d = (await res.json()) as Partial<GroupDigestPrefs>;
        if (cancelled) return;
        setPrefs(pickPrefs(d, DEFAULT_PREFS));
      } catch {
        if (!cancelled) setLoadError(true);
      }
    })();
    return () => { cancelled = true; };
  }, [user, getAccessToken, retryNonce]);

  async function save(patch: Partial<GroupDigestPrefs>) {
    if (!prefs || saving) return;
    const prev = prefs;
    const optimistic = { ...prefs, ...patch };
    setPrefs(optimistic);
    setSaving(true);
    try {
      const token = await getAccessToken();
      const res = await fetch("/api/group-digest-prefs", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error("save failed");
      const d = (await res.json()) as Partial<GroupDigestPrefs>;
      setPrefs(pickPrefs(d, optimistic));
      toast({ title: t("settings.groupDigest.saved") });
    } catch {
      setPrefs(prev); // revert on failure
      toast({ title: t("settings.groupDigest.saveFailed"), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  const enabled = prefs?.enabled ?? true;

  return (
    <section className={`rounded-3xl border p-5 md:p-6 ${isLight ? "border-[#C9A84C]/40 bg-gradient-to-b from-[#FCF7EA] to-[#F4E7C3]" : "border-primary/25 bg-gradient-to-b from-[#14100a] to-[#0d0a04]"}`} data-testid="group-digest-settings">
      <div className="flex items-center gap-3 mb-1">
        <div className="h-10 w-10 rounded-xl bg-primary/[0.12] border border-primary/25 flex items-center justify-center shrink-0">
          <Newspaper className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h2 className="text-base font-black text-white">{t("settings.groupDigest.title")}</h2>
          <p className="text-xs text-white/40 mt-0.5">{t("settings.groupDigest.subtitle")}</p>
        </div>
      </div>
      {loadError ? (
        <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/[0.06] p-4 text-sm text-red-200/80 flex items-center gap-3">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {t("settings.groupDigest.loadError")}
          <button
            type="button"
            onClick={() => setRetryNonce((n) => n + 1)}
            className="ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-white/15 px-3 py-1.5 text-xs font-bold text-white/80 hover:bg-white/5"
          >
            <RotateCcw className="h-3.5 w-3.5" /> {t("settings.groupDigest.retry")}
          </button>
        </div>
      ) : (
      <div className="mt-4">
        <div className="flex items-center gap-4 py-3.5 border-b border-white/[0.08]">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-white">{t("settings.groupDigest.master.title")}</p>
            <p className="text-[11px] text-white/35 mt-0.5 leading-relaxed">{t("settings.groupDigest.master.desc")}</p>
          </div>
          <Switch
            checked={prefs ? prefs.enabled : true}
            disabled={!prefs || saving}
            onCheckedChange={(v: boolean) => save({ enabled: v })}
            aria-label={t("settings.groupDigest.master.title")}
          />
        </div>
        <div className={`${enabled ? "" : "opacity-50"}`}>
          <div className="flex items-center gap-4 py-3.5 border-b border-white/[0.08]">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-white">{t("settings.groupDigest.frequency.title")}</p>
              <p className="text-[11px] text-white/35 mt-0.5 leading-relaxed">{t("settings.groupDigest.frequency.desc")}</p>
            </div>
            <div className="flex shrink-0 overflow-hidden rounded-lg border border-white/15" role="group" aria-label={t("settings.groupDigest.frequency.title")}>
              {(["daily", "weekly"] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  disabled={!prefs || saving || !enabled}
                  onClick={() => save({ frequency: f })}
                  aria-pressed={prefs?.frequency === f}
                  className={`px-3 py-1.5 text-xs font-bold transition ${
                    prefs?.frequency === f
                      ? "bg-primary text-black"
                      : "text-white/60 hover:bg-white/5"
                  }`}
                >
                  {t(`settings.groupDigest.frequency.${f}`)}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-4 py-3.5">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-white">{t("settings.groupDigest.email.title")}</p>
              <p className="text-[11px] text-white/35 mt-0.5 leading-relaxed">{t("settings.groupDigest.email.desc")}</p>
            </div>
            <Switch
              checked={prefs ? prefs.email_enabled : false}
              disabled={!prefs || saving || !enabled}
              onCheckedChange={(v: boolean) => save({ email_enabled: v })}
              aria-label={t("settings.groupDigest.email.title")}
            />
          </div>
        </div>
        <p className="mt-3 text-[11px] text-white/35 leading-relaxed">{t("settings.groupDigest.note")}</p>
      </div>
      )}
    </section>
  );
}
