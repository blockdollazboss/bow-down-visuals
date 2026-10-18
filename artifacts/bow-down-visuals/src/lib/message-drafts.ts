/* ─── Website DM composer drafts (STACK-20 #20) ─────────────────────
   The /messages composer's in-progress words, held on the SERVER —
   one draft per member per conversation — riding the same rail the
   World's Post Office desk got in #15 (GET/PUT/DELETE
   /api/dm/:id/draft; a landed send clears the sender's draft
   server-side). Before this, pages/messages.tsx kept ONE useState
   string for the whole page: switching threads carried the words
   into the wrong conversation, and a reload lost them outright.

   This module is the seam the page drives: pure decisions + a small
   framework-free sync controller (the page owns the React state; the
   controller owns what the server is owed and when). EVERY rail
   failure degrades silently to today's behavior — the composer
   always works; a failed save never blocks typing or sending, and
   the next change, thread switch or page close retries the write. */

export const MESSAGE_DRAFT_SAVE_DELAY_MS = 900;

export function messageDraftPath(conversationId: string): string {
  return `/api/dm/${encodeURIComponent(conversationId)}/draft`;
}

export interface SavedMessageDraft {
  body: string;
  updatedAt: string | null;
}

/** Guard a draft payload into the one saved reply (or null): anything
 *  that isn't exactly the server's shape reads as "no draft" — never
 *  a crash, and never junk text landing in the composer. A saved draft
 *  is never empty (the server clears instead of storing blanks). */
export function normalizeSavedMessageDraft(payload: unknown): SavedMessageDraft | null {
  const d = (payload as { draft?: unknown } | null | undefined)?.draft;
  if (!d || typeof d !== "object") return null;
  const body = (d as { body?: unknown }).body;
  if (typeof body !== "string" || body.length === 0) return null;
  const updatedAt = (d as { updated_at?: unknown }).updated_at;
  return { body, updatedAt: typeof updatedAt === "string" ? updatedAt : null };
}

/** What the page owes the server for the composer's current text:
 *  "skip" — the server already holds exactly this text; "clear" —
 *  the composer went blank over a saved draft, so retire it (a PUT
 *  with an empty body); "save" — new words to persist. */
export type MessageDraftSaveDecision = "skip" | "clear" | "save";
export function messageDraftSaveDecision(text: string, savedText: string): MessageDraftSaveDecision {
  if (text === savedText) return "skip";
  return text.trim().length === 0 ? "clear" : "save";
}

/** The server rail, injected so the controller is testable without a
 *  network: load returns the raw GET payload (normalizeSavedMessageDraft
 *  guards it), save is the PUT with { body } (an empty body clears,
 *  per the contract), clear is the optional DELETE. */
export interface MessageDraftRail {
  load: (conversationId: string) => Promise<unknown>;
  save: (conversationId: string, body: string) => Promise<unknown>;
  clear?: (conversationId: string) => Promise<unknown>;
}

export interface MessageDraftSyncOptions {
  rail: MessageDraftRail;
  /** Called once per thread open, only when a saved draft applies —
   *  i.e. the composer is still untouched since the thread opened. */
  onRestore: (conversationId: string, body: string) => void;
  saveDelayMs?: number;
}

/** The draft lifecycle for ONE composer across thread switches:
 *  open() flushes the outgoing thread's unsaved words to THEIR
 *  conversation, resets, and restores the incoming thread's saved
 *  draft (only into a composer untouched since the open — words
 *  typed in the meantime always win); type() records the latest
 *  words and debounces the save; flush() writes now (thread switch,
 *  page close); sent() retires the thread's draft after a landed
 *  send (the server clears its copy in the send itself — the local
 *  reset plus the optional clear call keep a save already in flight
 *  from resurrecting it). No method ever throws. */
export class MessageDraftSync {
  private rail: MessageDraftRail;
  private onRestore: (conversationId: string, body: string) => void;
  private saveDelayMs: number;
  private threadId: string | null = null;
  private text = "";
  private savedText = "";
  /** The write currently on the wire per thread — a flush landing
   *  while the identical save is still in flight must not send the
   *  same words twice. */
  private inflight = new Map<string, string>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private openGeneration = 0;
  private disposed = false;

  constructor(options: MessageDraftSyncOptions) {
    this.rail = options.rail;
    this.onRestore = options.onRestore;
    this.saveDelayMs = options.saveDelayMs ?? MESSAGE_DRAFT_SAVE_DELAY_MS;
  }

  open(conversationId: string | null): void {
    this.flush();
    this.disposed = false;
    this.threadId = conversationId;
    this.text = "";
    this.savedText = "";
    const generation = ++this.openGeneration;
    if (!conversationId) return;
    void (async () => {
      let payload: unknown;
      try {
        payload = await this.rail.load(conversationId);
      } catch {
        return; /* rail down — the composer simply starts empty */
      }
      if (this.disposed || generation !== this.openGeneration || this.threadId !== conversationId) return;
      const saved = normalizeSavedMessageDraft(payload);
      if (!saved) return;
      if (this.text !== "") {
        /* Typed since this thread opened — the fresh words win and
           will save over the server's copy; just remember what the
           server holds so the save decision stays exact. */
        this.savedText = saved.body;
        return;
      }
      this.text = saved.body;
      this.savedText = saved.body;
      this.onRestore(conversationId, saved.body);
    })();
  }

  type(text: string): void {
    if (!this.threadId) return;
    this.text = text;
    this.reschedule();
  }

  flush(): void {
    this.cancelTimer();
    if (!this.threadId) return;
    if (this.inflight.get(this.threadId) === this.text) return;
    if (messageDraftSaveDecision(this.text, this.savedText) === "skip") return;
    void this.persist(this.threadId, this.text);
  }

  sent(): void {
    this.cancelTimer();
    const id = this.threadId;
    this.text = "";
    this.savedText = "";
    if (id && this.rail.clear) {
      void this.rail.clear(id).catch(() => { /* the send already cleared it server-side */ });
    }
  }

  dispose(): void {
    this.flush();
    this.disposed = true;
  }

  private reschedule(): void {
    this.cancelTimer();
    if (!this.threadId) return;
    if (messageDraftSaveDecision(this.text, this.savedText) === "skip") return;
    const id = this.threadId;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.threadId !== id) return;
      if (this.inflight.get(id) === this.text) return;
      if (messageDraftSaveDecision(this.text, this.savedText) === "skip") return;
      void this.persist(id, this.text);
    }, this.saveDelayMs);
  }

  private async persist(id: string, text: string): Promise<void> {
    this.inflight.set(id, text);
    try {
      await this.rail.save(id, text);
      if (this.threadId === id && this.text === text) {
        this.savedText = text.trim().length === 0 ? "" : text;
      }
    } catch { /* the words stay on screen; the next change, switch or close retries */ }
    if (this.inflight.get(id) === text) this.inflight.delete(id);
  }

  private cancelTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
