/**
 * Artist Setup (profile editor) — honest load states (Stack-400 pin
 * batch, the "empty lie" family; same shape as the already-pinned
 * collabs "my profile" load).
 *
 * Before the Stack-28 #27 / A3-F5 fix, a FAILED profile load was
 * indistinguishable from "no profile yet": the editor constructed
 * the new-creator emptyProfile and saving from it walked the create
 * branch against an existing profile. After: fetchMyProfile
 * (lib/artist-profiles) returns null ONLY for a genuine 404 and
 * throws otherwise; the page catches and raises its own load-error
 * panel with a retry, and the emptyProfile is constructed only on
 * the successful no-profile outcome. The copy is hardcoded English
 * literals, so this pin asserts the literals and carries no
 * catalog block.
 *
 * The FE suite runs in node (no DOM), so — like the sibling
 * honest-load pins — these tests pin the state machine in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const page = read("./artist-setup.tsx");
const lib = read("../lib/artist-profiles.ts");
const loadAt = page.indexOf("const p = await fetchMyProfile();");
const loader = page.slice(loadAt, page.indexOf("}, [retryNonce]);", loadAt));

describe("failure path — a failed profile load never poses as a blank first-timer form", () => {
  it("the fetch returns null only for a 404; other failures throw through json()", () => {
    expect(lib).toContain("if (res.status === 404) return null;");
    expect(lib).toContain("err.status = res.status;");
  });

  it("the loader catches and records the load error instead of building the empty profile", () => {
    expect(loader).toContain("if (!cancelled) setLoadError(true);");
  });

  it("a successful load with a profile records the exists outcome", () => {
    expect(loader).toContain("if (p) { setProfile(p); setExists(true); wasPublic.current = p.is_public; }");
  });

  it("the new-creator empty profile is constructed only on the successful no-profile outcome", () => {
    expect(loader).toContain("setProfile(emptyProfile({ display_name: preName, avatar_url: preAvatar, bio: preBio }));");
    expect(loader.indexOf("setProfile(emptyProfile(")).toBeLessThan(loader.indexOf("setLoadError(true);"));
  });

  it("failure renders the error panel with a retry wired to the real load, before the editor", () => {
    expect(page).toContain('data-testid="artist-setup-load-error"');
    expect(page).toContain("Your profile couldn't load.");
    expect(page).toContain("onClick={() => { setLoadError(false); setLoading(true); setRetryNonce((n) => n + 1); }}");
    const errAt = page.indexOf('data-testid="artist-setup-load-error"');
    const loadingAt = page.indexOf("if (loading || !profile) {");
    expect(errAt).toBeGreaterThan(-1);
    expect(loadingAt).toBeGreaterThan(errAt);
  });
});

describe("loading path stays distinct from failure and from the new-creator state", () => {
  it("the load starts in the loading state", () => {
    expect(page).toContain("const [loading, setLoading] = useState(true);");
    expect(page).toContain("const [loadError, setLoadError] = useState(false);");
  });
});
