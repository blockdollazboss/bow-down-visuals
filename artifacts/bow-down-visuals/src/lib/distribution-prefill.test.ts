import { describe, it, expect } from "vitest";
import { vaultPrefill } from "./distribution";

/* ─── vaultPrefill (EVERYTHING-SMART, stack900 K1) ────────────────────
   The release wizard's vault fetch must carry BOTH fields the vault
   knows — artist name and genre — not just the name. */

describe("vaultPrefill", () => {
  it("takes the first vault's artist name and genre, trimmed", () => {
    expect(
      vaultPrefill([
        { artist_name: "  Thy Cheat Code ", genre: " Hip-Hop " },
        { artist_name: "Other", genre: "Pop" },
      ]),
    ).toEqual({ artistName: "Thy Cheat Code", genre: "Hip-Hop" });
  });

  it("returns nulls for empty, blank, or malformed payloads", () => {
    expect(vaultPrefill(undefined)).toEqual({ artistName: null, genre: null });
    expect(vaultPrefill(null)).toEqual({ artistName: null, genre: null });
    expect(vaultPrefill([])).toEqual({ artistName: null, genre: null });
    expect(vaultPrefill([{ artist_name: "   ", genre: 42 }])).toEqual({
      artistName: null,
      genre: null,
    });
  });

  it("keeps a name-only vault working (genre stays null)", () => {
    expect(vaultPrefill([{ artist_name: "Solo Act" }])).toEqual({
      artistName: "Solo Act",
      genre: null,
    });
  });
});
