/**
 * locations-desk — stack200 world parity lane B1, census
 * item 3 pins. The Locations bench is the locations page's
 * saved-places surface: the same free rails, the page's own
 * bars (name+URL to add; 10 MB then name-first to upload),
 * and the empty-lie law on the load — a payload that is not
 * the locations list parses to null so the bench can show
 * its error state, while the "No locations yet" copy is
 * reachable only through a successful empty list.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  LOCATION_MAX_IMAGE_BYTES,
  LOCATIONS_PATH,
  LOCATIONS_UPLOAD_PATH,
  buildLocationBody,
  locationPath,
  locationUploadProblem,
  locationsOf,
  savedLocationOf,
} from "./locations-desk";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const route = read("../../../api-server/src/routes/locations.ts");

describe("paths — the page's own rails", () => {
  it("list, upload and delete paths match the route file", () => {
    expect(LOCATIONS_PATH).toBe("/api/locations");
    expect(LOCATIONS_UPLOAD_PATH).toBe("/api/locations/upload");
    expect(locationPath("abc 123")).toBe("/api/locations/abc%20123");
    expect(route).toContain('router.get("/locations"');
    expect(route).toContain('router.post("/locations"');
    expect(route).toContain('router.post("/locations/upload"');
    expect(route).toContain('router.delete("/locations/:id"');
    expect(route).toContain('upload.single("image")');
  });

  it("the 10 MB cap is the route's multer limit", () => {
    expect(LOCATION_MAX_IMAGE_BYTES).toBe(10 * 1024 * 1024);
    expect(route).toContain("fileSize: 10 * 1024 * 1024");
  });
});

describe("locationsOf — load-path honesty", () => {
  it("parses the list shape and drops rows missing a name or an image", () => {
    const parsed = locationsOf({
      locations: [
        { id: "1", label: "Throne Room", image_url: "https://x/1.jpg", created_at: "2026-01-01" },
        { id: "2", label: "", image_url: "https://x/2.jpg" },
        { id: "3", label: "No image" },
        { label: "No id", image_url: "https://x/4.jpg" },
        "junk",
      ],
    });
    expect(parsed).toEqual([
      { id: "1", label: "Throne Room", imageUrl: "https://x/1.jpg", createdAt: "2026-01-01" },
    ]);
  });

  it("an empty successful list parses to [] — the only honest empty", () => {
    expect(locationsOf({ locations: [] })).toEqual([]);
  });

  it("anything that is not the list shape parses to null (load failure)", () => {
    for (const bad of [null, undefined, 42, "x", [], {}, { locations: "nope" }, { error: "boom" }]) {
      expect(locationsOf(bad)).toBeNull();
    }
  });

  it("savedLocationOf reads a save response's location, null when absent", () => {
    expect(
      savedLocationOf({ location: { id: "9", label: "Stage", image_url: "https://x/9.jpg" } }),
    ).toEqual({ id: "9", label: "Stage", imageUrl: "https://x/9.jpg", createdAt: null });
    expect(savedLocationOf({ ok: true })).toBeNull();
  });
});

describe("the page's bars", () => {
  it("add-by-URL needs BOTH a name and an image URL, trimmed", () => {
    expect(buildLocationBody("  Palace  ", "  https://x/p.jpg ")).toEqual({
      label: "Palace",
      image_url: "https://x/p.jpg",
    });
    expect(buildLocationBody("", "https://x/p.jpg")).toBeNull();
    expect(buildLocationBody("Palace", "   ")).toBeNull();
  });

  it("upload: the size cap fires before the name-first rule, like the page", () => {
    expect(locationUploadProblem("", LOCATION_MAX_IMAGE_BYTES + 1)).toBe("too-large");
    expect(locationUploadProblem("", 1024)).toBe("name-first");
    expect(locationUploadProblem("  ", 1024)).toBe("name-first");
    expect(locationUploadProblem("Stage", LOCATION_MAX_IMAGE_BYTES)).toBeNull();
  });
});
