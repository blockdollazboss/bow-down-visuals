/* Beat preset registry (Stack 100 item A11) — the extraction proof.

   FIXTURE METHOD: before the move, the original PRESETS object literal and
   BEAT_GENRES array in the AiAudio page file @ 23a636903 were machine-extracted
   (brace-matched out of the page source and evaluated) into the fixtures
   below. They are the originals, not a retype: if any grid cell, bass note,
   melody note, bpm, label or genre differs by one value, this suite fails.

   The page-wiring pins assert the data no longer lives in the page: the
   registry is the one home, the page imports it. */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  BEAT_GENRES,
  BEAT_PRESETS,
  BEAT_PRESET_IDS,
  beatPresetById,
  type BeatPreset,
} from "./beat-presets";

const FIXTURE_GENRES: string[] = [
  "hip-hop",
  "trap",
  "drill",
  "r&b",
  "afrobeats",
  "pop",
  "edm",
  "lofi",
  "dancehall",
  "jersey-club"
];

const FIXTURE_PRESETS: Record<string, BeatPreset> = {
  "trap": {
    "nameKey": "beatMaker.presetTrap",
    "fallback": "Trap",
    "bpm": 140,
    "grid": [
      [
        1,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        2,
        0,
        0,
        0,
        0,
        0
      ],
      [
        0,
        0,
        0,
        0,
        1,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        1,
        0,
        0,
        0
      ],
      [
        0,
        0,
        0,
        0,
        1,
        0,
        0,
        1,
        0,
        0,
        0,
        0,
        1,
        0,
        0,
        0
      ],
      [
        1,
        0,
        2,
        1,
        0,
        1,
        0,
        1,
        1,
        0,
        1,
        2,
        0,
        1,
        1,
        0
      ],
      [
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        1,
        0
      ],
      [
        1,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        1,
        0,
        0,
        1,
        0,
        0
      ],
      [
        0,
        0,
        1,
        0,
        0,
        0,
        1,
        0,
        0,
        0,
        0,
        0,
        1,
        0,
        0,
        0
      ],
      [
        1,
        0,
        0,
        1,
        0,
        0,
        1,
        0,
        0,
        1,
        0,
        0,
        1,
        0,
        0,
        1
      ],
      [
        1,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0
      ]
    ],
    "bass": [
      36,
      null,
      null,
      null,
      null,
      null,
      36,
      null,
      null,
      null,
      34,
      null,
      32,
      null,
      31,
      null
    ],
    "melody": {
      "keys": [
        {
          "id": "seed-trap-keys-1",
          "pitch": 60,
          "startStep": 0,
          "lengthSteps": 2,
          "velocity": 90
        },
        {
          "id": "seed-trap-keys-2",
          "pitch": 63,
          "startStep": 4,
          "lengthSteps": 2,
          "velocity": 85
        },
        {
          "id": "seed-trap-keys-3",
          "pitch": 65,
          "startStep": 8,
          "lengthSteps": 2,
          "velocity": 90
        },
        {
          "id": "seed-trap-keys-4",
          "pitch": 63,
          "startStep": 12,
          "lengthSteps": 2,
          "velocity": 80
        }
      ],
      "pluck": [
        {
          "id": "seed-trap-pluck-1",
          "pitch": 72,
          "startStep": 2,
          "lengthSteps": 0.5,
          "velocity": 80
        },
        {
          "id": "seed-trap-pluck-2",
          "pitch": 72,
          "startStep": 6,
          "lengthSteps": 0.5,
          "velocity": 80
        },
        {
          "id": "seed-trap-pluck-3",
          "pitch": 70,
          "startStep": 10,
          "lengthSteps": 0.5,
          "velocity": 75
        },
        {
          "id": "seed-trap-pluck-4",
          "pitch": 72,
          "startStep": 14,
          "lengthSteps": 0.5,
          "velocity": 80
        }
      ],
      "pad": []
    }
  },
  "drill": {
    "nameKey": "beatMaker.presetDrill",
    "fallback": "Drill",
    "bpm": 142,
    "grid": [
      [
        1,
        0,
        0,
        1,
        0,
        0,
        1,
        0,
        0,
        1,
        0,
        0,
        1,
        0,
        0,
        0
      ],
      [
        0,
        0,
        0,
        0,
        1,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        1,
        0,
        0,
        2
      ],
      [
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0
      ],
      [
        1,
        1,
        0,
        1,
        0,
        1,
        1,
        0,
        1,
        0,
        1,
        1,
        0,
        1,
        0,
        1
      ],
      [
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0
      ],
      [
        1,
        0,
        0,
        0,
        0,
        0,
        0,
        1,
        0,
        0,
        1,
        0,
        0,
        0,
        0,
        0
      ],
      [
        0,
        0,
        0,
        0,
        1,
        0,
        0,
        0,
        0,
        0,
        0,
        1,
        0,
        0,
        0,
        0
      ],
      [
        0,
        1,
        0,
        1,
        0,
        1,
        0,
        1,
        0,
        1,
        0,
        1,
        0,
        1,
        0,
        1
      ],
      [
        1,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0
      ]
    ],
    "bass": [
      33,
      null,
      null,
      33,
      null,
      null,
      33,
      null,
      31,
      null,
      null,
      29,
      null,
      null,
      null,
      null
    ]
  },
  "boombap": {
    "nameKey": "beatMaker.presetBoomBap",
    "fallback": "Boom Bap",
    "bpm": 92,
    "grid": [
      [
        2,
        0,
        0,
        0,
        0,
        0,
        0,
        1,
        0,
        0,
        1,
        0,
        0,
        0,
        0,
        0
      ],
      [
        0,
        0,
        0,
        0,
        2,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        1,
        0,
        0,
        0
      ],
      [
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0
      ],
      [
        1,
        0,
        1,
        0,
        1,
        0,
        1,
        0,
        1,
        0,
        1,
        0,
        1,
        1,
        0,
        1
      ],
      [
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0
      ],
      [
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0
      ],
      [
        0,
        0,
        1,
        0,
        0,
        1,
        0,
        0,
        1,
        0,
        0,
        0,
        0,
        1,
        0,
        0
      ],
      [
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        1,
        0
      ],
      [
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0
      ]
    ],
    "bass": [
      36,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      43,
      null,
      null,
      null,
      41,
      null,
      null,
      null
    ],
    "melody": {
      "keys": [
        {
          "id": "seed-boombap-keys-1",
          "pitch": 69,
          "startStep": 0,
          "lengthSteps": 1,
          "velocity": 85
        },
        {
          "id": "seed-boombap-keys-2",
          "pitch": 67,
          "startStep": 4,
          "lengthSteps": 1,
          "velocity": 80
        },
        {
          "id": "seed-boombap-keys-3",
          "pitch": 65,
          "startStep": 10,
          "lengthSteps": 1,
          "velocity": 80
        }
      ],
      "pluck": [],
      "pad": [
        {
          "id": "seed-boombap-pad-1",
          "pitch": 57,
          "startStep": 0,
          "lengthSteps": 8,
          "velocity": 70
        },
        {
          "id": "seed-boombap-pad-2",
          "pitch": 53,
          "startStep": 8,
          "lengthSteps": 8,
          "velocity": 70
        }
      ]
    }
  },
  "afrobeats": {
    "nameKey": "beatMaker.presetAfrobeats",
    "fallback": "Afrobeats",
    "bpm": 102,
    "grid": [
      [
        1,
        0,
        0,
        1,
        0,
        0,
        1,
        0,
        0,
        1,
        0,
        0,
        1,
        0,
        0,
        0
      ],
      [
        0,
        0,
        1,
        0,
        0,
        0,
        1,
        0,
        0,
        0,
        0,
        0,
        1,
        0,
        0,
        0
      ],
      [
        0,
        0,
        0,
        0,
        1,
        0,
        0,
        0,
        0,
        0,
        1,
        0,
        0,
        0,
        0,
        0
      ],
      [
        1,
        0,
        1,
        1,
        0,
        1,
        1,
        0,
        1,
        1,
        0,
        1,
        1,
        0,
        1,
        0
      ],
      [
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0
      ],
      [
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0
      ],
      [
        1,
        0,
        0,
        0,
        1,
        0,
        0,
        1,
        0,
        0,
        1,
        0,
        0,
        1,
        0,
        0
      ],
      [
        1,
        1,
        0,
        1,
        1,
        0,
        1,
        1,
        0,
        1,
        1,
        0,
        1,
        1,
        0,
        1
      ],
      [
        1,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0
      ]
    ],
    "bass": [
      36,
      null,
      null,
      null,
      36,
      null,
      null,
      null,
      34,
      null,
      null,
      null,
      32,
      null,
      null,
      null
    ]
  },
  "house": {
    "nameKey": "beatMaker.presetHouse",
    "fallback": "House",
    "bpm": 124,
    "grid": [
      [
        1,
        0,
        0,
        0,
        1,
        0,
        0,
        0,
        1,
        0,
        0,
        0,
        1,
        0,
        0,
        0
      ],
      [
        0,
        0,
        0,
        0,
        1,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        1,
        0,
        0,
        0
      ],
      [
        0,
        0,
        1,
        0,
        0,
        0,
        1,
        0,
        0,
        0,
        1,
        0,
        0,
        0,
        1,
        0
      ],
      [
        0,
        0,
        1,
        0,
        0,
        0,
        1,
        0,
        0,
        0,
        1,
        0,
        0,
        0,
        1,
        0
      ],
      [
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        1,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        1
      ],
      [
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0
      ],
      [
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0
      ],
      [
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0
      ],
      [
        1,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0
      ]
    ],
    "bass": [
      36,
      null,
      null,
      null,
      36,
      null,
      null,
      null,
      36,
      null,
      null,
      null,
      39,
      null,
      38,
      null
    ]
  }
};

const page = readFileSync(
  path.resolve(import.meta.dirname, "../components/audio-studio/AiAudio.tsx"),
  "utf8",
);

describe("beat preset registry — note-for-note the originals", () => {
  it("carries the exact genre list, in order", () => {
    expect([...BEAT_GENRES]).toEqual(FIXTURE_GENRES);
    expect(BEAT_GENRES).toHaveLength(10);
    expect(new Set(BEAT_GENRES).size).toBe(BEAT_GENRES.length);
  });

  it("carries exactly the 5 original presets, in picker order", () => {
    expect(BEAT_PRESET_IDS).toEqual(["trap", "drill", "boombap", "afrobeats", "house"]);
    expect(Object.keys(BEAT_PRESETS)).toEqual(Object.keys(FIXTURE_PRESETS));
  });

  it.each(Object.keys(FIXTURE_PRESETS))(
    "preset %s is deep-equal to the original (grid, bass, melody, bpm, labels)",
    (id) => {
      expect(BEAT_PRESETS[id as keyof typeof BEAT_PRESETS]).toEqual(FIXTURE_PRESETS[id]);
    },
  );

  it("melody presence matches the originals (trap + boombap seeded; the rest none)", () => {
    expect(BEAT_PRESETS.trap.melody).toBeDefined();
    expect(BEAT_PRESETS.boombap.melody).toBeDefined();
    expect(BEAT_PRESETS.drill.melody).toBeUndefined();
    expect(BEAT_PRESETS.afrobeats.melody).toBeUndefined();
    expect(BEAT_PRESETS.house.melody).toBeUndefined();
  });
});

describe("beat preset registry — playback shape invariants", () => {
  it("every grid is 9 drum rows x 16 steps of 0/1/2", () => {
    for (const p of Object.values(BEAT_PRESETS)) {
      expect(p.grid).toHaveLength(9);
      for (const row of p.grid) {
        expect(row).toHaveLength(16);
        for (const v of row) expect([0, 1, 2]).toContain(v);
      }
    }
  });

  it("every bass line is 16 steps of rests or in-range 808 notes (C1..B2)", () => {
    for (const p of Object.values(BEAT_PRESETS)) {
      expect(p.bass).toHaveLength(16);
      for (const n of p.bass) {
        if (n !== null) {
          expect(n).toBeGreaterThanOrEqual(24);
          expect(n).toBeLessThanOrEqual(47);
        }
      }
    }
  });

  it("every melody note is well-formed and note ids are unique registry-wide", () => {
    const ids = new Set<string>();
    for (const p of Object.values(BEAT_PRESETS)) {
      if (!p.melody) continue;
      for (const lane of Object.values(p.melody)) {
        for (const note of lane) {
          expect(ids.has(note.id)).toBe(false);
          ids.add(note.id);
          expect(note.pitch).toBeGreaterThanOrEqual(0);
          expect(note.pitch).toBeLessThanOrEqual(127);
          expect(note.startStep).toBeGreaterThanOrEqual(0);
          expect(note.startStep).toBeLessThan(16);
          expect(note.lengthSteps).toBeGreaterThanOrEqual(0.5);
          expect(note.velocity).toBeGreaterThanOrEqual(1);
          expect(note.velocity).toBeLessThanOrEqual(127);
        }
      }
    }
    expect(ids.size).toBe(13);
  });

  it("labels and tempos are the originals", () => {
    expect(Object.values(BEAT_PRESETS).map((p) => p.nameKey)).toEqual([
      "beatMaker.presetTrap",
      "beatMaker.presetDrill",
      "beatMaker.presetBoomBap",
      "beatMaker.presetAfrobeats",
      "beatMaker.presetHouse",
    ]);
    expect(Object.values(BEAT_PRESETS).map((p) => p.bpm)).toEqual([140, 142, 92, 102, 124]);
    for (const p of Object.values(BEAT_PRESETS)) expect(p.fallback.length).toBeGreaterThan(0);
  });

  it("beatPresetById resolves real ids and no-ops unknown ones", () => {
    expect(beatPresetById("trap")).toBe(BEAT_PRESETS.trap);
    expect(beatPresetById("house")).toBe(BEAT_PRESETS.house);
    expect(beatPresetById("nope")).toBeUndefined();
    expect(beatPresetById("")).toBeUndefined();
  });
});

describe("beat preset registry — the page consumes it, the data left the page", () => {
  it("the page imports the registry", () => {
    expect(page).toContain("from \"@/lib/beat-presets\"");
    expect(page).toContain("BEAT_GENRES");
    expect(page).toContain("BEAT_PRESETS");
  });

  it("the page holds no preset data of its own anymore", () => {
    expect(page).not.toContain("const PRESETS");
    expect(page).not.toContain("const BEAT_GENRES");
    // melody seed ids exist only in the registry now
    expect(page).not.toContain("seed-trap-keys-1");
    expect(page).not.toContain("seed-boombap-pad-1");
    // a signature grid row (trap closed-hat line) must not be re-declared in the page
    expect(page).not.toContain("[1,0,2,1,0,1,0,1,1,0,1,2,0,1,1,0]");
  });

  it("every page consumption site reads the registry", () => {
    // starting pattern A is seeded from the trap preset
    expect(page).toContain("grid: BEAT_PRESETS.trap.grid.map((r) => [...r])");
    expect(page).toContain("melody: cloneBeatMelody(BEAT_PRESETS.trap.melody ?? emptyBeatMelody())");
    // preset loads go through the registry lookup, unknown ids no-op
    expect(page).toContain("const p = beatPresetById(key);");
    // the picker renders the registry in order
    expect(page).toContain("Object.entries(BEAT_PRESETS).map(([key, p])");
    // the AI genre chips render the registry list
    expect(page).toContain("BEAT_GENRES.map((g)");
  });
});
