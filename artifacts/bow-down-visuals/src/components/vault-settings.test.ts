import { describe, expect, it } from "vitest";
import { formatVaultBytes, vaultPhaseOf, type VaultJobView } from "@/lib/vault-view";

/* The Vault card (#162): the pure state mapping the component renders
   from — working while the background job packages, ready only when
   the job itself says done, failed only on the job's own failure. */

function view(state: VaultJobView["state"]): VaultJobView {
  return { jobId: "j1", state, stage: "…", progress: 0 };
}

describe("vaultPhaseOf", () => {
  it("is idle before any job exists", () => {
    expect(vaultPhaseOf(null)).toBe("idle");
  });

  it("works while queued or active, never before the server says so", () => {
    expect(vaultPhaseOf(view("queued"))).toBe("working");
    expect(vaultPhaseOf(view("active"))).toBe("working");
  });

  it("is ready only on done, failed only on failed", () => {
    expect(vaultPhaseOf(view("done"))).toBe("ready");
    expect(vaultPhaseOf(view("failed"))).toBe("failed");
  });
});

describe("formatVaultBytes", () => {
  it("formats honest sizes", () => {
    expect(formatVaultBytes(0)).toBe("0 B");
    expect(formatVaultBytes(512)).toBe("512 B");
    expect(formatVaultBytes(1536)).toBe("1.5 KB");
    expect(formatVaultBytes(5 * 1024 * 1024)).toBe("5.0 MB");
    expect(formatVaultBytes(2 * 1024 * 1024 * 1024)).toBe("2.0 GB");
  });

  it("never prints nonsense for bad input", () => {
    expect(formatVaultBytes(-1)).toBe("0 B");
    expect(formatVaultBytes(Number.NaN)).toBe("0 B");
  });
});
