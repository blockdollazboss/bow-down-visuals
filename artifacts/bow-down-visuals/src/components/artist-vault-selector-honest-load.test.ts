/**
 * ArtistVaultSelector — honest load states (Stack-400 C-28
 * components residual, deep-pins tranche 1). The selector lists the
 * creator's subject profiles (GET /api/artist-vaults) at the top of
 * the creation tools. It carries the full honest machine, stated in
 * its own catch comment: "A failed load is NOT an empty vault."
 * The loader throws on a non-ok response and records the error
 * state; while the first load is in flight the selector renders
 * nothing; the render order is error notice (with a retry wired to
 * the real reload via the retry nonce) BEFORE the genuine-empty
 * "No subject profiles yet" branch — and the error branch is gated
 * on no vault being loaded, so a failed refresh never strips a
 * selector that already has its subject.
 *
 * Copy is hardcoded English literals; no catalog block. The FE suite
 * runs in node (no DOM), so these tests pin the machine in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const selector = read("./ArtistVaultSelector.tsx");
const loadAt = selector.indexOf("async function loadVaults() {");
const loader = selector.slice(loadAt, selector.indexOf("}, [retryNonce]);", loadAt));

describe("failure path — a failed vault load never reads as an empty vault", () => {
  it("the loader throws on a non-ok response", () => {
    expect(loader).toContain('const res = await fetch("/api/artist-vaults", {');
    expect(loader).toContain("if (!res.ok) throw new Error();");
  });

  it("success records the vaults and clears the error state", () => {
    expect(loader).toContain("setVaults(data.vaults);");
    expect(loader).toContain("setLoadError(false);");
  });

  it("the catch records the error state, under the file's own honesty comment", () => {
    expect(loader).toContain("A failed load is NOT an empty vault");
    expect(loader).toContain("setLoadError(true);");
    expect(loader).toContain("setFetching(false);");
  });

  it("failure renders the error notice with a retry wired to the real reload", () => {
    expect(selector).toContain("We couldn&apos;t load your subject profiles — your profiles are safe, this just couldn&apos;t reach them.");
    expect(selector).toContain('data-testid="btn-retry-vaults"');
    expect(selector).toContain("onClick={() => setRetryNonce((n) => n + 1)}");
    expect(selector).toContain("}, [retryNonce]);");
  });
});

describe("loading and genuine-empty paths stay distinct from failure", () => {
  it("the first load renders nothing while it is in flight", () => {
    expect(selector).toContain("const [fetching, setFetching] = useState(true);");
    expect(selector).toContain("if (fetching) return null;");
  });

  it("render order is error branch before the genuine-empty branch", () => {
    const errorAt = selector.indexOf("if (!loaded && loadError) {");
    const emptyAt = selector.indexOf("if (!loaded && vaults.length === 0) {");
    expect(errorAt).toBeGreaterThan(-1);
    expect(emptyAt).toBeGreaterThan(errorAt);
    expect(selector).toContain("No subject profiles yet.");
  });

  it("a failed refresh never strips a selector whose vault already loaded", () => {
    expect(selector).toContain("if (!loaded && loadError) {");
    expect(selector).toContain("const loaded = loadedVaultProp ?? (loadedVaultId ? vaults.find((v) => v.id === loadedVaultId) : null) ?? null;");
  });
});
