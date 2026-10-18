/**
 * Stage tips — client words (lib/world/stage-tip) + wiring pins.
 *
 * The transfer is server truth; this module only phrases it.
 * Pinned: the presets sit inside the house bounds (100–1,000,000
 * VB, the server's lib/live-config constants); the witnessed line
 * carries the server's names + amount verbatim; every refusal
 * reads in the tipper's words — an unknown reason gets the generic
 * line, never the raw token, and the insufficient line promises
 * the truth the server keeps: the balance hasn't changed.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  STAGE_TIP_PRESETS,
  stageTippedLine,
  stageTipDeniedLine,
} from "./stage-tip";

describe("the seat control's words", () => {
  it("the presets sit inside the house tip bounds", () => {
    expect(STAGE_TIP_PRESETS.length).toBeGreaterThan(0);
    for (const amount of STAGE_TIP_PRESETS) {
      expect(amount).toBeGreaterThanOrEqual(100);
      expect(amount).toBeLessThanOrEqual(1_000_000);
      expect(Number.isInteger(amount)).toBe(true);
    }
  });

  it("the witnessed line carries the server's names + amount", () => {
    expect(stageTippedLine({ name: "Fan", performerName: "Star", amountVb: 1000 })).toBe(
      "Fan tipped Star 1,000 VB from the seats.",
    );
  });

  it("every refusal reads in plain words; unknown reasons get the generic line", () => {
    for (const reason of [
      "guests",
      "no-stage",
      "self",
      "amount",
      "too-fast",
      "insufficient",
      "disabled",
      "error",
    ]) {
      const line = stageTipDeniedLine(reason);
      expect(line.length).toBeGreaterThan(10);
      expect(line).not.toBe(reason);
    }
    expect(stageTipDeniedLine("insufficient")).toContain("balance hasn't changed");
    expect(stageTipDeniedLine("self")).toContain("your stage");
    expect(stageTipDeniedLine("amount")).toContain("100 to 1,000,000");
    expect(stageTipDeniedLine("weird-token")).toContain("didn't land");
  });
});

describe("wiring pins", () => {
  const page = readFileSync(resolve(__dirname, "../../pages/world.tsx"), "utf8");
  const client = readFileSync(resolve(__dirname, "./world-client.ts"), "utf8");

  it("the page renders the tip bar with a control per preset and wires both handlers", () => {
    expect(page).toContain('data-testid="world-stage-tip-bar"');
    expect(page).toContain("world-stage-tip-${amount}");
    expect(page).toContain("client.onStageTipped");
    expect(page).toContain("client.onStageTipDenied");
    expect(page).toContain("tipStage(amount)");
  });

  it("the client parses stage.tipped / stage.tip.denied and sends stage.tip for members only", () => {
    expect(client).toContain('case "stage.tipped"');
    expect(client).toContain('case "stage.tip.denied"');
    expect(client).toContain('this.send({ type: "stage.tip", amountVb })');
  });
});
