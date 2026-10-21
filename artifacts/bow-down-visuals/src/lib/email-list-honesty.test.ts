import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Email List dashboard opens card — tracked era (migration 0188).
 *
 * The Stack-30 contract stands where it is still true: the API
 * reports openRate: null + opensTracked: false until a list has a
 * tracked send, and the card renders the not-tracked state instead of
 * a measured-looking 0 — "never measured" is never dressed up as a
 * measurement. What changed: tracking now EXISTS, so the not-tracked
 * note no longer claims tracking "isn't wired up" — it says there are
 * no tracked sends yet — and once sends exist the card shows the
 * recorded opens/clicks the API measured.
 */
const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const pageSource = read("../pages/email-list.tsx");
const en = JSON.parse(read("../locales/en.json")) as Record<string, Record<string, string>>;

describe("email-list opens card honesty", () => {
  it("the stats type admits the not-tracked state (openRate nullable + opensTracked flag)", () => {
    expect(pageSource).toContain("openRate: number | null");
    expect(pageSource).toContain("opensTracked: boolean");
  });

  it("the card renders a Not tracked state when the API says opens aren't tracked", () => {
    expect(pageSource).toContain("!stats.opensTracked");
    expect(pageSource).toContain('t("email-list.opens_not_tracked")');
    expect(pageSource).toContain('t("email-list.opens_not_tracked_note")');
  });

  it("the not-tracked copy exists in the English catalog and fakes nothing", () => {
    const section = en["email-list"] ?? {};
    expect(section["opens_not_tracked"]).toBe("Not tracked");
    expect(section["opens_not_tracked_note"]).toContain("no tracked sends yet");
    expect(section["opens_not_tracked_note"]).not.toContain("isn't wired up yet");
  });
});
