/**
 * Push client tests — the VAPID key decode (byte-exact; a wrong byte
 * makes the browser reject the subscription) and support detection.
 */
import { describe, it, expect } from "vitest";
import { urlBase64ToUint8Array, pushSupport } from "./push-client";

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
