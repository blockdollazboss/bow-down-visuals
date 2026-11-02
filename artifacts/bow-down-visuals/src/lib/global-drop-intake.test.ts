/**
 * global-drop-intake.test.ts — stack1300 lane (UPGRADE #165 remainder).
 *
 * Global Drop's versions were born with a bare "/translate" link: the
 * creator opened Translate & Dub cold, produced each dub by hand, and
 * pasted the title/URL back into the review slot. The production door
 * now carries `gd=<releaseId>&lang=<code>` and the surface consumes
 * it: language preselected, package verified, finished dub's video
 * URL returned into the review slot by the review PATCH.
 *
 * These pins are the contract:
 *  - a live door parses to its release + language;
 *  - a plain visit (no door) parses to NOTHING — behaviour unchanged;
 *  - a malformed or foreign pair parses to NOTHING — the params can
 *    never land as literal text anywhere;
 *  - the /translate route preserves the query into the editor, and
 *    the Translate surface consumes the parser + returns via PATCH.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseGlobalDropIntake, withoutGlobalDropParams } from "./global-drop-intake";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const appSource = read("../App.tsx");
const translateSource = read("../pages/translate.tsx");

describe("parseGlobalDropIntake — a live Global Drop door", () => {
  it("parses release + language for every launch language", () => {
    for (const lang of ["es", "pt", "fr", "de", "ja"]) {
      expect(parseGlobalDropIntake(`?gd=rel-9&lang=${lang}`)).toEqual({ releaseId: "rel-9", language: lang });
    }
  });

  it("accepts a bare query string and ignores neighbours", () => {
    expect(parseGlobalDropIntake("tab=translate&gd=rel-9&lang=fr")).toEqual({ releaseId: "rel-9", language: "fr" });
  });
});

describe("parseGlobalDropIntake — no door, no intake (byte-identical plain visit)", () => {
  it("an ordinary editor URL parses to nothing", () => {
    expect(parseGlobalDropIntake("?tab=translate")).toBeNull();
    expect(parseGlobalDropIntake("")).toBeNull();
    expect(parseGlobalDropIntake("?")).toBeNull();
  });

  it("half a door parses to nothing", () => {
    expect(parseGlobalDropIntake("?gd=rel-9")).toBeNull();
    expect(parseGlobalDropIntake("?lang=es")).toBeNull();
    expect(parseGlobalDropIntake("?gd=&lang=es")).toBeNull();
    expect(parseGlobalDropIntake("?gd=%20%20&lang=es")).toBeNull();
  });

  it("a language outside the launch five parses to nothing", () => {
    expect(parseGlobalDropIntake("?gd=rel-9&lang=it")).toBeNull();
    expect(parseGlobalDropIntake("?gd=rel-9&lang=en")).toBeNull();
    expect(parseGlobalDropIntake("?gd=rel-9&lang=ES")).toBeNull();
    expect(parseGlobalDropIntake("?gd=rel-9&lang=track:abc")).toBeNull();
  });
});

describe("withoutGlobalDropParams — the door is consumed once", () => {
  it("strips gd + lang and keeps the rest of the URL", () => {
    expect(withoutGlobalDropParams("?tab=translate&gd=rel-9&lang=es")).toBe("tab=translate");
    expect(withoutGlobalDropParams("?gd=rel-9&lang=es")).toBe("");
    expect(withoutGlobalDropParams("?tab=translate")).toBe("tab=translate");
  });
});

describe("the production wiring", () => {
  it("/translate preserves its query into the editor (the house redirect pattern)", () => {
    expect(appSource).toContain('<Route path="/translate"><QueryPreservingRedirect to="/video-editor?tab=translate" /></Route>');
  });

  it("the Translate surface consumes the intake parser", () => {
    expect(translateSource).toContain("parseGlobalDropIntake");
    expect(translateSource).toContain("withoutGlobalDropParams");
  });

  it("the finished dub returns through the review PATCH, into the slot only", () => {
    expect(translateSource).toContain("/languages/");
    expect(translateSource).toContain('method: "PATCH"');
    /* The return writes the produced URL — it never approves: the
       PATCH body carries no status, so the version stays a draft
       under the creator's own review. */
    expect(translateSource).not.toMatch(/body:\s*JSON\.stringify\(\{\s*url:[^}]*status/);
  });
});
