/**
 * social-proof-desk-components — stack1500 world parity wave #3
 * item 32 source-contract pins. The Social Proof desk must sit
 * in the My Studio stack as a board desk ({ isLight }), with:
 * - the figures in-panel with their values (formatted by the
 *   website's own formatter), the refresh, and the per-figure
 *   show/hide switch as a real aria-pressed toggle;
 * - the honest states separate: not-switched-on (503), no
 *   profile, no figures, failed-with-retry;
 * - no spend path at all (every rail is free);
 * - light/dark parity via the desk's isLight branches.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const desk = read("../../components/world/native/SocialProofDesk.tsx");
const panel = read("../../components/world/StationPanel.tsx");

describe("the board-desk shape + the My Studio mount", () => {
  it("is a named board desk rooted at its testid", () => {
    expect(desk).toContain("export function SocialProofDesk({ isLight }: { isLight: boolean })");
    expect(desk).toContain('data-testid="world-social-proof-desk"');
  });

  it("StationPanel stacks it at the My Studio board behind a DeskDoor", () => {
    expect(panel).toContain('const SocialProofDesk = lazy(() => import("@/components/world/native/SocialProofDesk")');
    expect(panel).toContain("<SocialProofDesk isLight={isLight} />");
  });
});

describe("the figures in-panel", () => {
  it("values ride the website's own formatter; toggles are aria-pressed switches", () => {
    expect(desk).toContain("formatProofValue(figure.value)");
    expect(desk).toContain("aria-pressed={figure.visible}");
    expect(desk).toContain("Showing — tap to hide");
    expect(desk).toContain("Hidden — tap to show");
    expect(desk).toContain('data-testid="world-social-proof-desk-refresh"');
    expect(desk).toContain("account disconnected — this figure is retired");
  });

  it("the toggle saves through the seam's computation + payload", () => {
    expect(desk).toContain("hiddenKeysAfterToggle(state.hiddenKeys, figure.key, show)");
    expect(desk).toContain("buildVisibilityPayload(hiddenKeys)");
  });
});

describe("free — no spend path exists in the desk", () => {
  it("plain fetches only, never confirmedFetch", () => {
    expect(desk).toContain("fetch(SOCIAL_PROOF_ME_PATH");
    expect(desk).toContain("fetch(SOCIAL_PROOF_REFRESH_PATH");
    expect(desk).not.toContain("confirmedFetch");
  });
});

describe("the honest states stay separate", () => {
  it("503, no-profile, no-figures and failed-with-retry each render as themselves", () => {
    expect(desk).toContain('data-testid="world-social-proof-desk-unavailable"');
    expect(desk).toContain("isn&rsquo;t switched on for this server yet");
    expect(desk).toContain('data-testid="world-social-proof-desk-no-profile"');
    expect(desk).toContain("No figures yet");
    expect(desk).toContain('data-testid="world-social-proof-desk-failed"');
    expect(desk).toContain("Try again");
  });
});

describe("light/dark parity — theme-switched surfaces", () => {
  it("the desk branches its surfaces on isLight", () => {
    expect(desk).toContain('isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"');
    expect(desk).toContain('isLight ? "text-[#6B5B36]" : "text-white/50"');
  });
});
