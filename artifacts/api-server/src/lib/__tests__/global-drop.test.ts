/**
 * global-drop.test.ts — UPGRADE #165 (Global Drop).
 *
 * Pins the package contract:
 * - the five launch languages are exactly the audit's five, and every
 *   one is dub-supported on the existing Translate & Dub rail (drift
 *   between this list and TARGET_LANGUAGES fails here);
 * - assembly creates five DRAFT versions from the release's own
 *   title — nothing approved, nothing translated, nothing routed
 *   by default;
 * - publish routes ONLY approved versions carrying a valid http(s)
 *   URL; approved-but-URL-less versions are reported as title-only,
 *   never silently dropped;
 * - merging never clobbers another language's existing destination.
 */
import { describe, expect, it } from "vitest";
import {
  GLOBAL_DROP_LANGUAGES,
  assemblePackage,
  isHttpUrl,
  mergeLanguageDestinations,
  publishableVersions,
  type GlobalDropVersions,
} from "../global-drop";
import { TARGET_LANGUAGES } from "../../routes/generate/video-translator";

const RELEASE = { id: "rel-1", userId: "user-1", title: "Midnight Run", artistName: "Thy Cheat Code" };

describe("GLOBAL_DROP_LANGUAGES — the audit's five, all dub-supported", () => {
  it("is exactly es/pt/fr/de/ja", () => {
    expect(GLOBAL_DROP_LANGUAGES.map((l) => l.code)).toEqual(["es", "pt", "fr", "de", "ja"]);
  });

  it("every launch language exists on the Translate & Dub rail", () => {
    const supported = new Set(TARGET_LANGUAGES.map((l) => l.code));
    for (const lang of GLOBAL_DROP_LANGUAGES) expect(supported.has(lang.code)).toBe(true);
  });
});

describe("assemblePackage — five drafts, nothing invented", () => {
  it("creates one draft per language carrying the release's own title", () => {
    const versions = assemblePackage(RELEASE);
    expect(Object.keys(versions).sort()).toEqual(["de", "es", "fr", "ja", "pt"]);
    for (const lang of GLOBAL_DROP_LANGUAGES) {
      expect(versions[lang.code]).toMatchObject({
        language: lang.code,
        sourceTitle: "Midnight Run",
        translatedTitle: null,
        url: null,
        status: "draft",
        translateLink: "/translate",
      });
    }
  });
});

describe("publishableVersions — approval + a real URL, or it doesn't route", () => {
  function reviewed(): GlobalDropVersions {
    const versions = assemblePackage(RELEASE);
    versions.es = { ...versions.es, status: "approved", url: "https://example.com/es", translatedTitle: "Carrera de Medianoche" };
    versions.pt = { ...versions.pt, status: "approved", translatedTitle: "Corrida da Meia-Noite" }; // no URL
    versions.fr = { ...versions.fr, url: "https://example.com/fr" }; // URL but still draft
    versions.de = { ...versions.de, status: "approved", url: "javascript:alert(1)" }; // not http(s)
    return versions;
  }

  it("routes only the approved + http(s) versions and names the title-only ones", () => {
    const { routable, titleOnly } = publishableVersions(reviewed());
    expect(routable).toEqual([{ code: "es", url: "https://example.com/es" }]);
    expect(titleOnly.sort()).toEqual(["de", "pt"]); // de's non-http URL counts as no URL
  });

  it("a package with no reviews publishes nothing", () => {
    const { routable, titleOnly } = publishableVersions(assemblePackage(RELEASE));
    expect(routable).toEqual([]);
    expect(titleOnly).toEqual([]);
  });
});

describe("mergeLanguageDestinations — never clobber the neighbors", () => {
  it("adds/overwrites only the routed codes and keeps the rest", () => {
    const merged = mergeLanguageDestinations(
      { it: "https://example.com/it", es: "https://old.example/es" },
      [{ code: "es", url: "https://example.com/es" }, { code: "ja", url: "https://example.com/ja" }],
    );
    expect(merged).toEqual({
      it: "https://example.com/it",
      es: "https://example.com/es",
      ja: "https://example.com/ja",
    });
  });
});

describe("isHttpUrl — the smartlink rail's own rule", () => {
  it("accepts http/https, rejects everything else", () => {
    expect(isHttpUrl("https://example.com/x")).toBe(true);
    expect(isHttpUrl("http://example.com")).toBe(true);
    expect(isHttpUrl("javascript:alert(1)")).toBe(false);
    expect(isHttpUrl("not a url")).toBe(false);
    expect(isHttpUrl("ftp://example.com")).toBe(false);
  });
});
