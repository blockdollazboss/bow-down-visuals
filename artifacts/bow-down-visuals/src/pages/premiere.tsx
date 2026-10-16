import { useCallback, useEffect, useRef, useState } from "react";
import { useRoute, Link } from "wouter";
import { CalendarClock, Clapperboard, Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { usePageTitle } from "@/hooks/use-page-title";
import LiveChatPanel from "@/components/live/LiveChatPanel";
import { reachApi, type PremiereDto } from "@/lib/reach-api";

/* ── /premiere/:id — a scheduled first showing (Stack 9 #2) ─────────────
   Before the start: an honest countdown (the video is NOT served
   early). At the start time it plays as a live event — playback
   position comes from the server clock, so late joiners land
   mid-video, exactly where everyone else is. The chat room rides
   the live chat machinery. After it ends, this page is the normal
   watch page for the video. It is always labelled "Premiere" —
   never dressed up as a live camera broadcast. */

export default function PremierePage() {
  const [, params] = useRoute("/premiere/:id");
  const id = params?.id ?? "";
  const { getAccessToken } = useAuth();
  const [premiere, setPremiere] = useState<PremiereDto | null>(null);
  const [load, setLoad] = useState<"loading" | "ready" | "error" | "notfound">("loading");
  const [nowMs, setNowMs] = useState(() => Date.now());
  const videoRef = useRef<HTMLVideoElement>(null);
  const syncedRef = useRef(false);

  usePageTitle(premiere ? `${premiere.title} — Premiere` : "Premiere", "A scheduled first showing on Bow Down Visuals.");

  const fetchPremiere = useCallback(async () => {
    try {
      const d = await reachApi.getPremiere(getAccessToken, id);
      setPremiere(d.premiere);
      setLoad("ready");
      return d.premiere;
    } catch (e) {
      if (e instanceof Error && /404|doesn't exist/i.test(e.message)) setLoad("notfound");
      else setLoad("error");
      return null;
    }
  }, [getAccessToken, id]);

  useEffect(() => {
    void fetchPremiere();
    const poll = setInterval(() => void fetchPremiere(), 10_000);
    const tick = setInterval(() => setNowMs(Date.now()), 1000);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [fetchPremiere]);

  /* Retention heartbeat (Stack 10 #8): real playback positions only,
     every 5s while playing plus on pause/end, signed-in viewers only.
     This is the collection the analytics retention curves are built
     from — videos nobody plays this way honestly read "no data". */
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !premiere?.clipId) return;
    let last = -1;
    const beat = async () => {
      if (video.paused && last >= 0 && Math.abs(video.currentTime - last) < 0.1) return;
      last = video.currentTime;
      try {
        const t = await getAccessToken();
        if (!t) return;
        await fetch("/api/analytics/retention/heartbeat", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` },
          body: JSON.stringify({ videoId: premiere.clipId, positionSeconds: Math.round(video.currentTime), durationSeconds: Math.max(1, Math.round(video.duration || premiere.durationSeconds || 0)) }),
        });
      } catch { /* a missed heartbeat is just a missed heartbeat */ }
    };
    const iv = setInterval(() => { if (!video.paused) void beat(); }, 5000);
    const onPause = () => void beat();
    video.addEventListener("pause", onPause);
    video.addEventListener("ended", onPause);
    return () => { clearInterval(iv); video.removeEventListener("pause", onPause); video.removeEventListener("ended", onPause); };
  }, [premiere?.clipId, premiere?.durationSeconds, getAccessToken]);

  /* Watch-together sync: when the premiere is live, the player starts
     at the server's position and re-syncs if it drifts > 3s. */
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !premiere || premiere.phase !== "live") return;
    const target = premiere.positionSeconds;
    if (!syncedRef.current) {
      video.currentTime = target;
      syncedRef.current = true;
      void video.play().catch(() => undefined);
      return;
    }
    if (Math.abs(video.currentTime - target) > 3) video.currentTime = target;
  }, [premiere]);

  if (load === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-black text-white">
        <Loader2 className="h-8 w-8 animate-spin text-amber-400" />
      </div>
    );
  }
  if (load === "notfound" || !premiere) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-black p-6 text-center text-white">
        <Clapperboard className="h-10 w-10 text-[#C9A84C]/60" />
        <p className="font-bold">That premiere doesn't exist.</p>
        <Link href="/home" className="text-sm text-[#e8c86a] underline">Back to the feed</Link>
      </div>
    );
  }
  if (load === "error") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-black p-6 text-center text-white">
        <p className="font-bold">The premiere couldn't load.</p>
        <button type="button" onClick={() => void fetchPremiere()} className="rounded-full bg-amber-400 px-5 py-2 text-sm font-bold text-black">Try again</button>
      </div>
    );
  }

  const startMs = premiere.scheduledAt ? new Date(premiere.scheduledAt).getTime() : 0;
  const remaining = Math.max(0, Math.floor((startMs - nowMs) / 1000));
  const hh = Math.floor(remaining / 3600);
  const mm = Math.floor((remaining % 3600) / 60);
  const ss = remaining % 60;

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="mx-auto max-w-7xl px-4 py-8 md:px-8">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[#C9A84C] px-3 py-1 text-xs font-black uppercase tracking-wider text-black">
          <Clapperboard className="h-3.5 w-3.5" /> Premiere
        </span>
        <h1 className="mt-3 text-2xl font-black tracking-tight">{premiere.title}</h1>
        {premiere.creator && (
          <p className="mt-1 text-sm text-white/50">
            by <Link href={`/artist/${premiere.creator.slug}`} className="text-[#e8c86a]">{premiere.creator.displayName}</Link>
          </p>
        )}
        <div className="mt-5 flex flex-col gap-5 lg:flex-row">
          <div className="min-w-0 flex-1">
            <div className="relative aspect-video w-full overflow-hidden rounded-2xl border border-[#C9A84C]/25 bg-black">
              {premiere.phase === "scheduled" && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
                  <CalendarClock className="h-10 w-10 text-[#C9A84C]/70" />
                  <p className="text-lg font-black">The premiere starts in</p>
                  <p className="font-mono text-4xl font-black tabular-nums text-[#e8c86a]">
                    {hh > 0 ? `${hh}:` : ""}{String(mm).padStart(2, "0")}:{String(ss).padStart(2, "0")}
                  </p>
                  <p className="max-w-sm text-xs text-white/40">
                    {premiere.scheduledAt ? new Date(premiere.scheduledAt).toLocaleString() : ""} — everyone watches together from the first second. The video isn't playable before the start.
                  </p>
                </div>
              )}
              {premiere.phase === "cancelled" && (
                <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-white/60">This premiere was cancelled by the creator.</div>
              )}
              {(premiere.phase === "live" || premiere.phase === "ended") && premiere.videoUrl && (
                <video ref={videoRef} src={premiere.videoUrl} controls={premiere.phase === "ended"} playsInline className="h-full w-full object-contain" data-testid="premiere-player" />
              )}
              {premiere.phase === "live" && (
                <span className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-[#C9A84C] px-3 py-1 text-xs font-black uppercase tracking-wider text-black">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-black" /> Premiere — playing now
                </span>
              )}
            </div>
            {premiere.phase === "ended" && <p className="mt-3 text-sm text-white/50">The premiere has ended — this is now the regular watch page for the video. Thanks for watching it together.</p>}
            {premiere.phase === "live" && <p className="mt-3 text-sm text-white/50">Everyone is watching at the same moment — if you just arrived, you're joining mid-video, right where the premiere is.</p>}
          </div>
          {premiere.chatStreamId ? (
            <LiveChatPanel streamId={premiere.chatStreamId} className="h-[440px] shrink-0 lg:h-auto lg:w-[340px]" />
          ) : (
            <div className="flex h-[200px] shrink-0 items-center justify-center rounded-2xl border border-white/10 p-4 text-center text-sm text-white/40 lg:w-[340px]">
              Chat opens when the premiere starts.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Schedule-a-premiere form (used on the premieres strip) ─────────── */
export function SchedulePremiereForm({ onScheduled }: { onScheduled?: (p: PremiereDto) => void }) {
  const { getAccessToken } = useAuth();
  const [clips, setClips] = useState<Array<{ id: string; title: string | null; status: string }>>([]);
  const [clipId, setClipId] = useState("");
  const [title, setTitle] = useState("");
  const [duration, setDuration] = useState("180");
  const [when, setWhen] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const token = await getAccessToken();
        const res = await fetch("/api/generated-clips", { headers: { Authorization: `Bearer ${token ?? ""}` } });
        if (!res.ok) throw new Error("load failed");
        const data = (await res.json()) as { clips: Array<{ id: string; title: string | null; status: string }> };
        setClips((data.clips ?? []).filter((c) => c.status === "completed"));
      } catch {
        setLoadError("Your finished videos couldn't load, so a premiere can't be scheduled right now.");
      }
    })();
  }, [getAccessToken]);

  return (
    <form
      className="rounded-2xl border border-white/10 bg-[#0d0d0d] p-5 text-white"
      onSubmit={async (e) => {
        e.preventDefault();
        setNote(null);
        try {
          const d = await reachApi.createPremiere(getAccessToken, {
            clipId,
            title: title.trim(),
            durationSeconds: Number(duration),
            scheduledAt: new Date(when).toISOString(),
          });
          setNote("Premiere scheduled — share its page and everyone watches together at the start time.");
          onScheduled?.(d.premiere);
        } catch (err) {
          setNote(err instanceof Error ? err.message : "That premiere couldn't be scheduled.");
        }
      }}
    >
      <h2 className="flex items-center gap-2 text-lg font-black"><Clapperboard className="h-5 w-5 text-[#e8c86a]" /> Schedule a premiere</h2>
      <p className="mt-1 text-sm text-white/50">A finished video, shown first at a set time — countdown, live chat, everyone in sync. After it ends it's a normal watch page.</p>
      {loadError && <p className="mt-3 text-sm text-red-300">{loadError}</p>}
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <select value={clipId} onChange={(e) => setClipId(e.target.value)} className="rounded-lg border border-white/15 bg-black px-3 py-2 text-sm focus:border-[#e8c86a] focus:outline-none">
          <option value="">Pick a finished video…</option>
          {clips.map((c) => (
            <option key={c.id} value={c.id}>{c.title ?? "Untitled video"}</option>
          ))}
        </select>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Premiere title" className="rounded-lg border border-white/15 bg-black px-3 py-2 text-sm focus:border-[#e8c86a] focus:outline-none" />
        <label className="text-xs text-white/50">
          Video length (seconds)
          <input type="number" min={10} max={14400} value={duration} onChange={(e) => setDuration(e.target.value)} className="mt-1 w-full rounded-lg border border-white/15 bg-black px-3 py-2 text-sm text-white focus:border-[#e8c86a] focus:outline-none" />
        </label>
        <label className="text-xs text-white/50">
          Starts at
          <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className="mt-1 w-full rounded-lg border border-white/15 bg-black px-3 py-2 text-sm text-white focus:border-[#e8c86a] focus:outline-none" />
        </label>
      </div>
      <button type="submit" disabled={!clipId || !title.trim() || !when} className="mt-4 rounded-full bg-[#e8c86a] px-5 py-2 text-sm font-bold text-black transition enabled:hover:scale-[1.02] disabled:opacity-50">
        Schedule premiere
      </button>
      {note && <p className="mt-3 text-sm text-white/60">{note}</p>}
    </form>
  );
}
