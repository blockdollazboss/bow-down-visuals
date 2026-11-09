/* ─── Avatar Presenter bench in-world (Stack 400 world parity,
   census B item B-06) ────────────────────────────────────────
   The make-video flow's Avatar Presenter option (Step 3 —
   Video Direction), native in the Video Desk family: pick a
   catalog avatar, write the script it speaks, and generate
   the talking-head presenter shot on the panel's own rail:

     GET  /api/avatar-presenter/status
       → { configured, provider, catalog[{ id, name, style }],
           creditCost, pricePlaceholder }
     POST /api/avatar-presenter
       { avatarId, script, aspectRatio }
       → 202 { jobId, status, creditsCharged }
     GET  /api/avatar-presenter/:jobId
       → { job: { status, outputUrl, error } }

   Price: the registry's own row — /api/avatar-presenter at
   1,200 Bucs (owner ruling Oct 24, 2026: Hedra Character-3
   engine) — read through getCreditCost, never a local
   constant, and passed to the confirmation as the override
   exactly as the proven in-World benches do.

   DARK STATE (the lane's hard condition): the engine is
   ruled SHIPS DARK — wallet $0, funding declined, do not
   re-ask. The server's status gate is the only truth: while
   it reports configured:false the bench renders the 2D
   panel's own honest unavailable state (its words, its
   amber notice), the pickers stay usable as a plan note
   exactly as they are in 2D, and NO generate control exists
   — nothing can charge, nothing pretends to work. The 503
   gate also stands server-side before any charge, so even a
   raced submit can never take Bucs for an unconnected
   provider. When the owner funds the engine and the status
   flips, the same bench lights up with no code change.

   Money discipline once lit: the route RESERVES the full
   1,200 at submit (charge-before-provider, keyed on the job
   id) and refunds in full on any failure — the bench only
   shows the outcome the poll reports.

   Copy rides the worldAvatarPresenterBench.* catalog
   namespace — new to the catalogs with this bench. Its en
   values mirror the 2D panel's own strings wherever the
   panel has wording, so bench and panel can never drift;
   the other nine catalogs carry them English-verbatim
   UNREVIEWED, the house convention. */
import { getCreditCost } from "@/lib/credit-costs";

export const AVATAR_PRESENTER_PATH = "/api/avatar-presenter";
export const AVATAR_PRESENTER_STATUS_PATH = "/api/avatar-presenter/status";

/** The registry's price + feature name for the presenter rail
 *  (1,200 Bucs) — the confirmation's override, read from the
 *  one price book, never retyped here. */
export const AVATAR_PRESENTER_COST =
  getCreditCost(AVATAR_PRESENTER_PATH)?.cost ?? 0;
export const AVATAR_PRESENTER_FEATURE =
  getCreditCost(AVATAR_PRESENTER_PATH)?.feature ?? "Avatar Presenter";

/** The route's own caps: the script is 4,000 chars (the
 *  presenter schema's max), and the frame is one of three
 *  aspect ratios. */
export const AVATAR_PRESENTER_SCRIPT_MAX = 4000;
export const AVATAR_PRESENTER_ASPECTS = ["16:9", "9:16", "1:1"] as const;
export type AvatarPresenterAspect = (typeof AVATAR_PRESENTER_ASPECTS)[number];

/** The bench polls a running job the Video Studio desk's way:
 *  a few seconds between reads, a hard deadline after which
 *  the bench says plainly that it stopped waiting (the job
 *  itself keeps its server-side fate). */
export const AVATAR_PRESENTER_POLL_MS = 4000;
export const AVATAR_PRESENTER_POLL_DEADLINE_MS = 10 * 60 * 1000;

export interface AvatarPresenterCatalogEntry {
  id: string;
  name: string;
  style: string;
}

export interface AvatarPresenterStatus {
  /** A provider key is configured server-side. FALSE is the
   *  ruled dark state — the bench must not offer a charge. */
  configured: boolean;
  provider: string | null;
  catalog: AvatarPresenterCatalogEntry[];
  /** The server's own price word (the registry's 1,200). */
  creditCost: number;
}

/** Parse the status payload defensively — a malformed body
 *  must never become a false "configured" or a fabricated
 *  price (the chat-speak seam's discipline, same shape). */
export function parseAvatarPresenterStatus(data: unknown): AvatarPresenterStatus {
  const d = data as {
    configured?: unknown;
    provider?: unknown;
    catalog?: unknown;
    creditCost?: unknown;
  } | null;
  const rawCatalog = Array.isArray(d?.catalog) ? d.catalog : [];
  const catalog: AvatarPresenterCatalogEntry[] = [];
  for (const entry of rawCatalog) {
    const e = entry as { id?: unknown; name?: unknown; style?: unknown } | null;
    if (e && typeof e.id === "string" && e.id && typeof e.name === "string" && e.name) {
      catalog.push({
        id: e.id,
        name: e.name,
        style: typeof e.style === "string" ? e.style : "",
      });
    }
  }
  const cost =
    typeof d?.creditCost === "number" && Number.isFinite(d.creditCost) && d.creditCost > 0
      ? d.creditCost
      : 0;
  return {
    configured: d?.configured === true,
    provider: typeof d?.provider === "string" && d.provider ? d.provider : null,
    catalog,
    creditCost: cost,
  };
}

/** The bench's dark-state verdict — THE B-06 pin: generation
 *  may be offered only when the server says a provider is
 *  configured. Anything else (still loading, load failed,
 *  configured:false) keeps the bench dark. */
export function avatarPresenterCanGenerate(status: AvatarPresenterStatus | null): boolean {
  return status?.configured === true;
}

/** Shape the generate body the route's presenter schema
 *  accepts. Returns null when the ask can't run — no avatar
 *  picked, or no script for the presenter to speak (the
 *  route refuses both with a 400; the bench never sends an
 *  ask it knows will fail). */
export function buildAvatarPresenterPayload(input: {
  avatarId: string;
  script: string;
  aspect: AvatarPresenterAspect;
}): { avatarId: string; script: string; aspectRatio: AvatarPresenterAspect } | null {
  const avatarId = input.avatarId.trim();
  const script = input.script.trim();
  if (!avatarId || !script) return null;
  return {
    avatarId,
    script: script.slice(0, AVATAR_PRESENTER_SCRIPT_MAX),
    aspectRatio: input.aspect,
  };
}

/** The 202 answer's job id — the poll's handle. Anything else
 *  in the body is not a job the bench can follow. */
export function presenterSubmitOf(data: unknown): string | null {
  const d = data as { jobId?: unknown } | null;
  return typeof d?.jobId === "string" && d.jobId ? d.jobId : null;
}

export function avatarPresenterJobPath(jobId: string): string {
  return `${AVATAR_PRESENTER_PATH}/${encodeURIComponent(jobId)}`;
}

export type AvatarPresenterJobStatus = "queued" | "processing" | "done" | "failed";

export interface AvatarPresenterJobView {
  status: AvatarPresenterJobStatus;
  outputUrl: string | null;
  error: string | null;
}

/** Read a poll answer. Returns null on a shape the bench
 *  can't trust — the poll keeps waiting rather than
 *  inventing an outcome. */
export function parseAvatarPresenterJob(data: unknown): AvatarPresenterJobView | null {
  const d = data as {
    job?: { status?: unknown; outputUrl?: unknown; error?: unknown };
  } | null;
  const status = d?.job?.status;
  if (status !== "queued" && status !== "processing" && status !== "done" && status !== "failed") {
    return null;
  }
  return {
    status,
    outputUrl: typeof d?.job?.outputUrl === "string" && d.job.outputUrl ? d.job.outputUrl : null,
    error: typeof d?.job?.error === "string" && d.job.error ? d.job.error : null,
  };
}

/** A finished job's honest read: done needs its clip URL —
 *  a "done" with no clip is stated as exactly that, never
 *  dressed up as a success (the Video Studio desk's rule). */
export function presenterJobOutcome(
  view: AvatarPresenterJobView,
): "running" | "done" | "done-no-clip" | "failed" {
  if (view.status === "queued" || view.status === "processing") return "running";
  if (view.status === "failed") return "failed";
  return view.outputUrl ? "done" : "done-no-clip";
}
