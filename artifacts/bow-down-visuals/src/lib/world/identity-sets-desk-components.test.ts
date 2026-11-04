/**
 * identity-sets-desk-components — stack1500 world parity wave
 * #4b item 38 source-contract pins. The Identity Sets desk must
 * sit in the My Studio stack in StationPanel (a lazy DeskDoor
 * beside Move Home) with:
 * - the vault picker on the character picker's own normalizer;
 * - the set grid + the rail's coverage words rendered as-is;
 * - manage controls (add / relabel / remove) gated on isOwn —
 *   the manage rails are strict-owner;
 * - the pick-for-a-shot panel with the reason + override pool;
 * - the soft-delete truth told before a remove;
 * - no confirmed-spend seam (the family is free).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const desk = read("../../components/world/native/IdentitySetsDesk.tsx");
const panel = read("../../components/world/StationPanel.tsx");
const routes = read("../../../../api-server/src/routes/artist-vault-identity.ts");

describe("the My Studio mount", () => {
  it("is a lazy DeskDoor in the my-studio stack", () => {
    expect(panel).toContain('const IdentitySetsDesk = lazy(() => import("@/components/world/native/IdentitySetsDesk")');
    expect(panel).toContain("<IdentitySetsDesk isLight={isLight} isGuest={isGuest} />");
    expect(desk).toContain("export function IdentitySetsDesk({ isLight, isGuest }: { isLight: boolean; isGuest: boolean })");
    expect(desk).toContain('data-testid="world-identity-sets-desk"');
  });
});

describe("the picker + the set", () => {
  it("rides the vault read through the house normalizer with the member's id", () => {
    expect(desk).toContain("fetch(ARTIST_VAULTS_PATH");
    expect(desk).toContain("normalizeVaultCharacters(data, user?.id)");
    expect(desk).toContain('data-testid="world-identity-sets-picker"');
  });

  it("loads the set on the photos rail and renders the rail's coverage words", () => {
    expect(desk).toContain("identityPhotosPath(vaultId)");
    expect(desk).toContain("identitySetOfResponse");
    expect(desk).toContain("{set.coverageSummary}");
    expect(desk).toContain("{item.missingMessage}");
    expect(desk).toContain('data-testid="world-identity-sets-coverage"');
    expect(desk).toContain('data-testid="world-identity-sets-grid"');
  });

  it("the main photo is badged and generated photos are badged", () => {
    expect(desk).toContain("Main photo");
    expect(desk).toContain("In every pick, as the front anchor.");
    expect(desk).toContain('source === "generated"');
    expect(desk).toContain("AI-generated");
  });
});

describe("manage — strict-owner honesty", () => {
  it("add / relabel / remove render only on the member's own characters", () => {
    expect(desk).toContain("selected.isOwn");
    expect(desk).toContain("Adding and editing belong to its owner");
    expect(desk).toContain('data-testid="world-identity-sets-shared-note"');
  });

  it("the verbs ride their rails: POST add, PATCH relabel, DELETE remove", () => {
    expect(desk).toContain("buildIdentityAddPayload(addDraft)");
    expect(desk).toContain('method: "PATCH"');
    expect(desk).toContain("buildIdentityRelabelPayload(relabel)");
    expect(desk).toContain('method: "DELETE"');
    expect(desk).toContain("identityPhotoPath(selected.id, photo.id)");
  });

  it("the cap is honored in the desk before the rail has to refuse", () => {
    expect(desk).toContain("set.photos.length >= set.maxPhotos");
    expect(desk).toContain("the most a set holds");
  });

  it("a remove tells the soft-delete truth first (IDENTITY_REMOVE_COPY)", () => {
    expect(desk).toContain("IDENTITY_REMOVE_COPY");
    expect(desk).toContain('data-testid="world-identity-sets-remove-confirm"');
  });

  it("the routes carry exactly the verbs the desk calls, owner-gated as documented", () => {
    expect(routes).toContain('router.get("/artist-vaults/:vaultId/identity-photos"');
    expect(routes).toContain('router.post("/artist-vaults/:vaultId/identity-photos"');
    expect(routes).toContain('router.patch("/artist-vaults/:vaultId/identity-photos/:photoId"');
    expect(routes).toContain('router.delete("/artist-vaults/:vaultId/identity-photos/:photoId"');
    expect(routes).toContain('router.post("/artist-vaults/:vaultId/identity-photos/select"');
    expect(routes).toContain("getOwnedVault");
    expect(routes).toContain("getAccessibleVault");
  });
});

describe("pick for a shot", () => {
  it("posts the shot context to the select rail and renders the reason verbatim", () => {
    expect(desk).toContain("identitySelectPath(selected.id)");
    expect(desk).toContain("buildIdentitySelectPayload(shot, overridePhotoId)");
    expect(desk).toContain("identitySelectionOfResponse");
    expect(desk).toContain("{selection.reason}");
    expect(desk).toContain('data-testid="world-identity-sets-selection"');
  });

  it("every pool photo is a one-tap override", () => {
    expect(desk).toContain("selection.pool.map");
    expect(desk).toContain("onClick={() => pickForShot(c.id)}");
    expect(desk).toContain("your pick is never second-guessed");
  });

  it("the desk never claims the picker sees inside a photo", () => {
    expect(desk).toContain("It reads the labels, never inside the photo.");
  });
});

describe("free + honest states", () => {
  it("no confirmed-spend seam anywhere; the free pin is quoted", () => {
    expect(desk).not.toContain("confirmedFetch");
    expect(desk).not.toContain("useConfirmedApi");
    expect(desk).toContain("identityPhotosCost()");
  });

  it("guests get the sign-in line; loading/failed/empty render as themselves", () => {
    expect(desk).toContain("Sign in to open your characters");
    expect(desk).toContain("NativeLoadingState");
    expect(desk).toContain("NativeErrorState");
    expect(desk).toContain("NativeEmptyState");
  });
});
