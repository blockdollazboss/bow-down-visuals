import { useEffect, useState, type JSX } from "react";
import { Loader2, Link2Off, AlertTriangle, BadgeCheck } from "lucide-react";
import { InstagramIcon } from "@/components/ui/instagram-icon";
import { TikTokIcon } from "@/components/ui/tiktok-icon";
import { FacebookIcon } from "@/components/ui/facebook-icon";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";

/* Connected social accounts for auto-posting (Instagram Reels + TikTok drafts + Facebook Pages).
   Lives on the Settings page. OAuth runs as a full-page redirect because both
   providers require it — the API callback lands back on /settings. */

export interface SocialAccountInfo {
  id: string;
  platform: string;
  username: string | null;
  pageName: string | null;
  usernameMasked: string | null;
  expired: boolean;
  connectedAt: string;
}

export function useSocialAccounts() {
  const { getAccessToken } = useAuth();
  const [accounts, setAccounts] = useState<SocialAccountInfo[]>([]);
  const [loading, setLoading] = useState(true);

  async function reload(): Promise<SocialAccountInfo[]> {
    setLoading(true);
    try {
      const token = await getAccessToken();
      const res = await fetch("/api/social/accounts", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error("load failed");
      const data = await res.json();
      const list: SocialAccountInfo[] = data.accounts ?? [];
      setAccounts(list);
      return list;
    } catch {
      setAccounts([]);
      return [];
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const token = await getAccessToken();
        const res = await fetch("/api/social/accounts", {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) throw new Error("load failed");
        const data = await res.json();
        if (!cancelled) setAccounts(data.accounts ?? []);
      } catch {
        if (!cancelled) setAccounts([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [getAccessToken]);

  return { accounts, loading, reload };
}

interface PlatformConfig {
  platform: "instagram" | "tiktok" | "facebook";
  name: string;
  authPath: string;
  connectBlurb: string;
  readyBlurb: string;
  Icon: ({ className }: { className?: string }) => JSX.Element;
  iconBadgeClass: string;
}

const PLATFORMS: PlatformConfig[] = [
  {
    platform: "instagram",
    name: "Instagram",
    authPath: "/api/social/instagram/auth-url",
    connectBlurb: "Needs a Business or Creator account linked to a Facebook Page.",
    readyBlurb: "Ready to post Reels · 2 credits per post",
    Icon: InstagramIcon,
    iconBadgeClass: "bg-gradient-to-br from-[#f9ce34] via-[#ee2a7b] to-[#6228d7]",
  },
  {
    platform: "tiktok",
    name: "TikTok",
    authPath: "/api/social/tiktok/auth-url",
    connectBlurb: "Any TikTok account works — uploads land in your TikTok drafts, never auto-posted.",
    readyBlurb: "Ready to send to TikTok drafts · 2 credits per upload",
    Icon: TikTokIcon,
    iconBadgeClass: "bg-black border border-white/20",
  },
  {
    platform: "facebook",
    name: "Facebook",
    authPath: "/api/social/facebook/auth-url",
    connectBlurb: "Connect your Facebook Pages — exports post as Reels.",
    readyBlurb: "Ready to post to Facebook Pages as Reels · 2 credits per post",
    Icon: FacebookIcon,
    iconBadgeClass: "bg-[#1877F2]",
  },
];

export function ConnectedAccounts() {
  const { getAccessToken } = useAuth();
  const { toast } = useToast();
  const { accounts, loading, reload } = useSocialAccounts();
  const [connecting, setConnecting] = useState<string | null>(null);
  const [disconnectingId, setDisconnectingId] = useState<string | null>(null);

  async function connect(cfg: PlatformConfig) {
    setConnecting(cfg.platform);
    try {
      const token = await getAccessToken();
      const res = await fetch(cfg.authPath, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.authUrl) {
        throw new Error(data.message || `${cfg.name} auto-post isn't configured yet.`);
      }
      // Full-page redirect — both Meta and TikTok OAuth require it.
      window.location.href = data.authUrl as string;
    } catch (err) {
      toast({
        title: `Couldn't start ${cfg.name} connect`,
        description: err instanceof Error ? err.message : "Try again.",
        variant: "destructive",
      });
      setConnecting(null);
    }
  }

  async function disconnect(id: string, name: string) {
    setDisconnectingId(id);
    try {
      const token = await getAccessToken();
      const res = await fetch(`/api/social/accounts/${id}`, {
        method: "DELETE",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error("disconnect failed");
      toast({ title: "Disconnected", description: `${name} account removed.` });
      await reload();
    } catch {
      toast({ title: "Couldn't disconnect", description: "Try again.", variant: "destructive" });
    } finally {
      setDisconnectingId(null);
    }
  }

  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 space-y-4">
      <div>
        <h2 className="text-lg font-bold text-white">Connected Accounts</h2>
        <p className="text-sm text-white/40 mt-1">
          Post your exports straight to Instagram Reels, TikTok drafts, and Facebook Pages — 2 credits per post.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-white/40 text-sm py-4">
          <Loader2 className="h-4 w-4 animate-spin" /> Checking connections…
        </div>
      ) : (
        <div className="space-y-3">
          {PLATFORMS.map((cfg) => {
            const account = accounts.find((a) => a.platform === cfg.platform);
            const { Icon } = cfg;
            return account ? (
              <div key={cfg.platform} className="flex items-center gap-4 rounded-xl border border-primary/25 bg-primary/[0.05] p-4">
                <div className={`h-11 w-11 rounded-full ${cfg.iconBadgeClass} flex items-center justify-center shrink-0`}>
                  <Icon className="h-5 w-5 text-white" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-white flex items-center gap-1.5">
                    {cfg.platform === "facebook" && account.pageName
                      ? account.pageName
                      : `@${account.usernameMasked ?? account.username ?? cfg.platform}`}
                    {!account.expired && <BadgeCheck className="h-4 w-4 text-primary" />}
                  </p>
                  {account.expired ? (
                    <p className="text-xs text-amber-400/90 flex items-center gap-1 mt-0.5">
                      <AlertTriangle className="h-3 w-3" /> Connection expired — reconnect to keep posting.
                    </p>
                  ) : (
                    <p className="text-xs text-white/40 mt-0.5">{cfg.readyBlurb}</p>
                  )}
                </div>
                {account.expired ? (
                  <Button
                    onClick={() => connect(cfg)}
                    disabled={connecting !== null}
                    className="bg-primary hover:bg-primary/90 text-black font-bold text-xs"
                  >
                    {connecting === cfg.platform ? <Loader2 className="h-4 w-4 animate-spin" /> : "Reconnect"}
                  </Button>
                ) : (
                  <Button
                    variant="ghost"
                    onClick={() => disconnect(account.id, cfg.name)}
                    disabled={disconnectingId === account.id}
                    className="text-white/50 hover:text-red-400 text-xs"
                  >
                    {disconnectingId === account.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <span className="flex items-center gap-1.5"><Link2Off className="h-3.5 w-3.5" /> Disconnect</span>
                    )}
                  </Button>
                )}
              </div>
            ) : (
              <div key={cfg.platform} className="flex flex-col sm:flex-row sm:items-center gap-4 rounded-xl border border-dashed border-white/15 p-4">
                <div className="h-11 w-11 rounded-full bg-white/[0.06] border border-white/10 flex items-center justify-center shrink-0">
                  <Icon className="h-5 w-5 text-white/50" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-bold text-white">{cfg.name}</p>
                  <p className="text-xs text-white/40 mt-0.5">{cfg.connectBlurb}</p>
                </div>
                <Button
                  onClick={() => connect(cfg)}
                  disabled={connecting !== null}
                  className="bg-primary hover:bg-primary/90 text-black font-bold text-xs shadow-[0_0_16px_rgba(218,165,32,0.35)]"
                >
                  {connecting === cfg.platform ? <Loader2 className="h-4 w-4 animate-spin" /> : `Connect ${cfg.name}`}
                </Button>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
