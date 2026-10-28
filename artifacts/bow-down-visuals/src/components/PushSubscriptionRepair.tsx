import { useEffect, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { apiFetch } from "@/lib/social-api";
import { repairPushSubscription, type PushDeps } from "@/lib/push-client";

/* ── Push subscription repair on sign-in ───────────────────────────────
   Renders nothing. Once per signed-in user, if the browser already
   granted notification permission, it re-registers the current push
   subscription with the API (endpoints rotate; accounts change on
   shared machines; VAPID keys rotate) so device pings keep landing
   on the right person's devices. It never prompts — asking is the
   job of the settings card and the in-context opt-in prompt. */
export default function PushSubscriptionRepair() {
  const { user, getAccessToken } = useAuth();
  const repairedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!user || repairedFor.current === user.id) return;
    repairedFor.current = user.id;
    const deps: PushDeps = {
      fetchJson: async (path, init) => {
        const res = await apiFetch(getAccessToken, path, init);
        return { status: res.status, json: await res.json().catch(() => null) };
      },
    };
    repairPushSubscription(deps).catch(() => {
      /* best-effort lifecycle upkeep — a failure here must never
         surface as an app error; the settings card shows real state */
    });
  }, [user, getAccessToken]);

  return null;
}
