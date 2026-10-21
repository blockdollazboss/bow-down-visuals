import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * List-details edit affordance — an existing list's name/description
 * could not be edited anywhere in the UI (the house list had to be
 * deleted and recreated to change its offer copy, which destroys the
 * subscriber list). The owner-scoped PATCH endpoint already accepted
 * name + description; the page must expose a settings section that
 * saves through it.
 */
const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const pageSource = read("../pages/email-list.tsx");

describe("email-list list-details editing", () => {
  it("renders a List details settings section for the selected list", () => {
    expect(pageSource).toContain("List details —");
    expect(pageSource).toContain("Save list details");
  });

  it("saves name + description through the owner-scoped PATCH endpoint", () => {
    expect(pageSource).toContain("saveListDetails");
    expect(pageSource).toContain('method: "PATCH"');
    expect(pageSource).toContain("name: editName.trim()");
    expect(pageSource).toContain("description: editDesc.trim()");
  });

  it("seeds the edit fields from the selected list", () => {
    expect(pageSource).toContain("setEditName(l?.name ?? \"\")");
    expect(pageSource).toContain("setEditDesc(l?.description ?? \"\")");
  });
});
