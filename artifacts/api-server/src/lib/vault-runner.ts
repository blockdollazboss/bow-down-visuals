import { logger } from "./logger";
import { buildAccountExportPayload } from "./account-export";
import { buildVaultArchive, collectMediaInventory } from "./vault-archive";
import { isR2Configured, r2Upload } from "./r2-client";
import { listSplitEntriesForOwner, listSplitEntriesForSeller } from "./sale-splits";
import {
  claimVaultJobForRun,
  completeVaultJob,
  enqueueVault,
  failVaultJob,
  recoverInterruptedVaultJobs,
  updateVaultJobStage,
  type VaultJob,
} from "./vault-jobs";

/**
 * vault-runner.ts — executes one Vault packaging job (Stack-200 #162).
 *
 * Flow: claim → collect (account data payload + sales/split records +
 * media inventory from the same owned tables the data export reads) →
 * package the archive (originals fetched byte-for-byte, stored
 * uncompressed) → upload to R2 → complete with the manifest facts.
 * The status route mints a fresh signed download URL per poll, so no
 * long-lived URL is ever stored.
 */

function siteOrigin(): string {
  return (
    process.env["SITE_ORIGIN"] ??
    process.env["PUBLIC_SITE_URL"] ??
    "https://bowdownvisuals.com"
  ).replace(/\/+$/, "");
}

async function fetchMediaBytes(url: string): Promise<Buffer> {
  const absolute = url.startsWith("/") ? `${siteOrigin()}${url}` : url;
  const res = await fetch(absolute);
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching original`);
  return Buffer.from(await res.arrayBuffer());
}

/** Sales + split records for the archive's data payload. Best-effort:
 *  a storage hiccup here must never sink the media archive — the
 *  section degrades to empty lists and says so in the payload. */
async function collectSalesAndSplits(userId: string): Promise<Record<string, unknown>> {
  try {
    const [asSeller, asOwner] = await Promise.all([
      listSplitEntriesForSeller(userId, 200),
      listSplitEntriesForOwner(userId, 200),
    ]);
    return { available: true, asSeller, asOwner };
  } catch (err) {
    logger.warn({ err, userId }, "[vault] sales/splits collection failed; degrading");
    return { available: false, asSeller: [], asOwner: [] };
  }
}

export async function runVaultJob(job: VaultJob): Promise<void> {
  const claimed = await claimVaultJobForRun(job.id);
  if (!claimed) return; // another worker (or a terminal state) owns it
  const userId = claimed.userId;
  try {
    if (!isR2Configured()) {
      await failVaultJob(job.id, {
        message:
          "Archive storage isn't configured on this server yet, so your Vault can't be packaged right now. Your work is safe on the site.",
        code: "storage_unavailable",
      });
      return;
    }

    // Collect: the same payload the JSON export serves, plus the
    // sales/splits records the audit delta names.
    const payload = await buildAccountExportPayload(userId);
    payload["salesAndSplits"] = await collectSalesAndSplits(userId);

    const inventory = collectMediaInventory({
      songs: payload.songs,
      generated_clips: payload.clips,
      projects: payload.projects,
      project_drafts: payload.drafts,
    });

    const r2Key = `vault/${userId}/${job.id}.zip`;
    const result = await buildVaultArchive(
      {
        fetchMedia: fetchMediaBytes,
        storeArchive: async (body) => {
          await r2Upload(r2Key, body, "application/zip");
        },
        onMediaProgress: async (done, total) => {
          const progress = Math.round(10 + 80 * (done / Math.max(total, 1)));
          await updateVaultJobStage(job.id, `packaging media ${done}/${total}`, progress).catch(
            () => undefined,
          );
        },
      },
      { exportedAt: payload.exportedAt, dataPayload: payload, inventory },
    );

    await completeVaultJob(job.id, {
      r2Key,
      fileName: "bow-down-visuals-vault.zip",
      sizeBytes: result.sizeBytes,
      fileCount: result.fileCount,
      skippedCount: result.skipped.length,
    });
    logger.info(
      { jobId: job.id, userId, fileCount: result.fileCount, skipped: result.skipped.length },
      "[vault] archive packaged",
    );
  } catch (err) {
    logger.error({ err, jobId: job.id, userId }, "[vault] packaging failed");
    await failVaultJob(job.id, {
      message:
        err instanceof Error && err.message.startsWith("None of your media")
          ? err.message
          : "Your Vault couldn't be packaged. Please try again — nothing was charged or changed.",
      code: "packaging_failed",
    }).catch(() => undefined);
  }
}

/** Enqueue a packaging run for a created (or recovered) job row. */
export function startVaultJob(job: VaultJob): void {
  enqueueVault(async () => {
    await runVaultJob(job);
  });
}

/**
 * Called once from index.ts after the server starts listening:
 * re-drive Vault jobs a previous process left queued/active.
 */
export async function recoverInterruptedVaultJobsBoot(): Promise<void> {
  await recoverInterruptedVaultJobs(async (job) => {
    startVaultJob(job);
  });
}
