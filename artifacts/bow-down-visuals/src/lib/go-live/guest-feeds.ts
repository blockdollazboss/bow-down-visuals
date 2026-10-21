/**
 * guest-feeds.ts — the shared registry of backstage guest feeds for
 * the Go Live studio (guest invites + backstage, 0201).
 *
 * The GuestPanel owns the backstage mesh (it holds the sockets); the
 * Stage pool and the Sources panel need the SAME live video elements
 * and roster without prop-drilling through BroadcastStudio. This
 * module is that meeting point: the panel writes roster + streams,
 * everyone else reads. Keyed by guest SESSION id (the durable
 * identity) — socket peer ids stay inside the panel/mesh.
 *
 * A feed's video element is created here, once per stream, so the
 * backstage tile and the program canvas draw the very same element.
 */
export interface GuestFeed {
  sessionId: string;
  name: string;
  state: "backstage" | "on_stage";
  stream: MediaStream | null;
  video: HTMLVideoElement | null;
}

type Listener = () => void;

export class GuestFeeds {
  private feeds = new Map<string, GuestFeed>();
  private listeners = new Set<Listener>();
  private version = 0;

  constructor(private makeVideo: () => HTMLVideoElement | null = defaultMakeVideo) {}

  /** Replace the roster from the server's guest list (states are DB
   *  facts; streams already attached survive the refresh). */
  setRoster(guests: Array<{ id: string; display_name: string; state: string }>): void {
    let changed = false;
    const seen = new Set<string>();
    for (const g of guests) {
      if (g.state !== "backstage" && g.state !== "on_stage") continue;
      seen.add(g.id);
      const existing = this.feeds.get(g.id);
      if (!existing) {
        this.feeds.set(g.id, {
          sessionId: g.id,
          name: g.display_name,
          state: g.state,
          stream: null,
          video: null,
        });
        changed = true;
      } else if (existing.name !== g.display_name || existing.state !== g.state) {
        existing.name = g.display_name;
        existing.state = g.state;
        changed = true;
      }
    }
    for (const id of [...this.feeds.keys()]) {
      if (!seen.has(id)) {
        this.drop(id);
        changed = true;
      }
    }
    if (changed) this.emit();
  }

  /** A guest's media stream arrived (or went away). */
  setStream(sessionId: string, stream: MediaStream | null): void {
    let feed = this.feeds.get(sessionId);
    if (!feed) {
      if (!stream) return;
      feed = { sessionId, name: "", state: "backstage", stream: null, video: null };
      this.feeds.set(sessionId, feed);
    }
    if (feed.stream === stream) return;
    feed.stream = stream;
    if (stream) {
      if (!feed.video) feed.video = this.makeVideo();
      if (feed.video) {
        feed.video.srcObject = stream;
        feed.video.muted = true;
        feed.video.playsInline = true;
        void feed.video.play().catch(() => undefined);
      }
    } else if (feed.video) {
      feed.video.srcObject = null;
    }
    this.emit();
  }

  setState(sessionId: string, state: "backstage" | "on_stage"): void {
    const feed = this.feeds.get(sessionId);
    if (!feed || feed.state === state) return;
    feed.state = state;
    this.emit();
  }

  drop(sessionId: string): void {
    const feed = this.feeds.get(sessionId);
    if (!feed) return;
    if (feed.video) feed.video.srcObject = null;
    this.feeds.delete(sessionId);
    this.emit();
  }

  clear(): void {
    if (this.feeds.size === 0) return;
    for (const id of [...this.feeds.keys()]) {
      const feed = this.feeds.get(id);
      if (feed?.video) feed.video.srcObject = null;
    }
    this.feeds.clear();
    this.emit();
  }

  get(sessionId: string): GuestFeed | null {
    return this.feeds.get(sessionId) ?? null;
  }

  all(): GuestFeed[] {
    return [...this.feeds.values()];
  }

  onStage(): GuestFeed[] {
    return this.all().filter((f) => f.state === "on_stage");
  }

  /** The Stage pool's resolver: the live element for a guest tile. */
  videoFor(sessionId: string): HTMLVideoElement | null {
    return this.feeds.get(sessionId)?.video ?? null;
  }

  streamFor(sessionId: string): MediaStream | null {
    return this.feeds.get(sessionId)?.stream ?? null;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getVersion(): number {
    return this.version;
  }

  private emit(): void {
    this.version++;
    for (const l of [...this.listeners]) l();
  }
}

function defaultMakeVideo(): HTMLVideoElement | null {
  if (typeof document === "undefined") return null;
  return document.createElement("video");
}

/** The studio-wide registry (one Go Live page, one backstage). */
export const guestFeeds = new GuestFeeds();
