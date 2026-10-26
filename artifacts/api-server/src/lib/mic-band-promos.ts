/**
 * mic-band-promos.ts — pure builder for the hero hanging-mic promo band.
 *
 * The band (owner, 2026-10-25) rotates the site's STANDING promotions.
 * Every word it shows is derived here from the promo sources of truth —
 * SITE_LAUNCH_PROMO, SPOTLIGHT_OFFER and LOADING_SCREEN_OFFER (all in
 * @workspace/db, the same constants the Spotlight / Loading Screen
 * inquiry modals and the loader rotation read) plus the live Cheat Code
 * Jackpot status (the same event the jackpot banner spotlights).
 * Nothing is hard-coded in the band component: change an offer's price
 * or the launch date at the source and the band follows.
 *
 * No I/O here — the route supplies the jackpot snapshot (or null when
 * no event should be promoted), which keeps this unit-testable.
 */

export interface MicBandPromo {
  id: "launch" | "jackpot" | "spotlight" | "loading-screen";
  /** Small eyebrow line, e.g. "Grand opening". */
  kicker: string;
  /** The big line, e.g. "Jan 1, 2027" / "10,000 VB" / offer name. */
  headline: string;
  /** Supporting line, e.g. countdown, end date, "$1,000 · 7 days". */
  detail: string;
  /** Where the promo points, when the surface has one. */
  href: string | null;
}

export interface MicBandOffer {
  name: string;
  priceDollars: number;
  durationDays: number;
}

export interface MicBandJackpotSnapshot {
  phase: "live" | "claimed" | "upcoming" | "ended" | "none";
  name?: string | null;
  prizeCredits?: number | null;
  startsAt?: string | null;
  endsAt?: string | null;
  winnerDisplayName?: string | null;
}

export interface MicBandPromoSources {
  now: Date;
  launch: { name: string; launchAt: string; href: string };
  spotlight: MicBandOffer;
  loadingScreen: MicBandOffer;
  jackpot: MicBandJackpotSnapshot | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** "2027-01-01T05:00:00.000Z" -> "Jan 1, 2027" (UTC, matching the source). */
export function formatMicBandDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function offerDetail(offer: MicBandOffer): string {
  return `$${offer.priceDollars.toLocaleString("en-US")} · ${offer.durationDays} days`;
}

export function buildMicBandPromos(src: MicBandPromoSources): MicBandPromo[] {
  const promos: MicBandPromo[] = [];

  /* Launch — only while it is still ahead of us. */
  const launchAt = new Date(src.launch.launchAt);
  if (!Number.isNaN(launchAt.getTime()) && src.now.getTime() < launchAt.getTime()) {
    const days = Math.ceil((launchAt.getTime() - src.now.getTime()) / DAY_MS);
    const dateLabel = formatMicBandDate(src.launch.launchAt);
    promos.push({
      id: "launch",
      kicker: "Grand opening",
      headline: dateLabel ?? src.launch.name,
      detail:
        days <= 0
          ? "Today"
          : days === 1
            ? "Tomorrow — be first in the door"
            : `${days} days away — be first in the door`,
      href: src.launch.href,
    });
  }

  /* Jackpot — the current event only; claimed shows its real winner
     (the same public spotlight the jackpot banner gives them). */
  const jp = src.jackpot;
  if (jp && jp.phase !== "none" && jp.phase !== "ended") {
    const prize =
      jp.prizeCredits != null ? `${jp.prizeCredits.toLocaleString("en-US")} VB` : null;
    if (jp.phase === "live" && prize) {
      const ends = formatMicBandDate(jp.endsAt);
      promos.push({
        id: "jackpot",
        kicker: "Cheat Code Jackpot",
        headline: prize,
        detail: ends ? `Unclaimed — ends ${ends}` : "Unclaimed — one winner",
        href: null,
      });
    } else if (jp.phase === "upcoming" && prize) {
      const starts = formatMicBandDate(jp.startsAt);
      promos.push({
        id: "jackpot",
        kicker: "Cheat Code Jackpot",
        headline: prize,
        detail: starts ? `Next code drops ${starts}` : "A new code is coming",
        href: null,
      });
    } else if (jp.phase === "claimed" && jp.winnerDisplayName) {
      promos.push({
        id: "jackpot",
        kicker: "Cheat Code Jackpot",
        headline: "Claimed",
        detail: `Won by ${jp.winnerDisplayName}`,
        href: null,
      });
    }
  }

  /* The two takeover offers — name, price and duration all come from
     the offer constants the inquiry modals fetch. */
  promos.push({
    id: "spotlight",
    kicker: "For brands",
    headline: src.spotlight.name,
    detail: offerDetail(src.spotlight),
    href: "/login",
  });
  promos.push({
    id: "loading-screen",
    kicker: "For brands",
    headline: src.loadingScreen.name,
    detail: offerDetail(src.loadingScreen),
    href: null,
  });

  return promos;
}
