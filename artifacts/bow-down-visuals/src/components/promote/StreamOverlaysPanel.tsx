import { useCallback, useEffect, useState } from "react";
import {
  BellRing,
  Check,
  Copy,
  FlaskConical,
  Loader2,
  MonitorPlay,
  RefreshCcw,
  Target,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useIsLightTheme } from "@/hooks/use-is-light-theme";

/* ─── Stream overlays desk (stack900 lane C2) ─────────────────────────────
   The Promote-side home for the widgets that live OUTSIDE the
   website, on the creator's own stream: two browser-source links
   (alerts + tip-goal bar) keyed by the creator's overlay token, a
   test-alert button, and the token reset. Plain words throughout —
   the creator's job is copy, paste, done.

   The token rides in the link itself (an OBS browser source holds
   no login), so the desk says plainly: keep the links private, and
   if one ever leaks, one tap on Reset makes every old link die. */

interface OverlayDesk {
  token: string;
  paths: { alerts: string; goal: string; nowPlaying: string };
}

type LoadState = "loading" | "ready" | "error";

function OverlayLinkRow({
  label,
  hint,
  url,
  testId,
  copyTestId,
  isLight,
}: {
  label: string;
  hint: string;
  url: string;
  testId: string;
  copyTestId: string;
  isLight: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard refused — the link is on screen to copy by hand */
    }
  };
  return (
    <div
      className={`rounded-2xl border px-4 py-3 ${
        isLight ? "border-[#7A5A12]/25 bg-black/[0.03]" : "border-white/10 bg-white/[0.03]"
      }`}
    >
      <div className="flex items-center gap-2">
        <p className={`text-sm font-black ${isLight ? "text-[#2a1e07]" : "text-white"}`}>{label}</p>
        <button
          type="button"
          data-testid={copyTestId}
          onClick={copy}
          className={`ml-auto inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition ${
            isLight
              ? "border-[#7A5A12]/40 text-[#6B5B36] hover:text-[#2a1e07]"
              : "border-white/20 text-white/70 hover:text-white"
          }`}
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? "Copied" : "Copy link"}
        </button>
      </div>
      <p className={`mt-0.5 text-xs font-semibold ${isLight ? "text-[#6B5B36]" : "text-white/45"}`}>
        {hint}
      </p>
      <p
        data-testid={testId}
        className={`mt-2 break-all font-mono text-[11px] leading-relaxed ${
          isLight ? "text-[#6B5B36]" : "text-white/50"
        }`}
      >
        {url}
      </p>
    </div>
  );
}

export function StreamOverlaysPanel() {
  const isLight = useIsLightTheme();
  const { user, getAccessToken } = useAuth();
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [desk, setDesk] = useState<OverlayDesk | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [resetArmed, setResetArmed] = useState(false);
  const [busy, setBusy] = useState<"test" | "reset" | null>(null);

  const authHeaders = useCallback(async (): Promise<Record<string, string>> => {
    const token = await getAccessToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, [getAccessToken]);

  const load = useCallback(async () => {
    if (!user) return;
    setLoadState("loading");
    try {
      const res = await fetch("/api/overlay/me", { headers: await authHeaders() });
      if (!res.ok) throw new Error("desk failed");
      setDesk((await res.json()) as OverlayDesk);
      setLoadState("ready");
    } catch {
      setLoadState("error");
    }
  }, [user, authHeaders]);

  useEffect(() => {
    void load();
  }, [load]);

  const origin = typeof window !== "undefined" ? window.location.origin : "";

  const fireTest = async () => {
    setBusy("test");
    setNote(null);
    try {
      const res = await fetch("/api/overlay/test-alert", {
        method: "POST",
        headers: await authHeaders(),
      });
      if (!res.ok) throw new Error("test failed");
      const body = (await res.json()) as { delivered: number };
      setNote(
        body.delivered > 0
          ? "Test alert sent — look at your stream overlay, it's popping right now."
          : "Test alert sent. Open one of your overlay links in a browser tab to see it pop.",
      );
    } catch {
      setNote("The test alert couldn't be sent. Try again in a moment.");
    } finally {
      setBusy(null);
    }
  };

  const resetToken = async () => {
    if (!resetArmed) {
      setResetArmed(true);
      return;
    }
    setBusy("reset");
    setNote(null);
    try {
      const res = await fetch("/api/overlay/token/reset", {
        method: "POST",
        headers: await authHeaders(),
      });
      if (!res.ok) throw new Error("reset failed");
      setDesk((await res.json()) as OverlayDesk);
      setResetArmed(false);
      setNote("Fresh links made. Your old overlay links have stopped working — paste the new ones into your streaming app.");
    } catch {
      setNote("The new links couldn't be made. Try again in a moment.");
    } finally {
      setBusy(null);
    }
  };

  const noteCls = `text-xs font-semibold ${isLight ? "text-[#6B5B36]" : "text-white/50"}`;
  const actionCls = `inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-bold transition ${
    isLight
      ? "border-[#7A5A12]/40 text-[#6B5B36] hover:text-[#2a1e07]"
      : "border-white/20 text-white/75 hover:text-white"
  }`;

  return (
    <section
      data-testid="stream-overlays-panel"
      className={`rounded-3xl border px-5 py-5 ${
        isLight
          ? "border-[#C9A84C]/50 bg-[#FBF6E9]"
          : "border-white/10 bg-white/[0.02]"
      }`}
    >
      <div className="flex items-center gap-2">
        <MonitorPlay className="h-5 w-5 text-[#d4af37]" />
        <h3 className={`text-base font-black ${isLight ? "text-[#2a1e07]" : "text-white"}`}>
          Widgets for your stream
        </h3>
      </div>
      <p className={`mt-1 text-sm font-semibold ${isLight ? "text-[#6B5B36]" : "text-white/55"}`}>
        Copy the link, paste it into your streaming app as a browser source, and your tips and
        fans — and the song you&rsquo;re playing — show up live on screen.
      </p>

      {!user ? (
        <p className={`mt-4 ${noteCls}`}>Sign in and your personal overlay links appear here.</p>
      ) : loadState === "loading" ? (
        <p data-testid="overlays-loading" className={`mt-4 inline-flex items-center gap-2 ${noteCls}`}>
          <Loader2 className="h-4 w-4 animate-spin" /> Getting your overlay links…
        </p>
      ) : loadState === "error" || !desk ? (
        <div className="mt-4">
          <p data-testid="overlays-error" className={`font-bold ${isLight ? "text-[#8a3324]" : "text-red-300"}`}>
            Your overlay links couldn&rsquo;t load.
          </p>
          <button type="button" onClick={() => void load()} className={`mt-2 ${actionCls}`}>
            Try again
          </button>
        </div>
      ) : (
        <>
          <div className="mt-4 flex flex-col gap-3">
            <OverlayLinkRow
              label="Tip & fan alerts"
              hint="Pops on your stream when a tip lands, a fan follows, or a member joins."
              url={`${origin}${desk.paths.alerts}`}
              testId="overlay-link-alerts"
              copyTestId="overlay-copy-alerts"
              isLight={isLight}
            />
            <OverlayLinkRow
              label="Tip goal bar"
              hint="Your tip goal, filling up live. Set the goal itself in the Go Live studio — the bar follows it on its own."
              url={`${origin}${desk.paths.goal}`}
              testId="overlay-link-goal"
              copyTestId="overlay-copy-goal"
              isLight={isLight}
            />
            <OverlayLinkRow
              label="Now playing"
              hint="The track on your program right now, named as it plays. Play a song from your library in the Go Live studio and this card follows it."
              url={`${origin}${desk.paths.nowPlaying}`}
              testId="overlay-link-now-playing"
              copyTestId="overlay-copy-now-playing"
              isLight={isLight}
            />
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              data-testid="overlay-test-alert"
              onClick={() => void fireTest()}
              disabled={busy !== null}
              className={actionCls}
            >
              {busy === "test" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <FlaskConical className="h-4 w-4" />
              )}
              Send a test alert
            </button>
            <button
              type="button"
              data-testid="overlay-reset-token"
              onClick={() => void resetToken()}
              disabled={busy !== null}
              className={actionCls}
            >
              {busy === "reset" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCcw className="h-4 w-4" />
              )}
              {resetArmed ? "Tap again to make fresh links" : "Reset my links"}
            </button>
          </div>

          <p className={`mt-3 inline-flex items-start gap-1.5 ${noteCls}`}>
            <BellRing className="mt-px h-3.5 w-3.5 shrink-0 text-[#d4af37]" />
            <span>
              Keep these links private — anyone holding one can see your alerts pop. If a link
              ever leaks, reset it here and every old link stops working at once.
            </span>
          </p>
          <p className={`mt-2 inline-flex items-start gap-1.5 ${noteCls}`}>
            <Target className="mt-px h-3.5 w-3.5 shrink-0 text-[#d4af37]" />
            <span>
              Streaming from inside Bow Down instead? The same widgets are built into the Go Live
              studio — nothing to paste.
            </span>
          </p>
          {note && (
            <p data-testid="overlays-note" className={`mt-3 text-sm font-bold ${isLight ? "text-[#2a1e07]" : "text-white"}`}>
              {note}
            </p>
          )}
        </>
      )}
    </section>
  );
}
