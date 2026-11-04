/**
 * credits-gate — the single decision every "Not Enough Visual Bucs"
 * surface must pass through (QC-200 fix queue #2, the false-insufficiency
 * family).
 *
 * The defect (live-verified Nov 3, 2026): /detector and /contracts showed
 * the "Not Enough Visual Bucs" card AT LOAD for an account holding
 * 87,795 VB. Two mechanisms produced the lie:
 *   1. Pages mounted the presentational <OutOfCredits /> card with no
 *      gate at all — the card asserts insufficiency whenever it renders.
 *   2. The spend-confirm dialog read `profile?.credits ?? 0`, so a
 *      balance that had not loaded yet (or whose read had failed) was
 *      treated as a proven balance of 0.
 *
 * The rule this module enforces: a balance is only ever in one of four
 * reads — loading, failed, signed-out, or ready with a number. The
 * insufficient-funds card may render ONLY on a ready read whose proven
 * balance is below the price. Loading is its own state, failure is its
 * own state (with a retry), and an unknown balance never dresses up as
 * "you can't afford this."
 */

export type BalanceRead =
  | { status: "loading" }
  | { status: "failed" }
  | { status: "signed-out" }
  | { status: "ready"; balance: number };

/**
 * Map the auth context's shape onto a BalanceRead. The auth profile is
 * the app's canonical balance source (fetchProfile folds the spendable
 * total into profile.credits). A signed-in user whose profile is still
 * null after loading finished is a FAILED read — fetchProfile resolves
 * with `data ?? null` and surfaces no error, so null-after-load is the
 * only failure signal available; it must never be read as balance 0.
 */
export function balanceReadFromAuth(input: {
  loading: boolean;
  hasUser: boolean;
  profileCredits: number | null;
}): BalanceRead {
  if (input.loading) return { status: "loading" };
  if (!input.hasUser) return { status: "signed-out" };
  if (input.profileCredits === null) return { status: "failed" };
  return { status: "ready", balance: input.profileCredits };
}

export type CreditsGateDecision =
  /** Proven balance below the price — the card may render. */
  | "card"
  /** Balance still loading — show the checking state, never the card. */
  | "checking"
  /** Balance read failed — show the honest error state with a retry. */
  | "balance-error"
  /** Nothing to claim: sufficient balance, or no balance applies. */
  | "nothing";

export function decideCreditsGate(read: BalanceRead, cost: number): CreditsGateDecision {
  switch (read.status) {
    case "loading":
      return "checking";
    case "failed":
      return "balance-error";
    case "signed-out":
      return "nothing";
    case "ready":
      return read.balance < cost ? "card" : "nothing";
  }
}
