/**
 * discounts-desk-components — stack1500 world parity wave #3
 * item 45 source-contract pins. The Discount Codes desk must
 * mount inside the shop stand beside StoreGrowthDesk,
 * self-gating to members ({!isGuest && …} at the stand, a
 * null render for guests in the desk), with:
 * - the full CRUD in-panel: create form, per-code switch
 *   (PATCH isActive) and two-tap delete, state re-read after
 *   every action;
 * - the rail's own state + appliesTo honesty in the frame
 *   (state labels from the seam, the profile-wide line);
 * - a separate no-profile state and a load-failure state
 *   with a retry; no spend path (the family is free);
 * - light/dark parity via the desk's isLight branches.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const desk = read("../../components/world/native/DiscountCodesDesk.tsx");
const stands = read("../../components/world/native/ShopStands.tsx");

describe("the desk shape + the shop-stand mount", () => {
  it("is a named desk rooted at its testid; guests render nothing", () => {
    expect(desk).toContain("export function DiscountCodesDesk({ isLight, isGuest }: { isLight: boolean; isGuest: boolean })");
    expect(desk).toContain('data-testid="world-discounts-desk"');
    expect(desk).toContain("if (isGuest) return null;");
  });

  it("ShopStands mounts it beside StoreGrowthDesk, members only", () => {
    expect(stands).toContain('import { DiscountCodesDesk } from "./DiscountCodesDesk";');
    expect(stands).toContain("{!isGuest && <DiscountCodesDesk isLight={isLight} isGuest={isGuest} />}");
  });
});

describe("the CRUD in-panel", () => {
  it("create, toggle, two-tap delete, reload after every action", () => {
    for (const needle of [
      'data-testid="world-discounts-desk-create"',
      "buildDiscountPayload(form)",
      'send("POST", DISCOUNTS_PATH, payload)',
      'send("PATCH", discountPath(code.id), { isActive: !code.isActive })',
      "Tap again to delete",
      'send("DELETE", discountPath(code.id))',
      "await load();",
    ]) {
      expect(desk, needle).toContain(needle);
    }
    expect(desk).not.toContain("confirmedFetch");
  });

  it("state + appliesTo honesty in the frame", () => {
    expect(desk).toContain("discountCodeState(code)");
    expect(desk).toContain("DISCOUNT_STATE_LABELS[state]");
    expect(desk).toContain("discountUsageLine(code)");
    expect(desk).toContain("Applies to ${code.appliesTo}");
  });

  it("no-profile and load-failure are their own states", () => {
    expect(desk).toContain('data-testid="world-discounts-desk-noprofile"');
    expect(desk).toContain('data-testid="world-discounts-desk-failed"');
    expect(desk).toContain("Try again");
  });
});

describe("light/dark parity — theme-switched surfaces", () => {
  it("the desk branches its surfaces on isLight", () => {
    expect(desk).toContain('isLight ? "border-[#C9A84C]/40 bg-white/50" : "border-white/10 bg-white/5"');
    expect(desk).toContain('isLight ? "text-[#6B5B36]" : "text-white/50"');
  });
});
