/* ─── Tier 1 doors — the chat drawer's side of the door contract ────────
   Cloud Operator Phase 2, Lane C. The server (api-server
   lib/operator-chat.ts buildReplyDoors) attaches up to two doors to a
   chat reply when the member's message matched a knowledge-base
   feature with a real path:

     doors: [{ kind: "open" | "guide", label, path }]

   This lib is the client half:
   - parseChatDoors() defensively reads the doors off a reply payload.
     The path is passed through VERBATIM (deep links — ?tab= / ?panel=
     — are the whole point), but the shape is never trusted: anything
     malformed is dropped, and at most two doors survive.
   - startGuideOnArrival() delivers the guide handoff: once the router
     has actually landed on the door's page, it dispatches the same
     "thy-tour:start" event the in-page coach host's "Walk me through
     it" button dispatches, and the page's own GuideMe tour takes over.
     If the landing never happens, no tour starts on the wrong page. */

export interface ChatDoor {
  kind: "open" | "guide";
  label: string;
  path: string;
}

const MAX_DOORS = 2;

/** Read the doors off a chat reply payload. Returns [] for anything
    that isn't a well-formed door list — an old server, an error body,
    or a reply that simply carried no doors all land here. */
export function parseChatDoors(data: unknown): ChatDoor[] {
  const raw = (data as { doors?: unknown } | null | undefined)?.doors;
  if (!Array.isArray(raw)) return [];
  const out: ChatDoor[] = [];
  for (const d of raw) {
    if (out.length >= MAX_DOORS) break;
    if (!d || typeof d !== "object") continue;
    const { kind, label, path } = d as Record<string, unknown>;
    if (kind !== "open" && kind !== "guide") continue;
    if (typeof label !== "string" || label.trim() === "") continue;
    /* Doors are site-internal navigation only — never an external or
       protocol-relative URL, whatever a payload claims. */
    if (typeof path !== "string" || !path.startsWith("/") || path.startsWith("//")) continue;
    out.push({ kind, label, path });
  }
  return out;
}

/** The base route of a path: query/hash stripped, no trailing slash —
    the same normalization the guide registry matches routes by. */
export function doorBase(path: string): string {
  return path.split("?")[0].split("#")[0].replace(/\/+$/, "") || "/";
}

const GUIDE_POLL_MS = 100;
const GUIDE_MAX_TRIES = 30; // ~3s for the landing to settle

/** Start the landed page's guide tour once the router arrives.
    Polls the address bar (wouter navigation is history-based, so the
    URL is the ground truth) and fires "thy-tour:start" exactly once,
    on the first tick where the current base route IS the door's base
    route. The first check waits one tick on purpose: the router's own
    state (which GuideMe resolves the guide from) settles a beat after
    the URL changes. */
export function startGuideOnArrival(path: string): void {
  const target = doorBase(path);
  let tries = 0;
  const iv = window.setInterval(() => {
    tries += 1;
    if (doorBase(window.location.pathname) === target) {
      window.clearInterval(iv);
      window.dispatchEvent(new CustomEvent("thy-tour:start"));
    } else if (tries >= GUIDE_MAX_TRIES) {
      window.clearInterval(iv);
    }
  }, GUIDE_POLL_MS);
}
