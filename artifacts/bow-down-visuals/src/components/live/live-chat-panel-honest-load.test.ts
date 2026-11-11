/**
 * LiveChatPanel — honest load standard (deep-pins tranche 5).
 * The panel renders the chat client's states in a strict
 * order: loading → error (with a "Try again" that re-runs
 * loadHistory) → ticket-locked → ready-and-empty → messages.
 * The empty copy exists only under loadState "ready", so a
 * failed history load can never read as "Be the first to say
 * something." The stream-source strip keeps its own honest
 * kinds — a failed connection CHECK is check_failed, never
 * dressed as "not connected". Tips: the success note is set
 * only when sendTip resolves ok; a failed tip leaves the
 * draft and shows no thanks.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const src = read("./LiveChatPanel.tsx");

const slice = (s: string, startMarker: string, endMarker: string) => {
  const a = s.indexOf(startMarker);
  const b = s.indexOf(endMarker, a);
  return s.slice(a, b);
};

describe("the message list — states in order", () => {
  it("loading → error + retry → ticket-locked → ready-empty → messages", () => {
    const body = slice(src, 'data-testid="chat-list"', "{/* ── Pinned message");
    expect(body).toContain('{client.loadState === "loading" && (');
    expect(body).toContain("Loading chat…");
    expect(body).toContain('{client.loadState === "error" && (');
    expect(body).toContain('data-testid="chat-error"');
    expect(body).toContain("Chat couldn&rsquo;t load.");
    expect(body).toContain("onClick={() => void client.loadHistory()}");
    expect(body).toContain("{client.ticketLocked && (");
    expect(body).toContain('data-testid="chat-ticket-locked"');
    expect(body).toContain('{client.loadState === "ready" && !client.ticketLocked && mergedMessages.length === 0 && (');
    expect(body).toContain('data-testid="chat-empty"');
    expect(body).toContain('{ended ? "No chat was saved from this stream." : "Be the first to say something."}');
    expect(body).toContain('{client.loadState === "ready" &&');
    expect(body).toContain("mergedMessages.map((m) => (");
    expect(body.indexOf('{client.loadState === "loading" && (')).toBeLessThan(
      body.indexOf('{client.loadState === "error" && ('),
    );
    expect(body.indexOf('{client.loadState === "error" && (')).toBeLessThan(
      body.indexOf('data-testid="chat-empty"'),
    );
    expect(body.indexOf('data-testid="chat-empty"')).toBeLessThan(body.indexOf("mergedMessages.map((m) => ("));
  });

  it("the source strip's failed check is its own kind, never 'not connected'", () => {
    expect(src).toContain('"check_failed"');
    expect(src).toContain('s.kind === "check_failed"');
  });
});

describe("the tip — thanks only after an ok result", () => {
  it("the note and the draft-clear sit inside the result.ok branch", () => {
    const body = slice(src, "const result = await client.sendTip(amount, draft.trim(), key);", 'data-testid="tip-send"');
    expect(body).toContain("if (result.ok) {");
    expect(body).toContain('setDraft("");');
    expect(body).toContain('setTipNote(result.pinned ? "Tipped — your message is pinned to the top of chat." : "Tipped — thank you for backing the stream.");');
    const okBranch = slice(body, "if (result.ok) {", 'data-testid="tip-send"');
    expect(okBranch.indexOf('setDraft("");')).toBeLessThan(okBranch.indexOf("setTipNote(result.pinned"));
  });
});
