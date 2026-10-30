import { apiErrorMessage, plainErrorText } from "../lib/api-error";
import { useEffect, useRef, useState } from "react";
import { X as CloseIcon, Loader2, Sparkles, Send, CheckCircle2, ExternalLink, Gauge } from "lucide-react";
import { XIcon } from "@/components/ui/x-icon";
import { useAuth } from "@/contexts/AuthContext";
import { useConfirmedApi } from "@/hooks/use-confirmed-api";
import { useToast } from "@/hooks/use-toast";
import { useIsLightTheme } from "@/hooks/use-is-light-theme";
import { Button } from "@/components/ui/button";
import { OutOfCredits } from "@/components/OutOfCredits";
import { getCreditCost } from "@/lib/credit-costs";
import type { SocialAccountInfo } from "./ConnectedAccounts";

/* Composer + publisher for X (Twitter) auto-posting (Wave-4 #42).
   Opens from FinalVideoExport after a successful export (the export is
   attached as video media), and works text-only when no video is passed.
   Publishing is charged by the backend and refunded if X fails.

   X posts cap at 280 characters — the composer enforces the same cap
   the server rail does, and nothing is ever truncated silently: the
   counter turns red at the limit and Publish disables past it.

   Idempotency mirrors the other post modals: one key per composer
   session, stashed in sessionStorage per video, so a double-click or a
   retry after a timeout replays the same server-side attempt. */

interface Props {
  open: boolean;
  onClose: () => void;
  /* The exported video to attach, when opened from an export surface.
     Omit for a text-only post. */
  videoUrl?: string;
  accounts: SocialAccountInfo[];
}

const DEFAULT_TEXT = "Just made this with @bowdownvisuals 🔥\n\n#musicvideo #contentcreator #aivideo";
const TEXT_LIMIT = 280;

const PROGRESS_STAGES = [
  "Uploading to X…",
  "X is processing the media…",
  "Posting to X…",
];

export function XPostModal({ open, onClose, videoUrl, accounts }: Props) {
  const xPostCost = getCreditCost("/api/social/x/publish")?.cost ?? 100;
  const isLight = useIsLightTheme();
  const { getAccessToken, refreshProfile } = useAuth();
  const { confirmedFetch } = useConfirmedApi();
  const { toast } = useToast();
  const [text, setText] = useState(DEFAULT_TEXT);
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

  const usable = accounts.filter((a) => a.platform === "x" && !a.expired);
  const charCount = [...text].length;
  const overLimit = charCount > TEXT_LIMIT;

  useEffect(() => {
    if (open) {
      setText(DEFAULT_TEXT);
      setAccountId(usable[0]?.id ?? "");
      setAiLoading(false);
      setPublishing(false);
      setElapsed(0);
      setPermalink(null);
      setError(null);
      setOutOfCredits(false);
      /* Reuse a pending key for this post if the composer was closed
         mid-publish; otherwise mint a fresh one for this session. */
      const storageKey = `x-publish-key:${videoUrl ?? "text-only"}`;
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

  async function generateAiText() {
    if (aiLoading) return;
    setAiLoading(true);
    setError(null);
    try {
      const token = await getAccessToken();
      const res = await confirmedFetch("/api/hook-studio", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ mode: "hooks", videoType: "music-promo", topic: "" }),
      });
      if (!res) return; // user cancelled the credit confirmation (finally resets state)
      const data = await res.json().catch(() => ({}));
      if (res.status === 402 || data.error === "out_of_credits") {
        setOutOfCredits(true);
        refreshProfile();
        return;
      }
      if (!res.ok || !Array.isArray(data.hooks) || data.hooks.length === 0) {
        throw new Error(apiErrorMessage(data, "Caption generation failed."));
      }
      setText(`${data.hooks[0]}\n\nMade with @bowdownvisuals 🔥`.slice(0, TEXT_LIMIT));
      refreshProfile();
    } catch (err) {
      setError(plainErrorText(err, "Caption generation failed."));
    } finally {
      setAiLoading(false);
    }
  }

  async function publish() {
    if (publishing || !accountId || overLimit) return;
    setPublishing(true);
    setElapsed(0);
    setError(null);
    setOutOfCredits(false);
    setPermalink(null);
    try {
      const token = await getAccessToken();
      const res = await confirmedFetch("/api/social/x/publish", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          accountId,
          text: text.trim(),
          ...(videoUrl ? { videoUrl } : {}),
          idempotencyKey: idempotencyKey.current,
        }),
      });
      if (!res) return; // user cancelled the credit confirmation (finally resets state)
      const data = await res.json().catch(() => ({}));
      if (res.status === 402 || data.error === "out_of_credits") {
        setOutOfCredits(true);
        refreshProfile();
        return;
      }
      if (res.status === 409 && data.error === "publish_in_progress") {
        /* Another attempt with this key is still running (double-click or a
           retry that raced the first request) — not an error, just wait. */
        setError("This post is already publishing — give it a minute, then check your X profile.");
        return;
      }
      if (!res.ok) {
        throw new Error(apiErrorMessage(data, "Couldn't publish to X."));
      }
      setPermalink(data.permalink || null);
      /* Confirmed success: this intent is done, so a later composer session
         for the same video mints a fresh key (a deliberate repost). */
      try {
        sessionStorage.removeItem(`x-publish-key:${videoUrl ?? "text-only"}`);
      } catch {
        /* ignore */
      }
      refreshProfile();
      toast({ title: "Posted to X", description: "Your post is live." });
    } catch (err) {
      setError(plainErrorText(err, "Couldn't publish to X."));
    } finally {
      setPublishing(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/75 backdrop-blur-sm" onClick={publishing ? undefined : onClose} />
      <div className={`relative w-full max-w-lg rounded-2xl border p-6 space-y-5 shadow-[0_0_60px_rgba(218,165,32,0.15)] ${isLight ? "border-[#C9A84C]/40 bg-gradient-to-b from-[#FCF7EA] to-[#F4E7C3]" : "border-primary/25 bg-gradient-to-b from-[#14100a] to-[#0d0a04]"}`}>
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-lg font-bold text-white flex items-center gap-2">
              <XIcon className="h-5 w-5 text-white" /> Post to X
            </h3>
            <p className="text-xs text-white/40 mt-1">{xPostCost} Visual Bucs · {videoUrl ? "posts with your video attached" : "text post to your timeline"}</p>
          </div>
          {!publishing && (
            <button onClick={onClose} className="text-white/40 hover:text-white transition-colors" aria-label="Close">
              <CloseIcon className="h-5 w-5" />
            </button>
          )}
        </div>

        {outOfCredits ? (
          <OutOfCredits />
        ) : permalink ? (
          <div className="space-y-4 text-center py-4">
            <CheckCircle2 className="h-12 w-12 text-primary mx-auto" />
            <p className="text-white font-bold">Your post is live on X!</p>
            {permalink ? (
              <a
                href={permalink}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline font-medium"
              >
                View on X <ExternalLink className="h-3.5 w-3.5" />
              </a>
            ) : (
              <p className="text-xs text-white/40">Posted — check your X profile.</p>
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
                      @{a.usernameMasked ?? a.username ?? "x"}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-white/60 uppercase tracking-wider">Post text</label>
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
                    onClick={generateAiText}
                    disabled={aiLoading || publishing}
                    className="inline-flex items-center gap-1 text-[11px] font-bold text-primary hover:text-primary/80 transition-colors disabled:opacity-50"
                  >
                    {aiLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                    AI text · 1cr
                  </button>
                </div>
              </div>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                disabled={publishing}
                rows={5}
                className="mt-1.5 w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-sm text-white placeholder:text-white/25 focus:outline-none focus:border-primary/50 resize-none"
                placeholder="Write your post…"
              />
              <p className={`text-[11px] mt-1 text-right ${overLimit ? "text-red-400 font-bold" : "text-white/30"}`}>
                {charCount}/{TEXT_LIMIT}{overLimit ? " — too long for X, shorten it" : ""}
              </p>
            </div>

            {error && (
              <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2.5">
                {error}
              </p>
            )}

            <Button
              onClick={publish}
              disabled={publishing || !accountId || !text.trim() || overLimit}
              className="w-full bg-primary hover:bg-primary/90 text-black font-bold gap-2 shadow-[0_0_24px_rgba(218,165,32,0.35)] disabled:opacity-50"
            >
              {publishing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {PROGRESS_STAGES[stage]} ({elapsed}s)
                </>
              ) : (
                <>
                  <Send className="h-4 w-4" /> Post to X · {xPostCost} Visual Bucs
                </>
              )}
            </Button>
            {publishing && (
              <p className="text-[11px] text-white/30 text-center -mt-2">
                This can take a few minutes while X processes the media. Don't close this window.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
