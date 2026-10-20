import { useState, type CSSProperties } from "react";
import { Flag, X, Check, Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import {
  REPORT_REASONS,
  REPORT_REASON_LABELS,
  canSubmitReport,
  submitReport,
  type ReportDialogPhase,
  type ReportReason,
  type ReportTargetType,
} from "@/lib/reports";

/* ─── ReportButton — the member report action (Stack-4 #3) ───────────
   One shared button + dialog, docked where posts, comments, and
   profiles already carry their actions (PostCard's action row, the
   media comment rows, the Shout Wall, the profile action row) —
   never a standalone page. Signed-in members only: with no user it
   renders nothing (the rail is auth-only server-side too).

   Honesty rules baked into the phases: the form can only claim
   success after the server answers ok; a failure lands in the
   "error" phase with the server's own message and the form intact
   (reason + note preserved) — it NEVER falls through to the success
   copy. A duplicate open report gets its own truthful line instead
   of a fake "filed". */

const TARGET_NOUN: Record<ReportTargetType, string> = {
  post: "post",
  comment: "comment",
  profile: "profile",
};

export function ReportButton({
  targetType,
  targetId,
  variant = "icon",
  className,
  style,
}: {
  targetType: ReportTargetType;
  targetId: string;
  variant?: "icon" | "text";
  className?: string;
  style?: CSSProperties;
}) {
  const { user, getAccessToken } = useAuth();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [note, setNote] = useState("");
  const [phase, setPhase] = useState<ReportDialogPhase>("form");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState(false);

  if (!user) return null;

  const noun = TARGET_NOUN[targetType];

  function close() {
    if (phase === "submitting") return;
    setOpen(false);
    setReason(null);
    setNote("");
    setPhase("form");
    setErrorMsg(null);
    setDuplicate(false);
  }

  async function file() {
    if (!canSubmitReport(reason, phase) || !reason) return;
    setPhase("submitting");
    setErrorMsg(null);
    try {
      const result = await submitReport(getAccessToken, {
        targetType,
        targetId,
        reason,
        note: note.trim() ? note : undefined,
      });
      setDuplicate(result.duplicate);
      setPhase("success");
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Could not file your report. Please try again.");
      setPhase("error");
    }
  }

  return (
    <>
      {variant === "icon" ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={`Report this ${noun}`}
          title={`Report this ${noun}`}
          data-testid="report-button"
          className={className ?? "rounded-full p-2 text-neutral-400 hover:text-[#d4af37]"}
          style={style}
        >
          <Flag className="h-[16px] w-[16px]" />
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={`Report this ${noun}`}
          data-testid="report-button"
          className={className ?? "inline-flex items-center gap-1 text-[11px] font-semibold text-white/35 transition hover:text-[#e8c86a]"}
          style={style}
        >
          <Flag className="h-3 w-3" /> Report
        </button>
      )}

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-label={`Report this ${noun}`}
          data-testid="report-dialog"
          onClick={close}
        >
          <div
            className="w-full max-w-sm rounded-2xl border border-[#C9A84C]/40 bg-[#14100a] p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {phase === "success" ? (
              <div className="text-center" data-testid="report-success">
                <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-[#C9A84C]/15">
                  <Check className="h-5 w-5 text-[#e8c86a]" />
                </span>
                <p className="mt-3 font-bold text-white">
                  {duplicate ? "Already reported" : "Report filed"}
                </p>
                <p className="mt-1 text-sm text-white/60">
                  {duplicate
                    ? "You already reported this — it's in the queue and our team will take a look."
                    : "Thanks — our team will take a look. Reports are reviewed by a person; nothing is hidden or banned automatically."}
                </p>
                <button
                  type="button"
                  onClick={close}
                  className="mt-4 w-full rounded-full bg-[#C9A84C] px-5 py-2.5 text-sm font-bold text-black transition hover:brightness-110"
                >
                  Done
                </button>
              </div>
            ) : (
              <>
                <div className="flex items-start justify-between gap-3">
                  <p className="flex items-center gap-2 font-bold text-white">
                    <Flag className="h-4 w-4 text-[#e8c86a]" /> Report this {noun}
                  </p>
                  <button
                    type="button"
                    onClick={close}
                    aria-label="Close"
                    className="rounded-full p-1 text-white/50 transition hover:text-white"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <p className="mt-1 text-sm text-white/55">
                  What's wrong with this {noun}? Every report is reviewed by a person — filing one never hides or bans anything by itself.
                </p>

                <div className="mt-3 space-y-1.5" role="radiogroup" aria-label="Reason">
                  {REPORT_REASONS.map((r) => (
                    <button
                      key={r}
                      type="button"
                      role="radio"
                      aria-checked={reason === r}
                      data-testid={`report-reason-${r}`}
                      onClick={() => setReason(r)}
                      className={`flex w-full items-center justify-between rounded-xl border px-3 py-2 text-left text-sm transition ${
                        reason === r
                          ? "border-[#C9A84C] bg-[#C9A84C]/15 font-semibold text-white"
                          : "border-white/10 bg-white/[0.03] text-white/75 hover:border-white/25"
                      }`}
                    >
                      {REPORT_REASON_LABELS[r]}
                      {reason === r && <Check className="h-4 w-4 text-[#e8c86a]" />}
                    </button>
                  ))}
                </div>

                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  maxLength={500}
                  rows={2}
                  placeholder="Add anything that helps (optional)"
                  aria-label="Note (optional)"
                  className="mt-3 w-full resize-none rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-[#C9A84C]/60 focus:outline-none"
                />
                <p className="mt-0.5 text-right text-[11px] text-white/30">{note.length}/500</p>

                {phase === "error" && errorMsg && (
                  <p className="mt-1 text-sm text-red-400" data-testid="report-error">{errorMsg}</p>
                )}

                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    onClick={close}
                    disabled={phase === "submitting"}
                    className="flex-1 rounded-full border border-white/15 px-4 py-2.5 text-sm font-semibold text-white/75 transition hover:border-white/35 disabled:opacity-40"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void file()}
                    disabled={!canSubmitReport(reason, phase)}
                    data-testid="report-submit"
                    className="flex-1 rounded-full bg-[#C9A84C] px-4 py-2.5 text-sm font-bold text-black transition hover:brightness-110 disabled:opacity-40"
                  >
                    {phase === "submitting" ? (
                      <span className="inline-flex items-center gap-1.5"><Loader2 className="h-4 w-4 animate-spin" /> Filing…</span>
                    ) : (
                      "File report"
                    )}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
