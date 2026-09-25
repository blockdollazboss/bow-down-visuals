import { useEffect, useRef, useState } from "react";
import { X, Loader2, Sparkles, Send, CheckCircle2, ExternalLink, Gauge } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { OutOfCredits } from "@/components/OutOfCredits";
import type { SocialAccountInfo } from "./ConnectedAccounts";

/* Caption composer + publisher for the Instagram auto-post MVP.
   Opens from FinalVideoExport after a successful export. Publishing costs
   2 credits (charged by the backend, refunded if Instagram fails).

   Idempotency: one key is generated per composer session (when the modal
   opens) and reused for every publish click within it, so a double-click or
   a retry after a timeout replays the same server-side attempt instead of
   posting/charging twice. The key is also stashed in sessionStorage per
   video, so closing and reopening the composer in the same tab keeps
   reusing it — a lost success response still replays instead of double
   posting. A genuinely new post (reopened composer after a confirmed
   success) gets a fresh key. */

interface Props {
  open: boolean;
  onClose: () => void;
  videoUrl: string;
  accounts: SocialAccountInfo[];
}

const DEFAULT_CAPTION = "Just made this with @bowdownvisuals 🔥\n\n#musicvideo #contentcreator #aivideo";
const CAPTION_LIMIT = 2200;

const PROGRESS_STAGES = [
  "Creating the reel…",
  "Instagram is processing the video…",
  "Publishing to your Reels…",
];

export function InstagramPostModal({ open, onClose, videoUrl, accounts }: Props) {
  const { getAccessToken, refreshProfile } = useAuth();
  const { toast } = useToast();
  const [caption, setCaption] = useState(DEFAULT_CAPTION);
  const [accountId, setAccountId] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [permalink, setPermalink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  /* Idempotency key for this composer session — stable across retries so a
     double-click or a retry after a timeout replays one server attempt. */
  const idempotencyKey = useRef("");

  const usable = accounts.filter((a) => !a.expired);

  useEffect(() => {
    if (open) {
      setCaption(DEFAULT_CAPTION);
      setAccountId(usable[0]?.id ?? "");
      setAiLoading(false);
      setPublishing(false);
      setElapsed(0);
      setPermalink(null);
      setError(null);
      setOutOfCredits(false);
      /* Reuse a pending key for this video if the composer was closed
         mid-publish; otherwise mint a fresh one for this session. */
      const storageKey = `ig-publish-key:${videoUrl}`;
      let key = "";
      try {
        key = sessionStorage.getItem(storageKey) ?? "";
      } catch {
        key = "";
      }
      if (!key) {
        key = crypto.randomUUID();
        try {
          sessionStorage.setItem(storageKey, key);
        } catch {
          /* private mode — the in-memory ref still dedupes this session */
        }
      }
      idempotencyKey.current = key;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open ]);

  useEffect(() => {
    if (publishing) {
      timer.current = setInterval(() => setElapsed((e) => e + 1), 1000);
    } else if (timer.current) {
      clearInterval(timer.current);
      timer.current = null;
    }
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [publishing]);

  if (!open) return null;

  const stage = elapsed < 20 ? 0 : elapsed < 120 ? 1 : 2;

  async function generateAiCaption() {
    if (aiLoading) return;
    setAiLoading(true);
    setError(null);
    try {
      const token = await getAccessToken();
      const res = await fetch("/api/hook-studio", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ mode: "hooks", videoType: "music-promo", topic: "" }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 402 || data.error === "out_of_credits") {
        setOutOfCredits(true);
        refreshProfile();
        return;
      }
      if (!res.ok || !Array.isArray(data.hooks) || data.hooks.length === 0) {
        throw new Error(data.message || "Caption generation failed.");
      }
      setCaption(`${data.hooks[0]}\n\nMade with @bowdownvisuals 🔥\n#musicvideo #contentcreator #aivideo`);
      refreshProfile();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Caption generation failed.");
    } finally {
      setAiLoading(false);
    }
  }

  async function publish() {
    if (publishing || !accountId) return;
    setPublishing(true);
    setElapsed(0);
    setError(null);
    setOutOfCredits(false);
    setPermalink(null);
    try {
      const token = await getAccessToken();
      const res = await fetch("/api/social/instagram/publish", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          accountId,
          videoUrl,
          caption: caption.trim(),
          idempotencyKey: idempotencyKey.current,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 402 || data.error === "out_of_credits") {
        setOutOfCredits(true);
        refreshProfile();
        return;
      }
      if (res.status === 409 && data.error === "publish_in_progress") {
        /* Another attempt with this key is still running (double-click or a
           retry that raced the first request) — not an error, just wait. */
        setError("This post is already publishing — give it a minute, then check your Instagram.");
        return;
      }
      if (!res.ok) {
        throw new Error(data.message || "Couldn't publish to Instagram.");
      }
      setPermalink(data.permalink || null);
      /* Confirmed success: this intent is done, so a later composer session
         for the same video mints a fresh key (a deliberate repost). */
      try {
        sessionStorage.removeItem(`ig-publish-key:${videoUrl}`);
      } catch {
        /* ignore */
      }
      refreshProfile();
      toast({ title: "Posted to Instagram", description: "Your reel is live." });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't publish to Instagram.");
    } finally {
      setPublishing(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/75 backdrop-blur-sm" onClick={publishing ? undefined : onClose} />
      <div className="relative w-full max-w-lg rounded-2xl border border-primary/25 bg-[#0b0b0d] p-6 space-y-5 shadow-[0_0_60px_rgba(218,165,32,0.15)]">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-lg font-bold text-white">Post to Instagram</h3>
            <p className="text-xs text-white/40 mt-1">2 credits · publishes as a Reel</p>
          </div>
          {!publishing && (
            <button onClick={onClose} className="text-white/40 hover:text-white transition-colors" aria-label="Close">
              <X className="h-5 w-5" />
            </button>
          )}
        </div>

        {outOfCredits ? (
          <OutOfCredits />
        ) : permalink ? (
          <div className="space-y-4 text-center py-4">
            <CheckCircle2 className="h-12 w-12 text-primary mx-auto" />
            <p className="text-white font-bold">Your reel is live!</p>
            {permalink ? (
              <a
                href={permalink}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline font-medium"
              >
                View on Instagram <ExternalLink className="h-3.5 w-3.5" />
              </a>
            ) : (
              <p className="text-xs text-white/40">Posted — check your Instagram profile.</p>
            )}
            <div>
              <Button onClick={onClose} className="bg-primary hover:bg-primary/90 text-black font-bold">
                Done
              </Button>
            </div>
          </div>
        ) : (
          <>
            {usable.length > 1 && (
              <div>
                <label className="text-xs font-bold text-white/60 uppercase tracking-wider">Account</label>
                <select
                  value={accountId}
                  onChange={(e) => setAccountId(e.target.value)}
                  disabled={publishing}
                  className="mt-1.5 w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-sm text-white focus:outline-none focus:border-primary/50"
                >
                  {usable.map((a) => (
                    <option key={a.id} value={a.id} className="bg-black">
                      @{a.usernameMasked ?? a.username ?? "instagram"}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-white/60 uppercase tracking-wider">Caption</label>
                <div className="flex items-center gap-2">
                  <a
                    href="/hooks"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] text-white/40 hover:text-primary transition-colors"
                  >
                    <Gauge className="h-3 w-3" /> Score it
                  </a>
                  <button
                    type="button"
                    onClick={generateAiCaption}
                    disabled={aiLoading || publishing}
                    className="inline-flex items-center gap-1 text-[11px] font-bold text-primary hover:text-primary/80 transition-colors disabled:opacity-50"
                  >
                    {aiLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                    AI caption · 1cr
                  </button>
                </div>
              </div>
              <textarea
                value={caption}
                onChange={(e) => setCaption(e.target.value.slice(0, CAPTION_LIMIT))}
                disabled={publishing}
                rows={5}
                className="mt-1.5 w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-sm text-white placeholder:text-white/25 focus:outline-none focus:border-primary/50 resize-none"
                placeholder="Write a caption…"
              />
              <p className="text-[11px] text-white/30 mt-1 text-right">{caption.length}/{CAPTION_LIMIT}</p>
            </div>

            {error && (
              <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2.5">
                {error}
              </p>
            )}

            <Button
              onClick={publish}
              disabled={publishing || !accountId || !caption.trim()}
              className="w-full bg-primary hover:bg-primary/90 text-black font-bold gap-2 shadow-[0_0_24px_rgba(218,165,32,0.35)] disabled:opacity-50"
            >
              {publishing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {PROGRESS_STAGES[stage]} ({elapsed}s)
                </>
              ) : (
                <>
                  <Send className="h-4 w-4" /> Publish Reel · 2 credits
                </>
              )}
            </Button>
            {publishing && (
              <p className="text-[11px] text-white/30 text-center -mt-2">
                This can take a few minutes while Instagram processes the video. Don't close this window.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
