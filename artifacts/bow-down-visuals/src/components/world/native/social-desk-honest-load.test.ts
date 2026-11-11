/**
 * SocialDesk — honest load standard (deep-pins tranche 3, batch 6).
 * Two instruments share one seam (apiJson throws the server's words
 * on non-ok): PostOfficeDesk (DMs) and CommunityHallBoard (the feed).
 *
 * PostOfficeDesk: the conversation list is a three-state machine
 * (loading → ready / failed with a retry wired to the real loader);
 * the open thread is a four-state machine (idle / loading / ready /
 * failed with retry) guarded by a request counter so a stale thread
 * answer never lands. The genuine empties (inbox / requests /
 * search / thread / thread-search) render only inside the ready arm.
 * Writes ride apiJson and surface failures in the notice line; the
 * reply-draft saves are best-effort BY DESIGN (their comment: the
 * words stay on the composer's screen and the next change, switch or
 * close retries — the composer never loses text to a failed save,
 * and nothing claims the save landed).
 *
 * CommunityHallBoard: the feed read and the drops read each carry
 * their own failed flag — a failure renders the error state with a
 * tick-bump retry, never the empty board; the empties render only
 * from loaded zero-reads; a failed load-MORE keeps the river on
 * screen and lands in the scan note (it never clears the posts).
 * The my-profile and pin-cost reads are documented enhancements
 * (failure just withholds the own-post verbs / the price suffix).
 * The pin flow treats an empty generation answer as "nothing came
 * back", never a success.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./SocialDesk.tsx");
const officeSrc = src.slice(src.indexOf("export function PostOfficeDesk"), src.indexOf("/* ═══ Community Hall"));
const hallSrc = src.slice(src.indexOf("export function CommunityHallBoard"));

const slice = (s: string, startMarker: string, endMarker: string) => {
  const a = s.indexOf(startMarker);
  const b = s.indexOf(endMarker, a);
  return s.slice(a, b);
};

describe("the shared seam — apiJson throws before any state", () => {
  it("non-ok throws the server's words", () => {
    const seam = slice(src, "async function apiJson<T>(", "/* Catalog key-maps");
    expect(seam).toContain("if (!res.ok) throw new Error(apiErrorMessage(data, `Request failed (${res.status})`));");
  });
});

describe("PostOfficeDesk — list and thread machines", () => {
  it("the conversation list: failure is its own state with a retry to the real loader", () => {
    const loader = slice(officeSrc, "const loadConvs = useCallback(async () => {", "const loadThread = useCallback");
    expect(loader).toContain("setListState(\"ready\")");
    expect(loader).toContain("setListState(\"failed\")");
    expect(officeSrc).toContain('if (listState === "loading") {');
    expect(officeSrc).toContain('if (listState === "failed") {');
    expect(officeSrc).toContain("onRetry={() => { setListState(\"loading\"); void loadConvs(); }}");
    expect(officeSrc).toContain("listQuery.trim()");
    expect(officeSrc).toContain('t("worldSocialDesk.dmEmptyInbox")');
  });

  it("the thread load is request-guarded and its failure retries the same thread", () => {
    const loader = slice(officeSrc, "const loadThread = useCallback(async (id: string) => {", "useEffect(() => { void loadConvs(); }");
    expect(loader).toContain("const reqId = ++threadReqRef.current;");
    expect(loader).toContain("if (reqId !== threadReqRef.current) return;");
    expect(loader).toContain("if (reqId === threadReqRef.current) setThreadState(\"failed\");");
    const render = slice(officeSrc, '{threadState === "loading" ? (', '<div ref={bottomRef} />');
    expect(render).toContain('threadState === "failed" ? (');
    expect(render).toContain("onRetry={() => activeId && void loadThread(activeId)}");
    expect(render.indexOf('t("worldSocialDesk.dmThreadEmpty")')).toBeGreaterThan(render.indexOf('threadState === "failed"'));
  });

  it("draft saves are best-effort by design — words stay on screen, nothing claims the save", () => {
    const persist = slice(officeSrc, "const persistDraft = useCallback(async (convId: string, text: string) => {", "/* Debounced save.");
    expect(persist).toContain("catch { /* the words stay on screen; the next change, switch or close retries */ }");
    expect(officeSrc).toContain("catch { /* no restored draft — the composer simply starts empty */ }");
  });

  it("send clears the draft only after the send lands; failures land in the notice", () => {
    const send = slice(officeSrc, "async function send() {", "async function requestAction(");
    expect(send).toContain("await apiJson(authHeaders, dmSendPath(activeId), {");
    expect(send.indexOf('setDraft("")')).toBeGreaterThan(send.indexOf("await apiJson(authHeaders, dmSendPath(activeId), {"));
    expect(send).toContain("setNotice(plainErrorText(e, t(\"worldSocialDesk.dmSendError\")));");
  });
});

describe("CommunityHallBoard — feed and drops fail as themselves", () => {
  it("the feed read: failure sets its flag; the empty board renders only from a loaded zero-read", () => {
    const effect = slice(hallSrc, "useEffect(() => {\n    let cancelled = false;\n    setFeedFailed(false);", "/* The next page:");
    expect(effect).toContain("if (!cancelled) setFeedFailed(true);");
    expect(effect).toContain("setPosts(null);");
    const render = slice(hallSrc, ") : feedFailed ? (", "      {/* The moderation bench");
    expect(render).toContain("onRetry={() => setTick((n) => n + 1)}");
    expect(render.indexOf("posts === null ? (")).toBeGreaterThan(render.indexOf("feedFailed ? ("));
    expect(render.indexOf("posts.length === 0 ? (")).toBeGreaterThan(render.indexOf("posts === null ? ("));
  });

  it("the drops view carries its own failed flag and retry", () => {
    const effect = slice(hallSrc, 'if (view === "drops") {', "setPosts(null);\n    setHasMore(false);");
    expect(effect).toContain("if (!cancelled) setDropsFailed(true);");
    const render = slice(hallSrc, '{view === "drops" ? (', ") : feedFailed ? (");
    expect(render.indexOf("drops === null ? (")).toBeGreaterThan(render.indexOf("dropsFailed ? ("));
    expect(render.indexOf("drops.length === 0 ? (")).toBeGreaterThan(render.indexOf("drops === null ? ("));
  });

  it("a failed load-more keeps the river and lands in the note", () => {
    const more = slice(hallSrc, "async function loadMore() {", "useEffect(() => {\n    let cancelled = false;\n    (async () => {\n      try {\n        const d = await apiJson<{ cost: number }>");
    expect(more).toContain("setPosts((prev) => mergeFeedPage(prev ?? [], page));");
    expect(more).toContain('setScanNote(t("worldSocialDesk.hallLoadMoreError"));');
    expect(more).not.toContain("setPosts(null)");
  });

  it("the profile and pin-cost reads are documented enhancements, pinned as-is", () => {
    expect(hallSrc).toContain("catch { /* no profile yet, or the read slipped — no own-verbs offered */ }");
    expect(hallSrc).toContain('catch { /* cost stays "shown when known" — generation still gates server-side */ }');
  });

  it("an empty generation answer is 'nothing came back', never a success", () => {
    const gen = slice(hallSrc, "async function generatePin() {", "async function pinVariant(text: string) {");
    expect(gen).toContain("if (!Array.isArray(d.posts) || d.posts.length === 0) {");
    expect(gen).toContain('setPinNote(t("worldSocialDesk.hallPinNothingBack"));');
    const pin = slice(hallSrc, "async function pinVariant(text: string) {", "\n  return (");
    expect(pin.indexOf('setPinNote(t("worldSocialDesk.hallPinPostedNote"))')).toBeGreaterThan(
      pin.indexOf("await apiJson(authHeaders, POSTS_PATH, {"),
    );
  });
});
