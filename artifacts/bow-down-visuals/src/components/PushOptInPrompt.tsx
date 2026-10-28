import { useEffect, useState } from "react";
import { BellRing, X } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { apiFetch } from "@/lib/social-api";
import {
  fetchPushConfig,
  hasPushSubscription,
  pushSupport,
  subscribeToPush,
  type PushDeps,
} from "@/lib/push-client";

/* ── In-context push opt-in (EVERYTHING SMART law) ─────────────────────
   The ask arrives in a moment that proves its value — never a cold
   blast on first page load. The parent supplies the moment via
   `when` (first surface: the store dashboard once a seller has a
   sale — "want the next one to ping your phone?"). The prompt stays
   silent when push is unsupported, unconfigured server-side, already
   subscribed on this device, or previously dismissed here. */

const DISMISS_PREFIX = "bdv_push_prompt_dismissed:";

type State = "hidden" | "asking" | "working" | "done" | "denied";

export default function PushOptInPrompt({
  when,
  context,
  headline,
  body,
}: {
  when: boolean;
  /** Dismissal namespace — one ask per meaningful context. */
  context: string;
  headline: string;
  body: string;
}) {
  const { user, getAccessToken } = useAuth();
  const [state, setState] = useState<State>("hidden");

  const deps: PushDeps = {
    fetchJson: async (path, init) => {
      const res = await apiFetch(getAccessToken, path, init);
      return { status: res.status, json: await res.json().catch(() => null) };
    },
  };

  useEffect(() => {
    if (!when || !user) return;
    let cancelled = false;
    (async () => {
      try {
        if (localStorage.getItem(`${DISMISS_PREFIX}${context}`)) return;
      } catch {
        /* storage unavailable — the prompt may show; harmless */
      }
      if (pushSupport() !== "ready") return;
      const config = await fetchPushConfig(deps).catch(() => ({ configured: false, publicKey: null }));
      if (cancelled || !config.configured) return;
      const subscribed = await hasPushSubscription().catch(() => true);
      if (!cancelled && !subscribed) setState("asking");
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [when, user, context]);

  function dismiss() {
    try {
      localStorage.setItem(`${DISMISS_PREFIX}${context}`, "1");
    } catch {
      /* ignore — hiding for this view is enough */
    }
    setState("hidden");
  }

  async function enable() {
    setState("working");
    try {
      const outcome = await subscribeToPush(deps);
      if (outcome === "subscribed") {
        setState("done");
        setTimeout(() => setState("hidden"), 4000);
      } else if (outcome === "denied") {
        setState("denied");
      } else {
        setState("hidden");
      }
    } catch {
      setState("asking");
    }
  }

  if (state === "hidden") return null;

  return (
    <div
      className="relative rounded-2xl border border-primary/30 bg-primary/10 p-4 md:p-5"
      data-testid="push-opt-in-prompt"
      role="status"
    >
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        className="absolute right-3 top-3 text-white/40 transition hover:text-white"
      >
        <X className="h-4 w-4" />
      </button>
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-primary/30 bg-primary/10">
          <BellRing className="h-4 w-4 text-primary" />
        </span>
        <div className="min-w-0">
          <div className="text-sm font-bold">{headline}</div>
          <p className="mt-0.5 text-xs text-white/55">{body}</p>
          {state === "denied" ? (
            <p className="mt-2 text-xs font-semibold text-amber-300">
              Notifications are blocked in your browser settings — the bell still catches everything.
            </p>
          ) : state === "done" ? (
            <p className="mt-2 text-xs font-semibold text-emerald-300">You're in — it's on for this device.</p>
          ) : (
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={enable}
                disabled={state === "working"}
                className="rounded-xl bg-primary px-4 py-2 text-xs font-black text-black transition hover:bg-primary/90 disabled:opacity-60"
              >
                {state === "working" ? "Turning on…" : "Ping this device"}
              </button>
              <button
                type="button"
                onClick={dismiss}
                className="rounded-xl border border-white/15 px-4 py-2 text-xs font-semibold text-white/70 transition hover:bg-white/5"
              >
                Not now
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
