import { describe, it, expect } from "vitest";
import {
  LOOK_RAIL_KEYS,
  LOOK_RAIL_OPTIONS,
  applicableLookClauses,
  applyLookProposal,
  composeScenePrompt,
  composeSceneSeedPrompt,
  legacySceneBasePrompt,
  suppressedLookPicks,
  type SceneLookInput,
  type SceneLookPicks,
} from "@/lib/scene-look";

/* The pre-rails buildFinalPrompt, reproduced verbatim as the parity oracle. */
function legacyFinalPrompt(scene: SceneLookInput): string {
  return (
    (scene.aiVideoPrompt ?? "").trim() ||
    [scene.action, scene.location, scene.cameraMovement, scene.lighting, scene.mood]
      .filter(Boolean)
      .join(", ") ||
    "cinematic music video scene, dramatic lighting, luxury aesthetic"
  );
}

/* The pre-rails sceneSeedPrompt, reproduced verbatim as the parity oracle. */
function legacySeedPrompt(scene: SceneLookInput): string {
  return (
    (scene.aiVideoPrompt ?? "").trim() ||
    [scene.action, scene.location, scene.cameraMovement, scene.lighting, scene.mood]
      .filter(Boolean)
      .join(", ")
  );
}

const FULL_LOOK: SceneLookPicks = {
  genre: "noir",
  era: "eighties",
  lens: "anamorphic",
  lighting: "goldenHour",
  emotion: "tense",
};

describe("vocabularies — exact key lists (pinned; the server mirror pins the same lists)", () => {
  it("pins every rail's keys", () => {
    expect(LOOK_RAIL_KEYS).toEqual({
      genre: ["drama", "noir", "documentary", "commercial", "horror", "romance", "action", "musicVideo"],
      era: ["contemporary", "seventies", "eighties", "nineties", "period", "futuristic"],
      lens: ["natural35", "portrait50", "tele85", "wide24", "anamorphic", "macro"],
      lighting: ["goldenHour", "neonNight", "softWindow", "hardNoon", "candlelit", "studioThreePoint", "overcast"],
      emotion: ["calm", "tense", "euphoric", "melancholic", "urgent"],
    });
  });

  it("every option carries a label, a phrase, and dedupe tokens", () => {
    for (const options of Object.values(LOOK_RAIL_OPTIONS)) {
      for (const option of options) {
        expect(option.label.length).toBeGreaterThan(0);
        expect(option.phrase.length).toBeGreaterThan(0);
        expect(option.tokens.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("no picks → byte-identical to the pre-rails prompts", () => {
  const scenes: SceneLookInput[] = [
    { aiVideoPrompt: "the artist performs on a rooftop at dusk" },
    { aiVideoPrompt: "  spaced prompt  ", action: "ignored while a prompt exists" },
    { action: "leans on a vintage car", location: "rainy alley", cameraMovement: "slow dolly-in", lighting: "", mood: "brooding" },
    { action: "only action" },
    {},
    { aiVideoPrompt: "", action: "", location: "", cameraMovement: "", lighting: "", mood: "" },
    { aiVideoPrompt: "a paragraph prompt that ends with a period." },
  ];

  it("composeScenePrompt matches the legacy final prompt for every shape", () => {
    for (const scene of scenes) {
      expect(composeScenePrompt(scene)).toBe(legacyFinalPrompt(scene));
      expect(composeScenePrompt({ ...scene, look: {} })).toBe(legacyFinalPrompt(scene));
      expect(composeScenePrompt({ ...scene, look: undefined })).toBe(legacyFinalPrompt(scene));
    }
  });

  it("composeSceneSeedPrompt matches the legacy seed for every shape", () => {
    for (const scene of scenes) {
      expect(composeSceneSeedPrompt(scene)).toBe(legacySeedPrompt(scene));
    }
  });

  it("an unknown pick key from old data is ignored, never woven", () => {
    const scene: SceneLookInput = { aiVideoPrompt: "base prompt", look: { genre: "western" } };
    expect(composeScenePrompt(scene)).toBe("base prompt");
    expect(applicableLookClauses(scene)).toEqual([]);
  });
});

describe("each rail's pick reaches the composed prompt", () => {
  const base: SceneLookInput = { aiVideoPrompt: "the artist performs on a rooftop" };

  it("weaves all five rails in rail order", () => {
    const out = composeScenePrompt({ ...base, look: FULL_LOOK });
    expect(out).toBe(
      "the artist performs on a rooftop, film noir style, 1980s period styling, " +
        "anamorphic lens look with horizontal flare and oval bokeh, " +
        "golden-hour light with warm low sun, tense, suspenseful pacing",
    );
  });

  it("weaves each rail on its own", () => {
    expect(composeScenePrompt({ ...base, look: { genre: "horror" } })).toContain("horror atmosphere");
    expect(composeScenePrompt({ ...base, look: { era: "futuristic" } })).toContain("near-future futuristic styling");
    expect(composeScenePrompt({ ...base, look: { lens: "tele85" } })).toContain("85mm lens look");
    expect(composeScenePrompt({ ...base, look: { lighting: "neonNight" } })).toContain("neon night light");
    expect(composeScenePrompt({ ...base, look: { emotion: "euphoric" } })).toContain("euphoric, joyful energy");
  });

  it("weaves into the fallback-built prompt too (no aiVideoPrompt)", () => {
    const scene: SceneLookInput = {
      action: "walks through the market",
      location: "old town",
      look: { era: "seventies", emotion: "calm" },
    };
    expect(composeScenePrompt(scene)).toBe(
      "walks through the market, old town, 1970s period styling, calm, unhurried pacing",
    );
  });

  it("appends as a new sentence when the base ends with a period", () => {
    const scene: SceneLookInput = {
      aiVideoPrompt: "The artist performs on a rooftop.",
      look: { genre: "noir" },
    };
    expect(composeScenePrompt(scene)).toBe("The artist performs on a rooftop. Film noir style.");
  });

  it("the seed prompt weaves identically", () => {
    const scene: SceneLookInput = { ...base, look: FULL_LOOK };
    expect(composeSceneSeedPrompt(scene)).toBe(composeScenePrompt(scene));
  });
});

describe("free-text precedence — the creator's words win", () => {
  it("a written Lighting field suppresses the lighting pick but keeps the text", () => {
    const scene: SceneLookInput = {
      aiVideoPrompt: "the artist performs on a rooftop",
      lighting: "harsh fluorescent green",
      look: { lighting: "goldenHour", genre: "noir" },
    };
    const out = composeScenePrompt(scene);
    expect(out).not.toContain("golden-hour");
    expect(out).toContain("film noir style"); // other rails still weave
    expect(suppressedLookPicks(scene)).toEqual([
      { rail: "lighting", key: "goldenHour", reason: "free-text" },
    ]);
  });

  it("a written Mood field suppresses the emotion pick", () => {
    const scene: SceneLookInput = {
      action: "stares out the train window",
      mood: "quietly hopeful",
      look: { emotion: "melancholic", lens: "portrait50" },
    };
    const out = composeScenePrompt(scene);
    expect(out).not.toContain("melancholic");
    expect(out).toContain("quietly hopeful"); // the free text rides the fallback base
    expect(out).toContain("50mm portrait lens look");
    expect(suppressedLookPicks(scene)).toEqual([
      { rail: "emotion", key: "melancholic", reason: "free-text" },
    ]);
  });

  it("with every pick suppressed the prompt is byte-identical to legacy", () => {
    const scene: SceneLookInput = {
      aiVideoPrompt: "neon-soaked street at night",
      lighting: "practical neon signs",
      mood: "tense stand-off energy",
      look: { lighting: "goldenHour", emotion: "calm" },
    };
    expect(composeScenePrompt(scene)).toBe(legacyFinalPrompt(scene));
  });
});

describe("conservative dedupe — never garble a prompt that already says it", () => {
  it("skips a pick whose signature is already in the prompt", () => {
    const scene: SceneLookInput = {
      aiVideoPrompt: "shot at golden hour on a quiet beach",
      look: { lighting: "goldenHour" },
    };
    const out = composeScenePrompt(scene);
    expect(out).toBe("shot at golden hour on a quiet beach");
    expect(out.match(/golden hour/gi)).toHaveLength(1);
    expect(suppressedLookPicks(scene)).toEqual([
      { rail: "lighting", key: "goldenHour", reason: "already-in-prompt" },
    ]);
  });

  it("does not false-positive on substrings (dramatic ≠ drama pick)", () => {
    const scene: SceneLookInput = {
      aiVideoPrompt: "a dramatic entrance down the staircase",
      look: { genre: "drama" },
    };
    expect(composeScenePrompt(scene)).toContain("cinematic drama tone");
  });
});

describe("applyLookProposal — the AI Director acceptance gate", () => {
  const proposal: SceneLookPicks = { ...FULL_LOOK };

  it("applies only the rails the creator accepted", () => {
    const next = applyLookProposal({ genre: "drama" }, proposal, ["lens", "emotion"]);
    expect(next).toEqual({ genre: "drama", lens: "anamorphic", emotion: "tense" });
  });

  it("accepting nothing changes nothing", () => {
    const current: SceneLookPicks = { genre: "drama", era: "nineties" };
    expect(applyLookProposal(current, proposal, [])).toEqual(current);
  });

  it("accept-all replaces every rail from the proposal", () => {
    const next = applyLookProposal({ genre: "drama" }, proposal, ["genre", "era", "lens", "lighting", "emotion"]);
    expect(next).toEqual(proposal);
  });

  it("never mutates the current picks and drops invalid proposal keys", () => {
    const current: SceneLookPicks = { genre: "drama" };
    const next = applyLookProposal(current, { genre: "western", lens: "tele85" }, ["genre", "lens"]);
    expect(next).toEqual({ genre: "drama", lens: "tele85" });
    expect(current).toEqual({ genre: "drama" });
  });
});

describe("legacySceneBasePrompt", () => {
  it("is the untouched pre-rails formula", () => {
    expect(legacySceneBasePrompt({ aiVideoPrompt: " x " })).toBe("x");
    expect(
      legacySceneBasePrompt({ action: "a", location: "b", cameraMovement: "", lighting: "c", mood: "" }),
    ).toBe("a, b, c");
    expect(legacySceneBasePrompt({})).toBe("");
  });
});
