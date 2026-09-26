import { useCallback, useEffect, useState } from "react";
import { Bot, Check, Copy, ExternalLink, Loader2, PlugZap, ShieldAlert } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { usePageTitle } from "@/hooks/use-page-title";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

/* Admin setup for the Discord Live Companion Bot.
 * Walks the owner through: Discord portal app creation → bot install →
 * wiring the guild/channel/streamer identity → live verification. */

interface BotConfig {
  guild_id?: string | null;
  announce_channel_id?: string | null;
  announce_role_id?: string | null;
  mention_everyone?: boolean;
  streamer_discord_user_id?: string | null;
  streamer_discord_username?: string | null;
  enabled?: boolean;
}

interface ConfigResponse {
  config: BotConfig | null;
  env: {
    client_id_set: boolean;
    bot_token_set: boolean;
    shared_secret_set: boolean;
    guild_id_env: string;
    announce_channel_env: string;
  };
}

const PORTAL_STEPS = [
  {
    title: "Create the Discord application",
    body: "Open the Discord Developer Portal → New Application → name it “Bow Down Visuals”. Copy the Application ID (General Information) — that's your DISCORD_CLIENT_ID.",
  },
  {
    title: "Create the bot user",
    body: "Go to Bot → Reset Token → copy the token — that's DISCORD_BOT_TOKEN. No privileged intents needed; leave them off.",
  },
  {
    title: "Install the bot on your server",
    body: "Click “Install bot on your server” below (or paste your server, channel, and role IDs in the form). You need Manage Server permission.",
  },
  {
    title: "Set the environment variables",
    body: "On the bot service AND the api-server: DISCORD_CLIENT_ID, DISCORD_BOT_TOKEN (bot only), DISCORD_BOT_SHARED_SECRET (both, 32+ random chars — generate with `openssl rand -hex 32`).",
  },
  {
    title: "Run the database migration",
    body: "Run lib/db/migrations/0029_discord_bot.sql against production Postgres once, then deploy. The bot announces from your next Go Live.",
  },
];

export default function DiscordBotSetup() {
  usePageTitle("Discord Bot", "Wire up the Live Companion Bot: auto-announcements, watch parties, LIVE badge.");
  const { getAccessToken } = useAuth();
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [data, setData] = useState<ConfigResponse | null>(null);
  const [form, setForm] = useState<BotConfig>({});
  const [saving, setSaving] = useState(false);
  const [installUrl, setInstallUrl] = useState<string | null>(null);
  const [installError, setInstallError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  const authHeaders = useCallback(async (): Promise<HeadersInit> => {
    const token = await getAccessToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, [getAccessToken]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/admin/status", { headers: await authHeaders() });
        const status = (await res.json()) as { isAdmin?: boolean };
        if (!cancelled) setIsAdmin(res.ok && status.isAdmin === true);
        if (res.ok && status.isAdmin) {
          const cfgRes = await fetch("/api/discord-bot/config", { headers: await authHeaders() });
          if (cfgRes.ok) {
            const cfg = (await cfgRes.json()) as ConfigResponse;
            if (!cancelled) {
              setData(cfg);
              setForm(cfg.config ?? {});
            }
          }
        }
      } catch {
        if (!cancelled) setIsAdmin(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authHeaders]);

  async function onInstall() {
    setInstallError(null);
    try {
      const res = await fetch("/api/discord-bot/install-url", { headers: await authHeaders() });
      const body = (await res.json()) as { install_url?: string; error?: string };
      if (!res.ok || !body.install_url) {
        setInstallError(body.error ?? "Could not build the install URL — is DISCORD_CLIENT_ID set on the server?");
        return;
      }
      setInstallUrl(body.install_url);
      window.open(body.install_url, "_blank", "noopener");
    } catch {
      setInstallError("Could not build the install URL. Try again.");
    }
  }

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaved(false);
    try {
      const res = await fetch("/api/discord-bot/config", {
        method: "POST",
        headers: { "content-type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify(form),
      });
      if (res.ok) setSaved(true);
    } finally {
      setSaving(false);
    }
  }

  function set<K extends keyof BotConfig>(key: K, value: BotConfig[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  if (isAdmin === null) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-[#d4af37]" />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center">
        <ShieldAlert className="mx-auto mb-4 h-10 w-10 text-[#d4af37]" />
        <h1 className="text-2xl font-bold">Admins only</h1>
        <p className="mt-2 text-muted-foreground">The Discord bot setup is only available to the site owner.</p>
      </div>
    );
  }

  const env = data?.env;

  return (
    <div className="mx-auto max-w-4xl space-y-8 px-4 py-10">
      <div className="flex items-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#5865F2]/15 text-[#5865F2]">
          <Bot className="h-6 w-6" />
        </div>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            Discord <span className="text-[#d4af37]">Live Companion Bot</span>
          </h1>
          <p className="text-muted-foreground">Go live on Discord — the bot handles announcements, watch parties, and the site LIVE badge.</p>
        </div>
      </div>

      {/* Environment status */}
      <Card className="lux-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><PlugZap className="h-5 w-5 text-[#d4af37]" /> Server status</CardTitle>
          <CardDescription>What the api-server can see right now.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <EnvBadge ok={env?.client_id_set} label="DISCORD_CLIENT_ID" />
          <EnvBadge ok={env?.bot_token_set} label="DISCORD_BOT_TOKEN" />
          <EnvBadge ok={env?.shared_secret_set} label="DISCORD_BOT_SHARED_SECRET" />
        </CardContent>
      </Card>

      {/* Install */}
      <Card className="lux-card">
        <CardHeader>
          <CardTitle>1 · Install the bot on your server</CardTitle>
          <CardDescription>Opens Discord's OAuth2 authorize page with the bot + slash-command scopes pre-selected.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button onClick={onInstall} className="bg-[#5865F2] text-white hover:bg-[#4752C4]">
            <ExternalLink className="mr-2 h-4 w-4" /> Install bot on your server
          </Button>
          {installUrl && (
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(installUrl);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
              className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? "Copied!" : "Copy install link"}
            </button>
          )}
          {installError && <p className="text-sm text-red-500">{installError}</p>}
        </CardContent>
      </Card>

      {/* Wiring form */}
      <Card className="lux-card">
        <CardHeader>
          <CardTitle>2 · Wire up the announcements</CardTitle>
          <CardDescription>Tell the bot where to announce and who to watch. Right-click in Discord with Developer Mode on to copy IDs.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSave} className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-1.5">
              <span className="text-sm font-medium">Server (guild) ID</span>
              <Input value={form.guild_id ?? env?.guild_id_env ?? ""} onChange={(e) => set("guild_id", e.target.value)} placeholder="123456789012345678" />
            </label>
            <label className="space-y-1.5">
              <span className="text-sm font-medium">Announcements channel ID</span>
              <Input value={form.announce_channel_id ?? env?.announce_channel_env ?? ""} onChange={(e) => set("announce_channel_id", e.target.value)} placeholder="123456789012345678" />
            </label>
            <label className="space-y-1.5">
              <span className="text-sm font-medium">Role ID to ping <span className="text-muted-foreground">(optional)</span></span>
              <Input value={form.announce_role_id ?? ""} onChange={(e) => set("announce_role_id", e.target.value)} placeholder="Role for live notifications" />
            </label>
            <label className="space-y-1.5">
              <span className="text-sm font-medium">Your Discord user ID <span className="text-muted-foreground">(the streamer)</span></span>
              <Input value={form.streamer_discord_user_id ?? ""} onChange={(e) => set("streamer_discord_user_id", e.target.value)} placeholder="Your user ID" />
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.mention_everyone ?? false}
                onChange={(e) => set("mention_everyone", e.target.checked)}
                className="h-4 w-4 accent-[#d4af37]"
              />
              Ping @everyone on go-live (instead of a role)
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.enabled ?? true}
                onChange={(e) => set("enabled", e.target.checked)}
                className="h-4 w-4 accent-[#d4af37]"
              />
              Bot announcements enabled
            </label>
            <div className="sm:col-span-2">
              <Button type="submit" disabled={saving} className="gold-glow">
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Save configuration
              </Button>
              {saved && <span className="ml-3 text-sm text-green-500">Saved ✓</span>}
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Setup steps */}
      <Card className="lux-card">
        <CardHeader>
          <CardTitle>3 · One-time setup checklist</CardTitle>
          <CardDescription>Everything the bot needs to run in production.</CardDescription>
        </CardHeader>
        <CardContent>
          <ol className="space-y-4">
            {PORTAL_STEPS.map((step, i) => (
              <li key={i} className="flex gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#d4af37]/15 text-sm font-bold text-[#d4af37]">
                  {i + 1}
                </span>
                <div>
                  <p className="font-medium">{step.title}</p>
                  <p className="text-sm text-muted-foreground">{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
          <div className="mt-6 rounded-xl border border-[#d4af37]/30 bg-[#d4af37]/5 p-4 text-sm">
            <p className="font-medium text-[#d4af37]">Slash commands your community gets</p>
            <ul className="mt-2 space-y-1 text-muted-foreground">
              <li><code className="text-foreground">/live</code> — is Thy Cheat Code live right now?</li>
              <li><code className="text-foreground">/next</code> — next scheduled stream</li>
              <li><code className="text-foreground">/socials</code> — all the links</li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function EnvBadge({ ok, label }: { ok?: boolean; label: string }) {
  return (
    <Badge variant={ok ? "default" : "destructive"} className={ok ? "bg-green-600/15 text-green-500 border-green-600/30" : ""}>
      {ok ? <Check className="mr-1 h-3 w-3" /> : null}
      {label}: {ok ? "set" : "missing"}
    </Badge>
  );
}
