/**
 * ThemePackQuickPicker (the theme-pack quick picker) —
 * honest load states (Stack-400 C-28 components residual,
 * deep-pins tranche 6).
 *
 * An entitlement surface whose failure direction claims
 * LESS: the pack-state read is ok-gated at the door
 * (`if (!res.ok) return;`), and its catch states the
 * doctrine — "picker still lists packs; premium stays
 * locked-looking". The pack list itself is the static
 * catalog (no server claim), while OWNERSHIP — the thing a
 * failed read must never fabricate — stays locked until a
 * proven state read says otherwise. A member is never
 * shown owning a premium pack on an unproven read.
 *
 * NO FIX in this lane — the family already meets the standard.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./ThemePackQuickPicker.tsx");

describe("ownership stays locked until a proven state read unlocks it", () => {
  it("the ok gate and the locked-on-failure doctrine are pinned", () => {
    expect(src).toContain("if (!res.ok) return;");
    expect(src).toContain("/* picker still lists packs; premium stays locked-looking */");
  });
});
