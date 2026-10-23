/**
 * group-detail-datapaths.test.ts — S27-26: the group feed settles
 * separately from the group itself (dashboard per-section pattern).
 *
 * The defect: load() set the group, then awaited the feed in the SAME
 * try — a feed failure threw into the page catch and replaced the
 * loaded group with a full-page error. The contract pinned here:
 *  (a) the group fetch alone owns the full-page error;
 *  (b) the feed loads through its own loader whose failure sets a
 *      feed-scoped error, never the page error;
 *  (c) the feed tab renders that error (with a feed-only retry) in
 *      place of the post list, while the group header/tabs render.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync(new URL("./group-detail.tsx", import.meta.url), "utf8");

describe("group detail — feed settles separately from the group", () => {
  it("the feed has its own loader and its own error state", () => {
    expect(page).toContain("async function loadFeed()");
    expect(page).toContain("const [feedError, setFeedError] = useState<string | null>(null)");
    expect(page).toContain('setFeedError(friendlyLoadError(e, "the group feed"))');
  });

  it("the group is applied, page loading clears, THEN the feed fires un-awaited — and a group failure returns before the feed load", () => {
    /* Pin corrected for Stack-28 #30 / A3-F9 (documented deliberate
       revisit): S27-26 pinned "group applied before the feed is
       awaited", but that very await gated the full-page spinner on
       the slower feed fetch, defeating (a)–(c) in practice. The
       newer truth keeps the S27-26 contract and strengthens the
       sequencing: core data settles the page; the feed resolves in
       its own section. */
    const groupSet = page.indexOf("setGroup(d.group)");
    const loadingCleared = page.indexOf("setLoading(false);\n    void loadFeed();");
    expect(groupSet).toBeGreaterThan(-1);
    expect(loadingCleared).toBeGreaterThan(groupSet);
    expect(page).not.toContain("await loadFeed();");
    expect(page).toContain('setError(friendlyLoadError(e, "this group"));');
  });

  it("the feed tab renders the feed error with a feed-only retry instead of the posts", () => {
    expect(page).toContain("<ErrorBox message={feedError} onRetry={loadFeed} />");
    expect(page).toContain("feedError ? (");
  });
});
