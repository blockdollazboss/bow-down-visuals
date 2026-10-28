/**
 * export-pricing.ts — the CLIENT mirror of the export rail's pricing
 * prediction (payfix lane 6, rulings A-01 / A-02 / A-07).
 *
 * The server rail (api-server routes/generate/export-video.ts) already
 * decides the real price: predictExportWatermarked mirrors the render's
 * own watermark decision, branded (watermarked) output is FREE (A-01),
 * and clean output costs EXPORT_CREDIT_COST = 400 VB on BOTH export
 * doors (A-02), reserved at job start (A-07).
 *
 * The Oct 26 Pass-3 defect was that the client never made this
 * prediction: the spend-confirmation dialog read the static registry
 * price (400 VB) even when the watermark was on, so a free branded
 * export "priced" at 400. Every export surface must price through THIS
 * module — never the raw registry entry — so the dialog, the button
 * copy, and the reserve panel quote the same figure the rail charges.
 */

export const EXPORT_CLEAN_COST = 400;

export interface ExportBrandingWatermarkInput {
  enabled?: unknown;
  customLogoUrl?: unknown;
  bdvWatermark?: unknown;
}

export interface ExportWatermarkInput {
  /** The export's watermark request (one-click addWatermark, or the
   *  Quality panel's watermark toggle). */
  addWatermark?: boolean;
  /** The branding block, when one rides the request. Its watermark
   *  section decides for itself, exactly as on the server. */
  branding?: { watermark?: ExportBrandingWatermarkInput | null } | null;
  /** Subscriber status — now only feeds the legacy default for a
   *  request that omits the watermark flag entirely. An explicit
   *  toggle decides on every plan (clean = 400 VB, A-02). */
  isSubscriber?: boolean;
}

/**
 * Mirror of the server's predictExportWatermarked — keep the two in
 * lockstep (export-pricing.test.ts walks the same truth table as the
 * server's export-branded-free.test.ts). ONE truth table, owned by the
 * export-time decision (stack400 lane 3):
 *  - `addWatermark === false` is an explicit OFF and ALWAYS wins — the
 *    export is clean at the ruled 400 VB on every plan (A-02). Before
 *    this fix the default-on branding block (and the free-plan gate)
 *    silently overrode the toggle, so the dialog could never quote the
 *    clean price the owner asked for;
 *  - otherwise an enabled branding watermark chooses the artwork
 *    (custom logo, or the house watermark unless explicitly switched
 *    off with no logo);
 *  - `addWatermark === true` → branded;
 *  - flag omitted → the legacy plan default (free/trial branded,
 *    subscribers clean).
 */
export function predictClientExportWatermarked(input: ExportWatermarkInput): boolean {
  if (input.addWatermark === false) return false;
  const bwm = input.branding?.watermark;
  if (bwm?.enabled) {
    if (typeof bwm.customLogoUrl === "string" && bwm.customLogoUrl.startsWith("http")) return true;
    return bwm.bdvWatermark !== false;
  }
  if (input.addWatermark === true) return true;
  return !input.isSubscriber;
}

export interface ExportPrice {
  /** True when the finished render will carry a watermark. */
  branded: boolean;
  /** The price the rail will reserve/settle: 0 branded, 400 clean. */
  cost: number;
  /** Confirmation-dialog feature label for this exact price. */
  feature: string;
}

/** The price to show (and pass as overrideCost) for one export request. */
export function exportPriceFor(input: ExportWatermarkInput & { quality?: boolean }): ExportPrice {
  const branded = predictClientExportWatermarked(input);
  const base = input.quality ? "Quality-Controlled Export" : "Export Final Video";
  return branded
    ? { branded: true, cost: 0, feature: `${base} — branded (free)` }
    : { branded: false, cost: EXPORT_CLEAN_COST, feature: base };
}

/**
 * Charge/reserve visibility for one export job — the shape the server
 * returns on POST 202 and on every GET /api/export-video-job/:jobId
 * (payfix lane 6, rung 3). `reservedAmount` is the A-07 hold currently
 * standing; `chargedAmount` is what the job has actually cost so far
 * (the settled hold on success, 0 while rendering / branded / failed /
 * cancelled).
 */
export interface ExportChargeInfo {
  branded: boolean;
  cost: number;
  reservedAmount: number;
  chargedAmount: number;
  chargeState: "free" | "will-reserve" | "reserved" | "settled" | "released" | "none";
}
