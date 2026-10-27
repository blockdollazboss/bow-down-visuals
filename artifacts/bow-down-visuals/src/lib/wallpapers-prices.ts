/**
 * Wallpapers desk prices — derived, never second literals.
 *
 * Stack-28 item 15 (audit A6-W4): the desk hardcoded GENERATE_COST /
 * CLEAN_RENDER_COST and rendered "— 100/400/800 Visual Bucs" string
 * literals with no test tying them to the server constants, so any
 * rail price change would silently desync the labels AND the clean
 * render's confirmation quote. Every figure below is now derived
 * from its source of truth, the way the template gallery derives
 * VIDEO_TEMPLATE_APPLY_COST from the registry, and
 * wallpapers-prices.test.ts (FE) + wallpapers.test.ts (API) pin each
 * one equal to the server constant it quotes.
 *
 * Sources, per figure:
 * - Generate art: the desk sends model "nano-banana-2.1", whose
 *   per-model price lives in the artist-image model catalogue
 *   (ARTIST_IMAGE_MODELS — the same source GenerateArtistImageModal
 *   quotes). The registry's /api/generate-artist-image entry (200) is
 *   the Pro model's price; quoting it here would over-quote the 100
 *   the rail charges for the nano model (NANO_BANANA_21_CREDIT_COST).
 * - Clean render: the registry records /api/wallpapers/render at 0
 *   (branded — free); the clean variant's 400 is, per the registry's
 *   own comment, mapped from the site's clean-export rail
 *   (/api/export-final-video — branded free, clean 400), which is the
 *   figure the server's CLEAN_RENDER_COST is mapped from too.
 * - Screensaver render / screensaver video (runway clip): direct
 *   registry entries for their own endpoints.
 *
 * Owner price rulings, Oct 27, 2026 (by delegation), reconciled
 * honestly against this desk's actual shape:
 * - "Single wallpaper = 100" — the desk's single is generating one
 *   wallpaper: WALLPAPER_GENERATE_COST, already 100 (the nano model
 *   rail). Pinned in wallpapers-prices.test.ts.
 * - "Living wallpaper = 300" — WALLPAPER_SCREENSAVER_RENDER_COST,
 *   landed on both rails (registry + server constant).
 * - "Pack of 10 = 500" — THE DESK SELLS NO PACK OF 10. Its only pack
 *   is the 3-piece theme pack (phone + lock + desktop), priced as
 *   two clean renders (WALLPAPER_CLEAN_PACK_COST = 2 × 400 = 800,
 *   branded free), and /api/wallpapers/pack-download zips renders the
 *   user already made for free. The clean figures stay mapped from
 *   the clean-export rail (branded free / clean 400 — the site-wide
 *   clean-output price), so no 500 figure was forced onto either
 *   surface; a 10-wallpaper bundle at 500 would be a new product,
 *   not a price wiring. Recorded here so the gap is explicit, never
 *   silently papered over.
 */
import { getCreditCost } from "./credit-costs";
import { ARTIST_IMAGE_MODELS } from "../components/generate-artist-image";

/** Generate art with the model the desk sends (nano-banana-2.1). */
export const WALLPAPER_GENERATE_COST: number =
  ARTIST_IMAGE_MODELS.find((m) => m.id === "nano-banana-2.1")?.credits ?? 100;

/** Clean (unbranded) wallpaper render — mapped from the clean-export rail. */
export const WALLPAPER_CLEAN_RENDER_COST: number =
  getCreditCost("/api/export-final-video")?.cost ?? 400;

/** The clean theme pack: phone + desktop clean renders (the lock
    screen reuses the phone render and is never charged twice). */
export const WALLPAPER_CLEAN_PACK_COST: number = WALLPAPER_CLEAN_RENDER_COST * 2;

/** Screensaver loop render (POST /api/wallpapers/screensaver-render). */
export const WALLPAPER_SCREENSAVER_RENDER_COST: number =
  getCreditCost("/api/wallpapers/screensaver-render")?.cost ?? 400;

/** Screensaver source video (POST /api/generate-runway-clip, gen4.5). */
export const WALLPAPER_SCREENSAVER_VIDEO_COST: number =
  getCreditCost("/api/generate-runway-clip")?.cost ?? 400;
