import { useEffect } from "react";
import { Link, useSearch } from "wouter";
import { ArrowLeft, Settings as SettingsIcon } from "lucide-react";
import { ConnectedAccounts } from "@/components/ConnectedAccounts";
import { DiscordWebhookSettings } from "@/components/DiscordWebhookSettings";
import { TeamSeats } from "@/components/TeamSeats";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "react-i18next";
import { usePageTitle } from "@/hooks/use-page-title";

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

        <div className="flex items-center gap-3">
          <div className="h-11 w-11 rounded-xl bg-primary/15 border border-primary/30 flex items-center justify-center">
            <SettingsIcon className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">{t("settings.title")}</h1>
            <p className="text-white/40 mt-1 text-sm">{t("settings.subtitle")}</p>
          </div>
        </div>

        <ConnectedAccounts />

        <DiscordWebhookSettings />

        <TeamSeats />
      </div>
    </div>
  );
}
