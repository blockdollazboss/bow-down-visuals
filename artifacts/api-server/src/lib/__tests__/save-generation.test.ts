/**
 * saveGeneration + asVaultId (0142, G8): generations record the
 * Creative Vault character they were made as. A malformed id from a
 * request body must degrade to null — never break the save.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "crypto";

const captured = vi.hoisted(() => ({ values: null as any }));

vi.mock("@workspace/db", () => ({
  generationsTable: { __table: "generations" },
  db: {
    insert: vi.fn(() => ({
      values: vi.fn(async (v: unknown) => {
        captured.values = v;
      }),
    })),
  },
}));

import { saveGeneration, asVaultId } from "../save-generation";

describe("asVaultId", () => {
  it("accepts UUIDs, rejects everything else", () => {
    const id = randomUUID();
    expect(asVaultId(id)).toBe(id);
    expect(asVaultId("not-a-uuid")).toBeNull();
    expect(asVaultId("")).toBeNull();
    expect(asVaultId(null)).toBeNull();
    expect(asVaultId(undefined)).toBeNull();
    expect(asVaultId(42)).toBeNull();
    expect(asVaultId({ id })).toBeNull();
  });
});

describe("saveGeneration", () => {
  beforeEach(() => {
    captured.values = null;
  });

  it("stores the character the generation was made as", async () => {
    const vaultId = randomUUID();
    await saveGeneration({
      userId: randomUUID(),
      type: "image",
      title: "Cover",
      fileUrl: "https://example.com/x.png",
      artistVaultId: vaultId,
    });
    expect(captured.values.artist_vault_id).toBe(vaultId);
  });

  it("a malformed character id degrades to null, save still lands", async () => {
    await saveGeneration({
      userId: randomUUID(),
      type: "image",
      fileUrl: "https://example.com/x.png",
      artistVaultId: "garbage",
    });
    expect(captured.values.artist_vault_id).toBeNull();
    expect(captured.values.file_url).toBe("https://example.com/x.png");
  });

  it("no character stays null (pre-0142 behavior)", async () => {
    await saveGeneration({ userId: randomUUID(), type: "song", fileUrl: "https://example.com/s.mp3" });
    expect(captured.values.artist_vault_id).toBeNull();
  });
});
