import { useEffect, useState } from "react";
import { Radio } from "lucide-react";

/* Pulsing gold LIVE badge. Polls the bot-reported live state every 30s.
 * Rendered in the header whenever the streamer is live on Discord. */

interface LiveState {
  is_live: boolean;
  configured: boolean;
  started_at?: string | null;
  channel_name?: string | null;
  stream_title?: string | null;
}

export function LiveBadge() {
  const [live, setLive] = useState<LiveState | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const res = await fetch("/api/discord-bot/live");
        if (!res.ok) return;
        const data = (await res.json()) as LiveState;
        if (!cancelled) setLive(data);
      } catch {
        /* Bot not configured yet — badge stays hidden. */
      }
    }
    poll();
    const t = setInterval(poll, 30_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  if (!live?.is_live) return null;

  return (
    <div className="fixed right-4 top-4 z-40" data-testid="live-badge-wrap">
      <a
        href="/go-live"
        className="group inline-flex items-center gap-2 rounded-full border border-[#d4af37]/60 bg-black/85 px-3 py-1.5 text-xs font-semibold text-[#d4af37] shadow-[0_0_20px_rgba(212,175,55,0.35)] backdrop-blur transition hover:bg-[#d4af37]/20"
        title={live.stream_title ?? "Live on Discord"}
        data-testid="live-badge"
      >
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
      </span>
      <Radio className="h-3.5 w-3.5" />
      LIVE{live.channel_name ? ` — ${live.channel_name}` : ""}
      </a>
    </div>
  );
}
