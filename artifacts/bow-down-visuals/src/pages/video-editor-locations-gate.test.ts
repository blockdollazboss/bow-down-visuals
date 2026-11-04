import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * QC-200 fix queue #7 — /locations landed on a bare gate.
 *
 * The Locations surface exists: pages/locations.tsx is a per-user library
 * backed by the /api/locations rails (account-scoped, never project-scoped),
 * and the video editor embeds it on its "locations" tab. But the editor's
 * root render gated EVERYTHING behind ?project= — and every door to the
 * surface (the /locations redirect in App.tsx, Scene Studio's links, the
 * hub workflow steps) arrives without a project, so the tab sat unreachable
 * behind "No project selected". These pins guard the fix: an explicit
 * ?tab=locations arrival with no project loaded is served the Locations
 * panel itself, while every other no-project arrival keeps the gate.
 */
const editor = readFileSync(new URL("./video-editor.tsx", import.meta.url), "utf8");
const locationsPage = readFileSync(new URL("./locations.tsx", import.meta.url), "utf8");
const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");

describe("locations door — the surface exists and needs no project", () => {
  it("the Locations library talks to the per-user /api/locations rails", () => {
    expect(locationsPage).toContain('fetch("/api/locations"');
    expect(locationsPage).toContain('fetch(`/api/locations/${id}`');
    expect(locationsPage).toContain('"/api/locations/upload"');
  });

  it("the Locations page never depends on a project", () => {
    expect(locationsPage).not.toContain("projectId");
    expect(locationsPage).not.toContain("project");
  });

  it("the /locations door still routes into the editor's locations tab", () => {
    expect(app).toContain(
      '<Route path="/locations"><Redirect to="/video-editor?tab=locations" /></Route>',
    );
  });
});

describe("locations door — no-project arrivals reach the surface", () => {
  it("derives the locations deep link from the tab search param", () => {
    expect(editor).toContain(
      'const locationsDeepLink = new URLSearchParams(search).get("tab") === "locations";',
    );
  });

  it("the bare gate now requires BOTH no project AND no locations deep link", () => {
    expect(editor).toContain("{!projectId && !locationsDeepLink ? (");
    // The old unconditional gate is gone.
    expect(editor).not.toContain("{!projectId ? (\n          <NoProject />");
  });

  it("the no-project locations branch renders the editor's own locations panel", () => {
    const gateAt = editor.indexOf("{!projectId && !locationsDeepLink ? (");
    const branch = editor.slice(gateAt, editor.indexOf("(loading || !barcodeDone)", gateAt));
    expect(branch).toContain('tool="locations"');
    expect(branch).toContain("<LocationsPage embedded />");
    expect(branch).toContain('title={t("locations.pageTitle")}');
    expect(branch).toContain('subtitle={t("locations.subtitle")}');
  });

  it("the embedded Locations panel is composed identically in both branches", () => {
    // Once on the in-project locations tab, once on the no-project door.
    expect(editor.split("<LocationsPage embedded />").length - 1).toBe(2);
    expect(editor.split('tool="locations"').length - 1).toBe(2);
  });

  it("the gate itself is not weakened — NoProject still renders, once, for plain arrivals", () => {
    expect(editor.split("<NoProject />").length - 1).toBe(1);
    const gateAt = editor.indexOf("{!projectId && !locationsDeepLink ? (");
    const branch = editor.slice(gateAt, editor.indexOf("(loading || !barcodeDone)", gateAt));
    expect(branch).toContain("<NoProject />");
  });
});
