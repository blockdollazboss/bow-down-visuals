/**
 * Push client tests — the VAPID key decode (byte-exact; a wrong byte
 * makes the browser reject the subscription), support detection, the
 * preference map normalization, and the sign-in subscription repair
 * (re-register as-is; rotate when the VAPID key changed; never prompt).
 */
import { describe, it, expect, vi } from "vitest";
import {
  urlBase64ToUint8Array,
  pushSupport,
  normalizePushPreferences,
  repairPushSubscription,
  PUSH_PREFERENCE_DEFAULTS,
  type PushDeps,
} from "./push-client";

describe("urlBase64ToUint8Array", () => {
  it("decodes base64url with padding restored", () => {
    // Bytes [251, 255, 190] encode as "-_--" in base64url.
    const out = urlBase64ToUint8Array("-_--");
    expect([...out]).toEqual([251, 255, 190]);
  });

  it("decodes a realistic VAPID-length key to 65 bytes", () => {
    const bytes = new Uint8Array(65);
    bytes[0] = 4;
    for (let i = 1; i < 65; i++) bytes[i] = i;
    const b64 = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const out = urlBase64ToUint8Array(b64);
    expect(out.length).toBe(65);
    expect([...out]).toEqual([...bytes]);
  });
});

describe("pushSupport", () => {
  it("is unsupported without the Push APIs", () => {
    const fakeWin = { navigator: {}, Notification: undefined } as unknown as Window;
    expect(pushSupport(fakeWin)).toBe("unsupported");
  });

  it("is denied when the browser blocked notifications", () => {
    const fakeWin = {
      navigator: { serviceWorker: {} },
      PushManager: function () {},
      Notification: { permission: "denied" },
    } as unknown as Window;
    expect(pushSupport(fakeWin)).toBe("denied");
  });
});

describe("normalizePushPreferences", () => {
  it("falls back to the defaults for junk and honors stored booleans", () => {
    expect(normalizePushPreferences(null)).toEqual(PUSH_PREFERENCE_DEFAULTS);
    expect(normalizePushPreferences({ preferences: { social: true, money: "yes" } })).toEqual({
      ...PUSH_PREFERENCE_DEFAULTS,
      social: true,
    });
  });
});

/* A 65-byte uncompressed-point-shaped stand-in key, base64url-encoded. */
function makeKey(seed: number): { b64: string; bytes: Uint8Array } {
  const bytes = new Uint8Array(65);
  bytes[0] = 4;
  for (let i = 1; i < 65; i++) bytes[i] = (i * seed) % 256;
  const b64 = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return { b64, bytes };
}

function fakeWindow(opts: {
  permission: string;
  subscriptionKey: Uint8Array | null;
  hasSubscription: boolean;
}) {
  const state = { unsubscribed: false, subscribedWith: null as Uint8Array | null };
  const subscription = {
    endpoint: "https://push.example.com/sub-1",
    options: {
      applicationServerKey: opts.subscriptionKey ? opts.subscriptionKey.buffer as ArrayBuffer : null,
    },
    unsubscribe: async () => {
      state.unsubscribed = true;
      return true;
    },
    toJSON: () => ({
      endpoint: "https://push.example.com/sub-1",
      keys: { p256dh: "pk", auth: "auth" },
    }),
  };
  const registration = {
    pushManager: {
      getSubscription: async () => (opts.hasSubscription ? subscription : null),
      subscribe: async (subOpts: { applicationServerKey: Uint8Array }) => {
        state.subscribedWith = subOpts.applicationServerKey;
        return {
          ...subscription,
          toJSON: () => ({
            endpoint: "https://push.example.com/sub-2",
            keys: { p256dh: "pk2", auth: "auth2" },
          }),
        };
      },
    },
  };
  const win = {
    navigator: { serviceWorker: { ready: Promise.resolve(registration) } },
    PushManager: function () {},
    Notification: { permission: opts.permission },
  } as unknown as Window;
  return { win, state };
}

function fakeDeps(publicKey: string | null) {
  const calls: { path: string; method?: string }[] = [];
  const deps: PushDeps = {
    fetchJson: async (path: string, init?: RequestInit) => {
      calls.push({ path, method: init?.method });
      if (path === "/api/push/config") {
        return { status: 200, json: { configured: publicKey !== null, publicKey } };
      }
      return { status: 201, json: { ok: true } };
    },
  };
  return { deps, calls };
}

describe("repairPushSubscription", () => {
  it("never prompts: without granted permission it is a no-op", async () => {
    const key = makeKey(3);
    const { win } = fakeWindow({ permission: "default", subscriptionKey: key.bytes, hasSubscription: true });
    const { deps, calls } = fakeDeps(key.b64);
    await expect(repairPushSubscription(deps, win)).resolves.toBe("no_permission");
    expect(calls).toHaveLength(0);
  });

  it("re-registers an existing subscription under the current key", async () => {
    const key = makeKey(3);
    const { win, state } = fakeWindow({ permission: "granted", subscriptionKey: key.bytes, hasSubscription: true });
    const { deps, calls } = fakeDeps(key.b64);
    await expect(repairPushSubscription(deps, win)).resolves.toBe("repaired");
    expect(state.unsubscribed).toBe(false);
    expect(calls.filter((c) => c.path === "/api/push/subscriptions")).toHaveLength(1);
  });

  it("rotates the subscription when the server key changed", async () => {
    const oldKey = makeKey(3);
    const newKey = makeKey(7);
    const { win, state } = fakeWindow({ permission: "granted", subscriptionKey: oldKey.bytes, hasSubscription: true });
    const { deps } = fakeDeps(newKey.b64);
    await expect(repairPushSubscription(deps, win)).resolves.toBe("rotated");
    expect(state.unsubscribed).toBe(true);
    expect([...(state.subscribedWith ?? [])]).toEqual([...newKey.bytes]);
  });

  it("reports no_subscription when the browser holds none", async () => {
    const key = makeKey(3);
    const { win } = fakeWindow({ permission: "granted", subscriptionKey: null, hasSubscription: false });
    const { deps } = fakeDeps(key.b64);
    await expect(repairPushSubscription(deps, win)).resolves.toBe("no_subscription");
  });

  it("reports not_configured when the server has no keys", async () => {
    const key = makeKey(3);
    const { win } = fakeWindow({ permission: "granted", subscriptionKey: key.bytes, hasSubscription: true });
    const { deps } = fakeDeps(null);
    await expect(repairPushSubscription(deps, win)).resolves.toBe("not_configured");
  });
});
