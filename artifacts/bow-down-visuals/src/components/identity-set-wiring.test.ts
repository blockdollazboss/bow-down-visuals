/**
 * identity-set-wiring.test.ts — source pins for Vault Identity Sets
 * (Higgsfield G4, honest near-term form) on the frontend.
 *
 * The contract pinned here:
 *  (a) Scene Studio asks the server for the per-shot identity pick with
 *      the scene's context and the creator's override, and renders the
 *      pick + its reason (data-testid="identity-picker") only when the
 *      character actually has a set;
 *  (b) generation consumes the pick through the same reference slot the
 *      single main photo always used — no set = the main photo flows
 *      exactly as before;
 *  (c) the vault page carries the Identity Set section (docked in the
 *      vault modal beside Wardrobe), with coverage coaching rendered
 *      from the server report and AI-generated photos admitted only
 *      with the generated label on + badged.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sceneStudio = readFileSync(new URL("./SceneStudio.tsx", import.meta.url), "utf8");
const vaultPage = readFileSync(new URL("../pages/artist-vault.tsx", import.meta.url), "utf8");
const en = JSON.parse(readFileSync(new URL("../locales/en.json", import.meta.url), "utf8"));

describe("SceneStudio — the per-shot identity pick", () => {
  it("requests the pick from the select rail with scene context + override", () => {
    expect(sceneStudio).toContain("/identity-photos/select");
    expect(sceneStudio).toContain("cameraMovement: scene.cameraMovement");
    expect(sceneStudio).toContain("wardrobeHint: pickedOutfit?.label ?? null");
    expect(sceneStudio).toContain("overridePhotoId: identityOverrideId");
  });

  it("renders the picker + reason only for characters with a set", () => {
    expect(sceneStudio).toContain('data-testid="identity-picker"');
    expect(sceneStudio).toContain("identitySetCount >= 1 && identityPool.length >= 2 && identityPick");
    expect(sceneStudio).toContain('data-testid="text-identity-pick-reason"');
    expect(sceneStudio).toContain("identityPick.reason");
  });

  it("the override is a tap on a pool photo", () => {
    expect(sceneStudio).toContain("onClick={() => setIdentityOverrideId(p.id)}");
  });

  it("generated set photos are badged in the picker", () => {
    expect(sceneStudio).toContain('p.source === "generated"');
  });
});

describe("SceneStudio — generation consumes the pick through the existing reference slot", () => {
  it("the pick wins the vault-photo slot only when a set exists", () => {
    expect(sceneStudio).toContain("identitySetCount >= 1 && identityPick");
    expect(sceneStudio).toContain("const vaultPhotoUrl: string | null =");
    expect(sceneStudio).toContain("identityRefUrl ??");
  });

  it("the resolved vault photo feeds both the single reference and the cast composite", () => {
    expect(sceneStudio).toContain("scene.locationImageUrl ??\n        vaultPhotoUrl");
    expect(sceneStudio).toContain("imageUrl: vaultPhotoUrl");
  });
});

describe("Artist Vault page — the Identity Set section", () => {
  it("the section exists and is docked in the vault modal", () => {
    expect(vaultPage).toContain("function IdentitySetSection");
    expect(vaultPage).toContain("<IdentitySetSection");
    expect(vaultPage).toContain("mainPhotoUrl={vault.reference_image_url}");
  });

  it("reads the set + coverage from the identity rail", () => {
    expect(vaultPage).toContain("/identity-photos`");
    expect(vaultPage).toContain("coverage.missingMessages");
    expect(vaultPage).toContain("coverage.summary");
  });

  it("AI-generated portraits enter only with the label on, and are badged", () => {
    expect(vaultPage).toContain('source: isGenerated ? "generated" : "upload"');
    expect(vaultPage).toContain('p.source === "generated"');
    expect(vaultPage).toContain('t("artistVault.identityGeneratedBadge")');
  });

  it("labels are editable per photo (angle / expression / wardrobe PATCH)", () => {
    expect(vaultPage).toContain("updatePhoto(p.id, { angle: e.target.value })");
    expect(vaultPage).toContain("updatePhoto(p.id, { expression: e.target.value })");
    expect(vaultPage).toContain("updatePhoto(p.id, { wardrobe: v })");
  });
});

describe("i18n — identity copy exists in English", () => {
  it("the artistVault.identity* keys are present", () => {
    const keys = Object.keys(en.artistVault).filter((k) => k.startsWith("identity"));
    expect(keys.length).toBeGreaterThanOrEqual(30);
    expect(en.artistVault.identityTitle).toContain("Identity Set");
    expect(en.artistVault.identityBlurb).toContain("nothing is trained on them");
  });
});
