/**
 * ObjectiveStrip — honest load states (Stack-400 C-28 components
 * residual, deep-pins tranche 1). The World shell's objective strip
 * runs three signed-in loads (quests, streak, daily trio) plus the
 * public palace slate, and its contract is PER-SLOT ISOLATION: each
 * slot owns its failure, and no slot's failure can blank the strip
 * or dress up as that slot's empty state.
 *
 * - Quests and streak each carry their own failed flag: a non-ok
 *   response OR an unparseable payload sets it; a well-shaped
 *   success clears it; a thrown load sets both. Each failed slot
 *   renders its own failure line ("Your quests wouldn't answer —
 *   the Treasury board holds them.") and each unloaded slot its
 *   own reading line — the genuine states (all-done, switched-off,
 *   none-on-slate) are reachable only behind a successful,
 *   well-shaped load.
 * - The daily trio is an enhancement BY DESIGN: its failure leaves
 *   it null and the weekly quest pick stands alone, exactly as
 *   before the trio existed.
 * - The public palace slate fails silently BY DESIGN: the in-app
 *   directory slate still speaks for the palace.
 *
 * Copy is literal on this World surface. The FE suite runs in node
 * (no DOM), so these tests pin the machines in source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const strip = read("./ObjectiveStrip.tsx");

describe("each slot owns its failure — per-slot failed flags", () => {
  it("quests and streak each start unloaded with their own failed flag down", () => {
    expect(strip).toContain("const [questsFailed, setQuestsFailed] = useState(false);");
    expect(strip).toContain("const [streakFailed, setStreakFailed] = useState(false);");
  });

  it("a non-ok or unparseable quests response sets the quests flag; a shaped success clears it", () => {
    expect(strip).toContain("if (qRes.ok) {");
    expect(strip).toContain("setQuestsFailed(false);");
    expect(strip).toContain("} else setQuestsFailed(true);");
  });

  it("a non-ok or unparseable streak response sets the streak flag the same way", () => {
    expect(strip).toContain("if (sRes.ok) {");
    expect(strip).toContain("setStreakFailed(false);");
    expect(strip).toContain("} else setStreakFailed(true);");
  });

  it("a thrown load fails both signed-in slots, never silently", () => {
    expect(strip).toContain("setQuestsFailed(true);\n          setStreakFailed(true);");
  });
});

describe("render: failure line, then reading line, then the genuine states", () => {
  it("the quest slot renders failure before its loading line", () => {
    const failIdx = strip.indexOf("Your quests wouldn&rsquo;t answer — the Treasury board holds them.");
    const loadIdx = strip.indexOf("Reading your quests…");
    expect(failIdx).toBeGreaterThan(-1);
    expect(loadIdx).toBeGreaterThan(failIdx);
  });

  it("the streak slot renders failure before its loading line", () => {
    const failIdx = strip.indexOf("Your streak wouldn&rsquo;t answer — the Treasury board holds it.");
    const loadIdx = strip.indexOf("Reading your streak…");
    expect(failIdx).toBeGreaterThan(-1);
    expect(loadIdx).toBeGreaterThan(failIdx);
  });

  it("the genuine quest states exist behind the loaded data", () => {
    expect(strip).toContain("All of this week&rsquo;s quests are done — the next slate lands Monday.");
    expect(strip).toContain("No quests on this week&rsquo;s slate.");
  });
});

describe("the enhancement loads fail soft, by documented design", () => {
  it("a failed daily-trio read leaves the weekly pick standing alone", () => {
    expect(strip).toContain("A\n   * failed trio read never breaks the slot — the weekly pick");
    expect(strip).toContain("if (dRes.ok) {");
  });

  it("a failed palace slate read leaves the directory slate speaking", () => {
    expect(strip).toContain("/* The directory slate below still speaks for the palace. */");
  });
});
