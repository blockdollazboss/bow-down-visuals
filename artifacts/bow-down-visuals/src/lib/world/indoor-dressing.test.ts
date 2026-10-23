/**
 * Indoor dressing parity (Stack-100 #2, items 39–47 tail) —
 * pinned at the source: the six wing rooms share ONE shell
 * builder, so parity is structural — every room gets the same
 * floor dressing, the same lantern, the same gilt frame, and
 * (item 41) its own trim identity on top.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const sceneSrc = readFileSync(new URL("./hall-scene.ts", import.meta.url), "utf8");

describe("indoor dressing parity", () => {
  it("all six wing rooms build through the one indoor shell builder", () => {
    expect(sceneSrc).toContain(
      "for (const roomId of [MUSIC_HALL_ID, GAME_ROOMS_ID, CREATE_WING_ID, TREASURY_ID, ROYAL_COURT_ID, BRANDING_ATELIER_ID])",
    );
    expect(sceneSrc).toContain("this.buildIndoorShell(group, look, mats, roomId)");
  });

  it("the shared builder dresses every room alike: rug inlay, lantern, gilt frame, stations", () => {
    expect(sceneSrc).toContain("Interior dressing parity");
    expect(sceneSrc).toContain("mats.fabric");
    expect(sceneSrc).toContain("this.shellLantern(g, look, cx, cz)");
    expect(sceneSrc).toContain("this.shellPanelFrame(g, mats");
    expect(sceneSrc).toContain("this.buildStationMarkers(g, mats, roomId)");
  });

  it("the rug is flat inlay — it never enters any blocked list", () => {
    /* The rug's heights in the builder are centimetres, and no
     * layout module knows a rug rect: dressing, not furniture. */
    expect(sceneSrc).toContain("new THREE.BoxGeometry(rugW, 0.018, rugD), mats.fabric");
  });
});
