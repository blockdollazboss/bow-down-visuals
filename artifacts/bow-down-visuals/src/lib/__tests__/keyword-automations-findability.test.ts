/**
 * Keyword-automations findability pin (stack800 lane 3, item 8;
 * board #11).
 *
 * The card exists in code (pages/email-list.tsx, migration 0232) but
 * the Oct 25 walker never sighted it on /email-list. The hiding
 * mechanism, pinned down in code: the card mounts only inside the
 * "newsletter" tab — a tab labelled for the AI newsletter writer —
 * and at the very bottom of it, below the writer, the campaign
 * sender, the campaign history and the 0198 automations card. No
 * signpost anywhere named it.
 *
 * The fix pinned here: the card carries a stable anchor id, and the
 * landing (dashboard) tab carries a named door whose action switches
 * to the newsletter tab and scrolls the card into view. The card's
 * own mount/behaviour is untouched.
 *
 * The two door strings (kw_door_line / kw_door_open) exist in all 10
 * catalogs; en is final, the other nine are AGENT-DRAFTED and
 * UNREVIEWED (standing stack600 practice).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const readJson = (rel: string) => JSON.parse(read(rel)) as Record<string, any>;

const page = read("../../pages/email-list.tsx");
const LOCALES = ["en", "ar", "de", "es", "fr", "hi", "it", "ja", "ko", "pt"];

describe("the keyword-automations card has a reachable door", () => {
  it("the card carries the anchor the door scrolls to", () => {
    expect(page).toContain('id="keyword-automations"');
    expect(page).toContain('data-testid="keyword-automations-card"');
  });

  it("the jump handler switches to the newsletter tab, then scrolls the card in", () => {
    const handler = page.slice(
      page.indexOf("const openKeywordAutomations"),
      page.indexOf("const openKeywordAutomations") + 500,
    );
    expect(handler).toContain('setTab("newsletter")');
    expect(handler).toContain('getElementById("keyword-automations")');
    expect(handler).toContain("scrollIntoView");
  });

  it("the door sits on the landing (dashboard) tab and names the feature", () => {
    const dashboardAt = page.indexOf('{tab === "dashboard"');
    const listsAt = page.indexOf('{tab === "lists"');
    const doorAt = page.indexOf('data-testid="keyword-automations-door"');
    expect(doorAt).toBeGreaterThan(dashboardAt);
    expect(doorAt).toBeLessThan(listsAt);
    const door = page.slice(doorAt, doorAt + 700);
    expect(door).toContain('t("email-list.kw_title")');
    expect(door).toContain('t("email-list.kw_door_line")');
    expect(door).toContain('t("email-list.kw_door_open")');
    expect(door).toContain("onClick={openKeywordAutomations}");
  });

  it("the card still mounts inside the newsletter tab (its home, now with a door)", () => {
    const newsletterAt = page.indexOf('{tab === "newsletter"');
    const formsAt = page.indexOf('{tab === "forms"');
    const cardAt = page.indexOf('data-testid="keyword-automations-card"');
    expect(cardAt).toBeGreaterThan(newsletterAt);
    expect(cardAt).toBeLessThan(formsAt);
  });

  it("the door strings exist in all 10 catalogs", () => {
    for (const loc of LOCALES) {
      const cat = readJson(`../../locales/${loc}.json`);
      expect(cat["email-list"].kw_door_line, loc).toBeTruthy();
      expect(cat["email-list"].kw_door_open, loc).toBeTruthy();
    }
    const en = readJson("../../locales/en.json");
    expect(en["email-list"].kw_door_open).toBe("Open keyword automations");
  });
});
