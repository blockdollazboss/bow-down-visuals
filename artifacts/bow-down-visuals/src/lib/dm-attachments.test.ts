/**
 * STACK-20 R2 #6 (2.17, website half): the messages page's DM
 * attachment + search seam. The server rail and the World desk shipped
 * in Ring 2; these pins hold the page-side mirror — attachments are
 * never silently dropped, hand-offs read as the work they are, and
 * search matches words AND work titles with the match highlighted in
 * place. Source pins hold the page wiring (attach control, upload
 * rail, send payload, search inputs + honest scope copy).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  DM_ATTACHMENT_UPLOAD_PATH, DM_THREAD_LOADED_COUNT,
  dmAttachmentOf, dmAttachmentRenderKind, dmWorkLabel, dmPreviewLine,
  dmKindForMime, dmKindForUrl, dmNameForUrl, dmCanSend,
  dmMessageHit, dmConversationHit, dmHighlightSegments,
} from "./dm-attachments";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

describe("dmAttachmentOf — the DTO triple becomes one tidy attachment", () => {
  it("a full triple parses, keeping the fresh URL the read minted", () => {
    expect(dmAttachmentOf({
      attachment_url: "https://signed.example/beat.mp3", attachment_type: "audio", attachment_name: "midnight-loop.mp3",
    })).toEqual({ url: "https://signed.example/beat.mp3", type: "audio", name: "midnight-loop.mp3" });
  });

  it("a text-only message (all nulls) carries no attachment", () => {
    expect(dmAttachmentOf({ attachment_url: null, attachment_type: null, attachment_name: null })).toBeNull();
    expect(dmAttachmentOf({})).toBeNull();
  });

  it("no URL or no name means no attachment — a nameless ref would render as a dead row", () => {
    expect(dmAttachmentOf({ attachment_url: "https://x/y.mp3", attachment_type: "audio", attachment_name: null })).toBeNull();
    expect(dmAttachmentOf({ attachment_url: null, attachment_type: "audio", attachment_name: "y.mp3" })).toBeNull();
  });

  it("an unknown type still surfaces (the file-row fallback) instead of vanishing", () => {
    const att = dmAttachmentOf({ attachment_url: "https://x/notes.pdf", attachment_type: "document", attachment_name: "notes.pdf" });
    expect(att).not.toBeNull();
    expect(dmAttachmentRenderKind(att!)).toBe("file");
    expect(dmAttachmentRenderKind({ url: "u", type: "", name: "n" })).toBe("file");
  });

  it("the three known kinds get their players", () => {
    expect(dmAttachmentRenderKind({ url: "u", type: "audio", name: "n" })).toBe("audio");
    expect(dmAttachmentRenderKind({ url: "u", type: "video", name: "n" })).toBe("video");
    expect(dmAttachmentRenderKind({ url: "u", type: "image", name: "n" })).toBe("image");
  });
});

describe("labels + preview — a hand-off reads as the work it is", () => {
  it("work labels mirror the desk's words", () => {
    expect(dmWorkLabel("audio")).toBe("Beat");
    expect(dmWorkLabel("video")).toBe("Clip");
    expect(dmWorkLabel("image")).toBe("Artwork");
    expect(dmWorkLabel("document")).toBe("File");
  });

  it("the preview prefers real words", () => {
    expect(dmPreviewLine({ body: "yo, listen to this", attachment_type: "audio", attachment_name: "b.mp3" }))
      .toBe("yo, listen to this");
  });

  it("an attachment-only last message previews as the work, never a blank line", () => {
    expect(dmPreviewLine({ body: "", attachment_type: "audio", attachment_name: "midnight-loop.mp3" }))
      .toBe("Beat: midnight-loop.mp3");
    expect(dmPreviewLine({ body: "   ", attachment_type: "image", attachment_name: "cover.png" }))
      .toBe("Artwork: cover.png");
  });

  it("no last message at all reads as the empty conversation it is", () => {
    expect(dmPreviewLine(null)).toBe("No messages yet");
    expect(dmPreviewLine({ body: "", attachment_type: null, attachment_name: null })).toBe("No messages yet");
  });
});

describe("classifiers — what may ride in a message", () => {
  it("MIME kinds match the server's upload filter", () => {
    expect(dmKindForMime("audio/mpeg")).toBe("audio");
    expect(dmKindForMime("video/mp4")).toBe("video");
    expect(dmKindForMime("image/png")).toBe("image");
    expect(dmKindForMime("application/pdf")).toBeNull();
    expect(dmKindForMime("")).toBeNull();
  });

  it("URL kinds come from the extension; an untellable ending can't ride", () => {
    expect(dmKindForUrl("https://cdn.example.com/work/beat.WAV?dl=1")).toBe("audio");
    expect(dmKindForUrl("https://x/clip.mov")).toBe("video");
    expect(dmKindForUrl("https://x/cover.webp")).toBe("image");
    expect(dmKindForUrl("https://x/file.zip")).toBeNull();
    expect(dmKindForUrl("https://x/noextension")).toBeNull();
    expect(dmKindForUrl("not a url")).toBeNull();
  });

  it("the work's name comes out of the URL, decoded and capped", () => {
    expect(dmNameForUrl("https://x/work/my%20beat%20(final).mp3")).toBe("my beat (final).mp3");
    expect(dmNameForUrl("https://x/")).toBe("Shared work");
    expect(dmNameForUrl("not a url")).toBe("Shared work");
  });

  it("a send needs words, work, or both — never neither", () => {
    expect(dmCanSend("hello", false)).toBe(true);
    expect(dmCanSend("", true)).toBe(true);
    expect(dmCanSend("  ", true)).toBe(true);
    expect(dmCanSend("", false)).toBe(false);
    expect(dmCanSend("   ", false)).toBe(false);
  });
});

describe("search — words and work titles both count", () => {
  const msg = { body: "finished the mix last night", attachment_name: "midnight-loop.mp3" };

  it("an empty query matches everything (no filter)", () => {
    expect(dmMessageHit(msg, "")).toBe(true);
    expect(dmMessageHit(msg, "   ")).toBe(true);
  });

  it("matches body words and attachment titles, case-insensitively", () => {
    expect(dmMessageHit(msg, "MIX")).toBe(true);
    expect(dmMessageHit(msg, "midnight")).toBe(true);
    expect(dmMessageHit(msg, "cover")).toBe(false);
    expect(dmMessageHit({ body: "hi", attachment_name: null }, "loop")).toBe(false);
  });

  it("conversation search covers name, slug, last words, and last work title", () => {
    const conv = {
      other: { profile: { displayName: "King Shark", slug: "shark-king" } },
      last_message: { body: "", attachment_name: "throne-room-demo.mp3" },
    };
    expect(dmConversationHit(conv, "shark")).toBe(true);
    expect(dmConversationHit(conv, "throne")).toBe(true);
    expect(dmConversationHit(conv, "nobody")).toBe(false);
    expect(dmConversationHit({ other: { profile: null }, last_message: null }, "")).toBe(true);
    expect(dmConversationHit({ other: { profile: null }, last_message: null }, "x")).toBe(false);
  });
});

describe("dmHighlightSegments — the match lights up in place", () => {
  it("an empty query leaves the body whole and un-hit", () => {
    expect(dmHighlightSegments("the mix is done", "")).toEqual([{ text: "the mix is done", hit: false }]);
  });

  it("splits around every case-insensitive match", () => {
    expect(dmHighlightSegments("Mix it, then MIX again", "mix")).toEqual([
      { text: "Mix", hit: true },
      { text: " it, then ", hit: false },
      { text: "MIX", hit: true },
      { text: " again", hit: false },
    ]);
  });

  it("a miss yields one un-hit segment; a full match yields one hit", () => {
    expect(dmHighlightSegments("hello", "zzz")).toEqual([{ text: "hello", hit: false }]);
    expect(dmHighlightSegments("beat", "BEAT")).toEqual([{ text: "beat", hit: true }]);
  });

  it("segments always reassemble into the original text", () => {
    const body = "a beat, a Beat, a BEAT drop";
    expect(dmHighlightSegments(body, "beat").map((s) => s.text).join("")).toBe(body);
  });
});

describe("source pins — the website page wiring", () => {
  const page = read("../pages/messages.tsx");

  it("the upload rides the DM rail through FormData, and the ref (not the signed URL) is what sends", () => {
    expect(DM_ATTACHMENT_UPLOAD_PATH).toBe("/api/dm/attachments/upload");
    expect(page).toContain("DM_ATTACHMENT_UPLOAD_PATH");
    expect(page).toContain("new FormData()");
    expect(page).toContain("setPendingAtt({ url: data.ref, type: data.type");
  });

  it("the composer offers attach-by-file and attach-by-link, with a removable pending chip", () => {
    expect(page).toContain('data-testid="dm-attach-button"');
    expect(page).toContain('data-testid="dm-attach-input"');
    expect(page).toContain('accept="audio/*,video/*,image/*"');
    expect(page).toContain('data-testid="dm-attach-link-toggle"');
    expect(page).toContain('data-testid="dm-pending-attachment"');
    expect(page).toContain('data-testid="dm-pending-attachment-remove"');
  });

  it("the send carries the attachment alongside the words and honors an attachment-only send", () => {
    expect(page).toContain("attachment: { url: pendingAtt.url, type: pendingAtt.type, name: pendingAtt.name }");
    expect(page).toContain("dmCanSend(draft, pendingAtt !== null)");
    expect(page).toContain("setPendingAtt(null)");
  });

  it("attachments render in the thread — a player per kind, a named row for anything else", () => {
    expect(page).toContain('data-testid="dm-attachment"');
    expect(page).toContain('data-testid="dm-attachment-audio"');
    expect(page).toContain('data-testid="dm-attachment-video"');
    expect(page).toContain('data-testid="dm-attachment-image"');
    expect(page).toContain('data-testid="dm-attachment-file"');
    expect(page).toContain("dmAttachmentOf(m)");
  });

  it("both searches exist, with the thread search's loaded-window scope stated in the copy", () => {
    expect(page).toContain('data-testid="dm-conv-search"');
    expect(page).toContain('data-testid="dm-thread-search"');
    expect(page).toContain('data-testid="dm-thread-search-scope"');
    expect(page).toContain("latest 50 messages");
    expect(DM_THREAD_LOADED_COUNT).toBe(50);
    expect(page).toContain("Nothing in this thread matches that search.");
    expect(page).toContain("No conversation matches that search.");
  });

  it("matches highlight in place through the seam, and previews name the work", () => {
    expect(page).toContain("dmHighlightSegments");
    expect(page).toContain("dmPreviewLine(c.last_message)");
    expect(page).toContain("dmMessageHit(m, threadQuery)");
    expect(page).toContain("dmConversationHit(c, convQuery)");
  });
});
