import { useEffect, useState } from "react";
import { Bell, BellRing, Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { apiFetch } from "@/lib/social-api";
import {
  fetchPushConfig,
  hasPushSubscription,
  pushSupport,
  subscribeToPush,
  unsubscribeFromPush,
  type PushDeps,
} from "@/lib/push-client";

/* ─── Push alerts toggle ──────────────────────────────────────────────────
   Turns browser push for go-live alerts on/off for the signed-in
   user. Honest states only: when the server has no push keys yet the
   toggle says alerts still arrive in the bell — it never renders a
   working-looking switch that does nothing. */

type State =
  | "loading"
  | "signed-out"
  | "unsupported"
  | "denied"
  | "not-configured"
  | "off"
  | "on"
  | "working"
  | "error";

export default function PushAlertsToggle({ className = "" }: { className?: string }) {
  const { user, getAccessToken } = useAuth();
  const [state, setState] = useState<State>("loading");

  const deps: PushDeps = {
    fetchJson: async (path, init) => {
      const res = await apiFetch(getAccessToken, path, init);
      return { status: res.status, json: await res.json().catch(() => null) };
    },
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!user) {
        if (!cancelled) setState("signed-out");
        return;
      }
      const support = pushSupport();
      if (support !== "ready") {
        if (!cancelled) setState(support === "denied" ? "denied" : "unsupported");
        return;
      }
      const config = await fetchPushConfig(deps).catch(() => ({ configured: false, publicKey: null }));
      if (cancelled) return;
      if (!config.configured) {
        setState("not-configured");
        return;
      }
      const subscribed = await hasPushSubscription().catch(() => false);
      if (!cancelled) setState(subscribed ? "on" : "off");
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  if (state === "loading" || state === "signed-out") return null;

  async function toggle() {
    if (state === "off" || state === "error") {
      setState("working");
      try {
        const outcome = await subscribeToPush(deps);
        setState(outcome === "subscribed" ? "on" : outcome === "denied" ? "denied" : outcome === "not_configured" ? "not-configured" : "unsupported");
      } catch {
        setState("error");
      }
    } else if (state === "on") {
      setState("working");
      try {
        await unsubscribeFromPush(deps);
        setState("off");
      } catch {
        setState("error");
      }
    }
  }

  const notes: Partial<Record<State, string>> = {
    unsupported: "This browser can't do push alerts — the bell still gets every go-live alert.",
    denied: "Notifications are blocked for this site in your browser settings — the bell still gets every go-live alert.",
    "not-configured": "Push alerts aren't switched on yet — the bell still gets every go-live alert.",
    error: "That didn't go through. Try again.",
  };
  const note = notes[state];

  return (
    <div className={`flex items-center gap-3 ${className}`} data-testid="push-alerts-toggle">
      <button
        type="button"
        onClick={() => void toggle()}
        disabled={state === "working" || state === "unsupported" || state === "denied" || state === "not-configured"}
        className="inline-flex shrink-0 items-center gap-2 rounded-full border border-[#C9A84C]/40 px-3.5 py-2 text-xs font-bold text-[#e8c86a] transition hover:border-[#C9A84C] disabled:cursor-not-allowed disabled:opacity-50"
        aria-pressed={state === "on"}
      >
        {state === "working" ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : state === "on" ? (
          <BellRing className="h-3.5 w-3.5" />
        ) : (
          <Bell className="h-3.5 w-3.5" />
        )}
        {state === "on" ? "Live alerts on" : "Live alerts off"}
      </button>
      {note && <p className="text-xs text-white/50">{note}</p>}
    </div>
  );
}
