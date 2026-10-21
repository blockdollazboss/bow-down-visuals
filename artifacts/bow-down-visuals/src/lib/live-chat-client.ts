/**
 * live-chat-client.ts — the stream chat panel's brain: message store,
 * history/catch-up merging, WebSocket delivery with polling fallback,
 * and the honest composer states. Framework-free (the React panel is
 * a thin shell over it) so the whole behaviour is unit-tested in node.
 *
 * Delivery: the socket is push-only (writes stay on POST — one write
 * path for validation, pacing and moderation). When no socket can be
 * held (guest, refusal, drop), the client polls GET ?after=<lastId>
 * every 2.5s. Messages are deduped by id everywhere: a message you
 * post arrives both as the POST response and as a room broadcast.
 */

export interface ChatAuthor {
  displayName: string;
  avatarUrl: string | null;
  slug: string | null;
}

export interface ChatMessage {
  id: string;
  streamId: string;
  userId: string;
  body: string;
  createdAt: string;
  author: ChatAuthor;
  /** 'chat' | 'tip' — tip messages render gold with their amount. */
  kind?: "chat" | "tip";
  tipAmountVb?: number | null;
}

export interface ChatPin {
  message: ChatMessage;
  pinnedUntil: string;
}

export interface ChatPage {
  streamId: string;
  streamStatus: "live" | "ended";
  streamTitle: string;
  ownerId: string;
  messages: ChatMessage[];
  hasMore: boolean;
  /** The server's active paid pin (null when there is none). */
  pinned?: ChatPin | null;
  /** Appointed channel moderators (user ids) for badge + controls. */
  moderatorIds?: string[];
}

/** A live alert event from the room (tip / follow) — the studio's
 *  Program overlay queues these. */
export interface LiveAlertEvent {
  kind: "tip" | "follow";
  title: string;
  body: string;
  amountVb?: number;
}

export interface ChatSocketLike {
  readyState: number;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: { code?: number }) => void) | null;
  onerror: (() => void) | null;
}

/** Timer handles differ between DOM (number) and Node (Timeout). */
export type TimerHandle = ReturnType<typeof setTimeout> | number;

export interface LiveChatDeps {
  /** REST call returning { status, json }; attaches the session token. */
  fetchJson: (path: string, init?: RequestInit) => Promise<{ status: number; json: any }>;
  /** Session access token for the socket handshake (null = guest). */
  getAccessToken: () => Promise<string | null>;
  /** My own user id (null for guests) — a user_muted event naming me
   *  flips the composer into its muted state. */
  selfId?: string | null;
  /** Build the socket URL for this stream + token. */
  socketUrl: (streamId: string, token: string) => string;
  /** Open a socket (WebSocket in the browser; fakes in tests). */
  openSocket: (url: string) => ChatSocketLike;
  setIntervalFn?: (fn: () => void, ms: number) => TimerHandle;
  clearIntervalFn?: (id: TimerHandle) => void;
  setTimeoutFn?: (fn: () => void, ms: number) => TimerHandle;
  clearTimeoutFn?: (id: TimerHandle) => void;
}

export type ChatLoadState = "loading" | "ready" | "error";
export type ChatDelivery = "ws" | "polling";

const POLL_MS = 2500;
const RECONNECT_MS = [2000, 5000, 10000];

export interface ComposerState {
  enabled: boolean;
  /** Why the composer is disabled, in house voice (null when enabled). */
  note: string | null;
  /** Guests get a sign-in prompt instead of a composer. */
  signIn: boolean;
}

/** The composer's honest state for a given situation. Pure — tested. */
export function composerState(args: {
  signedIn: boolean;
  streamStatus: "live" | "ended" | "idle";
  muted: boolean;
}): ComposerState {
  if (args.streamStatus === "ended") {
    return { enabled: false, signIn: false, note: "This stream has ended — chat is read-only." };
  }
  if (args.streamStatus !== "live") {
    return { enabled: false, signIn: false, note: "Chat opens when the stream starts." };
  }
  if (!args.signedIn) {
    return { enabled: false, signIn: true, note: null };
  }
  if (args.muted) {
    return { enabled: false, signIn: false, note: "You've been muted in this stream by the streamer." };
  }
  return { enabled: true, signIn: false, note: null };
}

export class LiveChatClient {
  messages: ChatMessage[] = [];
  loadState: ChatLoadState = "loading";
  streamStatus: "live" | "ended" | "idle" = "idle";
  ownerId: string | null = null;
  delivery: ChatDelivery = "polling";
  mutedSelf = false;
  /** Users the owner has muted this session (owner's own panel state). */
  mutedUsers = new Set<string>();
  /** Transient server notice (rate limit, mute, closed chat…). */
  notice: string | null = null;
  /** The active paid pin, always from server data (page or socket). */
  pinned: ChatPin | null = null;
  /** Live alert events (tips/follows) for the studio overlay. */
  onAlert: ((alert: LiveAlertEvent) => void) | null = null;
  /** Appointed channel moderators, from server data only. */
  moderatorIds = new Set<string>();

  /** My role on this stream, from server data (owner / moderator / viewer). */
  get selfRole(): "owner" | "moderator" | "viewer" {
    const selfId = this.deps.selfId;
    if (!selfId) return "viewer";
    if (this.ownerId && selfId === this.ownerId) return "owner";
    return this.moderatorIds.has(selfId) ? "moderator" : "viewer";
  }

  private _socket: ChatSocketLike | null = null;
  private _pollTimer: TimerHandle | null = null;
  private _reconnectTimer: TimerHandle | null = null;
  private _reconnectStep = 0;
  private _stopped = false;
  private _started = false;

  constructor(
    readonly streamId: string,
    private deps: LiveChatDeps,
    private onChange: () => void,
  ) {}

  /* ---------------------------------------------------------- lifecycle */

  async start(): Promise<void> {
    if (this._started) return;
    this._started = true;
    await this.loadHistory();
    if (this._stopped) return;
    await this.connectSocket();
    this.syncPolling();
  }

  stop(): void {
    this._stopped = true;
    this.closeSocket();
    this.stopPolling();
    if (this._reconnectTimer) {
      (this.deps.clearTimeoutFn ?? clearTimeout)(this._reconnectTimer);
      this._reconnectTimer = null;
    }
  }

  async loadHistory(): Promise<void> {
    this.loadState = this.messages.length ? this.loadState : "loading";
    this.onChange();
    try {
      const { status, json } = await this.deps.fetchJson(`/api/live/${this.streamId}/chat`);
      if (status !== 200 || !json) throw new Error("history failed");
      this.applyPage(json as ChatPage);
      this.loadState = "ready";
    } catch {
      this.loadState = "error";
    }
    this.onChange();
  }

  /* ---------------------------------------------------------- store */

  applyPage(page: ChatPage): void {
    this.streamStatus = page.streamStatus;
    this.ownerId = page.ownerId;
    this.pinned = page.pinned ?? null;
    if (page.moderatorIds) this.moderatorIds = new Set(page.moderatorIds);
    const byId = new Map<string, ChatMessage>();
    for (const m of page.messages) byId.set(m.id, m);
    this.messages = [...byId.values()].sort(byTime);
  }

  /** Merge catch-up / history pages without duplicating or reordering. */
  mergeMessages(incoming: ChatMessage[]): void {
    if (!incoming.length) return;
    const byId = new Map(this.messages.map((m) => [m.id, m]));
    let changed = false;
    for (const m of incoming) {
      if (!byId.has(m.id)) {
        byId.set(m.id, m);
        changed = true;
      }
    }
    if (changed) {
      this.messages = [...byId.values()].sort(byTime);
      this.onChange();
    }
  }

  applyDeleted(messageId: string): void {
    const before = this.messages.length;
    this.messages = this.messages.filter((m) => m.id !== messageId);
    if (this.messages.length !== before) this.onChange();
  }

  lastMessageId(): string | null {
    return this.messages.length ? this.messages[this.messages.length - 1].id : null;
  }

  /* ---------------------------------------------------------- delivery */

  private async connectSocket(): Promise<void> {
    if (this._stopped || this._socket) return;
    const token = await this.deps.getAccessToken().catch(() => null);
    if (!token || this._stopped) return; // guests poll — no socket to hold
    let socket: ChatSocketLike;
    try {
      socket = this.deps.openSocket(this.deps.socketUrl(this.streamId, token));
    } catch {
      return;
    }
    this._socket = socket;
    socket.onopen = () => {
      this.delivery = "ws";
      this._reconnectStep = 0;
      this.syncPolling();
      this.onChange();
      // Fill anything missed while the socket was down.
      void this.catchUp();
    };
    socket.onmessage = (ev) => this.handleSocketEvent(ev.data);
    socket.onclose = () => {
      if (this._socket === socket) this._socket = null;
      this.delivery = "polling";
      this.syncPolling();
      this.onChange();
      this.scheduleReconnect();
    };
    socket.onerror = () => {
      try {
        socket.close();
      } catch {
        /* close handler runs the fallback */
      }
    };
  }

  private closeSocket(): void {
    const socket = this._socket;
    this._socket = null;
    if (socket) {
      socket.onclose = null;
      try {
        socket.close();
      } catch {
        /* already closed */
      }
    }
  }

  private scheduleReconnect(): void {
    if (this._stopped || this.streamStatus !== "live") return;
    const delay = RECONNECT_MS[Math.min(this._reconnectStep, RECONNECT_MS.length - 1)];
    this._reconnectStep++;
    const setTimeoutFn = this.deps.setTimeoutFn ?? setTimeout;
    this._reconnectTimer = setTimeoutFn(() => {
      this._reconnectTimer = null;
      void this.connectSocket();
    }, delay);
  }

  private syncPolling(): void {
    const shouldPoll = !this._stopped && this.delivery === "polling" && this.loadState === "ready";
    if (shouldPoll && !this._pollTimer) {
      const setIntervalFn = this.deps.setIntervalFn ?? setInterval;
      this._pollTimer = setIntervalFn(() => void this.catchUp(), POLL_MS);
    } else if (!shouldPoll) {
      this.stopPolling();
    }
  }

  private stopPolling(): void {
    if (this._pollTimer) {
      (this.deps.clearIntervalFn ?? clearInterval)(this._pollTimer);
      this._pollTimer = null;
    }
  }

  /** One catch-up fetch (poll tick or socket reconnect). */
  async catchUp(): Promise<void> {
    if (this._stopped) return;
    try {
      const after = this.lastMessageId();
      const path = after ? `/api/live/${this.streamId}/chat?after=${encodeURIComponent(after)}` : `/api/live/${this.streamId}/chat`;
      const { status, json } = await this.deps.fetchJson(path);
      if (status !== 200 || !json) return;
      const page = json as ChatPage;
      const statusChanged = page.streamStatus !== this.streamStatus;
      this.streamStatus = page.streamStatus;
      this.ownerId = page.ownerId;
      this.pinned = page.pinned ?? this.pinned;
      if (page.moderatorIds) this.moderatorIds = new Set(page.moderatorIds);
      this.mergeMessages(page.messages);
      if (statusChanged) {
        if (this.streamStatus !== "live") this.closeSocket();
        this.onChange();
      }
    } catch {
      /* the next tick retries */
    }
  }

  private handleSocketEvent(data: unknown): void {
    let ev: any;
    try {
      ev = JSON.parse(String(data));
    } catch {
      return;
    }
    if (!ev || typeof ev !== "object") return;
    if (ev.type === "hello" && (ev.streamStatus === "live" || ev.streamStatus === "ended")) {
      this.streamStatus = ev.streamStatus;
      this.onChange();
    } else if (ev.type === "message" && ev.message) {
      this.mergeMessages([ev.message as ChatMessage]);
    } else if (ev.type === "message_deleted" && typeof ev.messageId === "string") {
      this.applyDeleted(ev.messageId);
    } else if (ev.type === "pin_updated") {
      this.pinned = (ev.pinned as ChatPin | null) ?? null;
      this.onChange();
    } else if (ev.type === "alert" && ev.alert && typeof ev.alert.title === "string") {
      this.onAlert?.({
        kind: ev.alert.kind === "follow" ? "follow" : "tip",
        title: ev.alert.title,
        body: typeof ev.alert.body === "string" ? ev.alert.body : "",
        amountVb: typeof ev.alert.amountVb === "number" ? ev.alert.amountVb : undefined,
      });
    } else if (ev.type === "user_muted" && typeof ev.userId === "string") {
      this.mutedUsers.add(ev.userId);
      if (this.deps.selfId && ev.userId === this.deps.selfId) this.mutedSelf = true;
      this.onChange();
    } else if (ev.type === "user_unmuted" && typeof ev.userId === "string") {
      this.mutedUsers.delete(ev.userId);
      if (this.deps.selfId && ev.userId === this.deps.selfId) this.mutedSelf = false;
      this.onChange();
    }
  }

  /* ---------------------------------------------------------- writes */

  async send(body: string): Promise<boolean> {
    const text = body.trim();
    if (!text) return false;
    try {
      const { status, json } = await this.deps.fetchJson(`/api/live/${this.streamId}/chat`, {
        method: "POST",
        body: JSON.stringify({ body: text }),
      });
      if (status === 201 && json?.message) {
        this.notice = null;
        this.mergeMessages([json.message as ChatMessage]);
        this.onChange();
        return true;
      }
      if (status === 403 && json?.code === "MUTED") this.mutedSelf = true;
      if (status === 409) this.streamStatus = "ended";
      this.notice = (json?.error as string) ?? "Your message didn't go through. Try again.";
      this.onChange();
      return false;
    } catch {
      this.notice = "Your message didn't go through. Try again.";
      this.onChange();
      return false;
    }
  }

  /** Tip the streamer in Visual Bucs. The idempotency key is one per
   *  user intent (generated by the caller), so a double-tap can't
   *  double-charge. Returns the server's honest outcome. */
  async sendTip(
    amountVb: number,
    body: string,
    idempotencyKey: string,
  ): Promise<{ ok: boolean; pinned: boolean; error: string | null }> {
    try {
      const { status, json } = await this.deps.fetchJson(`/api/live/${this.streamId}/tips`, {
        method: "POST",
        body: JSON.stringify({ amountVb, body, idempotencyKey }),
      });
      if ((status === 200 || status === 201) && json?.tip) {
        this.notice = null;
        this.onChange();
        return { ok: true, pinned: !!json.pinnedUntil, error: null };
      }
      const error = (json?.error as string) ?? "That tip didn't go through. Try again.";
      this.notice = error;
      this.onChange();
      return { ok: false, pinned: false, error };
    } catch {
      const error = "That tip didn't go through. Try again.";
      this.notice = error;
      this.onChange();
      return { ok: false, pinned: false, error };
    }
  }

  async deleteMessage(messageId: string): Promise<boolean> {
    try {
      const { status, json } = await this.deps.fetchJson(`/api/live/${this.streamId}/chat/${messageId}`, {
        method: "DELETE",
      });
      if (status === 200) {
        this.applyDeleted(messageId);
        return true;
      }
      this.notice = (json?.error as string) ?? "That message couldn't be removed.";
      this.onChange();
      return false;
    } catch {
      this.notice = "That message couldn't be removed.";
      this.onChange();
      return false;
    }
  }

  async muteUser(userId: string): Promise<boolean> {
    try {
      const { status, json } = await this.deps.fetchJson(`/api/live/${this.streamId}/chat/mute`, {
        method: "POST",
        body: JSON.stringify({ userId }),
      });
      if (status === 200) {
        this.mutedUsers.add(userId);
        this.onChange();
        return true;
      }
      this.notice = (json?.error as string) ?? "That chatter couldn't be muted.";
      this.onChange();
      return false;
    } catch {
      this.notice = "That chatter couldn't be muted.";
      this.onChange();
      return false;
    }
  }

  async unmuteUser(userId: string): Promise<boolean> {
    try {
      const { status, json } = await this.deps.fetchJson(`/api/live/${this.streamId}/chat/mute/${userId}`, {
        method: "DELETE",
      });
      if (status === 200) {
        this.mutedUsers.delete(userId);
        this.onChange();
        return true;
      }
      this.notice = (json?.error as string) ?? "That chatter couldn't be unmuted.";
      this.onChange();
      return false;
    } catch {
      this.notice = "That chatter couldn't be unmuted.";
      this.onChange();
      return false;
    }
  }
}

function byTime(a: ChatMessage, b: ChatMessage): number {
  const dt = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  return dt !== 0 ? dt : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Default socket URL for a stream: same origin, ws/wss by page scheme. */
export function defaultSocketUrl(locationLike: { protocol: string; host: string }, streamId: string, token: string): string {
  const scheme = locationLike.protocol === "https:" ? "wss:" : "ws:";
  return `${scheme}//${locationLike.host}/api/live/${streamId}/chat/ws?token=${encodeURIComponent(token)}`;
}
