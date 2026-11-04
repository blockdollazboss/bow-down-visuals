/**
 * catalog-desk-components — stack1500 world parity wave #3
 * item 11 source-contract pins. The Catalog Import desk must
 * sit in the My Studio stack as a board desk ({ isLight }),
 * with:
 * - the whole pipeline in-panel: accounts + scan, the platform
 *   list with pick-and-fetch + per-item fetch + dismiss, the
 *   upload flow (presign → PUT → register), the waiting list
 *   with draft editing + rebuild + approve + approve-all, and
 *   the home list;
 * - the rail's honesty lines rendered verbatim and blocked
 *   rows kept visible with their status notes;
 * - state re-read after every action (the page's refresh
 *   discipline) and no spend path (every rail is free);
 * - light/dark parity via the desk's isLight branches.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const desk = read("../../components/world/native/CatalogImportDesk.tsx");
const panel = read("../../components/world/StationPanel.tsx");

describe("the board-desk shape + the My Studio mount", () => {
  it("is a named board desk rooted at its testid", () => {
    expect(desk).toContain("export function CatalogImportDesk({ isLight }: { isLight: boolean })");
    expect(desk).toContain('data-testid="world-catalog-desk"');
  });

  it("StationPanel stacks it at the My Studio board behind a DeskDoor", () => {
    expect(panel).toContain('const CatalogImportDesk = lazy(() => import("@/components/world/native/CatalogImportDesk")');
    expect(panel).toContain("<CatalogImportDesk isLight={isLight} />");
  });
});

describe("the whole pipeline in-panel", () => {
  it("scan, pick + fetch, upload, rebuild, approve, approve-all, dismiss", () => {
    for (const needle of [
      "worldCatalogLibrary.importScan",
      'data-testid="world-catalog-desk-fetch-picked"',
      "worldCatalogLibrary.importFetchPicked",
      'data-testid="world-catalog-desk-file-input"',
      'data-testid="world-catalog-desk-choose"',
      "catalogImport.approvePutHome",
      'data-testid="world-catalog-desk-approve-all"',
      "catalogImport.approveAllReady",
      "catalogImport.rebuildDetails",
      "catalogImport.dismiss",
    ]) {
      expect(desk, needle).toContain(needle);
    }
  });

  it("the upload flow is the page's: presign, PUT to the signed URL, register", () => {
    expect(desk).toContain("CATALOG_PRESIGN_PATH");
    expect(desk).toContain('method: "PUT"');
    expect(desk).toContain("catalogUploadKey(user.id, crypto.randomUUID(), f.name)");
    expect(desk).toContain("buildUploadsPayload(done)");
  });

  it("draft editing rides the seam (editsFromDraft for display, buildApprovePayload for the wire)", () => {
    expect(desk).toContain("editsFromDraft(draft)");
    expect(desk).toContain("buildApprovePayload(edits[item.id] ?? null)");
    expect(desk).toContain("batchApprovedCount(data)");
  });
});

describe("honesty in the frame", () => {
  it("the rail's moves line renders verbatim; blocked rows keep their note", () => {
    expect(desk).toContain('data-testid="world-catalog-desk-honesty"');
    expect(desk).toContain("state.honesty.movesLine");
    expect(desk).toContain("item.statusNote");
    expect(desk).toContain("t(STATUS_LABEL_KEYS[item.status])");
  });

  it("state re-reads after every action; no spend path exists", () => {
    expect(desk).toContain("await load();");
    expect(desk).not.toContain("confirmedFetch");
  });
});

describe("light/dark parity — theme-switched surfaces", () => {
  it("the desk branches its surfaces on isLight", () => {
    expect(desk).toContain('isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"');
    expect(desk).toContain('isLight ? "text-[#6B5B36]" : "text-white/50"');
  });
});
