/**
 * world-client.ts — The World's presence client: the King's Hall socket
 * brain. Framework-free (the React page is a thin shell) so the whole
 * protocol behaviour is unit-tested in node with fake sockets.
 *
 * Protocol mirrors lib/world-room.ts on the server:
 *   out: move (throttled to ~10/s here AND on the server), say,
 *        voice.join / voice.leave, voice.signal
 *   in:  welcome (self + snapshot), peer.join / peer.move / peer.leave,
 *        peer.say, voice.joined / voice.left / voice.state /
 *        voice.signal / voice.full / voice.denied, room_full
 * Guests (no session token, or a stale one the server couldn't verify)
 * arrive as guest peers: present and visible, no voice, no say — the
 * client hides those controls off `self.guest`, the server enforces it.
 */

export interface WorldPeer {
  peerId: string;
  displayName: string;
  avatarUrl: string | null;
  profileSlug: string | null;
  tint: string;
  guest: boolean;
  voice: boolean;
  x: number;
  y: number;
  z: number;
  rotY: number;
}

export type WorldStatus = "connecting" | "inside" | "full" | "error" | "closed";

export interface WorldSocketLike {
  readyState: number;
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: { code?: number }) => void) | null;
  onerror: (() => void) | null;
}

export interface WorldClientDeps {
  /** Session access token for the handshake (null = guest visit). */
  getAccessToken: () => Promise<string | null>;
  /** Build the socket URL for this token (null token = no query param). */
  socketUrl: (token: string | null) => string;
  /** Open a socket (WebSocket in the browser; fakes in tests). */
  openSocket: (url: string) => WorldSocketLike;
  now?: () => number;
}

export interface WorldSayEvent {
  peerId: string;
  displayName: string;
  body: string;
}

export type VoiceNotice = "full" | "denied-guest";

const MOVE_SEND_INTERVAL_MS = 100; // ~10/s, matching the server throttle

export function defaultWorldSocketUrl(loc: { protocol: string; host: string }, token: string | null): string {
  const proto = loc.protocol === "https:" ? "wss:" : "ws:";
  const q = token ? `?token=${encodeURIComponent(token)}` : "";
  return `${proto}//${loc.host}/api/world/ws${q}`;
}

/** The page overlay for a client status — null means "you're inside,
 *  no overlay". Error and full are honest dead-ends with their own
 *  cards; closed (deliberate leave) shows nothing. */
export function worldOverlay(status: WorldStatus): "connecting" | "room-full" | "error" | null {
  switch (status) {
    case "connecting":
      return "connecting";
    case "full":
      return "room-full";
    case "error":
      return "error";
    default:
      return null;
  }
}

export class WorldClient {
  status: WorldStatus = "connecting";
  self: WorldPeer | null = null;
  peers = new Map<string, WorldPeer>();
  voicePeerIds = new Set<string>();

  /* Assignable handlers — the page wires scene + voice + chat log. */
  onStatus: ((status: WorldStatus) => void) | null = null;
  onPeerJoin: ((peer: WorldPeer) => void) | null = null;
  onPeerLeave: ((peerId: string) => void) | null = null;
  onSay: ((ev: WorldSayEvent) => void) | null = null;
  onSignal: ((from: string, data: unknown) => void) | null = null;
  onVoiceState: ((voicePeerIds: string[]) => void) | null = null;
  onVoicePeerJoined: ((peerId: string) => void) | null = null;
  onVoicePeerLeft: ((peerId: string) => void) | null = null;
  onVoiceNotice: ((notice: VoiceNotice) => void) | null = null;

  private socket: WorldSocketLike | null = null;
  private lastMoveSentAt = 0;
  private readonly now: () => number;

  constructor(private deps: WorldClientDeps) {
    this.now = deps.now ?? (() => Date.now());
  }

  get isGuest(): boolean {
    return this.self?.guest ?? true;
  }

  get inVoice(): boolean {
    return !!this.self && this.voicePeerIds.has(this.self.peerId);
  }

  async connect(): Promise<void> {
    this.setStatus("connecting");
    let token: string | null = null;
    try {
      token = await this.deps.getAccessToken();
    } catch {
      token = null; // a token hiccup downgrades to guest, never blocks the door
    }
    const socket = this.deps.openSocket(this.deps.socketUrl(token));
    this.socket = socket;
    socket.onmessage = (ev) => this.handleFrame(ev.data);
    socket.onclose = (ev) => {
      if (this.status === "full") return; // room_full already explained itself
      if (this.status === "inside" || this.status === "connecting") {
        this.setStatus(ev.code === 1000 || ev.code === 1005 ? "closed" : "error");
      }
    };
    socket.onerror = () => {
      if (this.status === "connecting") this.setStatus("error");
    };
  }

  disconnect(): void {
    this.setStatus("closed");
    try {
      this.socket?.close();
    } catch {
      /* already gone */
    }
    this.socket = null;
    this.peers.clear();
    this.voicePeerIds.clear();
    this.self = null;
  }

  /** Position sync — throttled; the latest pose always wins the next
   *  window, so a fast turn never gets stuck a beat behind. */
  sendMove(x: number, z: number, rotY: number): void {
    if (this.status !== "inside" || !this.socket) return;
    const t = this.now();
    if (t - this.lastMoveSentAt < MOVE_SEND_INTERVAL_MS) return;
    this.lastMoveSentAt = t;
    this.send({ type: "move", x, y: 0, z, rotY });
  }

  /** Room text. Returns false without sending when it can't land
   *  (guest, not inside, empty) so the composer can stay honest. */
  say(body: string): boolean {
    if (this.status !== "inside" || this.isGuest) return false;
    const trimmed = body.trim();
    if (!trimmed) return false;
    this.send({ type: "say", body: trimmed });
    return true;
  }

  joinVoice(): void {
    if (this.status !== "inside" || this.isGuest) return;
    this.send({ type: "voice.join" });
  }

  leaveVoice(): void {
    this.send({ type: "voice.leave" });
  }

  sendSignal(to: string, data: unknown): void {
    this.send({ type: "voice.signal", to, data });
  }

  private send(payload: unknown): void {
    if (!this.socket || this.socket.readyState !== 1) return;
    try {
      this.socket.send(JSON.stringify(payload));
    } catch {
      /* a dying socket surfaces via onclose */
    }
  }

  private setStatus(status: WorldStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.onStatus?.(status);
  }

  private handleFrame(data: unknown): void {
    let frame: Record<string, unknown>;
    try {
      const parsed: unknown = typeof data === "string" ? JSON.parse(data) : null;
      if (!parsed || typeof parsed !== "object") return;
      frame = parsed as Record<string, unknown>;
    } catch {
      return;
    }

    switch (frame["type"]) {
      case "room_full": {
        this.setStatus("full");
        return;
      }
      case "welcome": {
        const you = frame["you"] as WorldPeer;
        this.self = you;
        this.peers.clear();
        const snapshot = Array.isArray(frame["peers"]) ? (frame["peers"] as WorldPeer[]) : [];
        for (const peer of snapshot) {
          this.peers.set(peer.peerId, peer);
          if (peer.voice) this.voicePeerIds.add(peer.peerId);
        }
        this.setStatus("inside");
        return;
      }
      case "peer.join": {
        const peer = frame["peer"] as WorldPeer;
        if (!peer || peer.peerId === this.self?.peerId) return;
        this.peers.set(peer.peerId, peer);
        this.onPeerJoin?.(peer);
        return;
      }
      case "peer.move": {
        const peer = this.peers.get(String(frame["peerId"]));
        if (!peer) return;
        peer.x = Number(frame["x"] ?? peer.x);
        peer.y = Number(frame["y"] ?? peer.y);
        peer.z = Number(frame["z"] ?? peer.z);
        peer.rotY = Number(frame["rotY"] ?? peer.rotY);
        return;
      }
      case "peer.leave": {
        const peerId = String(frame["peerId"]);
        this.peers.delete(peerId);
        if (this.voicePeerIds.delete(peerId)) this.onVoicePeerLeft?.(peerId);
        this.onPeerLeave?.(peerId);
        return;
      }
      case "peer.say": {
        const peerId = String(frame["peerId"]);
        const author = peerId === this.self?.peerId ? this.self : this.peers.get(peerId);
        this.onSay?.({
          peerId,
          displayName: author?.displayName ?? "Someone in the hall",
          body: String(frame["body"] ?? ""),
        });
        return;
      }
      case "voice.joined": {
        const peerId = String(frame["peerId"]);
        this.voicePeerIds.add(peerId);
        const peer = this.peers.get(peerId);
        if (peer) peer.voice = true;
        if (this.self && peerId === this.self.peerId) this.self.voice = true;
        this.onVoicePeerJoined?.(peerId);
        return;
      }
      case "voice.left": {
        const peerId = String(frame["peerId"]);
        this.voicePeerIds.delete(peerId);
        const peer = this.peers.get(peerId);
        if (peer) peer.voice = false;
        if (this.self && peerId === this.self.peerId) this.self.voice = false;
        this.onVoicePeerLeft?.(peerId);
        return;
      }
      case "voice.state": {
        const ids = Array.isArray(frame["voicePeerIds"]) ? (frame["voicePeerIds"] as string[]) : [];
        if (this.self) this.voicePeerIds.add(this.self.peerId);
        this.onVoiceState?.(ids);
        return;
      }
      case "voice.signal": {
        this.onSignal?.(String(frame["from"]), frame["data"]);
        return;
      }
      case "voice.full": {
        this.onVoiceNotice?.("full");
        return;
      }
      case "voice.denied": {
        this.onVoiceNotice?.("denied-guest");
        return;
      }
      default:
        return;
    }
  }
}
