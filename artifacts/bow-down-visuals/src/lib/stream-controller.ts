/**
 * stream-controller.ts — the Stream Controller protocol + clients.
 *
 * One deck, two homes: the studio renders it docked (driving its own
 * state directly), and the phone remote page renders the same deck
 * driving the studio over the socket relay (server route:
 * /api/live/controller/ws — per-user rooms keyed by the VERIFIED
 * session, so a remote can only ever reach its own account's studio).
 *
 * Frames:
 *   remote → { type: "command", id, command, args?, targetStageId? }
 *   stage  → { type: "state", state }        (its full confirmed state)
 *   server → { type: "state.sync", state }   (stage state, relayed)
 *   server → { type: "presence", stageConnected, stageCount }
 *
 * Nothing is optimistic: deck buttons render the last CONFIRMED
 * state.sync. A press marks the command pending; the studio's next
 * state.sync confirms it (its executor broadcasts fresh state right
 * after running a command) — or the pending beat times out at ~3s
 * and the deck says so, honestly.
 */

export const CONTROLLER_COMMANDS = [
  "scene.select",
  "transition.cut",
  "transition.fade",
  "mic.toggle",
  "camera.toggle",
  "record.toggle",
  "stream.start",
  "stream.end",
] as const;

export type ControllerCommand = (typeof CONTROLLER_COMMANDS)[number];

export function isControllerCommand(v: unknown): v is ControllerCommand {
  return typeof v === "string" && (CONTROLLER_COMMANDS as readonly string[]).includes(v);
}

export interface ControllerScene {
  id: string;
  name: string;
}

/** The studio's confirmed state — the ONLY thing deck buttons show. */
export interface ControllerState {
  /** Stable per studio tab; the remote targets the live/most recent. */
  stageId: string;
  /** Human label for the target (the stream title, or "Your studio"). */
  label: string;
  live: boolean;
  title: string;
  scenes: ControllerScene[];
  activeSceneId: string | null;
  previewSceneId: string | null;
  micMuted: boolean;
  /**
   * A real mic input exists right now (mixer present, studio phase not
   * "off"). Optional because older snapshots omit it — and an omitted
   * or false value must read as NO mic (the deck shows "Off"), never
   * as a defaulted live mic. See micReadout().
   */
  micPresent?: boolean;
  cameraOn: boolean;
  recording: boolean;
  /** When the current broadcast started (ms epoch), or null. */
  liveSince: number | null;
}

export interface ControllerPresence {
  stageConnected: boolean;
  stageCount: number;
}

export interface ControllerSocketLike {
  readyState: number;
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: { code?: number }) => void) | null;
  onerror: (() => void) | null;
}

export interface ControllerClientDeps {
  getAccessToken: () => Promise<string | null>;
  socketUrl: (role: "stage" | "remote") => string;
  openSocket: (url: string) => ControllerSocketLike;
  setTimeoutFn?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout> | number;
  clearTimeoutFn?: (id: ReturnType<typeof setTimeout> | number) => void;
  now?: () => number;
}

export const ACK_TIMEOUT_MS = 3000;
const RECONNECT_MS = [1500, 4000, 8000];
/** A socket that hasn't opened within this window is a stalled
    handshake: retire it by hand (it may never fire onclose) and climb
    the reconnect ladder instead of hanging on "connecting…" forever. */
export const HANDSHAKE_TIMEOUT_MS = 8000;

/**
 * The deck's mic readout, derived from reality: only a state that
 * carries a REAL mic input may read "live" or "muted". No state yet,
 * or a state whose mic doesn't exist (mixer absent, phase "off", or
 * an older snapshot that never said) reads "off" — a fallback must
 * never present as an affirmative Live.
 */
export function micReadout(state: ControllerState | null): "live" | "muted" | "off" {
  if (!state || state.micPresent !== true) return "off";
  return state.micMuted ? "muted" : "live";
}

function defaultSocketUrl(locationLike: { protocol: string; host: string }, role: "stage" | "remote", token: string): string {
  const scheme = locationLike.protocol === "https:" ? "wss:" : "ws:";
  return `${scheme}//${locationLike.host}/api/live/controller/ws?role=${role}&token=${encodeURIComponent(token)}`;
}

export function controllerSocketUrl(
  locationLike: { protocol: string; host: string },
  role: "stage" | "remote",
): (token: string) => string {
  return (token: string) => defaultSocketUrl(locationLike, role, token);
}

interface PendingCommand {
  id: string;
  command: ControllerCommand;
  sceneId?: string;
  sentAt: number;
  /** Confirm predicate against a fresh confirmed state. */
  expect: (s: ControllerState) => boolean;
}

/* ------------------------------------------------------------ remote */

export class ControllerRemoteClient {
  /** Latest confirmed studio state (null until the first state.sync). */
  state: ControllerState | null = null;
  presence: ControllerPresence = { stageConnected: false, stageCount: 0 };
  /** The socket itself is up (independent of whether a studio is). */
  socketUp = false;
  notice: string | null = null;
  /** stageId the commands target: the live stage, else most recent. */
  targetStageId: string | null = null;

  private _pending = new Map<string, PendingCommand>();
  private _socket: ControllerSocketLike | null = null;
  private _stopped = false;
  private _reconnectTimer: ReturnType<typeof setTimeout> | number | null = null;
  private _reconnectStep = 0;
  private _handshakeTimer: ReturnType<typeof setTimeout> | number | null = null;
  private _seq = 0;

  /** True once the reconnect ladder is exhausted: the link is
      unavailable right now (the ladder keeps retrying at its last
      rung, and a later open clears this). Labels read this instead
      of saying "connecting…" forever. */
  get linkUnavailable(): boolean {
    return this._reconnectStep >= RECONNECT_MS.length;
  }

  private clearHandshakeTimer(): void {
    if (this._handshakeTimer) {
      (this.deps.clearTimeoutFn ?? clearTimeout)(this._handshakeTimer);
      this._handshakeTimer = null;
    }
  }

  constructor(
    private deps: ControllerClientDeps,
    private onChange: () => void,
  ) {}

  async start(): Promise<void> {
    await this.connect();
  }

  stop(): void {
    this._stopped = true;
    if (this._reconnectTimer) {
      (this.deps.clearTimeoutFn ?? clearTimeout)(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    this.clearHandshakeTimer();
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

  private async connect(): Promise<void> {
    if (this._stopped || this._socket) return;
    const token = await this.deps.getAccessToken().catch(() => null);
    if (this._stopped) return;
    if (!token) {
      // A missing/rejected token is a failed attempt, not a dead
      // end: climb the same reconnect ladder onclose uses.
      this.scheduleReconnect();
      return;
    }
    let socket: ControllerSocketLike;
    try {
      socket = this.deps.openSocket(this.deps.socketUrl("remote"));
    } catch {
      this.scheduleReconnect();
      return;
    }
    this._socket = socket;
    const setTimeoutFn = this.deps.setTimeoutFn ?? setTimeout;
    this._handshakeTimer = setTimeoutFn(() => {
      this._handshakeTimer = null;
      if (this._stopped || this._socket !== socket) return;
      // Stalled handshake: the socket never opened and may never
      // fire onclose. Retire it by hand and climb the ladder.
      socket.onclose = null;
      this._socket = null;
      this.socketUp = false;
      try {
        socket.close();
      } catch {
        /* already gone */
      }
      this.onChange();
      this.scheduleReconnect();
    }, HANDSHAKE_TIMEOUT_MS);
    socket.onopen = () => {
      this.clearHandshakeTimer();
      this.socketUp = true;
      this._reconnectStep = 0;
      this.onChange();
    };
    socket.onmessage = (ev) => this.handleFrame(ev.data);
    socket.onclose = () => {
      this.clearHandshakeTimer();
      if (this._socket === socket) this._socket = null;
      this.socketUp = false;
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

  private scheduleReconnect(): void {
    if (this._stopped) return;
    const delay = RECONNECT_MS[Math.min(this._reconnectStep, RECONNECT_MS.length - 1)];
    this._reconnectStep++;
    const setTimeoutFn = this.deps.setTimeoutFn ?? setTimeout;
    this._reconnectTimer = setTimeoutFn(() => {
      this._reconnectTimer = null;
      void this.connect();
    }, delay);
    // Surface the step change: at the ladder's top, linkUnavailable
    // flips and the label must stop saying "connecting…".
    this.onChange();
  }

  private handleFrame(data: unknown): void {
    let frame: any;
    try {
      frame = JSON.parse(String(data));
    } catch {
      return;
    }
    if (!frame || typeof frame !== "object") return;
    if (frame.type === "presence") {
      this.presence = {
        stageConnected: !!frame.stageConnected,
        stageCount: typeof frame.stageCount === "number" ? frame.stageCount : 0,
      };
      if (!this.presence.stageConnected) this.state = null;
      this.onChange();
      return;
    }
    if (frame.type === "state.sync" && frame.state) {
      const state = frame.state as ControllerState;
      const prev = this.state;
      this.state = state;
      // Target the live stage; a non-live stage only takes the target
      // when the previously held stage wasn't live either (most
      // recent wins by arrival).
      if (state.live || !prev?.live) this.targetStageId = state.stageId;
      this.confirmPending(state);
      this.onChange();
    }
  }

  private confirmPending(state: ControllerState): void {
    const now = (this.deps.now ?? Date.now)();
    let expired = false;
    for (const [id, pending] of [...this._pending]) {
      if (pending.expect(state)) {
        this._pending.delete(id);
      } else if (now - pending.sentAt > ACK_TIMEOUT_MS) {
        this._pending.delete(id);
        expired = true;
      }
    }
    if (expired) {
      this.notice = "That didn't go through — check the studio connection.";
    }
  }

  /** Sweep pending beats that outlived their window (call on a tick,
   *  or rely on the next state.sync / press to sweep). */
  sweepPending(): void {
    if (!this.state) return;
    this.confirmPending(this.state);
    this.onChange();
  }

  isPending(command: ControllerCommand, sceneId?: string): boolean {
    for (const p of this._pending.values()) {
      if (p.command !== command) continue;
      if (command === "scene.select") return p.sceneId === sceneId;
      return true;
    }
    return false;
  }

  /** Send a command to my studio. Returns the command id, or null
   *  when there is nowhere for it to go (button should be disabled). */
  send(command: ControllerCommand, args?: Record<string, unknown>): string | null {
    if (!this._socket || this._socket.readyState !== 1 || !this.presence.stageConnected) return null;
    const current = this.state;
    const sceneId = typeof args?.sceneId === "string" ? args.sceneId : undefined;
    const id = `${command}:${sceneId ?? ""}:${++this._seq}`;
    const expect = expectFor(command, args, current);
    this._pending.set(id, { id, command, sceneId, sentAt: (this.deps.now ?? Date.now)(), expect });
    this.notice = null;
    try {
      this._socket.send(
        JSON.stringify({ type: "command", id, command, args: args ?? {}, targetStageId: this.targetStageId }),
      );
    } catch {
      this._pending.delete(id);
      this.notice = "That didn't go through — check the studio connection.";
      this.onChange();
      return null;
    }
    this.onChange();
    return id;
  }
}

/** The confirm predicate for a command, from the state at press time. */
export function expectFor(
  command: ControllerCommand,
  args: Record<string, unknown> | undefined,
  current: ControllerState | null,
): (s: ControllerState) => boolean {
  switch (command) {
    case "scene.select": {
      const sceneId = typeof args?.sceneId === "string" ? args.sceneId : null;
      return (s) => s.activeSceneId === sceneId;
    }
    case "mic.toggle":
      return (s) => (current ? s.micMuted !== current.micMuted : true);
    case "camera.toggle":
      return (s) => (current ? s.cameraOn !== current.cameraOn : true);
    case "record.toggle":
      return (s) => (current ? s.recording !== current.recording : true);
    case "stream.start":
      return (s) => s.live === true;
    case "stream.end":
      return (s) => s.live === false;
    case "transition.cut":
    case "transition.fade":
      // A transition's result is the program scene afterwards, which
      // the press can't name (it's whatever preview was). Any fresh
      // confirmed state after the press is the confirm.
      return () => true;
  }
}

/* ------------------------------------------------------------ stage */

/**
 * The studio side: connects as role=stage, executes commands against
 * the studio's real controls (injected), and publishes confirmed
 * state after every execution + whenever the studio changes.
 */
export class ControllerStageClient {
  socketUp = false;
  private _socket: ControllerSocketLike | null = null;
  private _stopped = false;
  private _reconnectTimer: ReturnType<typeof setTimeout> | number | null = null;
  private _reconnectStep = 0;
  private _handshakeTimer: ReturnType<typeof setTimeout> | number | null = null;

  /** True once the reconnect ladder is exhausted: the link is
      unavailable right now (the ladder keeps retrying at its last
      rung, and a later open clears this). The studio's link label
      reads this instead of saying "connecting…" forever. */
  get linkUnavailable(): boolean {
    return this._reconnectStep >= RECONNECT_MS.length;
  }

  private clearHandshakeTimer(): void {
    if (this._handshakeTimer) {
      (this.deps.clearTimeoutFn ?? clearTimeout)(this._handshakeTimer);
      this._handshakeTimer = null;
    }
  }

  constructor(
    private deps: ControllerClientDeps,
    private execute: (command: ControllerCommand, args: Record<string, unknown>) => void | Promise<void>,
    private buildState: () => ControllerState,
    private onChange: () => void,
  ) {}

  async start(): Promise<void> {
    await this.connect();
  }

  stop(): void {
    this._stopped = true;
    if (this._reconnectTimer) {
      (this.deps.clearTimeoutFn ?? clearTimeout)(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    this.clearHandshakeTimer();
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

  private async connect(): Promise<void> {
    if (this._stopped || this._socket) return;
    const token = await this.deps.getAccessToken().catch(() => null);
    if (this._stopped) return;
    if (!token) {
      // A missing/rejected token is a failed attempt, not a dead
      // end: climb the same reconnect ladder onclose uses.
      this.scheduleReconnect();
      return;
    }
    let socket: ControllerSocketLike;
    try {
      socket = this.deps.openSocket(this.deps.socketUrl("stage"));
    } catch {
      this.scheduleReconnect();
      return;
    }
    this._socket = socket;
    const setTimeoutFn = this.deps.setTimeoutFn ?? setTimeout;
    this._handshakeTimer = setTimeoutFn(() => {
      this._handshakeTimer = null;
      if (this._stopped || this._socket !== socket) return;
      // Stalled handshake: the socket never opened and may never
      // fire onclose. Retire it by hand and climb the ladder.
      socket.onclose = null;
      this._socket = null;
      this.socketUp = false;
      try {
        socket.close();
      } catch {
        /* already gone */
      }
      this.onChange();
      this.scheduleReconnect();
    }, HANDSHAKE_TIMEOUT_MS);
    socket.onopen = () => {
      this.clearHandshakeTimer();
      this.socketUp = true;
      this._reconnectStep = 0;
      this.publish();
      this.onChange();
    };
    socket.onmessage = (ev) => {
      let frame: any;
      try {
        frame = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      if (frame?.type === "command" && isControllerCommand(frame.command)) {
        void Promise.resolve(this.execute(frame.command, (frame.args ?? {}) as Record<string, unknown>))
          .catch(() => undefined)
          .finally(() => this.publish());
      }
    };
    socket.onclose = () => {
      this.clearHandshakeTimer();
      if (this._socket === socket) this._socket = null;
      this.socketUp = false;
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

  private scheduleReconnect(): void {
    if (this._stopped) return;
    const delay = RECONNECT_MS[Math.min(this._reconnectStep, RECONNECT_MS.length - 1)];
    this._reconnectStep++;
    const setTimeoutFn = this.deps.setTimeoutFn ?? setTimeout;
    this._reconnectTimer = setTimeoutFn(() => {
      this._reconnectTimer = null;
      void this.connect();
    }, delay);
    // Surface the step change: at the ladder's top, linkUnavailable
    // flips and the label must stop saying "connecting…".
    this.onChange();
  }

  /** Publish the studio's current confirmed state to my remotes. */
  publish(): void {
    if (!this._socket || this._socket.readyState !== 1) return;
    try {
      this._socket.send(JSON.stringify({ type: "state", state: this.buildState() }));
    } catch {
      /* the close handler reconnects */
    }
  }
}
