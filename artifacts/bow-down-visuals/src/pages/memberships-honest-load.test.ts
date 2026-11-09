/**
 * Memberships — honest load states (Stack 400 C-28: the honest-load
 * pin layer completing the "empty lie" audit).
 *
 * The page's own comments state the law ("A failed load is NOT a
 * brand-new account") and the machine matches it: load() settles the
 * tiers/dashboard/members sources independently, checks res.ok per
 * source, and reserves the page-wide loadError for a total failure;
 * the fan-side loadMine() and the recovery loadRecovery() each carry
 * their own error state with a retry, and every empty branch is
 * gated on its error state being clear. What was missing is the PIN.
 * This file pins that shape in source, like the sibling honest-load
 * pins (the FE suite runs in node, no DOM). The page-level copy runs
 * through i18n keys, so the keys are pinned plus a catalog block;
 * the fan/recovery error lines are hardcoded English literals and
 * are pinned as literals.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const page = read("./memberships.tsx");
const loadAt = page.indexOf("async function load() {");
const loader = page.slice(loadAt, page.indexOf("if (user) void load();", loadAt));
const mineAt = page.indexOf("async function loadMine() {");
const mineLoader = page.slice(mineAt, page.indexOf("async function loadRecovery() {", mineAt));

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

describe("failure path — a failed fan-club load never reads as a brand-new account", () => {
  it("the main loader settles each source independently and checks res.ok per source", () => {
    expect(loader).toContain("const [tR, dR, mR] = await Promise.allSettled([");
    expect(loader).toContain('const tiersNorm = tR.status === "fulfilled" && tR.value.res.ok ? normalizeTiers(tR.value.data.tiers) : null;');
  });

  it("a total failure records the page-wide error state, in the branch and in the catch", () => {
    expect(loader).toContain("if (!tOk && !dOk && !mOk) {");
    expect(loader).toContain("setLoadError(true);");
    expect(page).toContain("const [loadError, setLoadError] = useState(false);");
  });

  it("a successful load records each source's data and always clears loading", () => {
    expect(loader).toContain("if (tiersNorm) setTiers(tiersNorm);");
    expect(loader).toContain("if (membersNorm) setMembers(membersNorm);");
    expect(loader).toContain("setLoading(false);");
  });

  it("the page error branch carries copy and a retry wired to the real loader", () => {
    expect(page).toContain('t("memberships.errorLoad")');
    expect(page).toContain("onClick={() => void load()}");
    expect(page).toContain('t("memberships.retry")');
  });

  it("the fan-side loader records its own error state on a non-ok or unusable answer", () => {
    expect(mineLoader).toContain("if (!res.ok || !mineNorm) {");
    expect(mineLoader).toContain("setMineError(true);");
    expect(mineLoader).toContain("setMineError(false);");
  });

  it("the fan error branch carries copy and a retry wired to loadMine", () => {
    expect(page).toContain("Couldn't load your memberships — try again.");
    expect(page).toContain("onClick={() => void loadMine()}");
  });

  it("the recovery error branch carries copy and a retry wired to loadRecovery", () => {
    expect(page).toContain("Couldn't load the recovery list — try again.");
    expect(page).toContain("onClick={() => void loadRecovery()}");
  });
});

describe("loading and genuine-empty paths stay distinct from failure", () => {
  it("the page renders its loading state before any content branch", () => {
    const loadingAt = page.indexOf(") : loading ? (");
    const loadErrorAt = page.indexOf("{loadError && (");
    expect(loadingAt).toBeGreaterThan(-1);
    expect(loadErrorAt).toBeGreaterThan(loadingAt);
  });

  it("the fan empty state renders only in the non-error branch", () => {
    const mineErrorAt = page.indexOf("mineError ? (");
    const mineEmptyAt = page.indexOf("mine.memberships.length === 0");
    expect(mineErrorAt).toBeGreaterThan(-1);
    expect(mineEmptyAt).toBeGreaterThan(mineErrorAt);
  });

  it("the recovery empty state renders only in the non-error branch", () => {
    const recoveryErrorAt = page.indexOf("recoveryError ? (");
    const recoveryEmptyAt = page.indexOf("recovery && recovery.members.length === 0");
    expect(recoveryErrorAt).toBeGreaterThan(-1);
    expect(recoveryEmptyAt).toBeGreaterThan(recoveryErrorAt);
  });

  it("the members empty copy is gated on the members error being clear", () => {
    const membersErrorAt = page.indexOf("{membersError && sectionLoadError}");
    const notMembersErrorAt = page.indexOf(") : !membersError ? (");
    expect(membersErrorAt).toBeGreaterThan(-1);
    expect(notMembersErrorAt).toBeGreaterThan(membersErrorAt);
    expect(page).toContain('t("memberships.noMembers")');
  });
});

describe("copy keys exist in all 10 catalogs", () => {
  it.each(LOCALES)("%s carries the memberships honest-load keys", (loc) => {
    const cat = flat(JSON.parse(read(`../locales/${loc}.json`)));
    for (const k of ["memberships.errorLoad", "memberships.retry", "memberships.noMembers"]) {
      expect(typeof cat[k] === "string" && cat[k]!.trim() !== "", `${loc}: ${k}`).toBe(true);
    }
  });
});
