/**
 * ThyCheatCodeChat — honest load classification (Stack-400 C-28
 * components residual, deep-pins tranche 1). The site chat drawer
 * rides every page. It is NOT a list-load surface: the conversation
 * is in-memory session state that starts locally, and the file's
 * network calls are one send action and one single-record config
 * read, pinned here so a future collection load cannot slip in
 * unclassified.
 *
 * The send (POST /api/free-chat) surfaces BOTH failure shapes as an
 * honest in-thread line that says the reply failed — the server's
 * own error string or the ask-again fallback on a non-ok response,
 * and the couldn't-reach-the-surface line on a network throw —
 * never as a fabricated answer. Navigation doors ride successful
 * replies only. The voice-out status read carries an explicit
 * failure flag that feeds its view selector, so a failed status
 * load renders as "status unknown", not as a made-up price or a
 * ready state.
 *
 * The FE suite runs in node (no DOM), so these tests pin the source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const chat = read("./ThyCheatCodeChat.tsx");

describe("no collection load exists in the chat drawer", () => {
  it("the only direct fetch is the send action", () => {
    const urls = [...chat.matchAll(/fetch\("(\/api\/[^"]+)"/g)].map((m) => m[1]);
    expect(urls).toEqual(["/api/free-chat"]);
    expect(chat).not.toContain("useQuery");
  });
});

describe("a failed send says so in the thread — it never fabricates an answer", () => {
  it("a non-ok response falls back to the ask-again line when no error string rides along", () => {
    expect(chat).toContain('const res = await fetch("/api/free-chat", {');
    expect(chat).toContain("data.error ||");
    expect(chat).toContain('"My fins slipped — could you ask that again?"');
  });

  it("a network throw appends the couldn't-reach line", () => {
    expect(chat).toContain('"Couldn\'t reach the surface — check your connection and try again."');
  });

  it("navigation doors ride successful replies only", () => {
    expect(chat).toContain("const doors = res.ok ? parseChatDoors(data) : [];");
  });
});

describe("the voice-out status read carries an explicit failure state", () => {
  it("success and failure land in separate states", () => {
    expect(chat).toContain("setSpeakStatus(status);");
    expect(chat).toContain("setSpeakStatusFailed(false);");
    expect(chat).toContain("setSpeakStatusFailed(true);");
  });

  it("the view is derived from status AND the failure flag together", () => {
    expect(chat).toContain("const speakView = chatSpeakView(speakStatus, speakStatusFailed);");
  });
});
