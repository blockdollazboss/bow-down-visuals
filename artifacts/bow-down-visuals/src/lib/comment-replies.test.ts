import { describe, it, expect, vi } from "vitest";
import {
  MAX_COMMENTS,
  HISTORY_LIMIT,
  HISTORY_KEY,
  parseCommentLines,
  buildBatch,
  loadReplyHistory,
  saveReplyBatch,
  clearReplyHistory,
} from "./comment-replies";

function memoryStorage(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => {
      store.set(k, v);
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
    _store: store,
  };
}

describe("parseCommentLines", () => {
  it("splits one comment per line and trims", () => {
    expect(parseCommentLines("  fire track  \nwhen's the drop?")).toEqual([
      "fire track",
      "when's the drop?",
    ]);
  });

  it("drops blank lines", () => {
    expect(parseCommentLines("one\n\n   \n two \n")).toEqual(["one", "two"]);
  });

  it("caps at MAX_COMMENTS", () => {
    const input = Array.from({ length: 25 }, (_, i) => `comment ${i}`).join("\n");
    const out = parseCommentLines(input);
    expect(out).toHaveLength(MAX_COMMENTS);
    expect(out[0]).toBe("comment 0");
  });

  it("returns [] for empty input", () => {
    expect(parseCommentLines("")).toEqual([]);
    expect(parseCommentLines("   \n  ")).toEqual([]);
  });
});

describe("buildBatch", () => {
  it("builds a batch with timestamp and tone", () => {
    const batch = buildBatch("hype", ["a"], ["b"]);
    expect(batch.tone).toBe("hype");
    expect(batch.comments).toEqual(["a"]);
    expect(batch.replies).toEqual(["b"]);
    expect(typeof batch.id).toBe("number");
    expect(new Date(batch.at).getTime()).not.toBeNaN();
  });
});

describe("reply history storage", () => {
  it("loadReplyHistory returns [] when nothing stored", () => {
    expect(loadReplyHistory(memoryStorage())).toEqual([]);
  });

  it("loadReplyHistory returns [] on corrupt JSON", () => {
    expect(loadReplyHistory(memoryStorage({ [HISTORY_KEY]: "not json{{{" }))).toEqual([]);
  });

  it("loadReplyHistory returns [] when storage throws", () => {
    const bad = { getItem: () => { throw new Error("denied"); } };
    expect(loadReplyHistory(bad)).toEqual([]);
  });

  it("saveReplyBatch prepends and persists", () => {
    const storage = memoryStorage();
    const batch = buildBatch("grateful", ["hi"], ["thanks!"]);
    const next = saveReplyBatch([], batch, storage);
    expect(next).toHaveLength(1);
    expect(next[0]).toBe(batch);
    expect(JSON.parse(storage._store.get(HISTORY_KEY)!)).toHaveLength(1);
  });

  it("saveReplyBatch caps at HISTORY_LIMIT", () => {
    const storage = memoryStorage();
    let prev: ReturnType<typeof buildBatch>[] = [];
    for (let i = 0; i < HISTORY_LIMIT + 5; i++) {
      prev = saveReplyBatch(prev, buildBatch("playful", [`c${i}`], [`r${i}`]), storage);
    }
    expect(prev).toHaveLength(HISTORY_LIMIT);
    expect(prev[0].comments).toEqual([`c${HISTORY_LIMIT + 4}`]);
  });

  it("saveReplyBatch still returns the batch when storage throws", () => {
    const bad = { setItem: () => { throw new Error("full"); } };
    const batch = buildBatch("hype", ["a"], ["b"]);
    expect(saveReplyBatch([], batch, bad)).toEqual([batch]);
  });

  it("round-trips through loadReplyHistory", () => {
    const storage = memoryStorage();
    const batch = buildBatch("professional", ["q"], ["a"]);
    saveReplyBatch([], batch, storage);
    const loaded = loadReplyHistory(storage);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].comments).toEqual(["q"]);
  });

  it("clearReplyHistory removes the key", () => {
    const storage = memoryStorage();
    saveReplyBatch([], buildBatch("hype", ["a"], ["b"]), storage);
    clearReplyHistory(storage);
    expect(storage._store.has(HISTORY_KEY)).toBe(false);
  });

  it("clearReplyHistory never throws", () => {
    const bad = { removeItem: () => { throw new Error("denied"); } };
    expect(() => clearReplyHistory(bad)).not.toThrow();
  });

});
