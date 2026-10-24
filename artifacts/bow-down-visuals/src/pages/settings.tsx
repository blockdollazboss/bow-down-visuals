import { useEffect, useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { AlertTriangle, ArrowLeft, ArrowUpRight, Download, Loader2, MousePointer2, Settings as SettingsIcon, Trash2 } from "lucide-react";
import { ConnectedAccounts } from "@/components/ConnectedAccounts";
import { ThemePacksDesk } from "@/components/theme-packs/ThemePacksDesk";
import { SocialProofSettings } from "@/components/SocialProofSettings";
import { PasskeyManager } from "@/components/Passkey";
import { RetentionPrefsSettings } from "@/components/RetentionPrefsSettings";
import { DiscordWebhookSettings } from "@/components/DiscordWebhookSettings";
import { DeveloperApiSettings } from "@/components/DeveloperApiSettings";
import { TeamSeats } from "@/components/TeamSeats";
import { LegacySettings, LegacyContactSettings, PermanenceSettings, CatalogExportPanel, ModConsolePanel } from "@/components/trust/TrustPanels";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "react-i18next";
import { usePageTitle } from "@/hooks/use-page-title";
import { useIsLightTheme } from "@/hooks/use-is-light-theme";

/* Account settings. The social OAuth callbacks redirect here with
   ?social=instagram_connected / ?social=tiktok_connected / ?social=facebook_connected
   (or ?social=error&reason=...). */

const REASON_MESSAGE_KEYS: Record<string, string> = {
  oauth_failed: "settings.reasonOauthFailed",
  facebook_oauth_failed: "settings.reasonFacebookOauthFailed",
  facebook_no_pages: "settings.reasonFacebookNoPages",
  facebook_bad_state: "settings.reasonFacebookBadState",
  facebook_missing_params: "settings.reasonFacebookMissingParams",
};

const SOCIAL_MESSAGE_KEYS: Record<string, { titleKey: string; descKey: string; destructive?: boolean }> = {
  instagram_connected: {
    titleKey: "settings.socialInstagramTitle",
    descKey: "settings.socialInstagramDesc",
  },
  tiktok_connected: {
    titleKey: "settings.socialTiktokTitle",
    descKey: "settings.socialTiktokDesc",
  },
  facebook_connected: {
    titleKey: "settings.socialFacebookTitle",
    descKey: "settings.socialFacebookDesc",
  },
  error: {
    titleKey: "settings.socialErrorTitle",
    descKey: "settings.socialErrorDesc",
    destructive: true,
  },
  tiktok_error: {
    titleKey: "settings.socialTiktokErrorTitle",
    descKey: "settings.socialTiktokErrorDesc",
    destructive: true,
  },
};

/* ─── Danger Zone: export data / delete account ─────────────────────────── */
function DangerZone() {
  const { t } = useTranslation();
  const { getAccessToken, signOut } = useAuth();
  const [, setLocation] = useLocation();
  const [exporting, setExporting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function exportData() {
    setExporting(true);
    setError(null);
    try {
      const token = await getAccessToken();
      const res = await fetch("/api/account/export", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error();
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "bow-down-visuals-export.json";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setError(t("settings.exportError"));
    } finally {
      setExporting(false);
    }
  }

  async function deleteAccount() {
    if (confirm !== "DELETE" || deleting) return;
    setDeleting(true);
    setError(null);
    try {
      const token = await getAccessToken();
      const res = await fetch("/api/account", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ confirm: "DELETE" }),
      });
      if (!res.ok) throw new Error();
      await signOut();
      setLocation("/");
    } catch {
      setError(t("settings.deleteError"));
      setDeleting(false);
    }
  }

  return (
    <section className="rounded-2xl border-2 border-red-500/40 bg-red-950/20 p-6">
      <div className="flex items-center gap-2.5">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-red-500/40 bg-red-500/10">
          <AlertTriangle className="h-4 w-4 text-red-400" />
        </span>
        <div>
          <h2 className="text-lg font-black tracking-tight text-red-300">
            {t("settings.dangerTitle")}
          </h2>
          <p className="text-xs text-white/50">{t("settings.dangerDescription")}</p>
        </div>
      </div>

      <div className="mt-5 space-y-5">
        <div>
          <button
            type="button"
            onClick={() => { void exportData(); }}
            disabled={exporting}
            className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-white/10 disabled:opacity-50"
          >
            {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            {exporting ? t("settings.exporting") : t("settings.exportButton")}
          </button>
        </div>

        <div className="border-t border-red-500/20 pt-5">
          <p className="text-sm font-bold text-red-300">{t("settings.deleteTitle")}</p>
          <p className="mt-1 text-xs text-white/50">{t("settings.deleteDescription")}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <input
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder={t("settings.deletePlaceholder")}
              disabled={deleting}
              className="w-56 rounded-xl bg-black/50 border border-red-500/40 px-3 py-2 text-sm text-white outline-none focus:border-red-400 placeholder:text-white/25"
            />
            <button
              type="button"
              onClick={() => { void deleteAccount(); }}
              disabled={confirm !== "DELETE" || deleting}
              className="inline-flex items-center gap-2 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              {deleting ? t("settings.deleting") : t("settings.deleteButton")}
            </button>
          </div>
        </div>
      </div>

      {error && <p className="mt-4 text-sm text-red-400">{error}</p>}
    </section>
  );
}


/* ─── Cursor: the picker lives on its own page (/cursor-lab) ───────────── */
function CursorCard() {
  const { t } = useTranslation();
  const isLight = useIsLightTheme();
  return (
    <section className={`rounded-2xl border p-5 md:p-6 ${isLight ? "border-[#C9A84C]/40 bg-gradient-to-b from-[#FCF7EA] to-[#F4E7C3]" : "border-primary/25 bg-gradient-to-b from-[#14100a] to-[#0d0a04]"}`} data-testid="cursor-settings">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-primary/30 bg-primary/10">
            <MousePointer2 className="h-4 w-4 text-primary" />
          </span>
          <div>
            <h2 className="text-lg font-bold">{t("settings.cursorTitle", { defaultValue: "Cursor" })}</h2>
            <p className={`text-xs ${isLight ? "text-[#6B5B36]" : "text-white/50"}`}>{t("settings.cursorDescription", { defaultValue: "Pick the custom cursor that follows you around the site." })}</p>
          </div>
        </div>
        <Link
          href="/cursor-lab"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-primary/40 bg-primary/10 px-4 py-2.5 text-sm font-semibold text-primary transition hover:bg-primary/20"
        >
          {t("settings.cursorButton", { defaultValue: "Choose cursor" })}
          <ArrowUpRight className="h-4 w-4" />
        </Link>
      </div>
    </section>
  );
}

export default function Settings() {
  const { t } = useTranslation();
  usePageTitle(t("settings.pageTitle"), t("settings.pageDescription"));
  const search = useSearch();
  const { toast } = useToast();

  useEffect(() => {
    const params = new URLSearchParams(search);
    const social = params.get("social");
    if (!social) return;
    const msg = SOCIAL_MESSAGE_KEYS[social] ?? SOCIAL_MESSAGE_KEYS["error"];
    if (msg) {
      const reason = params.get("reason") ?? "";
      const reasonKey = REASON_MESSAGE_KEYS[reason];
      toast({
        title: t(msg.titleKey),
        description: reasonKey ? t(reasonKey) : t(msg.descKey),
        variant: msg.destructive ? "destructive" : "default",
      });
    }
    // Clean the callback params so a refresh doesn't re-toast.
    params.delete("social");
    params.delete("reason");
    const next = params.toString();
    window.history.replaceState(null, "", `/settings${next ? `?${next}` : ""}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="max-w-4xl mx-auto px-5 md:px-8 py-10 space-y-8">
        <div className="flex items-center gap-3">
          <Link
            href="/dashboard"
            className="flex items-center gap-1.5 text-white/40 hover:text-white text-sm transition-colors"
          >
            <ArrowLeft className="h-4 w-4" /> {t("settings.backToDashboard")}
          </Link>
        </div>

        <div>
          <div className="mb-4 inline-flex items-center gap-1.5 rounded-full border border-[#d4a017]/40 bg-[#d4a017]/10 px-3 py-1 text-xs font-black uppercase tracking-widest text-[#fbbf24]">
            <SettingsIcon className="h-3.5 w-3.5" />{t("settings.kicker", { defaultValue: "Account" })}
          </div>
          <div className="flex items-center gap-4">
            <div className="h-12 w-12 rounded-xl bg-[#d4a017]/10 border border-[#d4a017]/30 flex items-center justify-center">
              <SettingsIcon className="h-5 w-5 text-[#fbbf24]" />
            </div>
            <div>
              <h1 className="text-4xl md:text-5xl font-black tracking-tight">{t("settings.title")}</h1>
              <p className="text-white/55 mt-2 text-sm max-w-xl">{t("settings.subtitle")}</p>
            </div>
          </div>
        </div>

        <ConnectedAccounts />

        <SocialProofSettings />

        <PasskeyManager />

        <RetentionPrefsSettings />

        <DiscordWebhookSettings />

        <DeveloperApiSettings />

        <TeamSeats />

        <ThemePacksDesk />

        <CursorCard />

        <LegacySettings />

        <LegacyContactSettings />

        <PermanenceSettings />

        <CatalogExportPanel />

        <ModConsolePanel />

        <DangerZone />
      </div>
    </div>
  );
}
