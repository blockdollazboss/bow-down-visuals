/* The Vault (#162) — pure view-model for the Settings card: the job
   view shape the API returns and the honest state mapping the card
   renders from (ready only when the job says done, failed only on
   the job's own failure). Kept JSX-free so it is unit-testable. */

export interface VaultJobView {
  jobId: string;
  state: "queued" | "active" | "done" | "failed";
  stage: string;
  progress: number;
  downloadUrl?: string | null;
  result?: {
    fileName: string;
    sizeBytes: number;
    fileCount: number;
    skippedCount: number;
  };
  error?: string;
}

export type VaultPhase = "idle" | "working" | "ready" | "failed";

export function vaultPhaseOf(view: VaultJobView | null): VaultPhase {
  if (!view) return "idle";
  if (view.state === "done") return "ready";
  if (view.state === "failed") return "failed";
  return "working";
}

export function formatVaultBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}
