import { useEffect, useState } from "react";
import { Loader2, Link2Off, AlertTriangle, BadgeCheck } from "lucide-react";
import { InstagramIcon } from "@/components/ui/instagram-icon";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";

/* Connected social accounts for auto-posting (Instagram MVP).
   Lives on the Settings page. OAuth runs as a full-page redirect because
   Meta requires it — the API callback lands back on /settings. */

export interface SocialAccountInfo {
  id: string;
  platform: string;
  username: string | null;
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

export function ConnectedAccounts() {
  const { getAccessToken } = useAuth();
  const { toast } = useToast();
  const { accounts, loading, reload } = useSocialAccounts();
  const [connecting, setConnecting] = useState(false);
  const [disconnectingId, setDisconnectingId] = useState<string | null>(null);

  const instagram = accounts.find((a) => a.platform === "instagram");

  async function connectInstagram() {
    setConnecting(true);
    try {
      const token = await getAccessToken();
      const res = await fetch("/api/social/instagram/auth-url", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.authUrl) {
        throw new Error(data.message || "Instagram auto-post isn't configured yet.");
      }
      // Full-page redirect — Meta OAuth requires it.
      window.location.href = data.authUrl as string;
    } catch (err) {
      toast({
        title: "Couldn't start Instagram connect",
        description: err instanceof Error ? err.message : "Try again.",
        variant: "destructive",
      });
      setConnecting(false);
    }
  }

  async function disconnect(id: string) {
    setDisconnectingId(id);
    try {
      const token = await getAccessToken();
      const res = await fetch(`/api/social/accounts/${id}`, {
        method: "DELETE",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error("disconnect failed");
      toast({ title: "Disconnected", description: "Instagram account removed." });
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
          Connect Instagram to post your exports straight to Reels — 2 credits per post.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-white/40 text-sm py-4">
          <Loader2 className="h-4 w-4 animate-spin" /> Checking connections…
        </div>
      ) : instagram ? (
        <div className="flex items-center gap-4 rounded-xl border border-primary/25 bg-primary/[0.05] p-4">
          <div className="h-11 w-11 rounded-full bg-gradient-to-br from-[#f9ce34] via-[#ee2a7b] to-[#6228d7] flex items-center justify-center shrink-0">
            <InstagramIcon className="h-5 w-5 text-white" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-white flex items-center gap-1.5">
              @{instagram.usernameMasked ?? instagram.username ?? "instagram"}
              {!instagram.expired && <BadgeCheck className="h-4 w-4 text-primary" />}
            </p>
            {instagram.expired ? (
              <p className="text-xs text-amber-400/90 flex items-center gap-1 mt-0.5">
                <AlertTriangle className="h-3 w-3" /> Connection expired — reconnect to keep posting.
              </p>
            ) : (
              <p className="text-xs text-white/40 mt-0.5">Ready to post Reels · 2 credits per post</p>
            )}
          </div>
          {instagram.expired ? (
            <Button
              onClick={connectInstagram}
              disabled={connecting}
              className="bg-primary hover:bg-primary/90 text-black font-bold text-xs"
            >
              {connecting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Reconnect"}
            </Button>
          ) : (
            <Button
              variant="ghost"
              onClick={() => disconnect(instagram.id)}
              disabled={disconnectingId === instagram.id}
              className="text-white/50 hover:text-red-400 text-xs"
            >
              {disconnectingId === instagram.id ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <span className="flex items-center gap-1.5"><Link2Off className="h-3.5 w-3.5" /> Disconnect</span>
              )}
            </Button>
          )}
        </div>
      ) : (
        <div className="flex flex-col sm:flex-row sm:items-center gap-4 rounded-xl border border-dashed border-white/15 p-4">
          <div className="h-11 w-11 rounded-full bg-white/[0.06] border border-white/10 flex items-center justify-center shrink-0">
            <InstagramIcon className="h-5 w-5 text-white/50" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-bold text-white">Instagram</p>
            <p className="text-xs text-white/40 mt-0.5">
              Needs a Business or Creator account linked to a Facebook Page.
            </p>
          </div>
          <Button
            onClick={connectInstagram}
            disabled={connecting}
            className="bg-primary hover:bg-primary/90 text-black font-bold text-xs shadow-[0_0_16px_rgba(218,165,32,0.35)]"
          >
            {connecting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Connect Instagram"}
          </Button>
        </div>
      )}
    </section>
  );
}
