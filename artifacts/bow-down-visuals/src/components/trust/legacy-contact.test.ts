/**
 * Stack 3 — legacy CONTACT panel pins (source-level, the house pattern
 * for settings panels). The panel's contract:
 *   - docked in the existing Settings page beside the Stack 10
 *     succession designation — never a standalone page;
 *   - reads/writes ONLY the owner-scoped /api/legacy/contact routes;
 *   - the copy is honest: the setting RECORDS who Bow Down Visuals
 *     should contact — it must never promise an account transfer, a
 *     payout, or legal effect;
 *   - removal is a confirmed, two-step action in the UI.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const panels = readFileSync(new URL("./TrustPanels.tsx", import.meta.url), "utf8");
const settings = readFileSync(new URL("../../pages/settings.tsx", import.meta.url), "utf8");

const panelStart = panels.indexOf("export function LegacyContactSettings");
const panel = panels.slice(panelStart, panels.indexOf("/* ── Stack 11 #5 Permanence", panelStart));

describe("legacy contact panel", () => {
  it("exists in TrustPanels and is mounted on the Settings page beside succession", () => {
    expect(panelStart).toBeGreaterThan(-1);
    expect(panel.length).toBeGreaterThan(500);
    expect(settings).toContain("LegacyContactSettings");
    expect(settings.indexOf("<LegacySettings />")).toBeLessThan(settings.indexOf("<LegacyContactSettings />"));
    expect(settings.indexOf("<LegacyContactSettings />")).toBeLessThan(settings.indexOf("<PermanenceSettings />"));
  });

  it("talks only to the owner-scoped legacy contact routes", () => {
    expect(panel).toContain('api(t, "GET", "/api/legacy/contact")');
    expect(panel).toContain('api(t, "PUT", "/api/legacy/contact"');
    expect(panel).toContain('api(t, "DELETE", "/api/legacy/contact")');
    expect(panel).not.toContain("/legacy/designation");
    expect(panel).not.toContain("/legacy/inbox");
  });

  it("copy records the designation only — no transfer, payout, or legal-effect promise", () => {
    expect(panel).toContain("only records who we");
    expect(panel).toContain("should contact");
    expect(panel).toMatch(/does\s*<strong>not<\/strong>\s*transfer your account, your catalog, or any money/);
    expect(panel).toContain("no legal effect");
    expect(panel).toContain("never appears");
    expect(panel).toContain("on your public profile");
  });

  it("removal is confirmed in the UI before the DELETE fires", () => {
    // First step only ARMS the confirmation; the delete handler sits
    // behind the confirmingRemove gate next to an explicit Keep.
    expect(panel).toContain("onClick={() => setConfirmingRemove(true)}");
    expect(panel).toContain("contact && confirmingRemove");
    expect(panel).toContain("Yes, remove");
    expect(panel).toContain("Keep");
    const gate = panel.indexOf("contact && confirmingRemove");
    expect(panel.indexOf("onClick={remove}", gate)).toBeGreaterThan(gate);
  });

  it("a failed load says so instead of rendering a fake empty form state", () => {
    expect(panel).toContain('setErr("Could not load your legacy contact.")');
  });
});
