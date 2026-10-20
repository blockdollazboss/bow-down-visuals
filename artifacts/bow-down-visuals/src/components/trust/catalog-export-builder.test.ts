/**
 * Catalog export builder — panel pins (stack3). The field options the
 * panel offers must mirror the server whitelist in
 * artifacts/api-server/src/routes/trust.ts (CATALOG_EXPORT_KINDS)
 * exactly: anything else is a guaranteed 400. The whitelist is
 * hardcoded here on purpose — this test is the cross-check between the
 * two lists. Source pins cover the wire behavior (endpoint, payload,
 * truncation honesty) that a render test can't see cheaply.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CATALOG_EXPORT_KIND_OPTIONS, CATALOG_EXPORT_FIELD_OPTIONS } from "./TrustPanels";

const SERVER_WHITELIST: Record<string, string[]> = {
  tracks: ["id", "title", "source", "durationSec", "fileUrl", "createdAt"],
  releases: ["id", "title", "artistName", "status", "fileUrl", "artworkUrl", "createdAt"],
  videos: ["id", "title", "status", "fileUrl", "thumbnailUrl", "createdAt"],
};

describe("catalog export builder panel options", () => {
  it("offers exactly the three server kinds", () => {
    expect(CATALOG_EXPORT_KIND_OPTIONS.map((o) => o.kind)).toEqual(["tracks", "releases", "videos"]);
  });

  it("field options mirror the server whitelist per kind, in order", () => {
    for (const [kind, keys] of Object.entries(SERVER_WHITELIST)) {
      expect((CATALOG_EXPORT_FIELD_OPTIONS[kind] ?? []).map((o) => o.key)).toEqual(keys);
    }
    expect(Object.keys(CATALOG_EXPORT_FIELD_OPTIONS).sort()).toEqual(Object.keys(SERVER_WHITELIST).sort());
  });

  it("every field option carries a human label", () => {
    for (const opts of Object.values(CATALOG_EXPORT_FIELD_OPTIONS)) {
      for (const o of opts) expect(o.label.length).toBeGreaterThan(0);
    }
  });
});

describe("catalog export builder wiring (source pins)", () => {
  const src = readFileSync(fileURLToPath(new URL("./TrustPanels.tsx", import.meta.url)), "utf8");

  it("posts kind + picked fields + format to the builder endpoint", () => {
    expect(src).toContain('"/api/catalog-export/build"');
    expect(src).toContain("body: JSON.stringify({ kind: bKind, fields: bFields[bKind] ?? [], format: bFormat })");
  });

  it("names the downloaded file after the kind and format", () => {
    expect(src).toContain("a.download = `my-catalog-${bKind}.${bFormat}`");
  });

  it("surfaces the server truncation flag honestly instead of hiding the cap", () => {
    expect(src).toContain('res.headers.get("X-Export-Truncated")');
    expect(src).toContain("2,000-row cap");
  });

  it("the panel copy states the cap up front", () => {
    expect(src).toContain("up to 2,000 rows per file");
  });
});
