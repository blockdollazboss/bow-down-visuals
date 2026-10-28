/* ─── Web-push client ─────────────────────────────────────────────────────
   Browser side of go-live push alerts: decode the server's VAPID
   public key, subscribe through the house service worker (public/
   sw.js, registered in main.tsx), and register the subscription with
   the API. Every state is honest: unsupported browser, push not
   switched on server-side (no VAPID keys), permission denied, and
   subscribed are distinct states the UI renders differently. */

/** VAPID public keys arrive base64url — the Push API wants raw bytes. */
export function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(normalized);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export type PushSupport =
  | "unsupported" // no serviceWorker / PushManager / Notification in this browser
  | "ready"
  | "denied"; // the user blocked notifications for this site

/** The Notification constructor as a window property (lib.dom types
 *  it as a global, not a Window member). */
function notificationOf(win: Window): typeof Notification | undefined {
  return (win as unknown as { Notification?: typeof Notification }).Notification;
}

export function pushSupport(win: Window = window): PushSupport {
  const NotificationApi = notificationOf(win);
  if (!("serviceWorker" in win.navigator) || !("PushManager" in win) || !NotificationApi) {
    return "unsupported";
  }
  if (NotificationApi.permission === "denied") return "denied";
  return "ready";
}

export interface PushConfigDto {
  configured: boolean;
  publicKey: string | null;
}

export interface PushDeps {
  fetchJson: (path: string, init?: RequestInit) => Promise<{ status: number; json: any }>;
}

/** Fetch the server's push config — { configured:false } is a real,
 *  renderable state (alerts still arrive in-app; push is just off). */
export async function fetchPushConfig(deps: PushDeps): Promise<PushConfigDto> {
  const { status, json } = await deps.fetchJson("/api/push/config");
  if (status !== 200 || !json) return { configured: false, publicKey: null };
  return {
    configured: json.configured === true,
    publicKey: typeof json.publicKey === "string" ? json.publicKey : null,
  };
}

/**
 * Subscribe this browser and register the subscription with the API.
 * Returns the honest outcome; throws only on unexpected failures the
 * caller should surface as a generic error.
 */
export async function subscribeToPush(
  deps: PushDeps,
  win: Window = window,
): Promise<"subscribed" | "denied" | "unsupported" | "not_configured"> {
  const support = pushSupport(win);
  if (support !== "ready") return support === "denied" ? "denied" : "unsupported";
  const config = await fetchPushConfig(deps);
  if (!config.configured || !config.publicKey) return "not_configured";
  const NotificationApi = notificationOf(win);
  if (!NotificationApi) return "unsupported";
  const permission = await NotificationApi.requestPermission();
  if (permission !== "granted") return "denied";
  const registration = await win.navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  const subscription =
    existing ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(config.publicKey),
    }));
  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
    throw new Error("subscription incomplete");
  }
  const { status } = await deps.fetchJson("/api/push/subscriptions", {
    method: "POST",
    body: JSON.stringify({ endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } }),
  });
  if (status !== 200 && status !== 201) throw new Error("register failed");
  return "subscribed";
}

/** Unsubscribe this browser and drop the server-side row. */
export async function unsubscribeFromPush(deps: PushDeps, win: Window = window): Promise<boolean> {
  if (!("serviceWorker" in win.navigator)) return false;
  const registration = await win.navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return true;
  const endpoint = subscription.endpoint;
  await subscription.unsubscribe().catch(() => undefined);
  await deps
    .fetchJson("/api/push/subscriptions", { method: "DELETE", body: JSON.stringify({ endpoint }) })
    .catch(() => undefined);
  return true;
}

/** Whether this browser already holds a push subscription. */
export async function hasPushSubscription(win: Window = window): Promise<boolean> {
  if (!("serviceWorker" in win.navigator) || !("PushManager" in win)) return false;
  try {
    const registration = await win.navigator.serviceWorker.ready;
    return (await registration.pushManager.getSubscription()) !== null;
  } catch {
    return false;
  }
}

/* ─── Per-category push preferences (migration 0299) ──────────────────────
   The switches that gate which event categories may ping this user's
   devices. Mirrors the server defaults in lib/push-events.ts — keep
   the two in sync. */

export type PushCategory = "money" | "messages" | "live" | "mentions" | "social";
export type PushPreferenceMap = Record<PushCategory, boolean>;

export const PUSH_PREFERENCE_DEFAULTS: PushPreferenceMap = {
  money: true,
  messages: true,
  live: true,
  mentions: true,
  social: false,
};

export function normalizePushPreferences(json: any): PushPreferenceMap {
  const out = { ...PUSH_PREFERENCE_DEFAULTS };
  const prefs = json && typeof json === "object" ? json.preferences : null;
  if (prefs && typeof prefs === "object") {
    for (const key of Object.keys(out) as PushCategory[]) {
      if (typeof prefs[key] === "boolean") out[key] = prefs[key];
    }
  }
  return out;
}

export async function fetchPushPreferences(deps: PushDeps): Promise<PushPreferenceMap> {
  const { status, json } = await deps.fetchJson("/api/push/preferences");
  if (status !== 200) throw new Error("preferences load failed");
  return normalizePushPreferences(json);
}

export async function updatePushPreferences(
  deps: PushDeps,
  patch: Partial<PushPreferenceMap>,
): Promise<PushPreferenceMap> {
  const { status, json } = await deps.fetchJson("/api/push/preferences", {
    method: "PUT",
    body: JSON.stringify(patch),
  });
  if (status !== 200) throw new Error("preferences save failed");
  return normalizePushPreferences(json);
}

/* ─── Subscription lifecycle repair (runs on sign-in) ─────────────────────
   Browsers rotate push endpoints and servers rotate VAPID keys; a
   subscription registered months ago — or under a different account
   on a shared machine — silently stops matching the server's rows.
   On sign-in, when permission is ALREADY granted (this NEVER prompts),
   re-register the current subscription so the endpoint belongs to the
   signed-in user with fresh keys; if the subscription was made under
   a different VAPID key, replace it. */

export type PushRepairOutcome =
  | "unsupported"
  | "no_permission" // not granted — repair never prompts
  | "not_configured" // server has no push keys in this environment
  | "no_subscription" // nothing to repair; the opt-in surfaces own asking
  | "repaired" // re-registered as-is
  | "rotated"; // key changed — subscription replaced and registered

function keyBytesEqual(a: ArrayBuffer | null, b: Uint8Array<ArrayBuffer>): boolean {
  if (!a) return false;
  const bytes = new Uint8Array(a);
  if (bytes.length !== b.length) return false;
  for (let i = 0; i < bytes.length; i++) if (bytes[i] !== b[i]) return false;
  return true;
}

async function registerSubscription(deps: PushDeps, subscription: PushSubscription): Promise<void> {
  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
    throw new Error("subscription incomplete");
  }
  const { status } = await deps.fetchJson("/api/push/subscriptions", {
    method: "POST",
    body: JSON.stringify({ endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } }),
  });
  if (status !== 200 && status !== 201) throw new Error("register failed");
}

export async function repairPushSubscription(
  deps: PushDeps,
  win: Window = window,
): Promise<PushRepairOutcome> {
  if (pushSupport(win) === "unsupported") return "unsupported";
  const NotificationApi = notificationOf(win);
  if (!NotificationApi || NotificationApi.permission !== "granted") return "no_permission";
  const config = await fetchPushConfig(deps);
  if (!config.configured || !config.publicKey) return "not_configured";
  const registration = await win.navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  if (!existing) return "no_subscription";
  const currentKey = urlBase64ToUint8Array(config.publicKey);
  if (keyBytesEqual(existing.options?.applicationServerKey ?? null, currentKey)) {
    await registerSubscription(deps, existing);
    return "repaired";
  }
  await existing.unsubscribe().catch(() => undefined);
  const fresh = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: currentKey,
  });
  await registerSubscription(deps, fresh);
  return "rotated";
}
