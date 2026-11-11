/**
 * ShoutoutsDesk — honest load standard (deep-pins tranche 3,
 * batch 6). Two loads with two different failure shapes, both
 * honest: the creators board fails as a whole (error state + retry
 * to the real loader; loading and the genuine empty render only
 * around a successful read), while the member's own selling-settings
 * read degrades ALONE into the "no settings yet" line (its code
 * comment: browsing never waits on it) — pinned as that documented
 * degradation, with the settings section still distinguishing
 * loading (undefined) from loaded-none (null). Verify of a pending
 * checkout confirms ONLY from the rail's confirmed answer; an ok
 * but unconfirmed answer is the honest pending note, and a failed
 * refresh changes nothing. The request flow: the made-request body
 * must parse before anything proceeds, a checkout that can't start
 * throws the server's words, and a session with neither an embedded
 * secret nor a hosted url is an error — never a silent success.
 * Guests browse and fire no settings read.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./ShoutoutsDesk.tsx");

const slice = (s: string, startMarker: string, endMarker: string) => {
  const a = s.indexOf(startMarker);
  const b = s.indexOf(endMarker, a);
  return s.slice(a, b);
};

describe("the creators board — fails as a whole", () => {
  it("the loader throws on non-ok AND on an unparseable body before state", () => {
    const loader = slice(src, "const loadCreators = useCallback(async () => {", "const loadSettings = useCallback");
    expect(loader).toContain('if (!res.ok) throw new Error("creators");');
    expect(loader).toContain("const parsed = shoutoutCreatorsOfResponse(await res.json().catch(() => ({})));");
    expect(loader).toContain('if (!parsed) throw new Error("creators");');
    expect(loader.indexOf("setCreators(parsed)")).toBeGreaterThan(loader.indexOf("if (!parsed) throw"));
    expect(loader).toContain("setFailed(true);");
  });

  it("render order is failed (retry wired) → loading → genuine empty → grid", () => {
    const failedAt = src.indexOf("{failed ? (");
    const loadingAt = src.indexOf(") : creators === null ? (");
    const emptyAt = src.indexOf(") : creators.length === 0 ? (");
    const gridAt = src.indexOf('data-testid="world-shoutouts-creators"');
    expect(failedAt).toBeGreaterThan(-1);
    expect(loadingAt).toBeGreaterThan(failedAt);
    expect(emptyAt).toBeGreaterThan(loadingAt);
    expect(gridAt).toBeGreaterThan(emptyAt);
    expect(src).toContain("onRetry={() => void loadCreators()}");
  });
});

describe("the settings read — degrades alone, by design", () => {
  it("guests fire no read; a failure lands as loaded-none, never as a board failure", () => {
    const loader = slice(src, "const loadSettings = useCallback(async () => {", "useEffect(() => { void loadCreators(); }");
    expect(loader).toContain("if (isGuest) return;");
    expect(loader).toContain("/* The selling section degrades alone — browsing never waits on it. */");
    expect(loader).toContain("setSettings(null);");
    expect(src).toContain("settings === undefined ? (");
    expect(src).toContain('t("worldSponsorPress.soSettingsNone")');
  });

  it("saveSettings: the saved note renders only from a parsed ok answer", () => {
    const body = slice(src, "const saveSettings = async () => {", "const setD = (patch:");
    expect(body).toContain('if (!res.ok) throw new Error(apiErrorMessage(data, t("worldSponsorPress.soErrorSettings")));');
    expect(body).toContain("const parsed = shoutoutSettingsOfResponse(data);");
    expect(body).toContain('if (parsed === undefined) throw new Error(t("worldSponsorPress.soErrorSettings"));');
    expect(body.indexOf('t("worldSponsorPress.soSettingsSavedAccepting")')).toBeGreaterThan(
      body.indexOf("if (parsed === undefined) throw"),
    );
  });
});

describe("verify + the money moment — server truth only", () => {
  it("verify confirms only on the rail's confirmed answer; unconfirmed is the pending note", () => {
    const body = slice(src, "const verifyPending = useCallback(async () => {", "useEffect(() => { void verifyPending(); }");
    expect(body).toContain("if (res.ok && shoutoutVerifyConfirmed(data)) {");
    expect(body).toContain("localStorage.removeItem(SHOUTOUT_PENDING_KEY);");
    expect(body).toContain("} else if (res.ok) {");
    expect(body).toContain('setNote(t("worldSponsorPress.soNotePending"));');
    expect(body).toContain("/* status couldn't refresh — nothing about the booking changed */");
  });

  it("the request flow: unparseable request and pageless checkout are errors, never success", () => {
    const body = slice(src, "const submitRequest = async () => {", "const saveSettings = async () => {");
    expect(body).toContain("const made = shoutoutRequestOfResponse(data);");
    expect(body).toContain('if (!made) throw new Error(t("worldSponsorPress.soErrorRequest"));');
    expect(body).toContain('if (!co.ok) throw new Error(apiErrorMessage(coData, t("worldSponsorPress.soErrorCheckoutStart")));');
    expect(body).toContain('throw new Error(t("worldPlansDesk.checkoutNoPage"));');
    expect(body.indexOf("setBuySecret(secret)")).toBeGreaterThan(body.indexOf("const secret = shoutoutEmbeddedSecret(coData);"));
  });
});
