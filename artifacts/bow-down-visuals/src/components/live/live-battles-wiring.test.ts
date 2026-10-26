/**
 * live-battles-wiring.test.ts — Stack-200 #154 docking contract.
 *
 * Live Battles must live INSIDE the existing live surfaces, never
 * as a standalone page/route:
 * - the watch page mounts the panel with the stream's id;
 * - the Go Live hub's broadcast tab mounts it for creators
 *   (challenge form + my battles);
 * - the Charts page carries ONLY the crown strip (the crown slot);
 * - App.tsx gains NO battle route;
 * - the panel itself rides the lib contract (paths/helpers/copy),
 *   says the recorded-votes + no-money rules, and is designed in
 *   both themes.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const panel = readFileSync(new URL("./LiveBattlesPanel.tsx", import.meta.url), "utf8");
const watch = readFileSync(new URL("../../pages/live-watch.tsx", import.meta.url), "utf8");
const goLive = readFileSync(new URL("../../pages/go-live.tsx", import.meta.url), "utf8");
const charts = readFileSync(new URL("../../pages/discovery/charts.tsx", import.meta.url), "utf8");
const app = readFileSync(new URL("../../App.tsx", import.meta.url), "utf8");

describe("docking — existing surfaces only", () => {
  it("the watch page mounts the panel for the stream being watched", () => {
    expect(watch).toContain('import LiveBattlesPanel from "@/components/live/LiveBattlesPanel"');
    expect(watch).toContain("<LiveBattlesPanel streamId={stream.id} />");
  });
  it("the Go Live broadcast tab mounts the creator panel (challenge + mine)", () => {
    expect(goLive).toContain("<LiveBattlesPanel showMine />");
    expect(goLive).toContain("GuestPanel");
  });
  it("Charts carries the crown slot and no battle page exists in App routes", () => {
    expect(charts).toContain("<LiveBattleCrownStrip />");
    expect(app).not.toMatch(/path="\/[^"]*battle/i);
    expect(app).not.toContain("LiveBattlesPanel");
  });
});

describe("the panel rides the lib contract", () => {
  it("uses the lib paths, helpers and pinned copy — no hand-rolled endpoints", () => {
    expect(panel).toContain("liveBattleActionPath");
    expect(panel).toContain("liveBattleByStreamPath");
    expect(panel).toContain("LIVE_BATTLES_CROWN_PATH");
    expect(panel).toContain("LIVE_BATTLE_COPY");
    expect(panel).toContain("voteEligibility");
    expect(panel).toContain("battleViewerActions");
    expect(panel).not.toContain("/api/live-battles/");
  });
  it("renders the live tally, the winner/crown state and both vote doors", () => {
    expect(panel).toContain('data-testid="battle-tally"');
    expect(panel).toContain('data-testid="battle-winner"');
    expect(panel).toContain('data-testid="live-battle-crown"');
    expect(panel).toContain("btn-vote-");
    expect(panel).toContain("tallyShare");
  });
  it("is designed in BOTH themes (light + dark branches)", () => {
    expect(panel).toContain("useIsLightTheme");
    expect(panel).toContain("isLight");
    expect(panel).toContain("#F7ECD2");
    expect(panel).toContain("bg-white/[0.03]");
  });
  it("carries no price, charge or payout UI", () => {
    const lower = panel.toLowerCase();
    expect(lower).not.toContain("checkout");
    expect(lower).not.toContain("buy vote");
    expect(lower).not.toContain("prize money");
  });
});
