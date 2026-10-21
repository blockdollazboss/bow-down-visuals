/* ─── Stream alert queue ──────────────────────────────────────────────────
   The studio Program overlay's brain: follow / tip alerts arrive
   over the chat room socket (bridged to a window event by the chat
   panel) and must show ONE at a time — a burst of tips should read
   as a celebration, not a pile-up. Each alert shows for a few
   seconds, then the next takes its place. Pure + timer-injected so
   the whole queue is unit-tested without a DOM. */

export interface StreamAlert {
  kind: "tip" | "follow";
  title: string;
  body: string;
  amountVb?: number;
  /** True only for the broadcaster's own test alert — rendered with
   *  a Preview tag and never broadcast anywhere. */
  preview?: boolean;
}

export const ALERT_SHOW_MS = 4500;
export const ALERT_GAP_MS = 600;
/** Bursts beyond this drop the OLDEST queued alert — the newest
 *  celebrations are the ones worth showing. */
export const ALERT_QUEUE_MAX = 8;

export interface AlertQueueDeps {
  setTimeoutFn?: (fn: () => void, ms: number) => unknown;
  clearTimeoutFn?: (id: unknown) => void;
}

export class AlertQueue {
  current: StreamAlert | null = null;
  private queue: StreamAlert[] = [];
  private timer: unknown = null;
  private showing = false;

  constructor(
    private deps: AlertQueueDeps = {},
    private onChange: () => void = () => undefined,
  ) {}

  get queuedCount(): number {
    return this.queue.length;
  }

  push(alert: StreamAlert): void {
    if (this.queue.length >= ALERT_QUEUE_MAX) this.queue.shift();
    this.queue.push(alert);
    this.pump();
  }

  private pump(): void {
    if (this.showing) return;
    const next = this.queue.shift();
    if (!next) {
      if (this.current !== null) {
        this.current = null;
        this.onChange();
      }
      return;
    }
    this.showing = true;
    this.current = next;
    this.onChange();
    const setTimeoutFn = this.deps.setTimeoutFn ?? ((fn, ms) => setTimeout(fn, ms));
    this.timer = setTimeoutFn(() => {
      this.timer = null;
      this.current = null;
      this.onChange();
      this.timer = setTimeoutFn(() => {
        this.timer = null;
        this.showing = false;
        this.pump();
      }, ALERT_GAP_MS);
    }, ALERT_SHOW_MS);
  }

  /** Drop everything (stream ended / overlay unmounted). */
  clear(): void {
    this.queue = [];
    this.current = null;
    this.showing = false;
    if (this.timer) {
      (this.deps.clearTimeoutFn ?? ((id) => clearTimeout(id as never)))(this.timer);
      this.timer = null;
    }
    this.onChange();
  }
}

/** The broadcaster's test alert: real queue mechanics, clearly a
 *  preview — it is built locally and never leaves this browser. */
export function previewAlert(): StreamAlert {
  return {
    kind: "tip",
    title: "Preview alert",
    body: "This is how a tip or a new follower will pop up on your Program feed.",
    preview: true,
  };
}

/** Validate an unknown window-event detail into a StreamAlert for a
 *  given stream — events for other streams are ignored. */
export function alertFromEventDetail(detail: unknown, streamId: string): StreamAlert | null {
  if (!detail || typeof detail !== "object") return null;
  const d = detail as Record<string, unknown>;
  if (d.streamId !== streamId) return null;
  if (typeof d.title !== "string" || !d.title) return null;
  return {
    kind: d.kind === "follow" ? "follow" : "tip",
    title: d.title,
    body: typeof d.body === "string" ? d.body : "",
    amountVb: typeof d.amountVb === "number" ? d.amountVb : undefined,
  };
}
