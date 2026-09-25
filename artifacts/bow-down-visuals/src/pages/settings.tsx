import { useEffect } from "react";
import { Link, useSearch } from "wouter";
import { ArrowLeft, Settings as SettingsIcon, Sparkles } from "lucide-react";
import { ConnectedAccounts } from "@/components/ConnectedAccounts";
import { DiscordWebhookSettings } from "@/components/DiscordWebhookSettings";
import { useToast } from "@/hooks/use-toast";
import { requestOnboardingTour } from "@/lib/onboarding";

/* Account settings. The social OAuth callbacks redirect here with
   ?social=instagram_connected / ?social=tiktok_connected / ?social=facebook_connected
   (or ?social=error&reason=...). */

const REASON_MESSAGES: Record<string, string> = {
  oauth_failed:
    "Instagram refused the connection — check the account is Business/Creator and linked to a Facebook Page.",
  facebook_oauth_failed:
    "Facebook refused the connection — try again, or reconnect from a browser where you're logged into Facebook.",
  facebook_no_pages:
    "No Facebook Pages were found on that account — create a Page first, then connect.",
  facebook_bad_state:
    "The login session expired before Facebook finished. Try connecting again.",
  facebook_missing_params:
    "Facebook didn't send back a complete response. Try connecting again.",
};

const SOCIAL_MESSAGES: Record<string, { title: string; description: string; destructive?: boolean }> = {
  instagram_connected: {
    title: "Instagram connected",
    description: "Your account is ready — post exports straight to Reels.",
  },
  tiktok_connected: {
    title: "TikTok connected",
    description: "Your account is ready — exports go to your TikTok drafts.",
  },
  facebook_connected: {
    title: "Facebook connected",
    description: "Your Pages are ready — post exports straight to Facebook as Reels.",
  },
  error: {
    title: "Connection failed",
    description: "The connection didn't complete. Try again.",
    destructive: true,
  },
  tiktok_error: {
    title: "TikTok connection failed",
    description: "The connection didn't complete. Try again, and make sure you approved the upload permission.",
    destructive: true,
  },
};

export default function Settings() {
  const search = useSearch();
  const { toast } = useToast();

  useEffect(() => {
    const params = new URLSearchParams(search);
    const social = params.get("social");
    if (!social) return;
    const msg = SOCIAL_MESSAGES[social] ?? SOCIAL_MESSAGES["error"];
    if (msg) {
      const reason = params.get("reason") ?? "";
      toast({
        title: msg.title,
        description: REASON_MESSAGES[reason] ?? msg.description,
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
            <ArrowLeft className="h-4 w-4" /> Dashboard
          </Link>
        </div>

        <div className="flex items-center gap-3">
          <div className="h-11 w-11 rounded-xl bg-primary/15 border border-primary/30 flex items-center justify-center">
            <SettingsIcon className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
            <p className="text-white/40 mt-1 text-sm">Your account and connections</p>
          </div>
        </div>

        <ConnectedAccounts />

        {/* Walkthrough replay */}
        <section className="rounded-2xl border border-primary/25 bg-gradient-to-br from-primary/[0.08] to-transparent p-5 md:p-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-primary/15 border border-primary/30 flex items-center justify-center shrink-0">
                <Sparkles className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h2 className="text-base font-bold text-white">Guided walkthrough</h2>
                <p className="text-sm text-white/40 mt-0.5">
                  Replay the first-visit tour of credits, tools, and the editor.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={requestOnboardingTour}
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-black text-black transition hover:brightness-110"
            >
              <Sparkles className="h-4 w-4" /> Replay tour
            </button>
          </div>
        </section>

        <DiscordWebhookSettings />
      </div>
    </div>
  );
}
