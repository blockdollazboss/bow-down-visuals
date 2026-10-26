import { useEffect, useState } from "react";
import { Image as ImageIcon, AlertTriangle, RotateCcw, Check, X, EyeOff, Undo2 } from "lucide-react";
import {
  fetchFanArtQueue,
  reviewFanArtPiece,
  fanArtActionsFor,
  fanArtStatusLabel,
  type FanArtAction,
  type FanArtPieceDto,
} from "@/lib/profile-website";

/* ─── Fan Art review desk — artist setup (Stack-200 #157) ───────────────
   The creator's half of the Fan Art Wall, docked in the page setup
   beside the layout editor: this is where fan submissions wait. Every
   decision is PER PIECE and the creator's alone — approve hangs the
   piece on the profile Gallery wall, reject turns it away, revoke
   takes an approved piece down (approving it again is the undo).
   Artist credit rides every row in every state and is never stripped.
   A failed load is an honest error + retry, never a fake-empty queue. */

const ACTION_UI: Record<FanArtAction, { label: string; icon: typeof Check; cls: string }> = {
  approve: { label: "Approve — hang it on my wall", icon: Check, cls: "bg-amber-400 text-black hover:scale-105" },
  reject: { label: "Reject", icon: X, cls: "border border-white/15 text-white/70 hover:bg-white/10" },
  revoke: { label: "Take down", icon: EyeOff, cls: "border border-white/15 text-white/70 hover:bg-white/10" },
};

const STATUS_CHIP: Record<FanArtPieceDto["status"], string> = {
  pending: "border-amber-400/40 bg-amber-400/10 text-amber-300",
  approved: "border-emerald-400/40 bg-emerald-400/10 text-emerald-300",
  rejected: "border-white/15 bg-white/5 text-white/50",
  revoked: "border-white/15 bg-white/5 text-white/50",
};

export default function FanArtReviewDesk() {
  const [pieces, setPieces] = useState<FanArtPieceDto[] | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [error, setError] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(false);
    (async () => {
      try {
        const queue = await fetchFanArtQueue();
        if (!cancelled) {
          setPieces(queue.pieces);
          setPendingCount(queue.pendingCount);
        }
      } catch (e) {
        if (cancelled) return;
        /* A 404 means the signed-in user has no creator profile yet —
           the desk simply doesn't apply to them (honest empty). Any
           other failure is an error state with a retry, never a
           fake-empty queue. */
        if ((e as { status?: number })?.status === 404) {
          setPieces([]);
          setPendingCount(0);
        } else {
          setError(true);
          setPieces([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [retryNonce]);

  async function decide(piece: FanArtPieceDto, action: FanArtAction) {
    setBusyId(piece.id);
    setActionError(null);
    try {
      const updated = await reviewFanArtPiece(piece.id, action);
      setPieces((prev) => {
        if (!prev) return prev;
        const next = prev.map((p) => (p.id === updated.id ? updated : p));
        setPendingCount(next.filter((p) => p.status === "pending").length);
        return next;
      });
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "That decision didn't save. Please try again.");
    } finally {
      setBusyId(null);
    }
  }

  if (pieces === null) return null;

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4" data-testid="fan-art-review-desk">
      <h3 className="mb-1 flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-white/50">
        <ImageIcon className="h-4 w-4" /> Fan Art Wall — review
        {pendingCount > 0 && (
          <span className="rounded-full bg-amber-400 px-2 py-0.5 text-[11px] font-black normal-case tracking-normal text-black">
            {pendingCount} waiting
          </span>
        )}
      </h3>
      <p className="mb-3 text-xs text-white/40">
        Fans submit art for your Gallery wall. Nothing appears on your profile until you approve that
        exact piece — and you can take any piece down at any time. The artist's name always rides on
        their work.
      </p>

      {error && (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-white/10 px-4 py-5 text-center">
          <AlertTriangle className="h-5 w-5 text-amber-400" />
          <p className="text-sm text-white/70">Your fan art queue couldn't load right now.</p>
          <button
            type="button"
            onClick={() => setRetryNonce((n) => n + 1)}
            className="inline-flex items-center gap-2 rounded-full bg-amber-400 px-4 py-1.5 text-xs font-bold text-black transition hover:scale-105"
          >
            <RotateCcw className="h-3.5 w-3.5" /> Try again
          </button>
        </div>
      )}

      {!error && pieces.length === 0 && (
        <p className="text-sm text-white/50">
          No fan art yet. When a fan submits a piece from your profile's Gallery, it waits here for
          your call.
        </p>
      )}

      {actionError && (
        <p className="mb-2 text-xs font-semibold text-red-400" role="alert">
          {actionError}
        </p>
      )}

      <div className="space-y-2">
        {pieces.map((piece) => (
          <div
            key={piece.id}
            className="flex flex-wrap items-center gap-3 rounded-lg border border-white/10 bg-black/20 p-3"
            data-testid="fan-art-queue-piece"
          >
            <img
              src={piece.imageUrl}
              alt={`${piece.title} — fan art by ${piece.artistName}`}
              className="h-14 w-14 shrink-0 rounded-lg object-cover"
              loading="lazy"
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-white" title={piece.title}>
                {piece.title}
              </p>
              <p className="text-xs text-white/50">
                by <span className="font-semibold text-white/80">{piece.artistName}</span>
                {piece.note && <span className="italic"> — “{piece.note}”</span>}
              </p>
              <span
                className={`mt-1 inline-block rounded-full border px-2 py-0.5 text-[11px] font-semibold ${STATUS_CHIP[piece.status]}`}
              >
                {fanArtStatusLabel(piece.status)}
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              {fanArtActionsFor(piece.status).map((action) => {
                const ui = ACTION_UI[action];
                const Icon = action === "approve" && piece.status === "revoked" ? Undo2 : ui.icon;
                const label =
                  action === "approve" && piece.status === "revoked" ? "Put it back up" : ui.label;
                return (
                  <button
                    key={action}
                    type="button"
                    disabled={busyId === piece.id}
                    onClick={() => void decide(piece, action)}
                    className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-bold transition disabled:opacity-60 ${ui.cls}`}
                  >
                    <Icon className="h-3.5 w-3.5" /> {label}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
