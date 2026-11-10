/**
 * SceneStudio — honest load states (Stack-400 C-28 components
 * residual, deep-pins tranche 1). The editor's scene surface carries
 * three load families, and this pin holds each to its contract:
 *
 * 1. THE LOCATIONS LIBRARY (LocationPicker): a collection load with
 *    a module-level cache shared across scene cards. FIXED IN THIS
 *    LANE: the loader used to map ANY failure (non-ok or network)
 *    into `locationsCache = []`, so a failed load dressed up as the
 *    picker's "No locations saved yet." for the whole page session
 *    and the poisoned cache never retried. The loader now throws on
 *    a non-ok response, caches ONLY a successful load, and clears
 *    the shared in-flight promise on failure; the picker records
 *    the failure and renders an error branch with a working retry
 *    BEFORE the loading and empty branches — the empty copy is
 *    reachable only behind a successful load.
 *
 * 2. QUIET-OPTIONAL ENHANCEMENTS: wardrobe outfits, the identity
 *    photo selection, the all-vaults co-star list and the linked
 *    co-stars load silently BY DESIGN ("wardrobe is optional —
 *    generation works without it") — and their sections render only
 *    when a successful load actually brought data (outfits render
 *    behind `outfits.length > 0`, the co-star picker behind
 *    `allVaults.length > 1`), so a failed enhancement never prints
 *    an empty claim either; it is simply absent.
 *
 * 3. CLIP AUTO-SAVE (autoSaveClip): the save POST surfaces failure
 *    as a destructive toast carrying the server's message on a
 *    non-ok response — and, FIXED IN THIS LANE, the same toast on a
 *    network throw (it used to swallow silently while the sibling
 *    branch told the creator; the clip is in the UI either way, but
 *    it did not persist and the creator deserved to know).
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const studio = read("./SceneStudio.tsx");

const loader = studio.slice(
  studio.indexOf("function fetchLocationsLibrary"),
  studio.indexOf("function LocationPicker"),
);

describe("the locations library — a failed load is never a cached empty library", () => {
  it("the loader throws on a non-ok response", () => {
    expect(loader).toContain('if (!res.ok) throw new Error("locations library failed to load");');
  });

  it("only a successful load enters the shared cache", () => {
    expect(loader).toContain("locationsCache = data.locations ?? [];");
    expect(loader).not.toContain("res.ok ? (data.locations ?? []) : []");
    expect(loader).not.toContain("locationsCache = [];");
  });

  it("failure clears the shared in-flight promise so the next open retries, and rethrows", () => {
    expect(loader).toContain("locationsFetch = null;");
    expect(loader).toContain("throw err;");
  });

  it("the picker records a rejected load as a failure state, distinct from loaded data", () => {
    expect(studio).toContain("const [loadFailed, setLoadFailed] = useState(false);");
    expect(studio).toContain("() => setLoadFailed(true),");
  });

  it("render order: failure (with retry) before loading, loading before the empty copy", () => {
    const picker = studio.slice(
      studio.indexOf("function LocationPicker"),
      studio.indexOf("/* ─── Scene card"),
    );
    const errIdx = picker.indexOf("Couldn&apos;t load your locations.");
    const spinIdx = picker.indexOf('<Loader2 className="h-5 w-5 animate-spin text-white/40" />');
    const emptyIdx = picker.indexOf("No locations saved yet.");
    expect(errIdx).toBeGreaterThan(-1);
    expect(spinIdx).toBeGreaterThan(errIdx);
    expect(emptyIdx).toBeGreaterThan(spinIdx);
  });

  it("the failure branch's retry re-runs the real load", () => {
    expect(studio).toContain("onClick={() => { setLoadFailed(false); setLoadNonce((n) => n + 1); }}");
    expect(studio).toContain("}, [open, locations, getAccessToken, loadNonce]);");
  });
});

describe("the scene enhancements are quiet-optional — absent on failure, never fake-empty", () => {
  it("the wardrobe load swallows failure under its documented optional note", () => {
    expect(studio).toContain("/* wardrobe is optional — generation works without it */");
    expect(studio).toContain("if (!res.ok || cancelled) return;");
  });

  it("wardrobe renders only when a load actually brought outfits", () => {
    expect(studio).toContain("{hasArtist && outfits.length > 0 && (");
  });

  it("the identity selection swallows failure under its documented enhancement note", () => {
    expect(studio).toContain("/* identity selection is an enhancement — generation works without it */");
  });

  it("the co-star picker renders only when more than the own vault loaded", () => {
    expect(studio).toContain("{allVaults.length > 1 && (");
    expect(studio).toContain("/* character picker is optional */");
  });
});

describe("clip auto-save tells the creator when the clip did not persist", () => {
  it("a non-ok save toasts destructively with the server's message", () => {
    expect(studio).toContain('const creditMsg = body.creditMessage ?? "Clip generated but saving failed.";');
    expect(studio).toContain('toast({ title: "Save failed", description: creditMsg, variant: "destructive" });');
  });

  it("a network-thrown save toasts the same failure instead of swallowing it", () => {
    expect(studio).toContain('toast({ title: "Save failed", description: "Clip generated but saving failed.", variant: "destructive" });');
    expect(studio).not.toContain("/* best-effort — clip is already in the UI */");
  });
});
