import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Bell, BellRing, Loader2, AlertTriangle, RotateCcw } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useIsLightTheme } from "@/hooks/use-is-light-theme";
import { Switch } from "@/components/ui/switch";
import { apiFetch } from "@/lib/social-api";
import {
  fetchPushConfig,
  fetchPushPreferences,
  hasPushSubscription,
  pushSupport,
  subscribeToPush,
  unsubscribeFromPush,
  updatePushPreferences,
  type PushCategory,
  type PushDeps,
  type PushPreferenceMap,
} from "@/lib/push-client";

/* ── Device notifications settings (Stack500 push foundation) ──────────
   The account-level control for real OS notifications: a master
   switch for THIS device (the browser subscription) plus one switch
   per event category (server-side, migration 0299 — they gate the
   ping on every device; the in-app bell always keeps its record).
   Honest states only: no keys on the server → the card says device
   pings aren't switched on yet instead of rendering a dead switch. */

type MasterState =
  | "loading"
  | "signed-out"
  | "unsupported"
  | "denied"
  | "not-configured"
  | "off"
  | "on"
  | "working"
  | "error";

const CATEGORY_ROWS: { key: PushCategory; label: string; description: string }[] = [
  { key: "money", label: "Money", description: "Sales, payout-ready moments, plan and credit-pack events." },
  { key: "messages", label: "Messages", description: "Direct messages and priority DMs." },
  { key: "live", label: "Live", description: "Go-live alerts — your own streams and creators you follow." },
  { key: "mentions", label: "Mentions", description: "@mentions and tags." },
  { key: "social", label: "Social", description: "New follows, likes and other social activity. Off by default." },
];

export function PushNotificationSettings() {
  const isLight = useIsLightTheme();
  const { t } = useTranslation();
  const { user, getAccessToken } = useAuth();
  const [master, setMaster] = useState<MasterState>("loading");
  const [prefs, setPrefs] = useState<PushPreferenceMap | null>(null);
  const [prefsError, setPrefsError] = useState(false);
  const [saving, setSaving] = useState<PushCategory | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);

  const deps: PushDeps = {
    fetchJson: async (path, init) => {
      const res = await apiFetch(getAccessToken, path, init);
      return { status: res.status, json: await res.json().catch(() => null) };
    },
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!user) {
        if (!cancelled) setMaster("signed-out");
        return;
      }
      const support = pushSupport();
      if (support !== "ready") {
        if (!cancelled) setMaster(support === "denied" ? "denied" : "unsupported");
        return;
      }
      const config = await fetchPushConfig(deps).catch(() => ({ configured: false, publicKey: null }));
      if (cancelled) return;
      if (!config.configured) {
        setMaster("not-configured");
        return;
      }
      const subscribed = await hasPushSubscription().catch(() => false);
      if (!cancelled) setMaster(subscribed ? "on" : "off");
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, retryNonce]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const loaded = await fetchPushPreferences(deps);
        if (!cancelled) {
          setPrefs(loaded);
          setPrefsError(false);
        }
      } catch {
        if (!cancelled) setPrefsError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, retryNonce]);

  async function toggleMaster(next: boolean) {
    setMaster("working");
    try {
      if (next) {
        const outcome = await subscribeToPush(deps);
        setMaster(
          outcome === "subscribed"
            ? "on"
            : outcome === "denied"
              ? "denied"
              : outcome === "not_configured"
                ? "not-configured"
                : "unsupported",
        );
      } else {
        await unsubscribeFromPush(deps);
        setMaster("off");
      }
    } catch {
      setMaster("error");
    }
  }

  async function toggleCategory(key: PushCategory, next: boolean) {
    if (!prefs) return;
    setSaving(key);
    const previous = prefs;
    setPrefs({ ...prefs, [key]: next });
    try {
      setPrefs(await updatePushPreferences(deps, { [key]: next }));
    } catch {
      setPrefs(previous);
    } finally {
      setSaving(null);
    }
  }

  const sub = isLight ? "text-[#6B5B36]" : "text-white/50";

  return (
    <section
      className={`rounded-2xl border p-5 md:p-6 ${isLight ? "border-[#C9A84C]/40 bg-gradient-to-b from-[#FCF7EA] to-[#F4E7C3]" : "border-primary/25 bg-gradient-to-b from-[#14100a] to-[#0d0a04]"}`}
      data-testid="push-notification-settings"
    >
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-primary/30 bg-primary/10">
          <BellRing className="h-4 w-4 text-primary" />
        </span>
        <div>
          <h2 className="text-lg font-bold">
            {t("settings.pushTitle", { defaultValue: "Device notifications" })}
          </h2>
          <p className={`text-xs ${sub}`}>
            {t("settings.pushDescription", {
              defaultValue: "Real pings on your phone and computer — not just the bell. You choose what earns a ping.",
            })}
          </p>
        </div>
      </div>

      {/* This-device master switch */}
      <div className="mt-5 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Bell className="h-4 w-4 text-primary" />
          {t("settings.pushThisDevice", { defaultValue: "Ping this device" })}
        </div>
        {master === "loading" || master === "working" ? (
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
        ) : master === "on" || master === "off" ? (
          <Switch checked={master === "on"} onCheckedChange={toggleMaster} aria-label="Ping this device" />
        ) : (
          <span className={`text-xs ${sub}`}>
            {master === "signed-out" && t("settings.pushSignedOut", { defaultValue: "Sign in to turn on device pings." })}
            {master === "unsupported" && t("settings.pushUnsupported", { defaultValue: "This browser can't receive device pings." })}
            {master === "denied" && t("settings.pushDenied", { defaultValue: "Notifications are blocked in your browser settings." })}
            {master === "not-configured" && t("settings.pushNotConfigured", { defaultValue: "Device pings aren't switched on for the site yet — the bell still catches everything." })}
            {master === "error" && t("settings.pushError", { defaultValue: "Something went wrong — try again." })}
          </span>
        )}
      </div>

      {/* Per-category switches (account-level: they gate every device) */}
      <div className="mt-5 space-y-3 border-t border-primary/15 pt-5">
        {prefsError ? (
          <button
            type="button"
            onClick={() => setRetryNonce((n) => n + 1)}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary"
          >
            <AlertTriangle className="h-3.5 w-3.5" />
            {t("settings.pushPrefsError", { defaultValue: "Your alert choices couldn't load — tap to retry." })}
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
        ) : prefs === null ? (
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
        ) : (
          CATEGORY_ROWS.map((row) => (
            <div key={row.key} className="flex items-center justify-between gap-4">
              <div>
                <div className="text-sm font-semibold">
                  {t(`settings.pushCategory.${row.key}`, { defaultValue: row.label })}
                </div>
                <div className={`text-xs ${sub}`}>{row.description}</div>
              </div>
              <Switch
                checked={prefs[row.key]}
                disabled={saving === row.key}
                onCheckedChange={(next) => toggleCategory(row.key, next)}
                aria-label={row.label}
              />
            </div>
          ))
        )}
        <p className={`text-xs ${sub}`}>
          {t("settings.pushPrefsNote", {
            defaultValue: "These choices apply on every device. Turning one off silences the ping — the bell still keeps the record.",
          })}
        </p>
      </div>
    </section>
  );
}
