/**
 * Palace announcements (lib/world/announce, Ring 3, THE-GAME §5(b)).
 *
 * Pinned contract:
 * - the banner line is the server's headline, verbatim — the page
 *   never rewrites a palace statement;
 * - the room log's speaker: a herald is the host (their own name),
 *   the King's moment is the King's, everything else is the Palace;
 * - freshness is a hard window (ANNOUNCE_TTL_MS): a stale
 *   announcement never rises late;
 * - the herald compose rule trims + caps at HERALD_MAX_CHARS, and
 *   an all-whitespace draft cleans to "" (nothing to send);
 * - the mute persists on this device ("1"/"0" under
 *   ANNOUNCE_MUTED_KEY), defaults to UNMUTED on absent/garbled
 *   storage, and survives storage throwing (private modes);
 * - the page wiring (source pins): the banner + its mute/dismiss,
 *   the always-in-reach header toggle, and the host panel's herald
 *   form all exist, and the client's onAnnounce feeds the room log
 *   even while muted (the mute silences the banner, not the record).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  ANNOUNCE_TTL_MS,
  ANNOUNCE_MUTED_KEY,
  announceLine,
  announceSpeaker,
  cleanHeraldText,
  isAnnounceFresh,
  loadAnnounceMuted,
  storeAnnounceMuted,
} from "./announce";
import { HERALD_MAX_CHARS, type WorldAnnouncement } from "./world-client";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

const at = 1_700_000_000_000;
function announcement(over: Partial<WorldAnnouncement> = {}): WorldAnnouncement {
  return { kind: "drop", text: "A drop landed in the Music Hall.", at, ...over };
}

describe("the line + the speaker", () => {
  it("the line is the server headline verbatim", () => {
    expect(announceLine(announcement())).toBe("A drop landed in the Music Hall.");
  });

  it("a herald speaks under the host's name; the King's moment under the King's; the rest under the Palace's", () => {
    expect(announceSpeaker(announcement({ kind: "herald", name: "Thy Cheat Code" }))).toBe("Thy Cheat Code");
    expect(announceSpeaker(announcement({ kind: "herald" }))).toBe("The Host");
    expect(announceSpeaker(announcement({ kind: "king" }))).toBe("The King");
    expect(announceSpeaker(announcement({ kind: "show" }))).toBe("The Palace");
    expect(announceSpeaker(announcement({ kind: "levelup" }))).toBe("The Palace");
    expect(announceSpeaker(announcement({ kind: "drop" }))).toBe("The Palace");
  });
});

describe("freshness", () => {
  it("fresh inside the window, stale at and past it", () => {
    const a = announcement();
    expect(isAnnounceFresh(a, at)).toBe(true);
    expect(isAnnounceFresh(a, at + ANNOUNCE_TTL_MS - 1)).toBe(true);
    expect(isAnnounceFresh(a, at + ANNOUNCE_TTL_MS)).toBe(false);
    expect(isAnnounceFresh(a, at + ANNOUNCE_TTL_MS * 10)).toBe(false);
  });
});

describe("the herald compose rule", () => {
  it("trims and caps; whitespace-only cleans to empty", () => {
    expect(cleanHeraldText("  Court at eight.  ")).toBe("Court at eight.");
    expect(cleanHeraldText("   ")).toBe("");
    expect(cleanHeraldText("x".repeat(HERALD_MAX_CHARS + 50))).toHaveLength(HERALD_MAX_CHARS);
  });
});

describe("the mute (this device only)", () => {
  function memStorage(seed: Record<string, string> = {}) {
    const map = new Map(Object.entries(seed));
    return {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      map,
    };
  }

  it("defaults unmuted; stores and reads back both ways", () => {
    const s = memStorage();
    expect(loadAnnounceMuted(s)).toBe(false);
    storeAnnounceMuted(true, s);
    expect(s.map.get(ANNOUNCE_MUTED_KEY)).toBe("1");
    expect(loadAnnounceMuted(s)).toBe(true);
    storeAnnounceMuted(false, s);
    expect(loadAnnounceMuted(s)).toBe(false);
  });

  it("garbled storage reads as unmuted; throwing storage never breaks the read or the write", () => {
    expect(loadAnnounceMuted(memStorage({ [ANNOUNCE_MUTED_KEY]: "yes" }))).toBe(false);
    const throwing = {
      getItem: () => {
        throw new Error("nope");
      },
      setItem: () => {
        throw new Error("nope");
      },
    };
    expect(loadAnnounceMuted(throwing)).toBe(false);
    expect(() => storeAnnounceMuted(true, throwing)).not.toThrow();
    expect(loadAnnounceMuted(null)).toBe(false);
  });
});

describe("page wiring (source pins)", () => {
  const page = read("../../pages/world.tsx");

  it("the announcement banner, its mute + dismiss, and the header toggle are mounted", () => {
    expect(page).toContain('data-testid="world-announce-banner"');
    expect(page).toContain('data-testid="world-announce-mute"');
    expect(page).toContain('data-testid="world-announce-dismiss"');
    expect(page).toContain('data-testid="world-announce-toggle"');
  });

  it("the host panel carries the herald compose", () => {
    expect(page).toContain('data-testid="world-herald-form"');
    expect(page).toContain('data-testid="world-herald-input"');
    expect(page).toContain('data-testid="world-herald-send"');
  });

  it("onAnnounce feeds the room log under its speaker, and the banner only when unmuted and fresh", () => {
    expect(page).toContain("client.onAnnounce = (a) => {");
    expect(page).toContain("displayName: announceSpeaker(a), body: announceLine(a)");
    expect(page).toContain("if (!announceMutedRef.current && isAnnounceFresh(a, Date.now())) showAnnounce(a);");
  });
});
