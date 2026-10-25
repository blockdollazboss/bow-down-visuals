/**
 * LiveChatClient tests — history/catch-up merging, socket delivery
 * with polling fallback, dedupe, moderation events, composer states.
 * All transport is faked (socket, fetch, timers); the client logic is
 * the real shipped code.
 */
import { describe, it, expect, vi } from "vitest";
import {
  LiveChatClient,
  composerState,
  defaultSocketUrl,
  type ChatMessage,
  type ChatSocketLike,
  type LiveChatDeps,
} from "./live-chat-client";

const STREAM = "22222222-2222-4222-8222-222222222222";
const OWNER = "user-owner";
const ME = "user-me";
const OTHER = "user-other";

function msg(id: string, userId: string, body: string, at: string): ChatMessage {
  return {
    id,
    streamId: STREAM,
    userId,
    body,
    createdAt: at,
    author: { displayName: userId === OWNER ? "Owner" : "Fan", avatarUrl: null, slug: null },
  };
}

class FakeSocket implements ChatSocketLike {
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code?: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  close(): void {
    this.closed = true;
    this.readyState = 3;
  }
  open(): void {
    this.readyState = 1;
    this.onopen?.();
  }
  emit(payload: unknown): void {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }
  drop(code = 1006): void {
    this.readyState = 3;
    this.onclose?.({ code });
  }
}

interface Rig {
  client: LiveChatClient;
  sockets: FakeSocket[];
  fetchCalls: Array<{ path: string; init?: RequestInit }>;
  setFetch: (fn: (path: string, init?: RequestInit) => Promise<{ status: number; json: any }>) => void;
  tickPoll: () => void;
  fireTimeouts: () => void;
  changes: () => number;
}

function makeRig(opts: { token?: string | null; selfId?: string | null } = {}): Rig {
  const sockets: FakeSocket[] = [];
  const fetchCalls: Rig["fetchCalls"] = [];
  let fetchImpl: Rig["setFetch"] extends (fn: infer F) => void ? F : never = async () => ({ status: 200, json: page([]) });
  let pollFn: (() => void) | null = null;
  const timeouts: Array<() => void> = [];
  let changeCount = 0;

  const deps: LiveChatDeps = {
    fetchJson: async (path, init) => {
      fetchCalls.push({ path, init });
      return fetchImpl(path, init);
    },
    getAccessToken: async () => (opts.token === undefined ? "tok-1" : opts.token),
    selfId: opts.selfId === undefined ? ME : opts.selfId,
    socketUrl: (id, token) => `ws://test/api/live/${id}/chat/ws?token=${token}`,
    openSocket: () => {
      const s = new FakeSocket();
      sockets.push(s);
      return s;
    },
    setIntervalFn: (fn) => {
      pollFn = fn;
      return 1;
    },
    clearIntervalFn: () => {
      pollFn = null;
    },
    setTimeoutFn: (fn) => {
      timeouts.push(fn);
      return 1;
    },
    clearTimeoutFn: () => undefined,
  };

  const client = new LiveChatClient(STREAM, deps, () => changeCount++);
  return {
    client,
    sockets,
    fetchCalls,
    setFetch: (fn) => {
      fetchImpl = fn as typeof fetchImpl;
    },
    tickPoll: () => pollFn?.(),
    fireTimeouts: () => {
      const pending = timeouts.splice(0);
      pending.forEach((fn) => fn());
    },
    changes: () => changeCount,
  };
}

function page(messages: ChatMessage[], streamStatus: "live" | "ended" = "live") {
  return { streamId: STREAM, streamStatus, streamTitle: "Show", ownerId: OWNER, messages, hasMore: false };
}

const M1 = msg("m1", OTHER, "first", "2026-10-16T10:00:01.000Z");
const M2 = msg("m2", OWNER, "second", "2026-10-16T10:00:02.000Z");
const M3 = msg("m3", OTHER, "third", "2026-10-16T10:00:03.000Z");

describe("composerState", () => {
  it("covers the honest matrix: ended, not started, guest, muted, ready", () => {
    expect(composerState({ signedIn: true, streamStatus: "ended", muted: false }).note).toMatch(/ended/);
    expect(composerState({ signedIn: true, streamStatus: "idle", muted: false }).note).toMatch(/opens when/);
    const guest = composerState({ signedIn: false, streamStatus: "live", muted: false });
    expect(guest.signIn).toBe(true);
    expect(guest.enabled).toBe(false);
    expect(composerState({ signedIn: true, streamStatus: "live", muted: true }).note).toMatch(/muted/);
    expect(composerState({ signedIn: true, streamStatus: "live", muted: false })).toEqual({
      enabled: true,
      signIn: false,
      note: null,
    });
  });
});

describe("LiveChatClient", () => {
  it("loads history sorted, with owner + status, and reports ready", async () => {
    const rig = makeRig();
    rig.setFetch(async () => ({ status: 200, json: page([M2, M1]) }));
    await rig.client.start();
    expect(rig.client.loadState).toBe("ready");
    expect(rig.client.messages.map((m) => m.id)).toEqual(["m1", "m2"]);
    expect(rig.client.ownerId).toBe(OWNER);
    expect(rig.client.streamStatus).toBe("live");
    rig.client.stop();
  });

  it("a failed history load lands on the error state (never a fake empty)", async () => {
    const rig = makeRig();
    rig.setFetch(async () => ({ status: 500, json: { error: "nope" } }));
    await rig.client.start();
    expect(rig.client.loadState).toBe("error");
    expect(rig.client.messages).toEqual([]);
    rig.client.stop();
  });

  it("guests get no socket: polling carries them, catch-up uses the after cursor", async () => {
    const rig = makeRig({ token: null });
    rig.setFetch(async (path) => {
      if (path.includes("after=m1")) return { status: 200, json: page([M2]) };
      return { status: 200, json: page([M1]) };
    });
    await rig.client.start();
    expect(rig.sockets).toHaveLength(0);
    expect(rig.client.delivery).toBe("polling");
    rig.tickPoll();
    await new Promise((r) => setTimeout(r, 0));
    expect(rig.client.messages.map((m) => m.id)).toEqual(["m1", "m2"]);
    expect(rig.fetchCalls.some((c) => c.path.includes("after=m1"))).toBe(true);
    rig.client.stop();
  });

  it("socket delivery: open flips delivery to ws, events append once, delete removes", async () => {
    const rig = makeRig();
    rig.setFetch(async () => ({ status: 200, json: page([M1]) }));
    await rig.client.start();
    expect(rig.sockets).toHaveLength(1);
    rig.sockets[0].open();
    expect(rig.client.delivery).toBe("ws");
    rig.sockets[0].emit({ type: "message", message: M2 });
    rig.sockets[0].emit({ type: "message", message: M2 }); // broadcast echo of own post
    expect(rig.client.messages.map((m) => m.id)).toEqual(["m1", "m2"]);
    rig.sockets[0].emit({ type: "message_deleted", messageId: "m1" });
    expect(rig.client.messages.map((m) => m.id)).toEqual(["m2"]);
    rig.client.stop();
  });

  it("a dropped socket falls back to polling and schedules a reconnect", async () => {
    const rig = makeRig();
    rig.setFetch(async () => ({ status: 200, json: page([M1]) }));
    await rig.client.start();
    rig.sockets[0].open();
    expect(rig.client.delivery).toBe("ws");
    rig.sockets[0].drop();
    expect(rig.client.delivery).toBe("polling");
    // Reconnect timer fires → a fresh socket is attempted.
    rig.fireTimeouts();
    await new Promise((r) => setTimeout(r, 0));
    expect(rig.sockets.length).toBeGreaterThanOrEqual(2);
    rig.client.stop();
  });

  it("send: 201 appends once; a 429 surfaces the server's own words; MUTE flips mutedSelf", async () => {
    const rig = makeRig();
    rig.setFetch(async () => ({ status: 200, json: page([]) }));
    await rig.client.start();
    rig.sockets[0].open();

    rig.setFetch(async () => ({ status: 201, json: { message: M3 } }));
    await expect(rig.client.send("  third ")).resolves.toBe(true);
    rig.sockets[0].emit({ type: "message", message: M3 }); // room echo
    expect(rig.client.messages.filter((m) => m.id === "m3")).toHaveLength(1);

    rig.setFetch(async () => ({ status: 429, json: { error: "Slow down a touch — one message every couple of seconds.", code: "RATE_LIMITED" } }));
    await expect(rig.client.send("again")).resolves.toBe(false);
    expect(rig.client.notice).toMatch(/Slow down/);

    rig.setFetch(async () => ({ status: 403, json: { error: "You've been muted in this stream by the streamer.", code: "MUTED" } }));
    await expect(rig.client.send("hello?")).resolves.toBe(false);
    expect(rig.client.mutedSelf).toBe(true);
    rig.client.stop();
  });

  it("a user_muted event naming me flips mutedSelf; unmute clears it", async () => {
    const rig = makeRig();
    rig.setFetch(async () => ({ status: 200, json: page([]) }));
    await rig.client.start();
    rig.sockets[0].open();
    rig.sockets[0].emit({ type: "user_muted", userId: ME });
    expect(rig.client.mutedSelf).toBe(true);
    rig.sockets[0].emit({ type: "user_unmuted", userId: ME });
    expect(rig.client.mutedSelf).toBe(false);
    rig.client.stop();
  });

  it("owner moderation calls move the muted set and delete removes locally", async () => {
    const rig = makeRig();
    rig.setFetch(async () => ({ status: 200, json: page([M1]) }));
    await rig.client.start();
    rig.setFetch(async () => ({ status: 200, json: { ok: true } }));
    await expect(rig.client.muteUser(OTHER)).resolves.toBe(true);
    expect(rig.client.mutedUsers.has(OTHER)).toBe(true);
    await expect(rig.client.unmuteUser(OTHER)).resolves.toBe(true);
    expect(rig.client.mutedUsers.has(OTHER)).toBe(false);
    await expect(rig.client.deleteMessage("m1")).resolves.toBe(true);
    expect(rig.client.messages).toHaveLength(0);
    rig.client.stop();
  });

  it("catch-up flips an ended stream and closes the socket", async () => {
    const rig = makeRig();
    rig.setFetch(async () => ({ status: 200, json: page([M1]) }));
    await rig.client.start();
    rig.sockets[0].open();
    rig.setFetch(async () => ({ status: 200, json: page([], "ended") }));
    await rig.client.catchUp();
    expect(rig.client.streamStatus).toBe("ended");
    expect(rig.sockets[0].closed).toBe(true);
    rig.client.stop();
  });
});

describe("tips, pins and alerts (Stack 2)", () => {
  it("sendTip posts amount/body/key and reports the pin honestly", async () => {
    const rig = makeRig();
    rig.setFetch(async (path) => {
      if (path.endsWith("/tips")) {
        return { status: 201, json: { tip: { id: "t1" }, pinnedUntil: "2026-10-16T10:02:00.000Z" } };
      }
      return { status: 200, json: page([]) };
    });
    await rig.client.start();
    const result = await rig.client.sendTip(500, "pin this", "tip-key-1234");
    expect(result).toEqual({ ok: true, pinned: true, error: null });
    const call = rig.fetchCalls.find((c) => c.path.endsWith("/tips"));
    expect(JSON.parse(String(call?.init?.body))).toEqual({ amountVb: 500, body: "pin this", idempotencyKey: "tip-key-1234" });
    rig.client.stop();
  });

  it("sendTip surfaces an insufficient-balance error instead of pretending", async () => {
    const rig = makeRig();
    rig.setFetch(async (path) => {
      if (path.endsWith("/tips")) return { status: 402, json: { error: "Not enough Visual Bucs for that tip." } };
      return { status: 200, json: page([]) };
    });
    await rig.client.start();
    const result = await rig.client.sendTip(5000, "", "tip-key-5678");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Not enough Visual Bucs/);
    expect(rig.client.notice).toMatch(/Not enough Visual Bucs/);
    rig.client.stop();
  });

  it("pin state comes from the page, pin_updated replaces it, and alerts reach onAlert", async () => {
    const rig = makeRig();
    const pinMessage = { ...msg("m9", OTHER, "pinned!", "2026-10-16T10:01:00.000Z"), kind: "tip" as const, tipAmountVb: 500 };
    rig.setFetch(async () => ({
      status: 200,
      json: { ...page([pinMessage]), pinned: { message: pinMessage, pinnedUntil: "2026-10-16T10:03:00.000Z" } },
    }));
    const alerts: unknown[] = [];
    rig.client.onAlert = (a) => alerts.push(a);
    await rig.client.start();
    expect(rig.client.pinned?.message.id).toBe("m9");
    rig.sockets[0].open();
    rig.sockets[0].emit({ type: "pin_updated", pinned: null });
    expect(rig.client.pinned).toBeNull();
    rig.sockets[0].emit({ type: "alert", alert: { kind: "tip", title: "Fan tipped 500 Visual Bucs", body: "yo", amountVb: 500 } });
    expect(alerts).toEqual([{ kind: "tip", title: "Fan tipped 500 Visual Bucs", body: "yo", amountVb: 500 }]);
    rig.client.stop();
  });
});

describe("defaultSocketUrl", () => {
  it("follows the page scheme and encodes the token", () => {
    expect(defaultSocketUrl({ protocol: "https:", host: "x.tv" }, STREAM, "a b")).toBe(
      `wss://x.tv/api/live/${STREAM}/chat/ws?token=a%20b`,
    );
    expect(defaultSocketUrl({ protocol: "http:", host: "localhost:8080" }, STREAM, "t")).toContain("ws://");
  });
});

describe("ticketed room (Wave 4 #31)", () => {
  it("a 402 TICKET_REQUIRED history answer locks the room with its price — a ready state, not an error, and no messages", async () => {
    const rig = makeRig();
    rig.setFetch(async () => ({
      status: 402,
      json: { code: "TICKET_REQUIRED", error: "This show is ticketed — your ticket opens the chat.", ticket: { price_vb: 200, sold: 3, seats_left: null } },
    }));
    await rig.client.loadHistory();
    expect(rig.client.ticketLocked).toBe(true);
    expect(rig.client.ticketPriceVb).toBe(200);
    expect(rig.client.loadState).toBe("ready");
    expect(rig.client.messages).toEqual([]);
  });

  it("a 402 on send locks the room mid-session", async () => {
    const rig = makeRig();
    rig.setFetch(async (_path, init) => {
      if (init?.method === "POST") {
        return { status: 402, json: { code: "TICKET_REQUIRED", error: "This show is ticketed — your ticket opens the chat.", ticket: { price_vb: 200 } } };
      }
      return { status: 200, json: page([M1]) };
    });
    await rig.client.loadHistory();
    expect(rig.client.ticketLocked).toBe(false);
    const ok = await rig.client.send("hello");
    expect(ok).toBe(false);
    expect(rig.client.ticketLocked).toBe(true);
    expect(rig.client.ticketPriceVb).toBe(200);
  });
});
