/**
 * drop-day-kit.test.ts — UPGRADE #169 (Drop Day Kit).
 *
 * Pins the assembly contract:
 * - the kit is built ONLY from the release's own fields — the teaser
 *   carries the release's audio/art, every banner carries the
 *   release's artwork, title, artist, and date;
 * - whatever the release lacks is NAMED in `missing` — no invented
 *   art, no invented audio, no invented date;
 * - activation is blocked only by the two pieces the land-time
 *   promise stands on (a release date, a presave page) — teaser and
 *   banner gaps are the creator's choice;
 * - 'landed' is derived from the release moment (a YYYY-MM-DD date
 *   reads as UTC midnight, exactly like the presave rail), never a
 *   second writer's claim.
 */
import { describe, expect, it } from "vitest";
import {
  activationBlockers,
  assembleKit,
  effectiveKitStatus,
  type KitRelease,
} from "../drop-day-kit";

const FULL: KitRelease = {
  id: "rel-1",
  userId: "user-1",
  title: "Midnight Run",
  artistName: "Thy Cheat Code",
  releaseDate: "2026-11-15",
  audioUrl: "https://cdn.example/track.mp3",
  artworkUrl: "https://cdn.example/cover.jpg",
  status: "packaged",
  presaveSlug: "midnight-run",
};

describe("assembleKit — from the release's own fields only", () => {
  it("a complete release assembles the full kit with nothing missing", () => {
    const kit = assembleKit(FULL);
    expect(kit.missing).toEqual([]);
    expect(kit.teaser).toMatchObject({
      kind: "teaser_short",
      status: "draft",
      durationSec: 15,
      audioUrl: FULL.audioUrl,
      artworkUrl: FULL.artworkUrl,
    });
    expect(decodeURIComponent(kit.teaser!.createLink)).toContain("Midnight Run");
    expect(kit.banners.map((b) => b.size)).toEqual(["profile", "wide", "post", "story"]);
    expect(kit.banners.every((b) => b.artworkUrl === FULL.artworkUrl)).toBe(true);
    expect(kit.banners[0]).toMatchObject({ headline: "Midnight Run", subline: "Thy Cheat Code · 2026-11-15" });
    expect(kit.countdown).toEqual({
      presaveUrl: "https://bowdownvisuals.com/presave/midnight-run",
      releaseDate: "2026-11-15",
    });
  });

  it("no audio: no teaser is invented — the gap is named", () => {
    const kit = assembleKit({ ...FULL, audioUrl: null });
    expect(kit.teaser).toBeNull();
    expect(kit.missing).toContain("audio");
    expect(kit.banners).toHaveLength(4); // the rest of the kit still assembles
  });

  it("no artwork: no banner set is invented — the gap is named", () => {
    const kit = assembleKit({ ...FULL, artworkUrl: null });
    expect(kit.banners).toEqual([]);
    expect(kit.missing).toContain("artwork");
    expect(kit.teaser).not.toBeNull();
    expect(kit.teaser!.artworkUrl).toBeNull();
  });

  it("no date and no presave page: both named, countdown binds nothing", () => {
    const kit = assembleKit({ ...FULL, releaseDate: null, presaveSlug: null });
    expect(kit.missing).toEqual(expect.arrayContaining(["release_date", "presave_page"]));
    expect(kit.countdown.presaveUrl).toBeNull();
    expect(kit.countdown.releaseDate).toBeNull();
  });
});

describe("activationBlockers — the land-time promise is the gate", () => {
  it("a full kit has no blockers", () => {
    expect(activationBlockers(assembleKit(FULL))).toEqual([]);
  });

  it("missing audio/artwork never block activation", () => {
    const kit = assembleKit({ ...FULL, audioUrl: null, artworkUrl: null });
    expect(activationBlockers(kit)).toEqual([]);
  });

  it("missing date or presave page blocks, by name", () => {
    expect(activationBlockers(assembleKit({ ...FULL, releaseDate: null }))).toEqual(["release_date"]);
    expect(activationBlockers(assembleKit({ ...FULL, presaveSlug: null }))).toEqual(["presave_page"]);
  });
});

describe("effectiveKitStatus — landed is derived", () => {
  const now = new Date("2026-11-16T12:00:00.000Z");

  it("an active kit past its release date has landed", () => {
    expect(effectiveKitStatus("active", "2026-11-15", now)).toBe("landed");
  });

  it("an active kit before its date is still active; a draft never lands", () => {
    expect(effectiveKitStatus("active", "2026-12-25", now)).toBe("active");
    expect(effectiveKitStatus("draft", "2026-11-15", now)).toBe("draft");
  });

  it("no date or a broken date never lands the kit", () => {
    expect(effectiveKitStatus("active", null, now)).toBe("active");
    expect(effectiveKitStatus("active", "not-a-date", now)).toBe("active");
  });
});
