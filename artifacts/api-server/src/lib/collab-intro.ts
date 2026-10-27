/* ─── Collab Match (#175) — double opt-in intros ─────────────────────────
   The Collab Finder already had profiles, a paid AI match report, and
   free requests — but a sender's pitch message was visible the moment it
   was sent: single opt-in. The approved delta is DOUBLE opt-in intros:
   an intro (the pitch + contact) is revealed only when BOTH creators have
   opted in — sender by sending, receiver by accepting. Until then the
   receiver sees who is interested and their public profile facts, never
   the pitch. If both creators send each other a request, that is mutual
   opt-in by definition and both intros unlock at once. */

export type CollabRequestStatus = "pending" | "accepted" | "declined";

export interface IntroView {
  /** The pitch text, or null while the intro is still locked. */
  message: string | null;
  introLocked: boolean;
  /** Plain-words reason shown in the inbox while locked. */
  lockedReason: string | null;
}

/* What a viewer may see of one collab request.
   - The sender always sees their own pitch.
   - The receiver sees the pitch only after accepting (their opt-in).
   - Declined intros stay locked for the receiver. */
export function introForViewer(
  status: CollabRequestStatus,
  message: string,
  viewerIsSender: boolean,
): IntroView {
  if (viewerIsSender) return { message, introLocked: false, lockedReason: null };
  if (status === "accepted") return { message, introLocked: false, lockedReason: null };
  return {
    message: null,
    introLocked: true,
    lockedReason:
      status === "declined"
        ? "This intro stayed locked — the other creator didn't opt in."
        : "Intro locked until you both opt in. Accept to reveal it.",
  };
}

/* Mutual opt-in: a pending (or accepted) request in EACH direction means
   both creators raised a hand — both intros unlock and both requests
   count as accepted. */
export function detectMutualIntro(
  aToB: CollabRequestStatus | null,
  bToA: CollabRequestStatus | null,
): boolean {
  const optedIn = (s: CollabRequestStatus | null) => s === "pending" || s === "accepted";
  return optedIn(aToB) && optedIn(bToA);
}

/* The status a request should carry once mutual opt-in is detected. */
export function mutualAcceptedStatus(current: CollabRequestStatus): CollabRequestStatus {
  return current === "declined" ? "declined" : "accepted";
}
