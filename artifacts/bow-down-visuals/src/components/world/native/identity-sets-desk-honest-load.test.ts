/**
 * IdentitySetsDesk — honest load standard (deep-pins tranche 3,
 * batch 6). Two chained loads, each failing as itself: the vault
 * picker (failed → error + retry; loading; the genuine no-characters
 * empty only from a successful zero-read) and, per selected
 * character, the identity set (failed → error + retry wired to that
 * character; loading; the no-photos empty only inside a loaded set).
 * Guests fire NO loads and get the sign-in intro. Every set op rides
 * runSetOp: the op must succeed BEFORE the set reloads and the ok
 * note prints — a thrown op lands the server's words in the note and
 * no success note ever prints. Add / relabel / remove each throw on
 * non-ok before their local cleanup; remove is a two-tap confirm.
 * Pick-for-a-shot throws on non-ok AND on an unparseable selection,
 * and renders the pick only from the parsed answer. Shared
 * (not-owned) characters read + pick but show why they can't be
 * edited, and the add form is owner-only.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./IdentitySetsDesk.tsx");

const slice = (s: string, startMarker: string, endMarker: string) => {
  const a = s.indexOf(startMarker);
  const b = s.indexOf(endMarker, a);
  return s.slice(a, b);
};

describe("the two loads — each fails as itself", () => {
  it("vaults: guests fire nothing; failure is the error state with retry", () => {
    const loader = slice(src, "const loadVaults = useCallback(async () => {", "const loadSet = useCallback");
    expect(loader).toContain("if (isGuest) return;");
    expect(loader).toContain('if (!res.ok) throw new Error("vaults");');
    expect(loader).toContain("setVaultsFailed(true);");
    const failedAt = src.indexOf("{vaultsFailed ? (");
    const loadingAt = src.indexOf(") : vaults === null ? (");
    const emptyAt = src.indexOf(") : vaults.length === 0 ? (");
    expect(failedAt).toBeGreaterThan(-1);
    expect(loadingAt).toBeGreaterThan(failedAt);
    expect(emptyAt).toBeGreaterThan(loadingAt);
    expect(src).toContain("onRetry={() => void loadVaults()}");
  });

  it("the set load resets per character and its empty renders only inside a loaded set", () => {
    const loader = slice(src, "const loadSet = useCallback(async (vaultId: string) => {", "useEffect(() => { void loadVaults(); }");
    expect(loader).toContain("setSet(null);");
    expect(loader).toContain('if (!res.ok) throw new Error("set");');
    expect(loader).toContain("const parsed = identitySetOfResponse(await res.json().catch(() => ({})));");
    expect(loader).toContain('if (!parsed) throw new Error("set");');
    expect(loader).toContain("setSetFailed(true);");
    expect(src).toContain("onRetry={() => void loadSet(selected.id)}");
    expect(src).toContain("set.photos.length === 0 && !set.mainPhotoUrl ? (");
    expect(src).toContain('t("worldCreatorRooms.identityNoPhotos")');
  });
});

describe("the ops — success notes only after the op AND the reload", () => {
  it("runSetOp sequences op → reload → note; a throw lands in the note instead", () => {
    const runner = slice(src, "const runSetOp = async (key: string,", "const addPhoto = () => {");
    expect(runner.indexOf("await loadSet(selectedId);")).toBeGreaterThan(runner.indexOf("await fn();"));
    expect(runner.indexOf("setNote(okNote);")).toBeGreaterThan(runner.indexOf("await loadSet(selectedId);"));
    expect(runner).toContain("setNote(plainErrorText(err, t(\"worldCreatorRooms.identityOpFallback\")));");
  });

  it("add / relabel / remove throw on non-ok before their local cleanup; remove is two-tap", () => {
    const add = slice(src, "const addPhoto = () => {", "const saveRelabel = (photo: IdentityPhoto) => {");
    expect(add).toContain('if (!res.ok) throw new Error(apiErrorMessage(data, t("worldCreatorRooms.identityAddFallback")));');
    expect(add.indexOf("setAddDraft(EMPTY_ADD);")).toBeGreaterThan(add.indexOf("if (!res.ok) throw"));
    const relabel = slice(src, "const saveRelabel = (photo: IdentityPhoto) => {", "const removePhoto = (photo: IdentityPhoto) => {");
    expect(relabel).toContain('if (!res.ok) throw new Error(apiErrorMessage(data, t("worldCreatorRooms.identityRelabelFallback")));');
    const remove = slice(src, "const removePhoto = (photo: IdentityPhoto) => {", "const pickForShot = (overridePhotoId?: string) => {");
    expect(remove).toContain('if (!res.ok) throw new Error(apiErrorMessage(data, t("worldCreatorRooms.identityRemoveFallback")));');
    expect(src).toContain("onClick={() => setConfirmRemoveId(photo.id)}");
    expect(src).toContain('data-testid="world-identity-sets-remove-confirm"');
  });

  it("pick-for-a-shot: an unparseable selection is an error; the pick renders only from the parse", () => {
    const pick = slice(src, "const pickForShot = (overridePhotoId?: string) => {", "const setAdd = (patch:");
    expect(pick).toContain('if (!res.ok) throw new Error(apiErrorMessage(data, t("worldCreatorRooms.identityPickFallback")));');
    expect(pick).toContain("const parsed = identitySelectionOfResponse(data);");
    expect(pick).toContain('if (!parsed) throw new Error(t("worldCreatorRooms.identityPickFallback"));');
    expect(pick.indexOf("setSelection(parsed)")).toBeGreaterThan(pick.indexOf("if (!parsed) throw"));
  });

  it("shared characters explain the read-only boundary; the add form is owner-only", () => {
    expect(src).toContain('data-testid="world-identity-sets-shared-note"');
    expect(src).toContain("{selected.isOwn ? (");
    expect(src).toContain('data-testid="world-identity-sets-add"');
  });
});
