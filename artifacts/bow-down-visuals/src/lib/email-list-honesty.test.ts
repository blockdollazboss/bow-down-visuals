import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Stack-30 D2 (frontend half) — the Email List dashboard's opens card.
 *
 * No open-tracking signal exists anywhere in the system (no pixel
 * endpoint, no provider webhook), so the API now reports the opens stat
 * as openRate: null + opensTracked: false. The card must render the
 * not-tracked state — a label that says opens aren't tracked — instead
 * of the old measured-looking "0" footnoted "best-effort pixel
 * tracking" (tracking that does not exist).
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
    expect(section["opens_not_tracked_note"]).toContain("isn't wired up yet");
  });
});
