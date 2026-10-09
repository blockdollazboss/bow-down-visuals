import { useCallback, useEffect, useState } from "react";
import { Link } from "wouter";
import {
  Radio, Square, Loader2, CheckCircle2, AlertTriangle, CalendarPlus,
  Trash2, ArrowLeft, Bell, BellOff, Clock, Gamepad2,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { useTranslation } from "react-i18next";
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

import ShowFinder from "@/pages/shows";
import DiscordBotSetup from "@/pages/discord-bot";
import LiveShopping from "@/pages/live-shopping";
import GamersHub from "@/pages/gamers";

type LiveTab = "golive" | "shows" | "discord" | "shopping" | "gamers";

function GoLiveMain() {
  const { t } = useTranslation();
  usePageTitle(t("goLive.pageTitle"), t("goLive.pageDescription"));
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
        title: extra.title || title || t("goLive.untitledStream"),
        game: game || undefined,
        mention_everyone: mentionEveryone,
        ...extra,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || t("goLive.failedToPostDiscord"));
    return data;
  }

  async function handleGoLive() {
    if (!title.trim()) {
      toast({ title: t("goLive.titleRequiredTitle"), description: t("goLive.titleRequiredDesc"), variant: "destructive" });
      return;
    }
    setAnnouncing(true);
    try {
      await announce("live");
      toast({ title: t("goLive.liveToastTitle"), description: t("goLive.liveToastDesc") });
      setTitle("");
      setGame("");
      await load();
    } catch (e) {
      toast({ title: t("goLive.couldntAnnounceTitle"), description: e instanceof Error ? e.message : t("goLive.tryAgain"), variant: "destructive" });
    } finally {
      setAnnouncing(false);
    }
  }

  async function handleEndStream() {
    setEnding(true);
    try {
      await announce("ended", {
        title: liveStream?.title || title || t("goLive.streamFallback"),
        ...(vodUrl.trim() ? { vod_url: vodUrl.trim() } : {}),
      });
      toast({ title: t("goLive.streamWrappedTitle"), description: t("goLive.streamWrappedDesc") });
      setVodUrl("");
      await load();
    } catch (e) {
      toast({ title: t("goLive.couldntSignoffTitle"), description: e instanceof Error ? e.message : t("goLive.tryAgain"), variant: "destructive" });
    } finally {
      setEnding(false);
    }
  }

  async function handleSchedule() {
    if (!schedTitle.trim()) {
      toast({ title: t("goLive.nameStreamTitle"), description: t("goLive.nameStreamDesc"), variant: "destructive" });
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
      if (!res.ok) throw new Error(data.error || t("goLive.couldntScheduleError"));
      toast({ title: t("goLive.scheduledTitle"), description: t("goLive.scheduledDesc") });
      setSchedTitle(""); setSchedGame(""); setSchedWhen("");
      await load();
    } catch (e) {
      toast({ title: t("goLive.couldntScheduleTitle"), description: e instanceof Error ? e.message : t("goLive.tryAgain"), variant: "destructive" });
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
          <ArrowLeft className="h-4 w-4" /> {t("goLive.backToDashboard")}
        </Link>

        <div>
          <h1 className="text-3xl md:text-4xl font-black tracking-tight">
            <span className="bg-gradient-to-r from-amber-200 via-yellow-400 to-amber-200 bg-clip-text text-transparent">{t("goLive.pageTitle")}</span>
          </h1>
          <p className="text-white/50 text-sm mt-2 max-w-xl">
            {t("goLive.hypeBefore")}<span className="text-amber-300 font-semibold">{t("goLive.hypeFree")}</span>{t("goLive.hypeAfter")}
          </p>
        </div>

        {status && !status.configured && (
          <div className="rounded-xl border border-amber-400/30 bg-amber-400/[0.06] p-4 flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-amber-300 shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-bold text-amber-200">{t("goLive.noWebhookTitle")}</p>
              <p className="text-white/50 mt-1">
                {t("goLive.webhookHelpBefore")}<Link href="/settings" className="text-amber-300 underline underline-offset-2">{t("goLive.webhookHelpLink")}</Link>{t("goLive.webhookHelpAfter")}
              </p>
            </div>
          </div>
        )}

        {/* ── Announce panel ── */}
        <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-5 md:p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold flex items-center gap-2">
              <Radio className="h-5 w-5 text-amber-300" />
              {t("goLive.streamAnnouncement")}
            </h2>
            {liveStream && (
              <span className="inline-flex items-center gap-1.5 text-xs font-bold text-red-400 bg-red-500/10 border border-red-500/30 rounded-full px-3 py-1">
                <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse" /> {t("goLive.liveBadge", { title: liveStream.title })}
              </span>
            )}
          </div>

          <div className="grid md:grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-bold text-white/60 uppercase tracking-wider">{t("goLive.streamTitleLabel")}</span>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t("goLive.streamTitlePlaceholder")}
                className="mt-1.5 w-full rounded-xl bg-black/60 border border-white/10 px-4 py-2.5 text-sm placeholder:text-white/25 focus:outline-none focus:border-amber-400/60"
                data-testid="input-stream-title"
              />
            </label>
            <label className="block">
              <span className="text-xs font-bold text-white/60 uppercase tracking-wider">{t("goLive.gameLabel")}</span>
              <div className="relative mt-1.5">
                <Gamepad2 className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-white/30" />
                <input
                  value={game}
                  onChange={(e) => setGame(e.target.value)}
                  placeholder={t("goLive.gamePlaceholder")}
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
            {t("goLive.pingBefore")}<span className="font-mono font-bold text-amber-200">@everyone</span>{t("goLive.pingAfter")}
          </label>

          <div className="flex flex-wrap gap-3">
            <Button
              onClick={handleGoLive}
              disabled={announcing || !status?.configured}
              className="gold-glow gap-2"
              data-testid="btn-announce-live"
            >
              {announcing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Radio className="h-4 w-4" />}
              {t("goLive.announceButton")}
            </Button>
            <div className="flex gap-2 flex-1 min-w-[240px]">
              <input
                value={vodUrl}
                onChange={(e) => setVodUrl(e.target.value)}
                placeholder={t("goLive.vodPlaceholder")}
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
                {t("goLive.endStreamButton")}
              </Button>
            </div>
          </div>
          <p className="text-[11px] text-white/30">
            {t("goLive.announceNote")}
          </p>
        </section>

        {/* ── Schedule ── */}
        <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-5 md:p-6 space-y-4">
          <h2 className="text-lg font-bold flex items-center gap-2">
            <CalendarPlus className="h-5 w-5 text-amber-300" />
            {t("goLive.scheduleStreamTitle")}
          </h2>
          <div className="grid md:grid-cols-3 gap-3">
            <input
              value={schedTitle}
              onChange={(e) => setSchedTitle(e.target.value)}
              placeholder={t("goLive.schedTitlePlaceholder")}
              className="rounded-xl bg-black/60 border border-white/10 px-4 py-2.5 text-sm placeholder:text-white/25 focus:outline-none focus:border-amber-400/60"
              data-testid="input-sched-title"
            />
            <input
              value={schedGame}
              onChange={(e) => setSchedGame(e.target.value)}
              placeholder={t("goLive.schedGamePlaceholder")}
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
            {t("goLive.scheduleButton")}
          </Button>

          {upcoming.length > 0 && (
            <div className="space-y-2 pt-2">
              <p className="text-xs font-bold text-white/50 uppercase tracking-wider">{t("goLive.upcoming")}</p>
              {upcoming.map((s) => (
                <div key={s.id} className="flex items-center justify-between rounded-xl border border-amber-400/20 bg-amber-400/[0.04] px-4 py-3">
                  <div className="min-w-0">
                    <p className="font-bold text-sm truncate">{s.title}</p>
                    <p className="text-xs text-white/40 flex items-center gap-1.5 mt-0.5">
                      <Clock className="h-3 w-3" />
                      {s.scheduled_for ? new Date(s.scheduled_for).toLocaleString() : t("goLive.noDateSet")}
                      {s.game && <span className="text-white/25">· {s.game}</span>}
                    </p>
                  </div>
                  <button
                    onClick={() => handleDeleteStream(s.id)}
                    className="text-white/30 hover:text-red-400 transition-colors p-1.5"
                    aria-label={t("goLive.cancelStreamAria", { title: s.title })}
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
              {t("goLive.recentStreams")}
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
                    {t("goLive.watchVod")}
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

/* ─── Tabbed wrapper ─── */
export default function GoLive() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<LiveTab>(() => {
    try {
      const q = new URLSearchParams(window.location.search).get("tab");
      if (q === "shows" || q === "discord" || q === "shopping" || q === "gamers") return q;
    } catch { /* non-browser — ignore */ }
    return "golive";
  });

  const TABS: Array<{ key: LiveTab; label: string }> = [
    { key: "golive", label: t("goLive.tabGoLive", { defaultValue: "Go Live" }) },
    { key: "shows", label: t("goLive.tabShows", { defaultValue: "Shows" }) },
    { key: "discord", label: t("goLive.tabDiscord", { defaultValue: "Discord" }) },
    { key: "shopping", label: t("goLive.tabShopping", { defaultValue: "Live Shopping" }) },
    { key: "gamers", label: t("goLive.tabGamers", { defaultValue: "Gamers" }) },
  ];

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="mx-auto max-w-5xl px-4 pt-8">
        <div className="flex flex-wrap justify-center gap-2 border-b border-white/[0.08] pb-4">
          {TABS.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`rounded-xl px-5 py-2.5 text-sm font-bold transition ${
                tab === key
                  ? "bg-gradient-to-br from-[#f7dd7f] to-[#C9A84C] text-black"
                  : "text-white/50 hover:text-white/80 border border-white/10"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {tab === "golive" ? <GoLiveMain /> : tab === "shows" ? <ShowFinder /> : tab === "discord" ? <DiscordBotSetup /> : tab === "shopping" ? <LiveShopping /> : <GamersHub />}
    </div>
  );
}
