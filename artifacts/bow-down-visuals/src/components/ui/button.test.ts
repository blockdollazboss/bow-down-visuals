import { describe, expect, it } from "vitest";
import { buttonVariants } from "./button-variants";

describe("buttonVariants", () => {
  it("emits the luxury bullion classes for variant=luxury", () => {
    const cls = buttonVariants({ variant: "luxury" });
    expect(cls).toContain("lux-shine");
    expect(cls).toContain("from-[#f7d774]");
    expect(cls).toContain("text-[#1a1204]");
  });

  it("keeps the default variant free of luxury classes", () => {
    const cls = buttonVariants({ variant: "default" });
    expect(cls).toContain("bg-primary");
    expect(cls).not.toContain("lux-shine");
  });
});
