/**
 * get-paid-tail-components — World Parity P3-F source-contract
 * pins. Both tail desks must ride the SITE's real endpoints (the
 * Settings panels are the reference implementation) and the
 * sanctioned-exit discipline (no same-tab walk-outs; the export's
 * answer is a file download, the board's own statement pattern):
 * - the CatalogExportDesk builds on POST /api/catalog-export/build
 *   via the lib's path/payload helpers and reports the server's
 *   truncation flag honestly;
 * - the SuccessionDesk reads and writes the /api/legacy/* rails
 *   via the lib's paths/payloads, with the panel's own verbs;
 * - both desks hang inside the EarningsBoard (the Get Paid Room),
 *   under its guest pitch — never as standalone panels.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const exportDesk = read("../../components/world/native/CatalogExportDesk.tsx");
const successionDesk = read("../../components/world/native/SuccessionDesk.tsx");
const earningsBoard = read("../../components/world/native/boards/EarningsBoard.tsx");

describe("P3-F catalog-export desk contracts", () => {
  it("builds on the trust rail via the lib helpers", () => {
    expect(exportDesk).toContain("fetch(exportBuildPath(), {");
    expect(exportDesk).toContain('method: "POST"');
    expect(exportDesk).toContain("exportBuildPayload(kind, fields, format)");
    expect(exportDesk).toContain("exportBuildProblem(kind, fields)");
    expect(exportDesk).toContain("parseExportBuildResult(kind, format, text, truncatedHeader)");
  });

  it("carries the truncation flag and downloads the file in-room", () => {
    expect(exportDesk).toContain('res.headers.get("X-Export-Truncated")');
    expect(exportDesk).toContain("catalogFileName(kind, format)");
    expect(exportDesk).toContain('document.createElement("a")');
    expect(exportDesk).toContain("a.download = catalogFileName(kind, format)");
    expect(exportDesk).toContain('data-testid="world-catalog-export-desk"');
    expect(exportDesk).toContain('data-testid="world-catalog-export-build"');
    expect(exportDesk).toContain("exportResultLine(result)");
  });

  it("never walks out of the room", () => {
    expect(exportDesk).not.toContain("window.location");
    expect(exportDesk).not.toContain('target="_blank"');
    expect(exportDesk).not.toContain("TransferFooter");
  });
});

describe("P3-F succession desk contracts", () => {
  it("reads and writes the designation on the legacy rail", () => {
    expect(successionDesk).toContain("fetch(legacyDesignationPath(), { headers: await authHeaders() })");
    expect(successionDesk).toContain("designationPayload(heir, instructions)");
    expect(successionDesk).toContain('method: "DELETE"');
    expect(successionDesk).toContain("parseLegacyDesignationState(await res.json())");
    expect(successionDesk).toContain("legacyDesignationLine(state)");
    expect(successionDesk).toContain('data-testid="world-succession-desk"');
    expect(successionDesk).toContain('data-testid="world-succession-save"');
  });

  it("answers the inbox on the respond rail", () => {
    expect(successionDesk).toContain("fetch(legacyInboxPath(), { headers: await authHeaders() })");
    expect(successionDesk).toContain("fetch(legacyRespondPath(row.id), {");
    expect(successionDesk).toContain("legacyRespondPayload(response)");
    expect(successionDesk).toContain('data-testid="world-succession-accept"');
    expect(successionDesk).toContain('data-testid="world-succession-decline"');
  });

  it("saves and removes the legacy contact with the two-step remove", () => {
    expect(successionDesk).toContain("fetch(legacyContactPath(), { headers: await authHeaders() })");
    expect(successionDesk).toContain('method: "PUT"');
    expect(successionDesk).toContain("legacyContactPayload(cName, cEmail, cNote)");
    expect(successionDesk).toContain("legacyContactProblem(cName, cEmail, cNote)");
    expect(successionDesk).toContain('data-testid="world-legacy-contact-desk"');
    expect(successionDesk).toContain('data-testid="world-legacy-contact-remove-confirm"');
  });

  it("never walks out of the room", () => {
    expect(successionDesk).not.toContain("window.location");
    expect(successionDesk).not.toContain('target="_blank"');
    expect(successionDesk).not.toContain("TransferFooter");
  });
});

describe("P3-F desks hang in the Get Paid Room", () => {
  it("the EarningsBoard renders both desks for members", () => {
    expect(earningsBoard).toContain('import { CatalogExportDesk } from "@/components/world/native/CatalogExportDesk";');
    expect(earningsBoard).toContain('import { SuccessionDesk } from "@/components/world/native/SuccessionDesk";');
    expect(earningsBoard).toContain("<CatalogExportDesk isLight={isLight} />");
    expect(earningsBoard).toContain("<SuccessionDesk isLight={isLight} />");
  });
});
