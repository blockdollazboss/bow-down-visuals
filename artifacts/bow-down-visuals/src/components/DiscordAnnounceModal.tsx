import { useEffect, useState } from "react";
import { X, Loader2, Send, CheckCircle2, Bell, BellOff, AlertTriangle } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";

/* Announce-to-Discord composer. Opens from FinalVideoExport after a
   successful export. Posts a gold "new video" embed to the user's Discord
   server via their saved webhook. Free under the pricing rule — pure
   integration, no AI compute. */

interface Props {
  open: boolean;
  onClose: () => void;
  videoUrl: string;
  videoTitle?: string;
}

export function DiscordAnnounceModal({ open, onClose, videoUrl, videoTitle }: Props) {
  const { getAccessToken } = useAuth();
  const { toast } = useToast();
  const [title, setTitle] = useState(videoTitle || "Fresh heat just dropped 🔥");
  const [mentionEveryone, setMentionEveryone] = useState(false);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTitle(videoTitle || "Fresh heat just dropped 🔥");
    setSent(false);
    setError(null);
    (async () => {
      const token = await getAccessToken();
      const res = await fetch("/api/discord/status", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (res.ok) {
        const s = await res.json();
        setConfigured(s.configured);
        setMentionEveryone(s.mention_everyone);
      } else {
        setConfigured(false);
      }
    })();
  }, [open, videoTitle, getAccessToken]);

  if (!open) return null;

  async function handleSend() {
    setSending(true);
    setError(null);
    try {
      const token = await getAccessToken();
      const res = await fetch("/api/discord/announce", {
        method: "POST",
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "video",
          title: title.trim() || "New video",
          video_url: videoUrl,
          mention_everyone: mentionEveryone,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't post to Discord.");
      setSent(true);
      toast({ title: "Announced! 🎉", description: "Your Discord server just got the drop." });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm" data-testid="discord-announce-modal">
      <div className="w-full max-w-md rounded-2xl border border-amber-400/25 bg-[#0a0a0a] p-6 space-y-4 shadow-2xl">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-black">
            <span className="bg-gradient-to-r from-amber-200 via-yellow-400 to-amber-200 bg-clip-text text-transparent">
              Announce to Discord
            </span>
          </h3>
          <button onClick={onClose} className="text-white/40 hover:text-white transition-colors" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        {configured === false && (
          <div className="rounded-xl border border-amber-400/30 bg-amber-400/[0.06] p-3.5 flex items-start gap-2.5 text-sm">
            <AlertTriangle className="h-4.5 w-4.5 text-amber-300 shrink-0 mt-0.5" />
            <p className="text-white/60">
              No Discord webhook connected yet.{" "}
              <a href="/settings" className="text-amber-300 underline underline-offset-2">Connect one in Settings</a>,
              then come back and hype the drop.
            </p>
          </div>
        )}

        {configured !== false && (
          <>
            <label className="block">
              <span className="text-xs font-bold text-white/60 uppercase tracking-wider">Announcement title</span>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={200}
                className="mt-1.5 w-full rounded-xl bg-black/60 border border-white/10 px-4 py-2.5 text-sm placeholder:text-white/25 focus:outline-none focus:border-amber-400/60"
                data-testid="input-announce-title"
              />
            </label>

            <label className="flex items-center gap-2.5 text-sm text-white/70 cursor-pointer select-none">
              <button
                type="button"
                role="switch"
                aria-checked={mentionEveryone}
                onClick={() => setMentionEveryone((v) => !v)}
                className={`w-10 h-6 rounded-full transition-colors relative ${mentionEveryone ? "bg-amber-400" : "bg-white/10"}`}
                data-testid="toggle-announce-everyone"
              >
                <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-black transition-all ${mentionEveryone ? "left-[18px]" : "left-0.5"}`} />
              </button>
              {mentionEveryone ? <Bell className="h-4 w-4 text-amber-300" /> : <BellOff className="h-4 w-4 text-white/30" />}
              Ping <span className="font-mono font-bold text-amber-200">@everyone</span>
            </label>

            {error && <p className="text-sm text-red-400">{error}</p>}
            {sent && (
              <p className="flex items-center gap-2 text-sm text-emerald-300">
                <CheckCircle2 className="h-4 w-4" /> Posted to your Discord!
              </p>
            )}

            <div className="flex gap-2.5">
              <Button onClick={handleSend} disabled={sending || sent} className="gold-glow flex-1 gap-2" data-testid="btn-send-announcement">
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                {sent ? "Announced" : "Announce — free"}
              </Button>
              <Button onClick={onClose} variant="outline" className="border-white/15">Close</Button>
            </div>
            <p className="text-[11px] text-white/30 text-center">Posting to Discord is always free — no credits.</p>
          </>
        )}
      </div>
    </div>
  );
}
