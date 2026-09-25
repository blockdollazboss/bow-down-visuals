import { useCallback, useEffect, useState } from "react";
import { Link } from "wouter";
import {
  Radio, Square, Loader2, CheckCircle2, AlertTriangle, CalendarPlus,
  Trash2, ArrowLeft, Bell, BellOff, Clock, Gamepad2,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { usePageTitle } from "@/hooks/use-page-title";

/* ─── Go Live — Discord stream dashboard ──────────────────────────────────
   The user's community hub is their Discord server (they stream via Go Live).
   This page is mission control:
   - Stream title + game/content input
   - "Announce to Discord" (posts a rich gold LIVE NOW embed via webhook)
   - "End Stream" (posts a stream-ended embed, optional VOD link)
   - Schedule upcoming streams + see recent history
   Posting is pure integration (one outbound HTTP call, no AI compute) so it
   is FREE under the pricing rule. The site never touches Discord voice/video
   — the user still hits Go Live in Discord itself; this handles the hype. */

interface DiscordStatus {
  configured: boolean;
  channel_name: string | null;
  mention_everyone: boolean;
  crypto_ready: boolean;
}

interface Stream {
  id: string;
  title: string;
  game: string | null;
  status: "scheduled" | "live" | "ended";
  scheduled_for: string | null;
  started_at: string | null;
  ended_at: string | null;
  vod_url: string | null;
}

export default function GoLive() {
  usePageTitle("Go Live", "Stream dashboard — announce your Discord streams and hype your community.");
  const { getAccessToken } = useAuth();
  const { toast } = useToast();
  const [status, setStatus] = useState<DiscordStatus | null>(null);
  const [streams, setStreams] = useState<Stream[]>([]);
  const [title, setTitle] = useState("");
  const [game, setGame] = useState("");
  const [vodUrl, setVodUrl] = useState("");
  const [mentionEveryone, setMentionEveryone] = useState(false);
  const [announcing, setAnnouncing] = useState(false);
  const [ending, setEnding] = useState(false);
  const [schedTitle, setSchedTitle] = useState("");
  const [schedGame, setSchedGame] = useState("");
  const [schedWhen, setSchedWhen] = useState("");
  const [scheduling, setScheduling] = useState(false);

  const authed = useCallback(async (): Promise<Record<string, string>> => {
    const token = await getAccessToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, [getAccessToken]);

  const load = useCallback(async () => {
    const headers = await authed();
    const [sRes, stRes] = await Promise.all([
      fetch("/api/discord/status", { headers }),
      fetch("/api/discord/streams", { headers }),
    ]);
    if (sRes.ok) {
      const s: DiscordStatus = await sRes.json();
      setStatus(s);
      setMentionEveryone(s.mention_everyone);
    }
    if (stRes.ok) {
      const d = await stRes.json();
      setStreams(d.streams ?? []);
    }
  }, [authed]);

  useEffect(() => { load(); }, [load]);

  const liveStream = streams.find((s) => s.status === "live") ?? null;
  const upcoming = streams.filter((s) => s.status === "scheduled");
  const recent = streams.filter((s) => s.status === "ended").slice(0, 5);

  async function announce(kind: "live" | "ended" | "video", extra: Record<string, string> = {}) {
    const headers = await authed();
    const res = await fetch("/api/discord/announce", {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        kind,
        title: extra.title || title || "Untitled stream",
        game: game || undefined,
        mention_everyone: mentionEveryone,
        ...extra,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to post to Discord.");
    return data;
  }

  async function handleGoLive() {
    if (!title.trim()) {
      toast({ title: "Give your stream a title", description: "Your Discord crew needs to know what they're pulling up for.", variant: "destructive" });
      return;
    }
    setAnnouncing(true);
    try {
      await announce("live");
      toast({ title: "You're live! 🔴", description: "The announcement just dropped in your Discord." });
      setTitle("");
      setGame("");
      await load();
    } catch (e) {
      toast({ title: "Couldn't announce", description: e instanceof Error ? e.message : "Try again.", variant: "destructive" });
    } finally {
      setAnnouncing(false);
    }
  }

  async function handleEndStream() {
    setEnding(true);
    try {
      await announce("ended", {
        title: liveStream?.title || title || "Stream",
        ...(vodUrl.trim() ? { vod_url: vodUrl.trim() } : {}),
      });
      toast({ title: "Stream wrapped 🎬", description: "Your Discord got the sign-off." });
      setVodUrl("");
      await load();
    } catch (e) {
      toast({ title: "Couldn't post the sign-off", description: e instanceof Error ? e.message : "Try again.", variant: "destructive" });
    } finally {
      setEnding(false);
    }
  }

  async function handleSchedule() {
    if (!schedTitle.trim()) {
      toast({ title: "Name the stream", description: "Give your upcoming stream a title.", variant: "destructive" });
      return;
    }
    setScheduling(true);
    try {
      const headers = await authed();
      const res = await fetch("/api/discord/streams", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          title: schedTitle.trim(),
          game: schedGame.trim() || undefined,
          scheduled_for: schedWhen ? new Date(schedWhen).toISOString() : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't schedule.");
      toast({ title: "Scheduled 📅", description: "It's on the board." });
      setSchedTitle(""); setSchedGame(""); setSchedWhen("");
      await load();
    } catch (e) {
      toast({ title: "Couldn't schedule", description: e instanceof Error ? e.message : "Try again.", variant: "destructive" });
    } finally {
      setScheduling(false);
    }
  }

  async function handleDeleteStream(id: string) {
    const headers = await authed();
    await fetch(`/api/discord/streams/${id}`, { method: "DELETE", headers });
    await load();
  }

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="max-w-4xl mx-auto px-5 md:px-8 py-10 space-y-8">
        <Link href="/dashboard" className="inline-flex items-center gap-1.5 text-white/40 hover:text-white text-sm transition-colors">
          <ArrowLeft className="h-4 w-4" /> Back to Dashboard
        </Link>

        <div>
          <h1 className="text-3xl md:text-4xl font-black tracking-tight">
            <span className="bg-gradient-to-r from-amber-200 via-yellow-400 to-amber-200 bg-clip-text text-transparent">Go Live</span>
          </h1>
          <p className="text-white/50 text-sm mt-2 max-w-xl">
            Hype up your Discord before you hit Go Live. Announcements are <span className="text-amber-300 font-semibold">free</span> —
            pure integration, no credits burned.
          </p>
        </div>

        {status && !status.configured && (
          <div className="rounded-xl border border-amber-400/30 bg-amber-400/[0.06] p-4 flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-amber-300 shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-bold text-amber-200">No Discord webhook connected</p>
              <p className="text-white/50 mt-1">
                Head to <Link href="/settings" className="text-amber-300 underline underline-offset-2">Settings → Discord</Link> and
                paste your channel's webhook URL. Takes 30 seconds.
              </p>
            </div>
          </div>
        )}

        {/* ── Announce panel ── */}
        <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-5 md:p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold flex items-center gap-2">
              <Radio className="h-5 w-5 text-amber-300" />
              Stream announcement
            </h2>
            {liveStream && (
              <span className="inline-flex items-center gap-1.5 text-xs font-bold text-red-400 bg-red-500/10 border border-red-500/30 rounded-full px-3 py-1">
                <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse" /> LIVE: {liveStream.title}
              </span>
            )}
          </div>

          <div className="grid md:grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-bold text-white/60 uppercase tracking-wider">Stream title</span>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Friday Night Beats — making the anthem"
                className="mt-1.5 w-full rounded-xl bg-black/60 border border-white/10 px-4 py-2.5 text-sm placeholder:text-white/25 focus:outline-none focus:border-amber-400/60"
                data-testid="input-stream-title"
              />
            </label>
            <label className="block">
              <span className="text-xs font-bold text-white/60 uppercase tracking-wider">Game / content</span>
              <div className="relative mt-1.5">
                <Gamepad2 className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-white/30" />
                <input
                  value={game}
                  onChange={(e) => setGame(e.target.value)}
                  placeholder="Music production, Just Chatting…"
                  className="w-full rounded-xl bg-black/60 border border-white/10 pl-10 pr-4 py-2.5 text-sm placeholder:text-white/25 focus:outline-none focus:border-amber-400/60"
                  data-testid="input-stream-game"
                />
              </div>
            </label>
          </div>

          <label className="flex items-center gap-2.5 text-sm text-white/70 cursor-pointer select-none">
            <button
              type="button"
              role="switch"
              aria-checked={mentionEveryone}
              onClick={() => setMentionEveryone((v) => !v)}
              className={`w-10 h-6 rounded-full transition-colors relative ${mentionEveryone ? "bg-amber-400" : "bg-white/10"}`}
              data-testid="toggle-mention-everyone"
            >
              <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-black transition-all ${mentionEveryone ? "left-[18px]" : "left-0.5"}`} />
            </button>
            {mentionEveryone ? <Bell className="h-4 w-4 text-amber-300" /> : <BellOff className="h-4 w-4 text-white/30" />}
            Ping <span className="font-mono font-bold text-amber-200">@everyone</span> in the announcement
          </label>

          <div className="flex flex-wrap gap-3">
            <Button
              onClick={handleGoLive}
              disabled={announcing || !status?.configured}
              className="gold-glow gap-2"
              data-testid="btn-announce-live"
            >
              {announcing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Radio className="h-4 w-4" />}
              Announce to Discord
            </Button>
            <div className="flex gap-2 flex-1 min-w-[240px]">
              <input
                value={vodUrl}
                onChange={(e) => setVodUrl(e.target.value)}
                placeholder="VOD link (optional, for the sign-off)"
                className="flex-1 rounded-xl bg-black/60 border border-white/10 px-4 py-2 text-sm placeholder:text-white/25 focus:outline-none focus:border-amber-400/60"
                data-testid="input-vod-url"
              />
              <Button
                onClick={handleEndStream}
                disabled={ending || !status?.configured}
                variant="outline"
                className="gap-2 border-white/15"
                data-testid="btn-end-stream"
              >
                {ending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Square className="h-4 w-4" />}
                End Stream
              </Button>
            </div>
          </div>
          <p className="text-[11px] text-white/30">
            This posts the announcement embed — you still hit Go Live inside Discord itself when you're ready.
          </p>
        </section>

        {/* ── Schedule ── */}
        <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-5 md:p-6 space-y-4">
          <h2 className="text-lg font-bold flex items-center gap-2">
            <CalendarPlus className="h-5 w-5 text-amber-300" />
            Schedule a stream
          </h2>
          <div className="grid md:grid-cols-3 gap-3">
            <input
              value={schedTitle}
              onChange={(e) => setSchedTitle(e.target.value)}
              placeholder="Stream title"
              className="rounded-xl bg-black/60 border border-white/10 px-4 py-2.5 text-sm placeholder:text-white/25 focus:outline-none focus:border-amber-400/60"
              data-testid="input-sched-title"
            />
            <input
              value={schedGame}
              onChange={(e) => setSchedGame(e.target.value)}
              placeholder="Game / content (optional)"
              className="rounded-xl bg-black/60 border border-white/10 px-4 py-2.5 text-sm placeholder:text-white/25 focus:outline-none focus:border-amber-400/60"
              data-testid="input-sched-game"
            />
            <input
              type="datetime-local"
              value={schedWhen}
              onChange={(e) => setSchedWhen(e.target.value)}
              className="rounded-xl bg-black/60 border border-white/10 px-4 py-2.5 text-sm text-white/70 focus:outline-none focus:border-amber-400/60 [color-scheme:dark]"
              data-testid="input-sched-when"
            />
          </div>
          <Button onClick={handleSchedule} disabled={scheduling} variant="outline" className="gap-2 border-amber-400/30 text-amber-200" data-testid="btn-schedule">
            {scheduling ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarPlus className="h-4 w-4" />}
            Schedule
          </Button>

          {upcoming.length > 0 && (
            <div className="space-y-2 pt-2">
              <p className="text-xs font-bold text-white/50 uppercase tracking-wider">Upcoming</p>
              {upcoming.map((s) => (
                <div key={s.id} className="flex items-center justify-between rounded-xl border border-amber-400/20 bg-amber-400/[0.04] px-4 py-3">
                  <div className="min-w-0">
                    <p className="font-bold text-sm truncate">{s.title}</p>
                    <p className="text-xs text-white/40 flex items-center gap-1.5 mt-0.5">
                      <Clock className="h-3 w-3" />
                      {s.scheduled_for ? new Date(s.scheduled_for).toLocaleString() : "No date set"}
                      {s.game && <span className="text-white/25">· {s.game}</span>}
                    </p>
                  </div>
                  <button
                    onClick={() => handleDeleteStream(s.id)}
                    className="text-white/30 hover:text-red-400 transition-colors p-1.5"
                    aria-label={`Cancel ${s.title}`}
                    data-testid={`btn-cancel-stream-${s.id}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ── Recent ── */}
        {recent.length > 0 && (
          <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-5 md:p-6 space-y-3">
            <h2 className="text-lg font-bold flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-amber-300" />
              Recent streams
            </h2>
            {recent.map((s) => (
              <div key={s.id} className="flex items-center justify-between rounded-xl border border-white/5 bg-black/40 px-4 py-3">
                <div className="min-w-0">
                  <p className="font-bold text-sm truncate">{s.title}</p>
                  <p className="text-xs text-white/40 mt-0.5">
                    {s.ended_at ? new Date(s.ended_at).toLocaleDateString() : ""}
                    {s.game && <span className="text-white/25"> · {s.game}</span>}
                  </p>
                </div>
                {s.vod_url && (
                  <a href={s.vod_url} target="_blank" rel="noopener noreferrer" className="text-xs text-amber-300 underline underline-offset-2 shrink-0 ml-3">
                    Watch VOD
                  </a>
                )}
              </div>
            ))}
          </section>
        )}
      </div>
    </div>
  );
}
