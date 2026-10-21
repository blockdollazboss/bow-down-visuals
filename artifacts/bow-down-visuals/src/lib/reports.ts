/**
 * lib/reports.ts — member content reports (Stack-4 #3).
 *
 * The client half of POST /api/reports. Until this seam existed a
 * member had NO way to report a post, a comment, or a profile — no
 * endpoint, no UI (the DMCA form on the copyright page is a public
 * legal intake, not a member report button). Filing a report only
 * queues the target for a human admin; nothing is auto-hidden or
 * auto-banned, and the dialog says so.
 *
 * REPORT_REASONS mirrors the server's fixed vocabulary
 * (CONTENT_REPORT_REASONS in lib/db/src/schema/content-reports.ts,
 * enforced by the route's zod enum). The server list is the
 * contract — if it changes, this list changes in the same commit;
 * reports.test.ts pins the exact contents so the two can't drift
 * silently.
 */
import { apiFetch } from "./social-api";

export const REPORT_REASONS = [
  "spam",
  "harassment",
  "hate_speech",
  "violence",
  "sexual_content",
  "copyright",
  "scam",
  "other",
] as const;

export type ReportReason = (typeof REPORT_REASONS)[number];

export const REPORT_REASON_LABELS: Record<ReportReason, string> = {
  spam: "Spam",
  harassment: "Harassment or bullying",
  hate_speech: "Hate speech",
  violence: "Violence or threats",
  sexual_content: "Sexual content",
  copyright: "Copyright issue",
  scam: "Scam or fraud",
  other: "Something else",
};

export type ReportTargetType = "post" | "comment" | "profile";

export interface FiledReport {
  id: string;
  reporterUserId: string;
  targetType: string;
  targetId: string;
  targetOwnerUserId: string | null;
  targetSummary: string;
  reason: string;
  note: string | null;
  status: string;
  createdAt: string;
}

export interface SubmitReportInput {
  targetType: ReportTargetType;
  targetId: string;
  reason: ReportReason;
  note?: string;
}

export interface SubmitReportResult {
  report: FiledReport;
  /** True when the member already had an OPEN report on this target:
   *  the server returned that row instead of queueing a second one. */
  duplicate: boolean;
}

/**
 * File one report. Throws with the SERVER's own error message on any
 * failure (validation, self-report refusal, network) — callers show
 * it verbatim and never claim success on a throw.
 */
export async function submitReport(
  getAccessToken: () => Promise<string | null>,
  input: SubmitReportInput,
): Promise<SubmitReportResult> {
  const note = input.note?.trim();
  const res = await apiFetch(getAccessToken, "/api/reports", {
    method: "POST",
    body: JSON.stringify({
      target_type: input.targetType,
      target_id: input.targetId,
      reason: input.reason,
      ...(note ? { note } : {}),
    }),
  });
  const data = (await res.json().catch(() => ({}))) as {
    report?: FiledReport;
    duplicate?: boolean;
    error?: string;
  };
  if (!res.ok || !data.report) {
    throw new Error(data.error || "Could not file your report. Please try again.");
  }
  return { report: data.report, duplicate: data.duplicate === true };
}

/** The dialog's submit gate: a reason must be picked and the dialog
 *  must be in a submittable phase (form showing, not already sending,
 *  not already filed). Pure so the gate is unit-testable. */
export type ReportDialogPhase = "form" | "submitting" | "success" | "error";

export function canSubmitReport(reason: ReportReason | null, phase: ReportDialogPhase): boolean {
  return reason !== null && (phase === "form" || phase === "error");
}
