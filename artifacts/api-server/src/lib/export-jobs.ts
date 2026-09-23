import { randomUUID } from "crypto";

/**
 * Async export job registry.
 *
 * A full video export (download clips → normalize → FFmpeg stitch with
 * captions/effects → upload → sign URL) takes several minutes — far longer
 * than a hosting proxy will keep a single HTTP request open. The old
 * synchronous POST /export-final-video design died with a 502 on real
 * exports. Now the route returns HTTP 202 with a jobId immediately and the
 * render runs here in the background; the client polls
 * GET /api/export-video-job/:jobId for progress.
 *
 * Jobs live in memory (single-node, WEB_CONCURRENCY=1). If the server
 * restarts mid-render the job disappears and polling returns 404, which the
 * client surfaces as "interrupted — please retry". Renders run strictly one
 * at a time (FIFO) so a 512MB free instance never has two FFmpeg processes
 * fighting for memory.
 */

export type ExportJobState = "queued" | "active" | "done" | "failed";

export interface ExportJobError {
  message: string;
  code?: string;
  exportStatus?: unknown;
  stderrTail?: string[];
  ffmpegExitCode?: number | null;
}

/** Live render status, mutated by the running export (mirrors ExportStatusInfo). */
export interface ExportStatusRef {
  current: { ffmpegStage?: string } | null;
}

export interface ExportJob {
  id: string;
  userId: string;
  projectId: string;
  state: ExportJobState;
  /** Last observed render stage (e.g. "combining", "normalizing clip 2/7"). */
  stage: string;
  statusRef: ExportStatusRef;
  result?: Record<string, unknown>;
  error?: ExportJobError;
  createdAt: number;
  updatedAt: number;
}

const jobs = new Map<string, ExportJob>();
const waitQueue: Array<() => Promise<void>> = [];
let activeCount = 0;

const MAX_CONCURRENT_EXPORTS = 1;
const JOB_TTL_MS = 2 * 60 * 60 * 1000;
const MAX_JOBS = 200;

export function createExportJob(userId: string, projectId: string): ExportJob {
  pruneJobs();
  const job: ExportJob = {
    id: randomUUID(),
    userId,
    projectId,
    state: "queued",
    stage: "queued",
    statusRef: { current: null },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  jobs.set(job.id, job);
  return job;
}

export function getExportJob(id: string): ExportJob | undefined {
  return jobs.get(id);
}

/** Enqueue a render. Runs FIFO, at most MAX_CONCURRENT_EXPORTS at once. */
export function enqueueExport(run: () => Promise<void>): void {
  waitQueue.push(run);
  pumpQueue();
}

function pumpQueue(): void {
  while (activeCount < MAX_CONCURRENT_EXPORTS && waitQueue.length > 0) {
    const run = waitQueue.shift()!;
    activeCount++;
    run()
      .catch(() => {
        /* run() is expected to handle its own errors; this is a last-resort guard. */
      })
      .finally(() => {
        activeCount--;
        pumpQueue();
      });
  }
}

function pruneJobs(): void {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (now - job.createdAt > JOB_TTL_MS) jobs.delete(id);
  }
  if (jobs.size > MAX_JOBS) {
    const sorted = [...jobs.values()].sort((a, b) => a.createdAt - b.createdAt);
    for (const j of sorted.slice(0, jobs.size - MAX_JOBS)) jobs.delete(j.id);
  }
}

/** Map the render's internal stage to a user-facing label + progress estimate. */
export function describeJobProgress(job: ExportJob): { stage: string; progress: number } {
  const liveStage = job.statusRef.current?.ffmpegStage;
  const stage = liveStage && liveStage.length > 0 ? liveStage : job.stage;
  let progress: number;
  if (job.state === "done") {
    progress = 100;
  } else if (job.state === "failed") {
    progress = 0;
  } else if (stage === "completed") {
    progress = 100;
  } else if (stage === "combining") {
    progress = 62;
  } else if (stage.startsWith("normalizing clip")) {
    const m = /normalizing clip (\d+)\/(\d+)/.exec(stage);
    progress = m
      ? 15 + 40 * (Math.min(parseInt(m[1]!, 10), parseInt(m[2]!, 10)) / Math.max(parseInt(m[2]!, 10), 1))
      : 25;
  } else if (stage === "downloading clips") {
    progress = 8;
  } else {
    progress = 3;
  }
  // While the bar sits at "combining", the render is actually in upload/sign/save —
  // creep forward slowly so the UI doesn't look stuck on a multi-minute render.
  if ((job.state === "active" || job.state === "queued") && progress >= 62 && progress < 96) {
    const idleMin = (Date.now() - job.updatedAt) / 60000;
    progress = Math.min(96, progress + idleMin * 5);
  }
  return { stage: humanizeStage(stage), progress: Math.round(progress) };
}

function humanizeStage(stage: string): string {
  switch (stage) {
    case "queued":
      return "Queued — waiting for the renderer…";
    case "starting":
      return "Starting render…";
    case "downloading clips":
      return "Downloading clips…";
    case "combining":
      return "Stitching video with FFmpeg…";
    case "completed":
      return "Completed";
    case "failed":
      return "Failed";
    default:
      if (stage.startsWith("normalizing clip")) return `Preparing ${stage.replace("normalizing ", "")}…`;
      return stage;
  }
}
