/**
 * performance-bookings.ts — FE client for Book the Artist (#158).
 *
 * A promoter/venue books an artist for a show from the artist's
 * profile; the fee sits in escrow until the show is done and the
 * promoter releases it. This module is the typed mirror of
 * routes/performance-bookings.ts plus the pure presentation rules
 * (status words + which step each side can take next), so the panel
 * renders the server's state machine instead of inventing its own.
 *
 * Money here is REAL dollars via Stripe escrow — never Visual Bucs.
 */
import { apiJson } from "@/lib/social-api";

export type PerformanceBookingStatus =
  | "proposed" | "accepted" | "funded" | "completed" | "paid" | "declined" | "cancelled";
export type PerformanceEscrowStatus =
  | "unfunded" | "funding" | "funded" | "released" | "refunded";

export interface PerformanceBookingTermsDto {
  performance: string;
  setLengthMin?: number | null;
  productionNotes?: string | null;
  cancellationTerms?: string | null;
}

export interface PerformanceBookingDto {
  id: string;
  profileId: string;
  artistUserId: string;
  artistName: string;
  promoterUserId: string;
  promoterName: string;
  eventTitle: string;
  eventDate: string;
  venueName: string;
  venueAddress: string;
  venueCity: string;
  feeCents: number;
  terms: PerformanceBookingTermsDto;
  plainWords: string;
  notes: string | null;
  status: PerformanceBookingStatus;
  escrowStatus: PerformanceEscrowStatus;
  platformFeeCents: number | null;
  artistPayoutCents: number | null;
  paidAt: string | null;
  feePreview: { feeCents: number; netCents: number };
  role: "promoter" | "artist" | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePerformanceBookingInput {
  profileId: string;
  promoterName: string;
  eventTitle: string;
  eventDate: string;
  venueName: string;
  venueAddress: string;
  venueCity: string;
  feeCents: number;
  terms: PerformanceBookingTermsDto;
  notes?: string;
}

type TokenGetter = () => Promise<string | null>;

export async function createPerformanceBooking(
  getAccessToken: TokenGetter,
  input: CreatePerformanceBookingInput,
): Promise<PerformanceBookingDto> {
  const data = await apiJson<{ booking: PerformanceBookingDto }>(
    getAccessToken,
    "/api/performance-bookings",
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) },
  );
  return data.booking;
}

export async function fetchMyPerformanceBookings(
  getAccessToken: TokenGetter,
): Promise<PerformanceBookingDto[]> {
  const data = await apiJson<{ bookings: PerformanceBookingDto[] }>(
    getAccessToken,
    "/api/performance-bookings",
  );
  return data.bookings ?? [];
}

export async function respondToPerformanceBooking(
  getAccessToken: TokenGetter,
  bookingId: string,
  action: "accept" | "decline",
): Promise<PerformanceBookingDto> {
  const data = await apiJson<{ booking: PerformanceBookingDto }>(
    getAccessToken,
    `/api/performance-bookings/${bookingId}/respond`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) },
  );
  return data.booking;
}

export async function fundPerformanceBooking(
  getAccessToken: TokenGetter,
  bookingId: string,
): Promise<{ sandbox: boolean; sessionId: string; checkoutUrl?: string; message?: string }> {
  return apiJson(
    getAccessToken,
    `/api/performance-bookings/${bookingId}/fund`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
  );
}

export async function confirmSandboxPerformanceFunding(
  getAccessToken: TokenGetter,
  bookingId: string,
  sessionId: string,
): Promise<void> {
  await apiJson(
    getAccessToken,
    "/api/performance-bookings/escrow/confirm",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bookingId, sessionId }),
    },
  );
}

export async function performanceBookingStep(
  getAccessToken: TokenGetter,
  bookingId: string,
  step: "complete" | "release" | "cancel",
): Promise<PerformanceBookingDto> {
  const data = await apiJson<{ booking: PerformanceBookingDto }>(
    getAccessToken,
    `/api/performance-bookings/${bookingId}/${step}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
  );
  return data.booking;
}

/* ── Presentation rules (pure) ────────────────────────────────────── */

export const BOOKING_STATUS_LABEL: Record<PerformanceBookingStatus, string> = {
  proposed: "Waiting for the artist",
  accepted: "Accepted — waiting for escrow funding",
  funded: "Fee in escrow — show is on",
  completed: "Show done — waiting for release",
  paid: "Paid",
  declined: "Declined",
  cancelled: "Cancelled",
};

export const ESCROW_STATUS_LABEL: Record<PerformanceEscrowStatus, string> = {
  unfunded: "Not funded yet",
  funding: "Funding in progress",
  funded: "Held in escrow",
  released: "Released to the artist",
  refunded: "Refunded to the promoter",
};

export type BookingActionId = "accept" | "decline" | "fund" | "complete" | "release" | "cancel";

export interface BookingAction {
  id: BookingActionId;
  label: string;
}

/** The steps THIS viewer can take on THIS booking right now — the
 *  client twin of the server's state machine (the server re-checks
 *  every step; this only decides which buttons exist). */
export function bookingNextActions(b: PerformanceBookingDto): BookingAction[] {
  if (!b.role) return [];
  const actions: BookingAction[] = [];
  if (b.role === "artist" && b.status === "proposed") {
    actions.push({ id: "accept", label: "Accept this booking" });
    actions.push({ id: "decline", label: "Decline" });
  }
  if (b.role === "promoter" && b.status === "accepted" && b.escrowStatus === "unfunded") {
    actions.push({ id: "fund", label: "Fund the escrow" });
  }
  if (b.role === "artist" && b.status === "funded") {
    actions.push({ id: "complete", label: "Mark the show complete" });
  }
  if (b.role === "promoter" && b.status === "completed") {
    actions.push({ id: "release", label: "Release the fee" });
  }
  if (b.status === "proposed" || b.status === "accepted" || b.status === "funded") {
    actions.push({ id: "cancel", label: "Cancel booking" });
  }
  return actions;
}

export function bookingMoney(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
