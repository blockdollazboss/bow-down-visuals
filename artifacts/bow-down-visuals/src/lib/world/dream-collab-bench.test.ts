/**
 * dream-collab-bench — Stack 300 world parity (Lane B
 * item 11) seam pins. The bench mirrors the panel: the
 * route's price as the override (no registry entry for
 * this rail — the panel's override is the house pattern),
 * its post body and required-field gate, a whole-concept
 * answer guard, and the panel's copy text + song seed,
 * byte for byte. Copy: dreamCollab is new to the catalogs
 * with this bench — en values are the panel's own
 * literals; the other nine carry them English-verbatim
 * UNREVIEWED.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DREAM_COLLAB_COST,
  DREAM_COLLAB_PATH,
  DREAM_COLLAB_SONG_STATION_ID,
  buildDreamCollabPayload,
  dreamCollabConceptOf,
  dreamCollabCopyText,
  dreamCollabInputReady,
  dreamCollabSongSeed,
  type DreamCollabConcept,
} from "./dream-collab-bench";

const CONCEPT: DreamCollabConcept = {
  logline: "Two worlds, one chorus",
  concept: "The full concept",
  styleBlend: "Drill × silk",
  videoPrompts: ["prompt one", "prompt two"],
  songConcept: "A duet about dawn",
};

describe("the rail + the price", () => {
  it("posts where the panel posts, at the route's 200", () => {
    expect(DREAM_COLLAB_PATH).toBe("/api/dream-collab/concept");
    expect(DREAM_COLLAB_COST).toBe(200);
    expect(DREAM_COLLAB_SONG_STATION_ID).toBe("song-desk");
  });

  it("shapes the panel's post body and gate", () => {
    expect(buildDreamCollabPayload({ collaborator: " X ", userStyle: " drill ", songTheme: "" })).toEqual({
      collaborator: "X",
      userStyle: "drill",
      songTheme: "",
    });
    expect(dreamCollabInputReady({ collaborator: "X", userStyle: "drill" })).toBe(true);
    expect(dreamCollabInputReady({ collaborator: " ", userStyle: "drill" })).toBe(false);
    expect(dreamCollabInputReady({ collaborator: "X", userStyle: "" })).toBe(false);
  });
});

describe("the answer guard", () => {
  it("takes a whole concept; a missing logline is a failed run", () => {
    expect(dreamCollabConceptOf(CONCEPT)).toEqual(CONCEPT);
    expect(dreamCollabConceptOf({ ...CONCEPT, logline: "" })).toBeNull();
    expect(dreamCollabConceptOf({ concept: "x" })).toBeNull();
    expect(dreamCollabConceptOf(null)).toBeNull();
    // drifted extras are shed, never fatal to the whole fields
    expect(dreamCollabConceptOf({ ...CONCEPT, videoPrompts: ["ok", 7] })?.videoPrompts).toEqual(["ok"]);
  });

  it("copies the concept and seeds the song in the panel's own formats", () => {
    expect(dreamCollabCopyText(CONCEPT)).toBe(
      "Two worlds, one chorus\n\nThe full concept\n\nSTYLE BLEND: Drill × silk\n\nVIDEO PROMPTS:\n1. prompt one\n2. prompt two\n\nSONG CONCEPT: A duet about dawn",
    );
    expect(dreamCollabSongSeed(CONCEPT)).toBe("Two worlds, one chorus\n\nA duet about dawn\n\nStyle blend: Drill × silk");
  });
});

describe("the copy — the namespace, verbatim in every catalog until reviewed", () => {
  it("dreamCollab rides all ten catalogs identically", () => {
    const readJson = (rel: string) => JSON.parse(readFileSync(new URL(rel, import.meta.url), "utf8")) as Record<string, any>;
    const en = readJson("../../locales/en.json");
    expect(en.dreamCollab.title).toBe("Dream Collab");
    expect(en.dreamCollab.makeThisSong).toBe("Make this song →");
    for (const loc of ["ar", "de", "es", "fr", "hi", "it", "ja", "ko", "pt"]) {
      const cat = readJson(`../../locales/${loc}.json`);
      expect(cat.dreamCollab, loc).toEqual(en.dreamCollab);
    }
  });
});
