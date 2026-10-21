/**
 * Party Games — room client tests (lib/party-client).
 *
 * Drives PartyClient with a fake socket, exactly the way the party
 * page does (deps injected, frames pushed in, frames asserted out):
 * - welcome installs self + room state; refusal frames (room_full,
 *   auth, no_room) land on the honest statuses and survive the close
 *   that follows them
 * - question frames carry no answer and the client tracks them
 *   answer-free; answering sends ONLY a choice — never a score
 * - host-only intents (start/next/end) send nothing for a guest seat
 * - pick is honored only for the designated picker in a duel
 * - reveal installs standings; podium installs the crown; a second
 *   answer to the same question is never sent
 * - room codes validate against the server's alphabet
 */
import { describe, it, expect } from "vitest";
import {
  PartyClient,
  partyOverlay,
  defaultPartySocketUrl,
  isPartyRoomCode,
  normalizePartyCode,
  type PartySocketLike,
} from "./party-client";

class FakeSocket implements PartySocketLike {
  readyState = 1;
  sent: any[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code?: number }) => void) | null = null;
  onerror: (() => void) | null = null;

  send(data: string): void {
    this.sent.push(JSON.parse(data));
  }
  close(): void {
    this.readyState = 3;
    this.onclose?.({ code: 1000 });
  }
  receive(payload: unknown): void {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }
}

const HOST = {
  peerId: "p-host",
  displayName: "Host Royal",
  avatarUrl: null,
  profileSlug: "host-royal",
  isHost: true,
  connected: true,
  score: 0,
  correct: 0,
  roundsWon: 0,
};
const GUEST = { ...HOST, peerId: "p-guest", displayName: "Guest Gold", isHost: false };

function makeClient() {
  const socket = new FakeSocket();
  const client = new PartyClient({
    getAccessToken: async () => "token-abc",
    socketUrl: (token, code) => defaultPartySocketUrl({ protocol: "http:", host: "palace.test" }, token, code),
    openSocket: () => socket,
  });
  return { client, socket };
}

async function connectAs(socket: FakeSocket, client: PartyClient, you: typeof HOST, game: "trivia" | "duel" = "trivia") {
  await client.connect("abc234");
  socket.receive({
    type: "welcome",
    code: "ABC234",
    you,
    room: {
      code: "ABC234",
      game,
      phase: "lobby",
      hostPeerId: HOST.peerId,
      streamId: null,
      profileSlug: null,
      players: [HOST, GUEST],
      question: null,
      pickerPeerId: null,
      createdAt: 0,
    },
  });
}

describe("party client admission", () => {
  it("builds the socket URL with token + code, normalizing the code", async () => {
    const { client } = makeClient();
    let url = "";
    const tok = ["tok", "123"].join("");
    const probe = new PartyClient({
      getAccessToken: async () => tok,
      socketUrl: (token, code) => defaultPartySocketUrl({ protocol: "https:", host: "bowdownvisuals.com" }, token, code),
      openSocket: (u) => {
        url = u;
        return new FakeSocket();
      },
    });
    await probe.connect(" abc234 ");
    const parsed = new URL(url);
    expect(parsed.protocol).toBe("wss:");
    expect(parsed.pathname).toBe("/api/party/ws");
    expect(parsed.searchParams.get("code")).toBe("ABC234");
    expect(parsed.searchParams.get("token")).toBe(tok);
    expect(client).toBeTruthy();
  });

  it("welcome installs self, players, and inside status", async () => {
    const { client, socket } = makeClient();
    await connectAs(socket, client, HOST);
    expect(client.status).toBe("inside");
    expect(client.isHost).toBe(true);
    expect(client.players).toHaveLength(2);
    expect(client.phase).toBe("lobby");
  });

  it("refusals land on honest statuses that the following close cannot stomp", async () => {
    const full = makeClient();
    await full.client.connect("ABC234");
    full.socket.receive({ type: "room_full", cap: 8 });
    full.socket.onclose?.({ code: 4429 });
    expect(full.client.status).toBe("full");
    expect(partyOverlay(full.client.status)).toBe("room-full");

    const auth = makeClient();
    await auth.client.connect("ABC234");
    auth.socket.receive({ type: "error", code: "auth_required", message: "Sign in to join a party room." });
    auth.socket.onclose?.({ code: 4401 });
    expect(auth.client.status).toBe("auth");

    const gone = makeClient();
    await gone.client.connect("ABC234");
    gone.socket.receive({ type: "error", code: "no_room", message: "That room isn't open." });
    expect(gone.client.status).toBe("no-room");
  });

  it("room codes validate against the unambiguous alphabet", () => {
    expect(isPartyRoomCode("ABC234")).toBe(true);
    expect(isPartyRoomCode("abc234")).toBe(true);
    expect(isPartyRoomCode("ABO123")).toBe(false); // no letter O
    expect(isPartyRoomCode("ABC23")).toBe(false);
    expect(isPartyRoomCode("ABC2345")).toBe(false);
    expect(normalizePartyCode(" abc234 ")).toBe("ABC234");
  });
});

describe("party client play", () => {
  it("host intents send; a guest seat's host intents send nothing", async () => {
    const host = makeClient();
    await connectAs(host.socket, host.client, HOST);
    host.client.start(5);
    host.client.next();
    expect(host.socket.sent).toEqual([{ type: "start", rounds: 5 }, { type: "next" }]);

    const guest = makeClient();
    await connectAs(guest.socket, guest.client, GUEST);
    guest.client.start(5);
    guest.client.next();
    guest.client.end();
    expect(guest.socket.sent).toEqual([]);
  });

  it("question frames are tracked answer-free; answering sends only a choice, once", async () => {
    const { client, socket } = makeClient();
    await connectAs(socket, client, GUEST);
    socket.receive({
      type: "question",
      index: 1,
      total: 5,
      category: "music",
      prompt: "How many notes in an octave?",
      choices: ["Seven", "Eight", "Twelve", "Five"],
      endsAt: Date.now() + 15000,
    });
    expect(client.phase).toBe("question");
    expect(client.question).not.toHaveProperty("answer");
    client.answer(1);
    client.answer(2); // locked in — never sent twice
    expect(socket.sent).toEqual([{ type: "answer", choice: 1 }]);
    expect(JSON.stringify(socket.sent)).not.toContain("score");
    expect(client.myChoice).toBe(1);
  });

  it("pick is honored only for the designated picker during the pick phase", async () => {
    const { client, socket } = makeClient();
    await connectAs(socket, client, GUEST, "duel");
    socket.receive({ type: "pick.begin", pickerPeerId: HOST.peerId, categories: ["music", "creator", "general"], endsAt: 1 });
    client.pick("music");
    expect(socket.sent).toEqual([]);
    socket.receive({ type: "pick.begin", pickerPeerId: GUEST.peerId, categories: ["music", "creator", "general"], endsAt: 1 });
    client.pick("creator");
    expect(socket.sent).toEqual([{ type: "pick", category: "creator" }]);
  });

  it("reveal installs standings; podium installs the crown; host.changed moves the crown", async () => {
    const { client, socket } = makeClient();
    await connectAs(socket, client, GUEST);
    const standing = [
      { ...HOST, score: 1800, correct: 2 },
      { ...GUEST, score: 2400, correct: 3 },
    ];
    socket.receive({
      type: "reveal",
      answer: 1,
      results: [{ peerId: GUEST.peerId, choice: 1, correct: true, points: 950, elapsedMs: 800 }],
      roundWinnerPeerId: null,
      standings: standing,
    });
    expect(client.phase).toBe("reveal");
    expect(client.reveal?.answer).toBe(1);
    expect(client.self?.score).toBe(2400);

    socket.receive({ type: "podium", standings: standing, winnerPeerIds: [GUEST.peerId], draw: false });
    expect(client.phase).toBe("podium");
    expect(client.podium?.winnerPeerIds).toEqual([GUEST.peerId]);

    socket.receive({ type: "host.changed", peerId: GUEST.peerId });
    expect(client.isHost).toBe(true);
  });
});
