/**
 * Buyer beat licenses — the DTO + the ownership join (stack1600 W8).
 *
 * GET /api/beats/licenses/mine returns the signed-in buyer's license
 * rows (newest first). The server DTO (toLicenseJson in the beats
 * routes) carries `beatId` on every row — the join key that lets a
 * surface answer "does this buyer already own a license for THIS
 * beat?" on every page load.
 *
 * The /beats browse cards and the license modal used to have no way
 * to ask that question: the page's local copy of this DTO omitted
 * beatId, the rows were fetched only when the Dashboard tab opened,
 * and neither surface consulted them — so a completed license
 * vanished from the buyer's view the moment the checkout-return
 * banner (transient state) was gone, even though the license row
 * itself was completed and the producer's sale was recorded.
 *
 * Only COMPLETED licenses are ownership: a pending_payment row is a
 * checkout the buyer never finished, and a refunded row is a
 * purchase that was undone — neither may badge a beat as owned.
 * downloadUrl / stemsUrl ride completed rows only (the server
 * withholds them otherwise, and an undeliverable completed license
 * can carry a null downloadUrl while its redelivery window runs —
 * the badge still shows; the download link renders when present).
 */
import type { BeatLicenseTerms } from "./beat-license-terms";

export interface BuyerBeatLicense {
  id: string;
  beatId: string;
  beatTitle: string | null;
  tier: string;
  templateId?: string | null;
  terms?: BeatLicenseTerms | null;
  priceCents: number;
  status: string;
  createdAt: string;
  downloadUrl: string | null;
  stemsUrl: string | null;
}

/**
 * The buyer's standing license for one beat, or null. Rows arrive
 * newest-first from licenses/mine, so the first completed match is
 * the most recent purchase — the one whose delivery links the card
 * and the modal present.
 */
export function completedLicenseForBeat(
  licenses: readonly BuyerBeatLicense[],
  beatId: string,
): BuyerBeatLicense | null {
  for (const l of licenses) {
    if (l.beatId === beatId && l.status === "completed") return l;
  }
  return null;
}
