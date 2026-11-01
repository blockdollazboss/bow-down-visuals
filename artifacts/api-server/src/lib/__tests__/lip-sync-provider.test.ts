/**
 * $0 verification suite for the LIP_SYNC_PROVIDER switch resolution.
 *
 * Owner's verdict (2026-10-24): LatentSync via WaveSpeed is the DEFAULT
 * lip-sync route; the direct Sync.so route stays as the premium upsell
 * behind the same switch. Owner's ruling (2026-10-26) hardened the
 * default: sync-3 is PREMIUM-ONLY, never the default. Resolution rules
 * pinned here:
 *  - an explicit LIP_SYNC_PROVIDER wins over key detection;
 *  - unset → latentsync when the WaveSpeed key is configured;
 *  - unset → null when only the Sync.so key exists: the Sync.so key
 *    alone NEVER promotes the premium route to the default (the old
 *    fallback did exactly that — one missing WaveSpeed key silently
 *    flipped every job to sync-3 at several times the per-second
 *    cost). Routes fail closed with 503 until a route is explicitly
 *    selected or the WaveSpeed key lands;
 *  - an unrecognized explicit value fails closed (null), never a silent
 *    route nobody chose.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getLipSyncProviderName,
  isLipSyncProviderConfigured,
  normalizeLipSyncProvider,
} from "../sync-labs";

const ENV_KEYS = [
  "LIP_SYNC_PROVIDER",
  "WAVESPEED_API_KEY",
  "LIP_SYNC_API_KEY",
  "SYNC_LABS_API_KEY",
] as const;

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = {};
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("normalizeLipSyncProvider", () => {
  it("maps the WaveSpeed/LatentSync spellings to latentsync", () => {
    expect(normalizeLipSyncProvider("latentsync")).toBe("latentsync");
    expect(normalizeLipSyncProvider("WaveSpeed")).toBe("latentsync");
    expect(normalizeLipSyncProvider(" latent-sync ")).toBe("latentsync");
  });

  it("maps the Sync.so spellings to sync", () => {
    expect(normalizeLipSyncProvider("sync")).toBe("sync");
    expect(normalizeLipSyncProvider("sync-labs")).toBe("sync");
    expect(normalizeLipSyncProvider("Sync.so")).toBe("sync");
  });

  it("returns null for empty and unrecognized values", () => {
    expect(normalizeLipSyncProvider(null)).toBeNull();
    expect(normalizeLipSyncProvider(undefined)).toBeNull();
    expect(normalizeLipSyncProvider("")).toBeNull();
    expect(normalizeLipSyncProvider("hedra")).toBeNull();
  });
});

describe("getLipSyncProviderName — route selection", () => {
  it("explicit sync selects the premium upsell even when WaveSpeed is configured", () => {
    process.env["LIP_SYNC_PROVIDER"] = "sync";
    process.env["WAVESPEED_API_KEY"] = "ws-key";
    process.env["LIP_SYNC_API_KEY"] = "sync-key";
    expect(getLipSyncProviderName()).toBe("sync");
  });

  it("explicit latentsync selects the default route by name", () => {
    process.env["LIP_SYNC_PROVIDER"] = "latentsync";
    expect(getLipSyncProviderName()).toBe("latentsync");
  });

  it("an unrecognized explicit value fails closed", () => {
    process.env["LIP_SYNC_PROVIDER"] = "carrier-pigeon";
    process.env["WAVESPEED_API_KEY"] = "ws-key";
    expect(getLipSyncProviderName()).toBeNull();
  });

  it("unset defaults to latentsync when the WaveSpeed key is configured", () => {
    process.env["WAVESPEED_API_KEY"] = "ws-key";
    expect(getLipSyncProviderName()).toBe("latentsync");
  });

  it("unset prefers latentsync when both keys are configured", () => {
    process.env["WAVESPEED_API_KEY"] = "ws-key";
    process.env["LIP_SYNC_API_KEY"] = "sync-key";
    expect(getLipSyncProviderName()).toBe("latentsync");
  });

  it("unset with only the Sync.so key resolves to null — the premium route never serves by default (owner's ruling, 2026-10-26)", () => {
    process.env["SYNC_LABS_API_KEY"] = "sync-key";
    expect(getLipSyncProviderName()).toBeNull();
    // …and the fail-closed chain holds: the resolved route is not
    // configured, so the routes answer 503 before any charge.
    expect(isLipSyncProviderConfigured(getLipSyncProviderName())).toBe(false);
  });

  it("the premium route is still reachable by explicit selection with only its key present", () => {
    process.env["LIP_SYNC_PROVIDER"] = "sync";
    process.env["SYNC_LABS_API_KEY"] = "sync-key";
    expect(getLipSyncProviderName()).toBe("sync");
    expect(isLipSyncProviderConfigured(getLipSyncProviderName())).toBe(true);
  });

  it("unset with no keys resolves to null (nothing connected)", () => {
    expect(getLipSyncProviderName()).toBeNull();
  });
});

describe("isLipSyncProviderConfigured", () => {
  it("tracks each route's own key", () => {
    process.env["WAVESPEED_API_KEY"] = "ws-key";
    expect(isLipSyncProviderConfigured("latentsync")).toBe(true);
    expect(isLipSyncProviderConfigured("sync")).toBe(false);
    process.env["LIP_SYNC_API_KEY"] = "sync-key";
    expect(isLipSyncProviderConfigured("sync")).toBe(true);
  });

  it("is false for a null provider", () => {
    process.env["WAVESPEED_API_KEY"] = "ws-key";
    expect(isLipSyncProviderConfigured(null)).toBe(false);
    expect(isLipSyncProviderConfigured(undefined)).toBe(false);
  });
});
