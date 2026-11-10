/**
 * PostCard — honest load states (Stack-400 C-28 components
 * residual, deep-pins tranche 2). The card receives its post as a
 * prop (no collection load of its own); its network life is a set
 * of small reads and optimistic actions, pinned here:
 *
 * - REVEAL (covered media): the media records only from a resolved
 *   reveal; a failure lands in revealError and the post stays
 *   covered — nothing pretends the media arrived.
 * - REPLIES: the list records only on a resolved read; the section
 *   opens only on success (showReplies is set inside the try), and
 *   there is no empty copy to fake — a failed read paints nothing.
 * - VOTE / ANALYTICS: no optimistic paint at all — the poll and
 *   the hint record only from proven responses (analytics is
 *   403-quiet by design: not your post, no panel).
 * - DELETE was already the exemplar: apiFetch does not throw on a
 *   rejection, so del() checks res.ok itself and only then lets
 *   the post leave the feed; failure shows its message.
 * - SHARE: a failed referral-code read degrades to a plain link
 *   (documented), never a false code.
 *
 * FINDING + FIX IN THIS LANE (two sibling optimistic-write traps):
 * react() painted the emoji AND the counts optimistically, but its
 * failure path rolled back only the emoji — the counts kept their
 * optimistic values, so the card displayed reaction totals the
 * server never recorded. Worse, the un-react leg rides apiFetch
 * (which does not throw on HTTP errors) without checking res.ok,
 * so a refused un-react was never even detected. toggleSave() had
 * the identical trap on its unsave DELETE. Both legs now check
 * res.ok and throw into the rollback, and react() restores the
 * counts snapshot as well as the emoji.
 *
 * The FE suite runs in node (no DOM), so these tests pin the
 * machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const card = read("./PostCard.tsx");

const react = card.slice(card.indexOf("async function react("), card.indexOf("async function toggleSave()"));
const save = card.slice(card.indexOf("async function toggleSave()"), card.indexOf("async function repost()"));
const replies = card.slice(card.indexOf("async function loadReplies()"), card.indexOf("async function vote("));

describe("the reveal: media arrives only from a proven reveal", () => {
  it("a failed reveal lands in its error line and the post stays covered", () => {
    expect(card).toContain("const media = await revealPostContent(getAccessToken, post.id);");
    expect(card).toContain("setRevealedMedia(media);");
    expect(card).toContain('setRevealError(plainErrorText(e, "Couldn\'t reveal that media."));');
    expect(card).toContain("const coveredNow = !!cover && !revealedMedia;");
  });
});

describe("replies: the section opens only on a successful read", () => {
  it("records and opens live inside the try; failure paints nothing", () => {
    expect(replies).toContain("setReplies(data.replies);");
    expect(replies).toContain("setRepliesLoaded(true);");
    expect(replies).toContain("setShowReplies(true);");
    expect(card).toContain("{!removed && !locked && showReplies && (");
    expect(card).not.toContain("No replies yet");
  });
});

describe("react: optimistic counts roll back on a proven failure (fixed in this lane)", () => {
  it("the counts are snapshotted before the optimistic paint", () => {
    expect(react).toContain("const prevCounts = counts;");
    expect(react.indexOf("const prevCounts = counts;")).toBeLessThan(react.indexOf("setCounts((c) => {"));
  });

  it("the un-react DELETE checks its response — apiFetch alone would not throw", () => {
    expect(react).toContain('if (!res.ok) throw new Error("react rejected");');
  });

  it("failure restores BOTH the emoji and the counts", () => {
    expect(react).toContain("setEmoji(prev);");
    expect(react).toContain("setCounts(prevCounts);");
  });
});

describe("toggleSave: the unsave DELETE checks its response too (fixed in this lane)", () => {
  it("a refused unsave throws into the rollback", () => {
    expect(save).toContain('if (!res.ok) throw new Error("unsave rejected");');
    expect(save).toContain("setSaved(!next);");
  });

  it("the save leg rides apiJson, which throws on non-ok by construction", () => {
    expect(save).toContain('await apiJson(getAccessToken, "/api/saves", {');
  });
});

describe("vote, analytics, delete and share — unchanged", () => {
  it("vote records the poll only from a resolved response (no optimistic paint)", () => {
    const vote = card.slice(card.indexOf("async function vote("), card.indexOf("async function loadAnalytics()"));
    expect(vote).toContain("setPoll(data.poll);");
    expect(vote).not.toContain("setPoll({");
  });

  it("delete checks res.ok itself because apiFetch does not throw on rejection", () => {
    const del = card.slice(card.indexOf("async function del()"), card.indexOf("async function share()"));
    expect(del).toContain("apiFetch does not throw on a rejection");
    expect(del).toContain('if (!res.ok) throw new Error("delete rejected");');
    expect(del.indexOf('throw new Error("delete rejected")')).toBeLessThan(del.indexOf("onDeleted?.(post.id);"));
    expect(del).toContain('setShareMsg("Couldn\'t delete that post — try again.");');
  });

  it("share degrades to a plain link when the referral read fails — never a false code", () => {
    expect(card).toContain("/* no referral code — share plain */");
    expect(card).toContain('ref = data?.code ? `?ref=${data.code}` : "";');
  });
});
