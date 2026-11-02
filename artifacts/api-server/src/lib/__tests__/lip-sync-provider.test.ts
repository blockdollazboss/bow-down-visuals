/**
 * $0 verification suite for lip-sync provider resolution AFTER the
 * sync-3 strip (stack1400).
 *
 * Owner deleted his Sync Labs account on 2026-11-02. The premium
 * direct route (sync-3) was removed from the site code entirely, so
 * nothing can point at the closed account again. Pins:
 *  - the ONLY selectable route is LatentSync via WaveSpeed;
 *  - every spelling of the removed route resolves to null — by env
 *    selection (LIP_SYNC_PROVIDER=sync / sync.so / sync-3), by stored
 *    job provider, and by key presence;
 *  - the removed route's old key env vars (LIP_SYNC_API_KEY,
 *    SYNC_LABS_API_KEY, LIP_SYNC_MODEL) are never read: setting them
 *    alone configures NOTHING and selects NOTHING;
 *  - an explicit removed-route selection fails CLOSED (null) even
 *    when the live route's key is also present — it never silently
 *    reroutes and never reaches the closed account;
 *  - the live route still resolves exactly as before: explicit
 *    latentsync, or unset with the WaveSpeed key configured;
 *  - a stored removed-route value is RECOGNISED as removed
 *    (isRemovedLipSyncProvider) so the poller can fail already-
 *    submitted jobs honestly instead of polling a foreign id.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getLipSyncProviderName,
  isLipSyncProviderConfigured,
  isRemovedLipSyncProvider,
  normalizeLipSyncProvider,
} from "../lip-sync-core";

const ENV_KEYS = [
  "LIP_SYNC_PROVIDER",
  "WAVESPEED_API_KEY",
  "LIP_SYNC_API_KEY",
  "SYNC_LABS_API_KEY",
  "LIP_SYNC_MODEL",
  "SYNC_LABS_BASE_URL",
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

describe("normalizeLipSyncProvider — the removed route has no spelling left", () => {
  it("maps the WaveSpeed/LatentSync spellings to latentsync", () => {
    expect(normalizeLipSyncProvider("latentsync")).toBe("latentsync");
    expect(normalizeLipSyncProvider("WaveSpeed")).toBe("latentsync");
    expect(normalizeLipSyncProvider(" latent-sync ")).toBe("latentsync");
  });

  it("returns null for EVERY spelling of the removed route", () => {
    for (const spelling of ["sync", "sync-labs", "synclabs", "sync.so", "sync-3", "sync3", "Sync Labs"]) {
      expect(normalizeLipSyncProvider(spelling)).toBeNull();
    }
  });

  it("returns null for empty and unrecognized values", () => {
    expect(normalizeLipSyncProvider(null)).toBeNull();
    expect(normalizeLipSyncProvider(undefined)).toBeNull();
    expect(normalizeLipSyncProvider("")).toBeNull();
    expect(normalizeLipSyncProvider("hedra")).toBeNull();
  });
});

describe("isRemovedLipSyncProvider — legacy values are recognised only to be refused", () => {
  it("recognises the removed route's spellings", () => {
    expect(isRemovedLipSyncProvider("sync")).toBe(true);
    expect(isRemovedLipSyncProvider(" sync.so ")).toBe(true);
    expect(isRemovedLipSyncProvider("sync-3")).toBe(true);
  });

  it("does not flag the live route or empty values", () => {
    expect(isRemovedLipSyncProvider("latentsync")).toBe(false);
    expect(isRemovedLipSyncProvider(null)).toBe(false);
    expect(isRemovedLipSyncProvider("")).toBe(false);
  });
});

describe("getLipSyncProviderName — sync-3 can no longer be selected", () => {
  it("explicit removed-route selection fails closed — even with every key present", () => {
    for (const spelling of ["sync", "sync.so", "sync-3"]) {
      process.env["LIP_SYNC_PROVIDER"] = spelling;
      process.env["WAVESPEED_API_KEY"] = "ws-key";
      process.env["LIP_SYNC_API_KEY"] = "removed-key";
      process.env["SYNC_LABS_API_KEY"] = "removed-key";
      expect(getLipSyncProviderName()).toBeNull();
      expect(isLipSyncProviderConfigured(getLipSyncProviderName())).toBe(false);
    }
  });

  it("the removed route's keys alone select and configure NOTHING", () => {
    process.env["LIP_SYNC_API_KEY"] = "removed-key";
    process.env["SYNC_LABS_API_KEY"] = "removed-key";
    process.env["LIP_SYNC_MODEL"] = "sync-3";
    expect(getLipSyncProviderName()).toBeNull();
    expect(isLipSyncProviderConfigured(getLipSyncProviderName())).toBe(false);
  });

  it("explicit latentsync selects the live route by name", () => {
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

  it("unset with no keys resolves to null (nothing connected)", () => {
    expect(getLipSyncProviderName()).toBeNull();
  });
});

describe("isLipSyncProviderConfigured", () => {
  it("tracks only the live route's key", () => {
    process.env["WAVESPEED_API_KEY"] = "ws-key";
    expect(isLipSyncProviderConfigured("latentsync")).toBe(true);
    // The removed route is not a provider id anymore; any foreign
    // value passed by a legacy caller is simply not configured.
    expect(isLipSyncProviderConfigured("sync" as never)).toBe(false);
    process.env["LIP_SYNC_API_KEY"] = "removed-key";
    expect(isLipSyncProviderConfigured("sync" as never)).toBe(false);
  });

  it("is false for a null provider", () => {
    process.env["WAVESPEED_API_KEY"] = "ws-key";
    expect(isLipSyncProviderConfigured(null)).toBe(false);
    expect(isLipSyncProviderConfigured(undefined)).toBe(false);
  });
});
