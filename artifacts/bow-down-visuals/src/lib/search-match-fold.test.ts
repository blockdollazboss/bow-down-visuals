/**
 * Search fold (Stack1100 lane Y5) — the FE matcher twin of the
 * server's lib/search-match. N5's search-truth.test.ts pins the
 * plain-words table; this file pins the Y5 extension: accent folding
 * in queryTokens/matchesQuery, so the in-page searches that adopted
 * the shared matcher (library, sounds, video templates, font picker,
 * deal partner picker, DM search) find "Beyoncé" under "beyonce"
 * and match multi-word queries word-by-word in any order.
 */
import { describe, it, expect } from "vitest";
import { foldSearchText, matchesQuery, queryTokens } from "./search-match";

describe("foldSearchText", () => {
  it("strips accents and case", () => {
    expect(foldSearchText("Beyoncé")).toBe("beyonce");
    expect(foldSearchText("CAFÉ Créateurs")).toBe("cafe createurs");
    expect(foldSearchText("naïve façade")).toBe("naive facade");
  });

  it("maps the letters decomposition cannot fold", () => {
    expect(foldSearchText("Łukasz")).toBe("lukasz");
    expect(foldSearchText("Søren Đakovo")).toBe("soren dakovo");
  });
});

describe("matchesQuery — folded, token-AND", () => {
  it("finds accented names under unaccented typing, words in any order", () => {
    expect(matchesQuery("Beyoncé — Halo (live)", "beyonce halo")).toBe(true);
    expect(matchesQuery("King Shark", "shark king")).toBe(true);
  });

  it("every meaningful word must hit", () => {
    expect(matchesQuery("King Shark", "king midas")).toBe(false);
    expect(matchesQuery("Drum Circle — weekly meetup", "drum weekly")).toBe(true);
    expect(matchesQuery("Drum Circle — weekly meetup", "drum yearly")).toBe(false);
  });

  it("queryTokens folds before tokenizing", () => {
    expect(queryTokens("Beyoncé Knowles")).toEqual(["beyonce", "knowles"]);
    expect(queryTokens("how do I get paid")).toEqual(["get", "paid"]);
  });
});
