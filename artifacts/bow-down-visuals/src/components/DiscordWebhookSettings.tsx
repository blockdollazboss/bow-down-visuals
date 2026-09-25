import { useEffect, useState } from "react";
import { MessageCircle, Loader2, CheckCircle2, Trash2, Eye, EyeOff, Bell, BellOff } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";

/* Discord webhook settings. The user pastes a channel webhook URL from
   Discord (channel settings → Integrations → Webhooks → Copy Webhook URL).
   The URL is a secret: it is encrypted server-side (SOCIAL_TOKEN_KEY), never
   logged, and never returned to the client — this UI only ever shows whether
   one is configured, plus the non-secret display prefs. */

interface DiscordStatus {
  configured: boolean;
  channel_name: string | null;
  mention_everyone: boolean;
  crypto_ready: boolean;
}

export function DiscordWebhookSettings() {
  const { getAccessToken } = useAuth();
  const { toast } = useToast();
  const [status, setStatus] = useState<DiscordStatus | null>(null);
  const [url, setUrl] = useState("");
  const [showUrl, setShowUrl] = useState(false);
  const [channelName, setChannelName] = useState("");
  const [mentionEveryone, setMentionEveryone] = useState(false);
  const [saving, setSaving] = useState(false);

  async function load() {
    const token = await getAccessToken();
    const res = await fetch("/api/discord/status", {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (res.ok) {
      const s: DiscordStatus = await res.json();
      setStatus(s);
      setChannelName(s.channel_name ?? "");
      setMentionEveryone(s.mention_everyone);
    }
  }

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSave() {
    if (!url.trim() && !status?.configured) {
      toast({ title: "Paste your webhook URL", description: "Discord → channel settings → Integrations → Webhooks → Copy Webhook URL.", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const token = await getAccessToken();
      const body: Record<string, unknown> = { mention_everyone: mentionEveryone };
      if (url.trim()) body.webhook_url = url.trim();
      if (channelName.trim()) body.channel_name = channelName.trim();
      const res = await fetch("/api/discord/webhook", {
        method: "POST",
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't save.");
      toast({ title: "Discord connected 🎉", description: "Your server will get the hype from /go-live." });
      setUrl("");
      await load();
    } catch (e) {
      toast({ title: "Couldn't save", description: e instanceof Error ? e.message : "Try again.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove() {
    const token = await getAccessToken();
    const res = await fetch("/api/discord/webhook", {
      method: "DELETE",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (res.ok) {
      toast({ title: "Disconnected", description: "Discord announcements are off." });
      await load();
    }
  }

  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-5 md:p-6 space-y-4" data-testid="discord-settings">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold flex items-center gap-2">
          <span className="h-9 w-9 rounded-xl bg-[#5865F2]/15 border border-[#5865F2]/30 flex items-center justify-center">
            <MessageCircle className="h-4.5 w-4.5 text-[#8b9bff]" />
          </span>
          Discord Live
        </h2>
        {status?.configured && (
          <span className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 rounded-full px-3 py-1">
            <CheckCircle2 className="h-3.5 w-3.5" /> Connected
          </span>
        )}
      </div>

      <p className="text-sm text-white/50 leading-relaxed">
        Post <span className="text-amber-200 font-semibold">LIVE NOW</span> announcements straight to your Discord server
        from the <a href="/go-live" className="text-amber-300 underline underline-offset-2">Go Live</a> dashboard.
        Your webhook URL is encrypted on our servers and never shown again after saving.
      </p>

      {status && !status.crypto_ready && (
        <p className="text-xs text-amber-300/80 bg-amber-400/10 border border-amber-400/20 rounded-lg px-3 py-2">
          Secure storage isn't ready on the server yet — saving is temporarily disabled.
        </p>
      )}

      <div className="space-y-3">
        <label className="block">
          <span className="text-xs font-bold text-white/60 uppercase tracking-wider">
            {status?.configured ? "Replace webhook URL" : "Webhook URL"}
          </span>
          <div className="relative mt-1.5">
            <input
              type={showUrl ? "text" : "password"}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://discord.com/api/webhooks/…"
              autoComplete="off"
              spellCheck={false}
              className="w-full rounded-xl bg-black/60 border border-white/10 px-4 py-2.5 pr-11 text-sm font-mono placeholder:text-white/25 focus:outline-none focus:border-amber-400/60"
              data-testid="input-discord-webhook"
            />
            <button
              type="button"
              onClick={() => setShowUrl((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/70"
              aria-label={showUrl ? "Hide webhook URL" : "Show webhook URL"}
            >
              {showUrl ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </label>

        <div className="grid md:grid-cols-2 gap-3">
          <label className="block">
            <span className="text-xs font-bold text-white/60 uppercase tracking-wider">Channel label (optional)</span>
            <input
              value={channelName}
              onChange={(e) => setChannelName(e.target.value)}
              placeholder="#announcements"
              className="mt-1.5 w-full rounded-xl bg-black/60 border border-white/10 px-4 py-2.5 text-sm placeholder:text-white/25 focus:outline-none focus:border-amber-400/60"
              data-testid="input-discord-channel"
            />
          </label>
          <div className="flex items-end pb-1">
            <label className="flex items-center gap-2.5 text-sm text-white/70 cursor-pointer select-none">
              <button
                type="button"
                role="switch"
                aria-checked={mentionEveryone}
                onClick={() => setMentionEveryone((v) => !v)}
                className={`w-10 h-6 rounded-full transition-colors relative ${mentionEveryone ? "bg-amber-400" : "bg-white/10"}`}
                data-testid="toggle-discord-everyone"
              >
                <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-black transition-all ${mentionEveryone ? "left-[18px]" : "left-0.5"}`} />
              </button>
              {mentionEveryone ? <Bell className="h-4 w-4 text-amber-300" /> : <BellOff className="h-4 w-4 text-white/30" />}
              Default <span className="font-mono font-bold text-amber-200">@everyone</span> ping
            </label>
          </div>
        </div>

        <div className="flex flex-wrap gap-2.5">
          <Button
            onClick={handleSave}
            disabled={saving || (status != null && !status.crypto_ready)}
            className="gold-glow gap-2"
            data-testid="btn-save-discord"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            {status?.configured ? "Save changes" : "Connect Discord"}
          </Button>
          {status?.configured && (
            <Button onClick={handleRemove} variant="outline" className="gap-2 border-red-500/30 text-red-300 hover:bg-red-500/10" data-testid="btn-remove-discord">
              <Trash2 className="h-4 w-4" /> Disconnect
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}
