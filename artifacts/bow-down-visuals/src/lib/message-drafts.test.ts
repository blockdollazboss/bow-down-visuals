/**
 * message-drafts — the /messages composer draft seam (STACK-20 #20).
 *
 * Pins:
 * - the draft rail is the conversation's own sub-path (the rail #15
 *   landed for the World's desk: GET/PUT/DELETE /api/dm/:id/draft);
 * - the payload guard: the server's exact shape reads back, anything
 *   malformed reads as "no draft" — never junk in the composer;
 * - the save decision: skip what's saved, save new words, clear a
 *   blanked composer (a PUT with an empty body);
 * - the sync lifecycle: restore on open (only into an untouched
 *   composer — words typed since the open always win), the 900 ms
 *   debounced save, flush on thread switch / page close, the draft
 *   retired on a landed send, and silent degradation — a dead rail
 *   leaves the composer working exactly as it did before the rail;
 * - source pins: pages/messages.tsx wires the whole lifecycle and
 *   useCommunityApi carries the PUT the save rides on.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  MESSAGE_DRAFT_SAVE_DELAY_MS,
  messageDraftPath,
  normalizeSavedMessageDraft,
  messageDraftSaveDecision,
  MessageDraftSync,
  type MessageDraftRail,
} from "./message-drafts";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const pageSrc = read("../pages/messages.tsx");
const communitySrc = read("./community-ui.tsx");

describe("the draft rail path + payload guard", () => {
  it("the draft rail is the conversation's own sub-path", () => {
    expect(messageDraftPath("c1")).toBe("/api/dm/c1/draft");
    expect(messageDraftPath("c 1/x")).toBe("/api/dm/c%201%2Fx/draft");
  });

  it("a saved draft reads back exactly; anything malformed reads as no draft", () => {
    expect(normalizeSavedMessageDraft({ draft: { body: "half a thought", updated_at: "2026-10-18T19:00:00.000Z" } }))
      .toEqual({ body: "half a thought", updatedAt: "2026-10-18T19:00:00.000Z" });
    expect(normalizeSavedMessageDraft({ draft: { body: "no stamp" } })).toEqual({ body: "no stamp", updatedAt: null });
    expect(normalizeSavedMessageDraft({ draft: { body: "bad stamp", updated_at: 42 } }))
      .toEqual({ body: "bad stamp", updatedAt: null });
    expect(normalizeSavedMessageDraft({ draft: null })).toBeNull();
    expect(normalizeSavedMessageDraft({ draft: { body: "" } })).toBeNull();
    expect(normalizeSavedMessageDraft({ draft: { body: 42 } })).toBeNull();
    expect(normalizeSavedMessageDraft({ draft: "words" })).toBeNull();
    expect(normalizeSavedMessageDraft({})).toBeNull();
    expect(normalizeSavedMessageDraft(null)).toBeNull();
    expect(normalizeSavedMessageDraft(undefined)).toBeNull();
  });

  it("the save decision: skip what's saved, save new words, clear a blanked composer", () => {
    expect(messageDraftSaveDecision("same words", "same words")).toBe("skip");
    expect(messageDraftSaveDecision("", "")).toBe("skip");
    expect(messageDraftSaveDecision("new words", "")).toBe("save");
    expect(messageDraftSaveDecision("edited words", "old words")).toBe("save");
    expect(messageDraftSaveDecision("", "old words")).toBe("clear");
    expect(messageDraftSaveDecision("   ", "old words")).toBe("clear");
  });

  it("the save rhythm is the desk's: 900 ms", () => {
    expect(MESSAGE_DRAFT_SAVE_DELAY_MS).toBe(900);
  });
});

/* ─── The sync controller, on a stub rail ─────────────────────────── */

interface RailCalls {
  loads: string[];
  saves: Array<[string, string]>;
  clears: string[];
}

function stubRail(opts: {
  drafts?: Record<string, unknown>;
  loadImpl?: (id: string) => Promise<unknown>;
  saveImpl?: (id: string, body: string) => Promise<unknown>;
  withClear?: boolean;
} = {}): { rail: MessageDraftRail; calls: RailCalls } {
  const calls: RailCalls = { loads: [], saves: [], clears: [] };
  const rail: MessageDraftRail = {
    load: (id) => {
      calls.loads.push(id);
      if (opts.loadImpl) return opts.loadImpl(id);
      return Promise.resolve(opts.drafts && id in opts.drafts ? opts.drafts[id] : { draft: null });
    },
    save: (id, body) => {
      calls.saves.push([id, body]);
      return opts.saveImpl ? opts.saveImpl(id, body) : Promise.resolve({});
    },
  };
  if (opts.withClear !== false) {
    rail.clear = (id) => {
      calls.clears.push(id);
      return Promise.resolve({});
    };
  }
  return { rail, calls };
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

/** Let queued promise continuations (the controller's load/save
 *  completions) run without moving the fake clock. */
async function settle() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("MessageDraftSync — the composer lifecycle", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("restores the thread's saved draft on open — and the restore itself is never re-saved", async () => {
    const { rail, calls } = stubRail({ drafts: { c1: { draft: { body: "half a thought", updated_at: "2026-10-18T19:00:00.000Z" } } } });
    const restored: Array<[string, string]> = [];
    const sync = new MessageDraftSync({ rail, onRestore: (id, body) => restored.push([id, body]) });
    sync.open("c1");
    await settle();
    expect(restored).toEqual([["c1", "half a thought"]]);
    sync.type("half a thought"); /* the page echoing the restore into the input */
    vi.advanceTimersByTime(5000);
    await settle();
    expect(calls.saves).toEqual([]);
  });

  it("no saved draft: the composer starts empty and typing saves after the debounce", async () => {
    const { rail, calls } = stubRail();
    const restored: string[] = [];
    const sync = new MessageDraftSync({ rail, onRestore: (_id, body) => restored.push(body) });
    sync.open("c1");
    await settle();
    expect(restored).toEqual([]);
    sync.type("hey");
    vi.advanceTimersByTime(899);
    expect(calls.saves).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(calls.saves).toEqual([["c1", "hey"]]);
  });

  it("the debounce coalesces a burst of typing into one save of the latest words", async () => {
    const { rail, calls } = stubRail();
    const sync = new MessageDraftSync({ rail, onRestore: () => {} });
    sync.open("c1");
    await settle();
    sync.type("a");
    vi.advanceTimersByTime(500);
    sync.type("ab");
    vi.advanceTimersByTime(899);
    expect(calls.saves).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(calls.saves).toEqual([["c1", "ab"]]);
  });

  it("words typed and deleted again inside the window never reach the server", async () => {
    const { rail, calls } = stubRail();
    const sync = new MessageDraftSync({ rail, onRestore: () => {} });
    sync.open("c1");
    await settle();
    sync.type("x");
    vi.advanceTimersByTime(100);
    sync.type("");
    vi.advanceTimersByTime(5000);
    await settle();
    expect(calls.saves).toEqual([]);
  });

  it("switching threads flushes the outgoing words to THEIR thread at once, then restores the incoming draft", async () => {
    const { rail, calls } = stubRail({ drafts: { c2: { draft: { body: "for two", updated_at: null } } } });
    const restored: Array<[string, string]> = [];
    const sync = new MessageDraftSync({ rail, onRestore: (id, body) => restored.push([id, body]) });
    sync.open("c1");
    await settle();
    sync.type("for one");
    sync.open("c2"); /* no clock advance — the flush is immediate */
    expect(calls.saves).toEqual([["c1", "for one"]]);
    await settle();
    expect(restored).toEqual([["c2", "for two"]]);
  });

  it("closing the thread (open null) flushes and restores nothing", async () => {
    const { rail, calls } = stubRail();
    const sync = new MessageDraftSync({ rail, onRestore: () => {} });
    sync.open("c1");
    await settle();
    sync.type("unsent words");
    sync.open(null);
    expect(calls.saves).toEqual([["c1", "unsent words"]]);
    expect(calls.loads).toEqual(["c1"]);
  });

  it("words typed while the draft is still loading win — the late restore never overwrites them", async () => {
    const gate = deferred<unknown>();
    const { rail, calls } = stubRail({ loadImpl: () => gate.promise });
    const restored: string[] = [];
    const sync = new MessageDraftSync({ rail, onRestore: (_id, body) => restored.push(body) });
    sync.open("c1");
    sync.type("fresh words");
    gate.resolve({ draft: { body: "old words", updated_at: null } });
    await settle();
    expect(restored).toEqual([]);
    vi.advanceTimersByTime(900);
    expect(calls.saves).toEqual([["c1", "fresh words"]]);
  });

  it("a stale load from a thread already left behind is discarded", async () => {
    const gate = deferred<unknown>();
    const { rail } = stubRail({
      loadImpl: (id) => (id === "c1" ? gate.promise : Promise.resolve({ draft: { body: "two's draft", updated_at: null } })),
    });
    const restored: Array<[string, string]> = [];
    const sync = new MessageDraftSync({ rail, onRestore: (id, body) => restored.push([id, body]) });
    sync.open("c1");
    sync.open("c2");
    await settle();
    gate.resolve({ draft: { body: "one's stale draft", updated_at: null } });
    await settle();
    expect(restored).toEqual([["c2", "two's draft"]]);
  });

  it("per-thread keying: each conversation's words save under its own id", async () => {
    const { rail, calls } = stubRail();
    const sync = new MessageDraftSync({ rail, onRestore: () => {} });
    sync.open("c1");
    await settle();
    sync.type("for one");
    vi.advanceTimersByTime(900);
    sync.open("c2");
    await settle();
    sync.type("for two");
    vi.advanceTimersByTime(900);
    expect(calls.saves).toEqual([["c1", "for one"], ["c2", "for two"]]);
  });

  it("blanking a restored draft clears it on the server (PUT with an empty body), exactly once", async () => {
    const { rail, calls } = stubRail({ drafts: { c1: { draft: { body: "hello", updated_at: null } } } });
    const sync = new MessageDraftSync({ rail, onRestore: () => {} });
    sync.open("c1");
    await settle();
    sync.type("");
    vi.advanceTimersByTime(900);
    await settle();
    expect(calls.saves).toEqual([["c1", ""]]);
    sync.type("");
    vi.advanceTimersByTime(5000);
    await settle();
    expect(calls.saves).toEqual([["c1", ""]]);
  });

  it("a landed send retires the draft: pending saves die, the clear rides, fresh typing starts clean", async () => {
    const { rail, calls } = stubRail({ drafts: { c1: { draft: { body: "old words", updated_at: null } } } });
    const sync = new MessageDraftSync({ rail, onRestore: () => {} });
    sync.open("c1");
    await settle();
    sync.type("old words, finished");
    sync.sent();
    expect(calls.clears).toEqual(["c1"]);
    vi.advanceTimersByTime(5000);
    await settle();
    expect(calls.saves).toEqual([]);
    sync.type("next message");
    vi.advanceTimersByTime(900);
    expect(calls.saves).toEqual([["c1", "next message"]]);
  });

  it("sent() still retires the local draft when the rail has no clear call", async () => {
    const { rail, calls } = stubRail({ withClear: false });
    const sync = new MessageDraftSync({ rail, onRestore: () => {} });
    sync.open("c1");
    await settle();
    sync.type("about to send");
    sync.sent();
    vi.advanceTimersByTime(5000);
    await settle();
    expect(calls.saves).toEqual([]);
  });

  it("dispose (page close) flushes the unsaved words immediately", async () => {
    const { rail, calls } = stubRail();
    const sync = new MessageDraftSync({ rail, onRestore: () => {} });
    sync.open("c1");
    await settle();
    sync.type("unsaved");
    sync.dispose();
    expect(calls.saves).toEqual([["c1", "unsaved"]]);
  });

  it("typing with no thread open is a no-op", async () => {
    const { rail, calls } = stubRail();
    const sync = new MessageDraftSync({ rail, onRestore: () => {} });
    sync.type("nowhere");
    vi.advanceTimersByTime(5000);
    await settle();
    expect(calls.saves).toEqual([]);
    expect(calls.loads).toEqual([]);
  });
});

describe("honest degradation — a dead rail changes nothing for the composer", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("a failed load restores nothing and never throws; typing still saves", async () => {
    const { rail, calls } = stubRail({ loadImpl: () => Promise.reject(new Error("rail down")) });
    const restored: string[] = [];
    const sync = new MessageDraftSync({ rail, onRestore: (_id, body) => restored.push(body) });
    sync.open("c1");
    await settle();
    expect(restored).toEqual([]);
    sync.type("still typing");
    vi.advanceTimersByTime(900);
    expect(calls.saves).toEqual([["c1", "still typing"]]);
  });

  it("a failed save is swallowed and retried at the next flush", async () => {
    let fail = true;
    const { rail, calls } = stubRail({
      saveImpl: () => (fail ? Promise.reject(new Error("rail down")) : Promise.resolve({})),
    });
    const sync = new MessageDraftSync({ rail, onRestore: () => {} });
    sync.open("c1");
    await settle();
    sync.type("words");
    vi.advanceTimersByTime(900);
    await settle();
    expect(calls.saves).toEqual([["c1", "words"]]);
    fail = false;
    sync.open("c2"); /* the switch flush retries the write */
    await settle();
    expect(calls.saves).toEqual([["c1", "words"], ["c1", "words"]]);
  });
});

describe("source pins — the messages page wires the lifecycle", () => {
  it("the page builds one sync on the draft rail and routes every edit through it", () => {
    expect(pageSrc).toContain('from "@/lib/message-drafts"');
    expect(pageSrc).toContain("new MessageDraftSync({");
    expect(pageSrc).toContain("messageDraftPath(id)");
    expect(pageSrc).toContain("onChange={(e) => updateDraft(e.target.value)}");
    expect(pageSrc).toContain("updateDraft(next.value)"); /* the emoji/GIF tray insert */
  });

  it("open on switch, retired on send, flushed on unmount", () => {
    expect(pageSrc).toContain("draftSyncRef.current?.open(activeId)");
    expect(pageSrc).toContain("draftSyncRef.current?.sent()");
    expect(pageSrc).toContain("draftSyncRef.current?.dispose()");
  });

  it("the page rides the shared API helper — which carries the PUT the save needs", () => {
    expect(communitySrc).toContain('method: "PUT"');
    expect(communitySrc).toContain("put: useCallback(");
    /* The website seam stands on its own — no world-panel imports. */
    expect(pageSrc).not.toContain("lib/world/social-desk");
    expect(pageSrc).not.toContain("components/world");
  });
});
