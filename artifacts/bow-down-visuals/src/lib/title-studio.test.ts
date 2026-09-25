import { describe, it, expect } from "vitest";
import {
  scoreColor,
  scoreBar,
  parseTitleStudioHistory,
  pushTitleStudioHistory,
  tagsCopyString,
  TITLE_STUDIO_HISTORY_LIMIT,
} from "./title-studio";

describe("scoreColor", () => {
  it("is emerald at 75+", () => {
    expect(scoreColor(100)).toBe("text-emerald-400");
    expect(scoreColor(75)).toBe("text-emerald-400");
  });
  it("is amber in the middle band", () => {
    expect(scoreColor(74)).toBe("text-amber-400");
    expect(scoreColor(50)).toBe("text-amber-400");
  });
  it("is red below 50", () => {
    expect(scoreColor(49)).toBe("text-red-400");
    expect(scoreColor(0)).toBe("text-red-400");
  });
});

describe("scoreBar", () => {
  it("mirrors the scoreColor bands with gradient classes", () => {
    expect(scoreBar(90)).toContain("emerald");
    expect(scoreBar(60)).toContain("amber");
    expect(scoreBar(10)).toContain("red");
  });
});

function makeEntry(topic: string) {
  return {
    topic,
    platform: "youtube" as const,
    tone: "hype" as const,
    titles: [{ title: "T", score: 80, why: "" }],
    description: "D",
    tags: ["a"],
  };
}

describe("parseTitleStudioHistory", () => {
  it("returns [] for null", () => {
    expect(parseTitleStudioHistory(null)).toEqual([]);
  });
  it("returns [] for malformed JSON without throwing", () => {
    expect(parseTitleStudioHistory("{oops")).toEqual([]);
  });
  it("returns [] for non-array JSON", () => {
    expect(parseTitleStudioHistory(JSON.stringify({ topic: "x" }))).toEqual([]);
  });
  it("keeps valid entries and drops invalid ones", () => {
    const raw = JSON.stringify([
      { id: "1", when: 1, ...makeEntry("good") },
      { id: "2", when: 2, topic: "no titles" },
      "garbage",
      null,
    ]);
    const parsed = parseTitleStudioHistory(raw);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]!.topic).toBe("good");
  });
  it("enforces the history cap", () => {
    const raw = JSON.stringify(
      Array.from({ length: TITLE_STUDIO_HISTORY_LIMIT + 5 }, (_, i) => ({
        id: `${i}`,
        when: i,
        ...makeEntry(`t${i}`),
      }))
    );
    expect(parseTitleStudioHistory(raw)).toHaveLength(TITLE_STUDIO_HISTORY_LIMIT);
  });
});

describe("pushTitleStudioHistory", () => {
  it("prepends the new entry with an id and timestamp", () => {
    const next = pushTitleStudioHistory([], makeEntry("first"));
    expect(next).toHaveLength(1);
    expect(next[0]!.topic).toBe("first");
    expect(next[0]!.id).toBeTruthy();
    expect(next[0]!.when).toBeGreaterThan(0);
  });
  it("caps the list at the limit", () => {
    let list = pushTitleStudioHistory([], makeEntry("seed"));
    for (let i = 0; i < TITLE_STUDIO_HISTORY_LIMIT + 3; i++) {
      list = pushTitleStudioHistory(list, makeEntry(`t${i}`));
    }
    expect(list).toHaveLength(TITLE_STUDIO_HISTORY_LIMIT);
    expect(list[0]!.topic).toBe(`t${TITLE_STUDIO_HISTORY_LIMIT + 2}`);
  });
});

describe("tagsCopyString", () => {
  it("prefixes each tag with #", () => {
    expect(tagsCopyString(["newmusic", "indie"])).toBe("#newmusic #indie");
  });
  it("does not double-prefix tags that already carry #", () => {
    expect(tagsCopyString(["#newmusic"])).toBe("#newmusic");
  });
  it("returns an empty string for no tags", () => {
    expect(tagsCopyString([])).toBe("");
  });
});
