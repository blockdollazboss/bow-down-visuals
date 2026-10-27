/**
 * get-paid-tail — World Parity P3-F pure-logic pins. Every
 * expectation is traced to the 2D surface that owns the rail
 * (named in get-paid-tail.ts's header): the Settings catalog
 * builder (TrustPanels' CatalogExportPanel +
 * components/trust/catalog-export-options, over the server
 * whitelist CATALOG_EXPORT_KINDS in routes/trust.ts) and
 * TrustPanels' LegacySettings / LegacyContactSettings over the
 * /api/legacy/* rails.
 */
import { describe, expect, it } from "vitest";
import {
  CATALOG_EXPORT_FIELD_OPTIONS as SITE_FIELD_OPTIONS,
  CATALOG_EXPORT_KIND_OPTIONS as SITE_KIND_OPTIONS,
} from "../../components/trust/catalog-export-options";
import {
  CATALOG_EXPORT_FIELD_OPTIONS,
  CATALOG_EXPORT_KIND_OPTIONS,
  CATALOG_EXPORT_ROW_CAP,
  allExportFields,
  catalogFileName,
  csvRowCount,
  designationPayload,
  designationProblem,
  exportBuildPath,
  exportBuildPayload,
  exportBuildProblem,
  exportKindLabel,
  exportResultLine,
  legacyContactPath,
  legacyContactPayload,
  legacyContactProblem,
  legacyDesignationLine,
  legacyDesignationPath,
  legacyInboxPath,
  legacyRespondPath,
  legacyRespondPayload,
  parseExportBuildResult,
  parseLegacyContact,
  parseLegacyDesignationAnswer,
  parseLegacyDesignationState,
  parseLegacyInbox,
} from "./get-paid-tail";

const HEIR = "9b2f1c4e-7a3d-4e5f-8a0b-1c2d3e4f5a6b";
const OWNER = "11111111-2222-4333-8444-555555555555";

describe("catalog-export options mirror the site's builder options", () => {
  it("kinds match components/trust/catalog-export-options exactly", () => {
    expect(CATALOG_EXPORT_KIND_OPTIONS).toEqual(SITE_KIND_OPTIONS);
  });

  it("fields match per kind, keys and labels", () => {
    for (const { kind } of SITE_KIND_OPTIONS) {
      expect(CATALOG_EXPORT_FIELD_OPTIONS[kind as keyof typeof CATALOG_EXPORT_FIELD_OPTIONS]).toEqual(
        SITE_FIELD_OPTIONS[kind],
      );
    }
  });

  it("names the server's row cap (CATALOG_EXPORT_ROW_CAP in routes/trust.ts)", () => {
    expect(CATALOG_EXPORT_ROW_CAP).toBe(2000);
  });

  it("allExportFields returns the kind's whitelist in order", () => {
    expect(allExportFields("tracks")).toEqual(["id", "title", "source", "durationSec", "fileUrl", "createdAt"]);
    expect(allExportFields("store")).toContain("priceCents");
    expect(exportKindLabel("store")).toBe("Store products");
  });
});

describe("export build shaping", () => {
  it("refuses what the server would 400, in the member's words", () => {
    expect(exportBuildProblem("audience", ["id"])).toMatch(/Choose a catalog kind/);
    expect(exportBuildProblem("tracks", [])).toMatch(/at least one field/);
    expect(exportBuildProblem("tracks", ["title", "bpm"])).toMatch(/no field called bpm/);
    expect(exportBuildProblem("tracks", ["title"])).toBeNull();
  });

  it("payload is the site builder's shape, fields de-duplicated", () => {
    expect(exportBuildPath()).toBe("/api/catalog-export/build");
    expect(exportBuildPayload("videos", ["id", "title", "id"], "json")).toEqual({
      kind: "videos",
      fields: ["id", "title"],
      format: "json",
    });
  });

  it("filename is the server's own Content-Disposition name", () => {
    expect(catalogFileName("releases", "csv")).toBe("my-catalog-releases.csv");
    expect(catalogFileName("projects", "json")).toBe("my-catalog-projects.json");
  });
});

describe("export build results — honest counts", () => {
  it("counts CSV data rows under the header", () => {
    expect(csvRowCount("id,title\r\n1,A\r\n2,B\r\n")).toBe(2);
    expect(csvRowCount("id,title\r\n")).toBe(0);
    expect(csvRowCount("")).toBeNull();
  });

  it("reads the JSON document's own count and truncation flag", () => {
    const body = JSON.stringify({
      format: "catalog-export", kind: "tracks", fields: ["id"], count: 2000,
      truncated: true, exportedAt: "2026-10-27T00:00:00.000Z", rows: [{ id: "x" }],
    });
    const r = parseExportBuildResult("tracks", "json", body, false);
    expect(r).toEqual({ kind: "tracks", format: "json", count: 2000, truncated: true, exportedAt: "2026-10-27T00:00:00.000Z" });
  });

  it("trusts the truncation header even when the body is silent", () => {
    const r = parseExportBuildResult("tracks", "csv", "id\r\n1\r\n", true);
    expect(r?.truncated).toBe(true);
    expect(r?.count).toBe(1);
  });

  it("returns null rather than inventing a count for a garbage body", () => {
    expect(parseExportBuildResult("tracks", "json", "<html>oops</html>", false)).toBeNull();
    expect(parseExportBuildResult("tracks", "json", JSON.stringify({ nope: 1 }), false)).toBeNull();
    expect(parseExportBuildResult("tracks", "csv", "", false)).toBeNull();
  });

  it("result line states the cap plainly when the build was cut", () => {
    const cut = exportResultLine({ kind: "tracks", format: "csv", count: 2000, truncated: true, exportedAt: null });
    expect(cut).toContain("2,000 tracks");
    expect(cut).toContain("newest rows only");
    const whole = exportResultLine({ kind: "tracks", format: "csv", count: 12, truncated: false, exportedAt: null });
    expect(whole).toContain("12 tracks");
    expect(whole).not.toContain("cap");
  });
});

const designationWire = {
  id: "d1", userId: OWNER, heirUserId: HEIR, status: "pending",
  instructions: "Keep the page kind.", includes: ["catalog", "page"],
  excludes: ["private messages", "payment rails and payout credentials"],
  activation: "manual_review", createdAt: "2026-10-01T00:00:00.000Z", updatedAt: null,
};

describe("legacy designation parsing", () => {
  it("parses the standing state with its includes/excludes", () => {
    const s = parseLegacyDesignationState({
      designation: designationWire, includes: ["catalog", "page"],
      excludes: ["private messages", "payment rails and payout credentials"], activation: "manual_review",
    });
    expect(s?.designation?.heirUserId).toBe(HEIR);
    expect(s?.includes).toEqual(["catalog", "page"]);
    expect(s && legacyDesignationLine(s)).toContain("pending");
  });

  it("parses the no-designation state honestly", () => {
    const s = parseLegacyDesignationState({ designation: null, includes: ["catalog", "page"], excludes: [], activation: "manual_review" });
    expect(s?.designation).toBeNull();
    expect(s && legacyDesignationLine(s)).toMatch(/No designation recorded/);
    expect(parseLegacyDesignationState(null)).toBeNull();
    expect(parseLegacyDesignationState("junk")).toBeNull();
  });

  it("a revoked designation reads as none standing", () => {
    const s = parseLegacyDesignationState({ designation: { ...designationWire, status: "revoked" }, includes: [], excludes: [], activation: "manual_review" });
    expect(s && legacyDesignationLine(s)).toMatch(/No designation recorded/);
  });

  it("write answers fold back into a designation; junk folds to null", () => {
    expect(parseLegacyDesignationAnswer({ designation: designationWire })?.status).toBe("pending");
    expect(parseLegacyDesignationAnswer({ designation: null })).toBeNull();
    expect(parseLegacyDesignationAnswer({})).toBeNull();
  });

  it("inbox keeps only rows that parse, with the designator's id", () => {
    const rows = parseLegacyInbox({ designations: [designationWire, { id: "bad" }, null] });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.userId).toBe(OWNER);
    expect(parseLegacyInbox({})).toEqual([]);
  });
});

describe("legacy payloads and problems mirror the rails", () => {
  it("paths are the trust routes' own", () => {
    expect(legacyDesignationPath()).toBe("/api/legacy/designation");
    expect(legacyInboxPath()).toBe("/api/legacy/inbox");
    expect(legacyRespondPath("d 1")).toBe("/api/legacy/inbox/d%201/respond");
    expect(legacyContactPath()).toBe("/api/legacy/contact");
  });

  it("designation body is TrustPanels' shape — heir trimmed, instructions as typed", () => {
    expect(designationPayload(`  ${HEIR}  `, "  words  ")).toEqual({ heirUserId: HEIR, instructions: "  words  " });
  });

  it("designation problems mirror the server's zod bounds", () => {
    expect(designationProblem("", "")).toMatch(/Enter your heir's account ID/);
    expect(designationProblem("not-a-uuid", "")).toMatch(/doesn't look like an account ID/);
    expect(designationProblem(HEIR, "x".repeat(2001))).toMatch(/2,000 characters/);
    expect(designationProblem(HEIR, "ok")).toBeNull();
  });

  it("respond body is the enum only", () => {
    expect(legacyRespondPayload("accept")).toEqual({ response: "accept" });
    expect(legacyRespondPayload("decline")).toEqual({ response: "decline" });
  });
});

describe("legacy contact parsing and shaping", () => {
  it("parses a recorded contact; absence parses to null", () => {
    expect(parseLegacyContact({ contact: { name: "Sam", email: "sam@example.com", note: "Partner", createdAt: null, updatedAt: null } }))
      .toEqual({ name: "Sam", email: "sam@example.com", note: "Partner" });
    expect(parseLegacyContact({ contact: null })).toBeNull();
    expect(parseLegacyContact({ contact: { name: "Sam" } })).toBeNull();
    expect(parseLegacyContact(null)).toBeNull();
  });

  it("contact body trims all three fields", () => {
    expect(legacyContactPayload("  Sam ", " sam@example.com ", " note ")).toEqual({
      name: "Sam", email: "sam@example.com", note: "note",
    });
  });

  it("contact problems mirror legacyContactBody's bounds", () => {
    expect(legacyContactProblem("", "a@b.co", "")).toMatch(/name/);
    expect(legacyContactProblem("Sam", "", "")).toMatch(/email/);
    expect(legacyContactProblem("Sam", "not-an-email", "")).toMatch(/doesn't look complete/);
    expect(legacyContactProblem("Sam", "a@b.co", "x".repeat(1001))).toMatch(/1,000 characters/);
    expect(legacyContactProblem("Sam", "a@b.co", "")).toBeNull();
  });
});
