/**
 * Artist Vault — honest load states (Stack 400 C-28: the honest-load
 * pin layer completing the "empty lie" audit).
 *
 * Four list loads, all honest, none pinned until now:
 *  - Saved profiles (the page's main list): fetchVaults() throws on
 *    non-ok, the catch sets vaultsError — its own comment states the
 *    law ("A failed load is NOT an empty vault") — and the grid
 *    renders loading → error card (retry btn-retry-vaults, wired to
 *    fetchVaults) → the empty panel, in that order.
 *  - Wardrobe outfits and Identity-set photos (per-vault sections):
 *    each loader throws on non-ok and lands the message in the
 *    section's error state via plainErrorText; the section renders
 *    that error line in-panel ({error && …}) and its loading line
 *    before the empty line, so a failed load is never silent.
 *  - Voice pickers (songs / voices): both loaders throw on non-ok
 *    with their load-failed keys into the same in-panel error line.
 * This file pins those shapes in source, like the sibling
 * honest-load pins (the FE suite runs in node, no DOM).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const page = read("./artist-vault.tsx");

function slice(from: string, to: string): string {
  const a = page.indexOf(from);
  expect(a, `marker ${from}`).toBeGreaterThan(-1);
  const b = page.indexOf(to, a);
  expect(b, `end marker ${to}`).toBeGreaterThan(a);
  return page.slice(a, b);
}

const LOCALES = ["en", "es", "fr", "de", "it", "pt", "ar", "hi", "ja", "ko"] as const;
function flat(o: unknown, p = "", out: Record<string, string> = {}): Record<string, string> {
  if (o && typeof o === "object" && !Array.isArray(o)) {
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      const key = p ? `${p}.${k}` : k;
      if (v && typeof v === "object" && !Array.isArray(v)) flat(v, key, out);
      else out[key] = v as string;
    }
  }
  return out;
}

describe("saved profiles — the main list", () => {
  const loader = slice("async function fetchVaults()", "useEffect(() => { fetchVaults(); }, []);");

  it("the loader throws on non-ok and records the error state in its catch", () => {
    expect(loader).toContain("if (!res.ok) throw new Error();");
    expect(loader).toContain("setVaultsError(true);");
  });

  it("a successful load records the profiles and clears the error; loading always clears", () => {
    expect(loader).toContain("setVaults(data.vaults);");
    expect(loader).toContain("setVaultsError(false);");
    expect(loader).toContain("setLoadingVaults(false);");
  });

  it("the grid reaches the empty panel only after the loading and error branches", () => {
    const loadingAt = page.indexOf("{loadingVaults ? (");
    const errorAt = page.indexOf(") : vaultsError && vaults.length === 0 ? (");
    const emptyAt = page.indexOf(") : vaults.length === 0 ? (");
    expect(loadingAt).toBeGreaterThan(-1);
    expect(errorAt).toBeGreaterThan(loadingAt);
    expect(emptyAt).toBeGreaterThan(errorAt);
  });

  it("the error card's retry is wired to the real loader", () => {
    expect(page).toContain('data-testid="btn-retry-vaults"');
    expect(page).toContain("onClick={() => { setLoadingVaults(true); void fetchVaults(); }}");
  });
});

describe("wardrobe outfits — failure lands in the section's rendered error state", () => {
  const section = slice("function WardrobeSection(", "function IdentitySetSection(");

  it("the loader throws on non-ok and the catch records the load-failed message", () => {
    expect(section).toContain('if (!res.ok) throw new Error(apiErrorMessage(data, t("artistVault.wardrobeLoadFailed")));');
    expect(section).toContain('setError(plainErrorText(err, t("artistVault.wardrobeLoadFailed")));');
  });

  it("the error state renders in-panel, and loading precedes the empty line", () => {
    expect(section).toContain("{error && <p className=\"mt-2 text-xs text-red-400\">{error}</p>}");
    const loadingAt = section.indexOf("{loading ? (");
    const emptyAt = section.indexOf(") : outfits.length === 0 ? (");
    expect(loadingAt).toBeGreaterThan(-1);
    expect(emptyAt).toBeGreaterThan(loadingAt);
    expect(section).toContain('t("artistVault.loadingWardrobe")');
    expect(section).toContain('t("artistVault.noOutfits")');
  });
});

describe("identity-set photos — failure lands in the section's rendered error state", () => {
  const section = slice("function IdentitySetSection(", "function VaultModal(");

  it("the loader throws on non-ok and the catch records the load-failed message", () => {
    expect(section).toContain('if (!res.ok) throw new Error(apiErrorMessage(data, t("artistVault.identityLoadFailed")));');
    expect(section).toContain('setError(plainErrorText(err, t("artistVault.identityLoadFailed")));');
  });

  it("the error state renders in-panel, and loading precedes the empty line", () => {
    expect(section).toContain("{error && <p className=\"mt-2 text-xs text-red-400\">{error}</p>}");
    const loadingAt = section.indexOf("{loading ? (");
    const emptyAt = section.indexOf(") : photos.length === 0 && !mainPhotoUrl ? (");
    expect(loadingAt).toBeGreaterThan(-1);
    expect(emptyAt).toBeGreaterThan(loadingAt);
    expect(section).toContain('t("artistVault.identityLoading")');
    expect(section).toContain('t("artistVault.identityEmpty")');
  });
});

describe("voice pickers — songs and voices loads fail into the same error line", () => {
  const section = slice("function LockedVoiceSection(", "function ReferenceVideoSection(");

  it("both loaders throw on non-ok with their load-failed keys", () => {
    expect(section).toContain('if (!res.ok) throw new Error(apiErrorMessage(data, t("artistVault.loadSongsFailed")));');
    expect(section).toContain('if (!res.ok) throw new Error(apiErrorMessage(data, t("artistVault.loadVoicesFailed")));');
  });

  it("the error renders in-panel alongside the pickers' empty lines", () => {
    expect(section).toContain("{error && <p className=\"mt-2 text-xs text-red-400\">{error}</p>}");
    expect(section).toContain('t("artistVault.noSongsYet")');
    expect(section).toContain('t("artistVault.noVoicesFound")');
  });
});

describe("copy keys exist in all 10 catalogs", () => {
  it.each(LOCALES)("%s carries the artistVault honest-load keys", (loc) => {
    const cat = flat(JSON.parse(read(`../locales/${loc}.json`)));
    for (const k of [
      "artistVault.loading",
      "artistVault.noProfilesYet",
      "artistVault.wardrobeLoadFailed",
      "artistVault.identityLoadFailed",
      "artistVault.loadSongsFailed",
      "artistVault.loadVoicesFailed",
      "artistVault.loadingWardrobe",
      "artistVault.noOutfits",
      "artistVault.identityLoading",
      "artistVault.identityEmpty",
      "artistVault.noSongsYet",
      "artistVault.noVoicesFound",
    ]) {
      expect(typeof cat[k] === "string" && cat[k]!.trim() !== "", `${loc}: ${k}`).toBe(true);
    }
  });
});
