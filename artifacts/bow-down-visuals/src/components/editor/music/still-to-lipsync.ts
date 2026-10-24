/**
 * Still → clip → lip-sync orchestration (Stack-100 #3, Wave 3, Lane 7).
 *
 * There is no new rail here and no new price. The flow rides the two
 * existing charged rails end to end, exactly as the pages that already
 * use them do:
 *
 *   Step 1 — animate the still:
 *     POST /api/generate-runway-clip with `referenceImageUrl` set to the
 *     artist photo (the rail's image-to-video mode, model gen4.5), then
 *     GET /api/generate-runway-clip/:taskId until it lands. The rail
 *     charges GEN45_CREDIT_COST (400 Visual Bucs, clip-pricing.ts) ONLY
 *     when the task SUCCEEDS, exactly once (guarded server-side by its
 *     pending-task map); a FAILED/CANCELLED task charges nothing. The
 *     finished clip is stored by the rail in the same clips storage
 *     every generated clip uses, and the poll response's `url` is the
 *     playable HTTPS URL the lip-sync flow consumes.
 *
 *   Step 2 — lip-sync that clip:
 *     POST /api/lip-sync/preview with clipUrl = the produced clip URL,
 *     audioUrl = the user's song, and the scene window 0 → clip
 *     duration (gen4.5 clips are a fixed 5s; the submit response's
 *     `durationSec` is the rail's own report and wins when present).
 *     That route charges its own constant (300 Visual Bucs) once —
 *     idempotency-keyed server-side on the (clip, audio, window)
 *     intent — and enqueues the durable job the client polls at
 *     GET /api/lip-sync/job/:id, exactly like LipSyncSection does for
 *     any other generated clip.
 *
 * If step 1 fails, step 2 is never called: no lip-sync charge can land
 * for a clip that does not exist, and step 1 itself charged nothing.
 */

export type StillToLipSyncPhase =
  | "animating"
  | "clip-ready"
  | "syncing"
  | "done"
  | "failed";

export interface StillToLipSyncResult {
  /** Playable HTTPS URL of the animated clip produced from the still. */
  clipUrl: string;
  /** Stable storage ref for the clip, when the rail returned one. */
  clipStorageRef: string | null;
  /** Clip length in seconds, as reported by the video rail. */
  clipDurationSec: number;
  /** Durable lip-sync job id from POST /api/lip-sync/preview. */
  lipSyncJobId: string;
  /** Final lip-synced video URL (present when the job finished here). */
  lipSyncUrl: string | null;
  /** Provider name reported by the lip-sync job. */
  lipSyncProvider: string | null;
  /** True when the lip-sync job was still running when polling stopped —
   *  the job keeps running server-side; this is NOT a failure. */
  lipSyncStillProcessing: boolean;
}

export class StillToLipSyncError extends Error {
  /** Which step failed: "animate" (no charge) or "lip-sync". */
  step: "animate" | "lip-sync";
  /** The animated clip URL when step 1 succeeded but step 2 failed —
   *  the user owns this clip (it was charged on success) and can retry
   *  the lip-sync step against it. */
  clipUrl: string | null;
  constructor(step: "animate" | "lip-sync", message: string, clipUrl: string | null = null) {
    super(message);
    this.name = "StillToLipSyncError";
    this.step = step;
    this.clipUrl = clipUrl;
  }
}

type FetchLike = (
  input: string,
  init?: RequestInit,
) => Promise<Response | null>;

export interface RunStillToLipSyncInput {
  /** Artist still image — must be an https URL the video rail can fetch. */
  imageUrl: string;
  /** The user's song audio — https URL, as the lip-sync rail requires. */
  audioUrl: string;
  projectId?: string | null;
  /** Creative Vault id for the performing artist (uuid only; the
   *  lip-sync rail validates it as one). */
  artistVaultId?: string | null;
  /** Optional motion/performance prompt for the animation step. */
  promptText?: string;
  getAccessToken: () => Promise<string | null>;
  /** Fetch used for the two CHARGED POSTs — pass confirmedFetch so each
   *  rail's charge goes through the credit-confirmation popup, exactly
   *  like Video Studio / LipSyncSection. Returning null means the user
   *  cancelled the confirmation: the flow stops before that step. */
  fetchImpl?: FetchLike;
  /** Poll fetches (uncharged GETs). MUST stay plain fetch — routing a
   *  poll through confirmedFetch would prefix-match the charged
   *  endpoint in the credit registry and pop a spend confirmation on
   *  every poll. Defaults to plain fetch. */
  pollFetch?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  clipPollIntervalMs?: number;
  clipMaxPolls?: number;
  lipSyncPollIntervalMs?: number;
  lipSyncMaxPolls?: number;
  onPhase?: (phase: StillToLipSyncPhase) => void;
}

const DEFAULT_PROMPT =
  "The artist performs the song straight to camera, mouth moving " +
  "naturally as if singing the lyrics, subtle head nods and body " +
  "movement, medium close-up with the face clearly visible.";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const realSleep = (ms: number) =>
  new Promise<void>((r) => setTimeout(r, ms));

export async function runStillToLipSync(
  input: RunStillToLipSyncInput,
): Promise<StillToLipSyncResult> {
  const {
    imageUrl,
    audioUrl,
    projectId,
    artistVaultId,
    getAccessToken,
    onPhase,
  } = input;
  const doFetch: FetchLike = input.fetchImpl ?? ((u, i) => fetch(u, i));
  const doPoll: FetchLike = input.pollFetch ?? ((u, i) => fetch(u, i));
  const sleep = input.sleep ?? realSleep;
  const clipPollIntervalMs = input.clipPollIntervalMs ?? 5_000;
  const clipMaxPolls = input.clipMaxPolls ?? 60; // ~5 min, mirrors Video Studio
  const lipSyncPollIntervalMs = input.lipSyncPollIntervalMs ?? 3_000;
  const lipSyncMaxPolls = input.lipSyncMaxPolls ?? 160; // ~8 min, mirrors LipSyncSection

  if (!imageUrl.startsWith("https://")) {
    throw new StillToLipSyncError(
      "animate",
      "The artist image must be a hosted https URL before it can be animated.",
    );
  }
  if (!audioUrl.startsWith("https://")) {
    throw new StillToLipSyncError(
      "lip-sync",
      "The song audio must be a hosted https URL before it can be lip-synced.",
    );
  }

  const token = await getAccessToken();
  const authHeaders = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token ?? ""}`,
  };

  /* ── Step 1: still → clip on the existing video rail ─────────────────
     Image-to-video: referenceImageUrl is the rail's documented first
     frame input. No charge moves at submit; the rail charges its flat
     gen4.5 cost only when the poll reports SUCCEEDED. */
  onPhase?.("animating");
  const submitRes = await doFetch("/api/generate-runway-clip", {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({
      promptText: input.promptText?.trim() || DEFAULT_PROMPT,
      ratio: "720:1280",
      referenceImageUrl: imageUrl,
      model: "gen4.5",
      ...(projectId ? { projectId } : {}),
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!submitRes) {
    /* User cancelled the credit confirmation — nothing was submitted,
       nothing was charged. */
    throw new StillToLipSyncError(
      "animate",
      "Cancelled before the animation started — no Visual Bucs were charged.",
    );
  }
  const submitData = (await submitRes.json().catch(() => ({}))) as {
    taskId?: string;
    durationSec?: number;
    error?: string;
    message?: string;
  };
  if (!submitRes.ok || !submitData.taskId) {
    throw new StillToLipSyncError(
      "animate",
      submitData.message ??
        submitData.error ??
        `Animation failed to start (HTTP ${submitRes.status}) — no Visual Bucs were charged.`,
    );
  }
  const taskId = submitData.taskId;
  /* gen4.5 is a fixed 5s; trust the rail's own duration report. */
  const clipDurationSec =
    typeof submitData.durationSec === "number" && submitData.durationSec > 0
      ? submitData.durationSec
      : 5;

  let clipUrl: string | null = null;
  let clipStorageRef: string | null = null;
  for (let i = 0; i < clipMaxPolls; i++) {
    await sleep(clipPollIntervalMs);
    const pollRes = await doPoll(`/api/generate-runway-clip/${taskId}`, {
      headers: { Authorization: `Bearer ${token ?? ""}` },
      signal: AbortSignal.timeout(30_000),
    });
    if (!pollRes) {
      throw new StillToLipSyncError(
        "animate",
        "Animation status check was cancelled.",
      );
    }
    if (!pollRes.ok) {
      throw new StillToLipSyncError(
        "animate",
        `Animation status check failed (HTTP ${pollRes.status}).`,
      );
    }
    const pollData = (await pollRes.json().catch(() => ({}))) as {
      status?: string;
      url?: string | null;
      storageRef?: string | null;
      error?: string;
    };
    if (pollData.status === "succeeded" && pollData.url) {
      clipUrl = pollData.url;
      clipStorageRef = pollData.storageRef ?? null;
      break;
    }
    if (pollData.status === "succeeded") {
      /* The rail charges on success — a success with no clip URL is a
         rail malfunction; surface it honestly rather than marching a
         missing clip into lip-sync. */
      throw new StillToLipSyncError(
        "animate",
        "The animation finished without a clip URL — please try again.",
      );
    }
    if (pollData.status === "failed" || pollData.status === "cancelled") {
      throw new StillToLipSyncError(
        "animate",
        `${pollData.error ?? "The animation failed."} No Visual Bucs were charged.`,
      );
    }
    /* "processing" — keep polling */
  }
  if (!clipUrl) {
    throw new StillToLipSyncError(
      "animate",
      "The animation timed out — the clip may still finish in the background, and it is only charged if it succeeds.",
    );
  }
  onPhase?.("clip-ready");

  /* ── Step 2: hand the produced clip to lip-sync, like any clip ───────
     Same endpoint, same body shape, same audio the user picked — the
     only difference from a scene clip is where clipUrl came from. The
     scene window is the clip's full length (0 → duration). */
  onPhase?.("syncing");
  const lipRes = await doFetch("/api/lip-sync/preview", {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({
      clipUrl,
      audioUrl,
      sceneStartSec: 0,
      sceneEndSec: clipDurationSec,
      ...(projectId ? { projectId } : {}),
      ...(artistVaultId && UUID_RE.test(artistVaultId)
        ? { artistVaultId }
        : {}),
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!lipRes) {
    throw new StillToLipSyncError(
      "lip-sync",
      "Cancelled before lip sync started — the animated clip above is yours, and no lip-sync charge was made.",
      clipUrl,
    );
  }
  const lipData = (await lipRes.json().catch(() => ({}))) as {
    jobId?: string;
    error?: string;
    message?: string;
  };
  if (!lipRes.ok || !lipData.jobId) {
    throw new StillToLipSyncError(
      "lip-sync",
      lipData.message ??
        lipData.error ??
        `Lip sync failed to start (HTTP ${lipRes.status}). The animated clip above is yours to keep.`,
      clipUrl,
    );
  }
  const lipSyncJobId = lipData.jobId;

  /* ── Poll the durable lip-sync job (same loop shape as LipSyncSection) */
  let lipSyncUrl: string | null = null;
  let lipSyncProvider: string | null = null;
  let stillProcessing = false;
  for (let i = 0; i < lipSyncMaxPolls; i++) {
    await sleep(lipSyncPollIntervalMs);
    const pollRes = await doPoll(`/api/lip-sync/job/${lipSyncJobId}`, {
      headers: { Authorization: `Bearer ${token ?? ""}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!pollRes) break;
    if (!pollRes.ok) {
      throw new StillToLipSyncError(
        "lip-sync",
        `Lip-sync status check failed (HTTP ${pollRes.status}). The animated clip above is yours to keep.`,
        clipUrl,
      );
    }
    const job = (await pollRes.json().catch(() => ({}))) as {
      status?: string;
      url?: string;
      provider?: string;
      error?: string;
      code?: string;
    };
    if (job.status === "done") {
      if (!job.url) {
        throw new StillToLipSyncError(
          "lip-sync",
          "Lip sync finished but returned no video URL. The animated clip above is yours to keep.",
          clipUrl,
        );
      }
      lipSyncUrl = job.url;
      lipSyncProvider = job.provider ?? null;
      break;
    }
    if (job.status === "failed") {
      throw new StillToLipSyncError(
        "lip-sync",
        job.error ??
          "Lip sync failed. The animated clip above is yours to keep.",
        clipUrl,
      );
    }
    if (job.status === "processing" && job.code === "still_processing") {
      stillProcessing = true;
      break;
    }
    /* "queued" | "processing" — keep polling */
  }
  if (!lipSyncUrl && !stillProcessing) stillProcessing = true;

  onPhase?.("done");
  return {
    clipUrl,
    clipStorageRef,
    clipDurationSec,
    lipSyncJobId,
    lipSyncUrl,
    lipSyncProvider,
    lipSyncStillProcessing: stillProcessing && !lipSyncUrl,
  };
}
