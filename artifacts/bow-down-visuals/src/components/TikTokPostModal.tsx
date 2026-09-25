import { useEffect, useRef, useState } from "react";
import { X, Loader2, Sparkles, Send, CheckCircle2, Copy, Gauge } from "lucide-react";
import { TikTokIcon } from "@/components/ui/tiktok-icon";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { OutOfCredits } from "@/components/OutOfCredits";
import type { SocialAccountInfo } from "./ConnectedAccounts";

/* Caption composer + draft uploader for the TikTok auto-post DRAFTS tier.
   Opens from FinalVideoExport after a successful export. Uploading costs
   2 credits (charged by the backend, refunded if TikTok fails).

   DRAFTS-TIER HONESTY: TikTok's Content Posting API only sends the video to
   the creator's TikTok inbox — the user finishes it in the TikTok app. The
   modal NEVER claims the video was published. */

interface Props {
  open: boolean;
  onClose: () => void;
  videoUrl: string;
  accounts: SocialAccountInfo[];
}

const DEFAULT_CAPTION = "Just made this with @bowdownvisuals 🔥\n\n#fyp #musicvideo #contentcreator #aivideo";
const CAPTION_LIMIT = 2200;

const PROGRESS_STAGES = [
  "Uploading to TikTok…",
  "TikTok is processing the video…",
  "Sending to your drafts…",
];

export function TikTokPostModal({ open, onClose, videoUrl, accounts }: Props) {
  const { getAccessToken, refreshProfile } = useAuth();
  const { toast } = useToast();
  const [caption, setCaption] = useState(DEFAULT_CAPTION);
  const [accountId, setAccountId] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [delivered, setDelivered] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  /* Idempotency key for this composer session — stable across retries so a
     double-click or a retry after a timeout replays one server attempt. */
  const idempotencyKey = useRef("");

  const usable = accounts.filter((a) => a.platform === "tiktok" && !a.expired);

  useEffect(() => {
    if (open) {
      setCaption(DEFAULT_CAPTION);
      setAccountId(usable[0]?.id ?? "");
      setAiLoading(false);
      setUploading(false);
      setElapsed(0);
      setDelivered(false);
      setCopied(false);
      setError(null);
      setOutOfCredits(false);
      /* Reuse a pending key for this video if the composer was closed
         mid-upload; otherwise mint a fresh one for this session. */
      const storageKey = `tiktok-publish-key:${videoUrl}`;
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
    if (uploading) {
      timer.current = setInterval(() => setElapsed((e) => e + 1), 1000);
    } else if (timer.current) {
      clearInterval(timer.current);
      timer.current = null;
    }
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [uploading]);

  if (!open) return null;

  const stage = elapsed < 30 ? 0 : elapsed < 180 ? 1 : 2;

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
      setCaption(`${data.hooks[0]}\n\nMade with @bowdownvisuals 🔥\n#fyp #musicvideo #contentcreator #aivideo`);
      refreshProfile();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Caption generation failed.");
    } finally {
      setAiLoading(false);
    }
  }

  async function copyCaption() {
    try {
      await navigator.clipboard.writeText(caption.trim());
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setError("Couldn't copy the caption — select and copy it manually.");
    }
  }

  async function sendToDrafts() {
    if (uploading || !accountId) return;
    setUploading(true);
    setElapsed(0);
    setError(null);
    setOutOfCredits(false);
    setDelivered(false);
    try {
      const token = await getAccessToken();
      const res = await fetch("/api/social/tiktok/publish", {
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
        setError("This video is already uploading — give it a minute, then check your TikTok drafts.");
        return;
      }
      if (!res.ok) {
        throw new Error(data.message || "Couldn't send the video to TikTok.");
      }
      setDelivered(true);
      /* Confirmed success: this intent is done, so a later composer session
         for the same video mints a fresh key (a deliberate re-upload). */
      try {
        sessionStorage.removeItem(`tiktok-publish-key:${videoUrl}`);
      } catch {
        /* ignore */
      }
      refreshProfile();
      toast({ title: "Sent to TikTok drafts", description: "Open TikTok to finish posting." });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send the video to TikTok.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/75 backdrop-blur-sm" onClick={uploading ? undefined : onClose} />
      <div className="relative w-full max-w-lg rounded-2xl border border-primary/25 bg-[#0b0b0d] p-6 space-y-5 shadow-[0_0_60px_rgba(218,165,32,0.15)]">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-lg font-bold text-white flex items-center gap-2">
              <TikTokIcon className="h-5 w-5 text-white" /> Send to TikTok drafts
            </h3>
            <p className="text-xs text-white/40 mt-1">2 credits · lands in your TikTok inbox — you post it in the app</p>
          </div>
          {!uploading && (
            <button onClick={onClose} className="text-white/40 hover:text-white transition-colors" aria-label="Close">
              <X className="h-5 w-5" />
            </button>
          )}
        </div>

        {outOfCredits ? (
          <OutOfCredits />
        ) : delivered ? (
          <div className="space-y-4 text-center py-4">
            <CheckCircle2 className="h-12 w-12 text-primary mx-auto" />
            <div>
              <p className="text-white font-bold">It's in your TikTok drafts!</p>
              <p className="text-sm text-white/50 mt-2 max-w-sm mx-auto">
                Open the TikTok app and tap the notification to review, add your caption, and post it.
              </p>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-left">
              <p className="text-[11px] font-bold text-white/50 uppercase tracking-wider mb-1.5">
                Your caption — TikTok needs you to paste it in the app
              </p>
              <p className="text-xs text-white/70 whitespace-pre-wrap max-h-24 overflow-y-auto">{caption.trim()}</p>
            </div>
            <div className="flex gap-2 justify-center">
              <Button
                onClick={copyCaption}
                variant="outline"
                className="border-white/15 text-white font-bold gap-2"
              >
                <Copy className="h-4 w-4" /> {copied ? "Copied!" : "Copy caption"}
              </Button>
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
                  disabled={uploading}
                  className="mt-1.5 w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-sm text-white focus:outline-none focus:border-primary/50"
                >
                  {usable.map((a) => (
                    <option key={a.id} value={a.id} className="bg-black">
                      @{a.usernameMasked ?? a.username ?? "tiktok"}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-white/60 uppercase tracking-wider">
                  Caption <span className="text-white/30 normal-case font-normal">· paste it in TikTok</span>
                </label>
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
                    disabled={aiLoading || uploading}
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
                disabled={uploading}
                rows={5}
                className="mt-1.5 w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-sm text-white placeholder:text-white/25 focus:outline-none focus:border-primary/50 resize-none"
                placeholder="Write a caption to paste in TikTok…"
              />
              <p className="text-[11px] text-white/30 mt-1 text-right">{caption.length}/{CAPTION_LIMIT}</p>
            </div>

            {error && (
              <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2.5">
                {error}
              </p>
            )}

            <Button
              onClick={sendToDrafts}
              disabled={uploading || !accountId || !caption.trim()}
              className="w-full bg-primary hover:bg-primary/90 text-black font-bold gap-2 shadow-[0_0_24px_rgba(218,165,32,0.35)] disabled:opacity-50"
            >
              {uploading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {PROGRESS_STAGES[stage]} ({elapsed}s)
                </>
              ) : (
                <>
                  <Send className="h-4 w-4" /> Send to TikTok drafts · 2 credits
                </>
              )}
            </Button>
            {uploading && (
              <p className="text-[11px] text-white/30 text-center -mt-2">
                This can take a few minutes while TikTok processes the video. Don't close this window.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
