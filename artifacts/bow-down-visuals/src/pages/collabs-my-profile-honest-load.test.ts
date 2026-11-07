/**
 * Collabs "my profile" — honest load states (Stack-200 hardening D2,
 * census section A item 11: the "empty lie" family).
 *
 * Before: loadMyProfile() had no try/catch and acted only
 * `if (res.ok && data.profile)` — a failure (or an unhandled throw)
 * left the blank form defaults with hasProfile false, indistinguishable
 * from never having made a profile, and saving from the blank form
 * POSTs over the real profile. After: the load throws on !res.ok and
 * catches; failure before any successful load raises a banner with a
 * retry over the editor; a successful ok answer — with a profile or a
 * confirmed no-profile — is an explicit loaded outcome that disarms
 * the banner for later reloads. Mirrors the browse/inbox error states
 * the same page already carries.
 *
 * The FE suite runs in node (no DOM), so — like the sibling honest-load
 * pins — these tests pin the state machine in source: which setter each
 * load outcome calls, and which render branch each state reaches. The
 * new copy keys are English in en.json; the other nine catalogs carry
 * the English verbatim as UNREVIEWED placeholders (registered in the
 * collabs wave's legit-identical allowlists).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const page = read("./collabs.tsx");
const loadAt = page.indexOf("async function loadMyProfile()");
const loader = page.slice(loadAt, page.indexOf("async function loadInbox()", loadAt));

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

describe("failure path — a failed profile load never poses as a blank first-timer form", () => {
  it("the loader throws on a non-ok response and catches instead of acting only on res.ok", () => {
    expect(loader).toContain('if (!res.ok) throw new Error("my profile load failed");');
    expect(loader).toContain("} catch {");
    expect(loader).toContain("if (!myProfileLoadedRef.current) setMyProfileLoadError(true);");
  });

  it("a successful load — profile or confirmed no-profile — records the loaded outcome", () => {
    expect(loader).toContain("myProfileLoadedRef.current = true;");
    /* the loaded outcome is recorded on the ok path, after the profile branch */
    expect(loader.indexOf("myProfileLoadedRef.current = true;")).toBeGreaterThan(loader.indexOf("setHasProfile(true);"));
  });

  it("each load attempt clears the banner first so a retry can succeed cleanly", () => {
    expect(loader).toContain("setMyProfileLoadError(false);");
    expect(loader.indexOf("setMyProfileLoadError(false);")).toBeLessThan(loader.indexOf("throw new Error"));
  });

  it("failure renders the banner with a retry wired to the real loader, above the form", () => {
    expect(page).toContain('data-testid="collabs-my-profile-load-error"');
    expect(page).toContain('t("collabs.myProfileLoadError")');
    expect(page).toContain('t("collabs.myProfileLoadErrorBody")');
    expect(page).toContain('t("collabs.myProfileRetry")');
    expect(page).toContain("onClick={() => void loadMyProfile()}");
    const bannerAt = page.indexOf('data-testid="collabs-my-profile-load-error"');
    const formAt = page.indexOf('t("collabs.displayNameLabel")');
    expect(bannerAt).toBeGreaterThan(-1);
    expect(formAt).toBeGreaterThan(bannerAt);
  });
});

describe("copy keys exist in all 10 catalogs", () => {
  it.each(LOCALES)("%s carries the collabs honest-load keys", (loc) => {
    const cat = flat(JSON.parse(read(`../locales/${loc}.json`)));
    for (const k of ["collabs.myProfileLoadError", "collabs.myProfileLoadErrorBody", "collabs.myProfileRetry"]) {
      expect(typeof cat[k] === "string" && cat[k]!.trim() !== "", `${loc}: ${k}`).toBe(true);
    }
  });
});
