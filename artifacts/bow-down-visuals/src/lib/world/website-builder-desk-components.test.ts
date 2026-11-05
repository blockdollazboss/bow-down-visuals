/**
 * website-builder-desk-components — stack100 wave 4, item 23 (#97)
 * source-contract pins. The Website Builder desk must sit in the
 * My Studio stack as a board desk ({ isLight }), with:
 * - the whole builder in-panel: saved projects (open / two-step
 *   delete), the gallery remix shelf, the brief form, generate and
 *   conversational edits, version history with view + restore, the
 *   private preview, the file list, and the zip download;
 * - build/edit riding the standing CreditConfirm path through
 *   useConfirmedApi with NO desk-side price override — the popup
 *   prices from the registry rows, exactly the rail's 3,000 / 200;
 * - the free rails (projects CRUD, versions, restore, templates)
 *   riding plain fetch on the seam's path constants;
 * - honest states: NativeStates for the projects read, a dedicated
 *   out-of-credits line, the save-failed banner with its retry, and
 *   failure copy that names the refund — never a dressed-up success;
 * - no page pull-ups: no hrefs, no location changes, nothing that
 *   leaves the World.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const desk = read("../../components/world/native/WebsiteBuilderDesk.tsx");
const panel = read("../../components/world/StationPanel.tsx");
const seam = read("./website-builder-desk.ts");

describe("the board-desk shape + the My Studio mount", () => {
  it("is a named board desk rooted at its testid", () => {
    expect(desk).toContain(
      "export function WebsiteBuilderDesk({ isLight }: { isLight: boolean })",
    );
    expect(desk).toContain('data-testid="world-website-builder-desk"');
    expect(desk).toContain('worldDeskRemainder.bldTitle');
  });

  it("StationPanel lazy-loads it and stacks it at the My Studio board behind a DeskDoor", () => {
    expect(panel).toContain(
      'const WebsiteBuilderDesk = lazy(() => import("@/components/world/native/WebsiteBuilderDesk")',
    );
    expect(panel).toContain("<WebsiteBuilderDesk isLight={isLight} />");
    const boardAt = panel.indexOf('station.id === "my-studio"');
    const deskAt = panel.indexOf("<WebsiteBuilderDesk isLight={isLight} />");
    const identityAt = panel.indexOf("<IdentitySetsDesk");
    const adminAt = panel.indexOf("<AdminDesk");
    expect(boardAt).toBeGreaterThan(-1);
    expect(deskAt).toBeGreaterThan(boardAt);
    /* In the My Studio stack, after Identity Sets, before Admin. */
    expect(deskAt).toBeGreaterThan(identityAt);
    expect(deskAt).toBeLessThan(adminAt);
  });

  it("its sections carry their own testids", () => {
    for (const id of [
      "world-website-builder-projects",
      "world-website-builder-gallery",
      "world-website-builder-brief",
      "world-website-builder-result",
      "world-website-builder-versions",
    ]) {
      expect(desk, id).toContain(`data-testid="${id}"`);
    }
  });
});

describe("money: the shared rails through the standing spend confirm", () => {
  it("generate and edit ride confirmedFetch on the seam's path constants", () => {
    expect(desk).toContain("confirmedFetch(WEBSITE_BUILDER_GENERATE_PATH");
    expect(desk).toContain("confirmedFetch(WEBSITE_BUILDER_EDIT_PATH");
    expect(desk).toContain("buildWebsiteGenerateBody(");
    expect(desk).toContain("buildWebsiteEditBody(");
  });

  it("carries NO price override — the confirm prices from the registry", () => {
    expect(desk).not.toContain("overrideCost");
    expect(desk).not.toContain("overrideFeature");
    /* …and no hard-coded rail path anywhere in the component: the
       seam's constants are the only way in. */
    expect(desk).not.toContain('"/api/website-builder/generate"');
    expect(desk).not.toContain('"/api/website-builder/edit"');
    expect(desk).not.toContain('"/api/website-builder/projects"');
  });

  it("a declined confirm sends nothing (the null return is honored)", () => {
    expect(desk).toContain("if (!res) return;");
  });

  it("the displayed prices come from the seam's registry-derived constants", () => {
    expect(desk).toContain("WEBSITE_BUILD_COST_VB");
    expect(desk).toContain("WEBSITE_EDIT_COST_VB");
    /* No page-style local price constants (the 2D page's BUILD_COST /
       EDIT_COST literals are deliberately NOT copied). */
    expect(desk).not.toContain("const BUILD_COST");
    expect(desk).not.toContain("const EDIT_COST");
  });

  it("out-of-credits is its own state, never an error dressed as success", () => {
    expect(desk).toContain("websiteBuilderOutOfCredits(res.status, data)");
    expect(desk).toContain("worldDeskRemainder.bldOutOfCredits");
    expect(seam).toContain("nothing was charged");
  });

  it("failure copy names the refund — the rail's honesty, mirrored", () => {
    expect(desk).toContain("worldDeskRemainder.bldGenerationFailed");
    expect(desk).toContain("worldDeskRemainder.bldEditFailed");
    expect(seam).toContain("Generation failed — Visual Bucs were refunded.");
    expect(seam).toContain("Edit failed — Visual Bucs were refunded.");
    /* A response without files is a failure, never a result. */
    expect(desk).toContain("normalizeWebsiteGenerateResult(data)");
    expect(desk).toContain("normalizeWebsiteEditResult(data)");
  });
});

describe("the free rails ride plain fetch on the seam paths", () => {
  it("projects list, detail, version payload, restore, delete, save, templates", () => {
    expect(desk).toContain("fetch(WEBSITE_BUILDER_PROJECTS_PATH");
    expect(desk).toContain("fetch(websiteProjectPath(id)");
    expect(desk).toContain("fetch(websiteProjectVersionPath(id, target)");
    expect(desk).toContain("fetch(websiteProjectRestorePath(projectId, version)");
    expect(desk).toContain("fetch(WEBSITE_BUILDER_TEMPLATES_PATH)");
    expect(desk).toContain("buildWebsiteSaveBody(");
    expect(desk).toContain('method: "DELETE"');
  });

  it("the save retry keeps the per-build clientRef — exactly-once by idempotency", () => {
    expect(desk).toContain("clientRefRef");
    expect(desk).toContain("clientRef: buildClientRef()");
    /* Start-New mints a fresh build identity. */
    expect(desk).toContain("clientRefRef.current = null");
  });

  it("deletes are two-step, spoken in-world", () => {
    expect(desk).toContain("confirmDeleteId");
    expect(desk).toContain("worldDeskRemainder.bldConfirmDelete");
  });
});

describe("honest states + the full flow in-panel", () => {
  it("the projects read uses the Native states — loading, error+retry, honest empty", () => {
    expect(desk).toContain("NativeLoadingState");
    expect(desk).toContain("NativeErrorState");
    expect(desk).toContain("NativeEmptyState");
    expect(desk).toContain("worldDeskRemainder.bldNoSites");
    expect(desk).toContain("worldDeskRemainder.bldSitesLoadFailed");
  });

  it("the save-failed banner keeps the build and offers the retry save", () => {
    expect(desk).toContain("worldDeskRemainder.bldSaveFailedLine");
    expect(desk).toContain("worldDeskRemainder.bldRetrySave");
    expect(desk).toContain("setSaveFailed(!result.saved)");
  });

  it("the brief is gated on the seam's schema gate, the edit on its own", () => {
    expect(desk).toContain("websiteBriefReady({ businessName, description, style, colorScheme })");
    expect(desk).toContain("websiteEditReady(files, editRequest)");
  });

  it("gallery remix seeds real files + the starter brief — free, no charge path", () => {
    expect(desk).toContain("parseGalleryTemplates(data)");
    expect(desk).toContain("cloneTemplateFiles(tpl)");
    expect(desk).toContain("starterBrief(tpl)");
    expect(desk).toContain("worldDeskRemainder.bldRemix");
  });

  it("versions: view loads the exact payload, restore appends a new head", () => {
    expect(desk).toContain("websiteSourceLabel(v.source,");
    expect(desk).toContain("normalizeWebsiteVersionPayload");
    expect(desk).toContain("worldDeskRemainder.bldVersionHistory");
    expect(desk).toContain("Restore");
    expect(desk).toContain("worldDeskRemainder.bldViewingVersion");
  });

  it("the preview is the private sandboxed iframe over the seam's inliner", () => {
    expect(desk).toContain('sandbox="allow-scripts"');
    expect(desk).toContain("srcDoc={buildPreviewHtml(files)}");
    expect(desk).toContain("worldDeskRemainder.bldPrivatePreview");
  });

  it("the zip download is an in-desk file act on the page's JSZip mechanism", () => {
    expect(desk).toContain("jszip/3.10.1/jszip.min.js");
    expect(desk).toContain("websiteZipFolderName(businessName)");
    expect(desk).toContain("websiteZipFileName(businessName)");
    expect(desk).toContain("worldDeskRemainder.bldDownloadZip");
  });

  it("the ownership law is stated in the desk — nothing hosted here", () => {
    expect(desk).toContain("worldDeskRemainder.bldOwnershipLead");
    expect(desk).toContain("worldDeskRemainder.bldFeeNote");
  });
});

describe("World law: nothing leaves the room", () => {
  it("no hrefs, no location changes, no page pull-ups", () => {
    expect(desk).not.toContain("href=");
    expect(desk).not.toContain("window.location");
    expect(desk).not.toContain("history.replaceState");
    expect(desk).not.toContain('"/website-builder"');
  });
});
