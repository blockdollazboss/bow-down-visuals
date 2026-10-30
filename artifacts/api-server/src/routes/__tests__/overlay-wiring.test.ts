/**
 * Stream overlay → emit wiring pins (stack900 lane C2).
 * The behavioral halves are proven in stream-overlays.test.ts (the
 * hub delivers over a real socket; state reads the real rows). These
 * pins keep the composition from silently unwiring: each real event
 * point that already feeds the bell / chat alert must ALSO feed the
 * overlay hub, at the same gate, so an OBS overlay can never drift
 * from what the site itself showed.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const read = (...parts: string[]) => readFileSync(join(here, ...parts), "utf8");

const liveTipsSrc = read("..", "live-tips.ts");
const creatorPlatformSrc = read("..", "creator-platform.ts");
const membershipsSrc = read("..", "generate", "memberships.ts");
const worldStageTipsSrc = read("..", "..", "lib", "world-stage-tips.ts");
const liveWidgetsSrc = read("..", "live-widgets.ts");
const indexSrc = read("..", "..", "index.ts");
const routesIndexSrc = read("..", "index.ts");

describe("stream overlay emit wiring", () => {
  it("a landed live tip alerts the overlay with the same words as the chat alert", () => {
    expect(liveTipsSrc).toContain('import { emitOverlayAlert } from "../lib/overlay-events";');
    const chatAlertAt = liveTipsSrc.indexOf('liveChatHub.broadcast(stream.id, {\n        type: "alert",');
    const overlayAt = liveTipsSrc.indexOf('emitOverlayAlert(stream.user_id, {', chatAlertAt);
    expect(chatAlertAt).toBeGreaterThan(-1);
    expect(overlayAt).toBeGreaterThan(chatAlertAt);
    expect(liveTipsSrc).toContain('kind: "tip",');
  });

  it("a new follow alerts the overlay beside the webhook, new follows only", () => {
    expect(creatorPlatformSrc).toContain('import { emitOverlayAlert } from "../lib/overlay-events";');
    const gateAt = creatorPlatformSrc.indexOf("if (isNewFollow) {");
    const overlayAt = creatorPlatformSrc.indexOf("emitOverlayAlert(profile.userId, {", gateAt);
    expect(gateAt).toBeGreaterThan(-1);
    expect(overlayAt).toBeGreaterThan(gateAt);
  });

  it("every brand-new-member webhook site also fires the overlay member alert", () => {
    expect(membershipsSrc).toContain('import { emitOverlayMemberAlert } from "../../lib/overlay-events";');
    const webhooks = membershipsSrc.split("emitNewMemberWebhook(tier.user_id, {").length - 1;
    const overlays = membershipsSrc.split("emitOverlayMemberAlert(tier.user_id,").length - 1;
    expect(webhooks).toBe(3);
    expect(overlays).toBe(webhooks);
  });

  it("a landed World stage tip alerts the performer overlay under the credit gate", () => {
    expect(worldStageTipsSrc).toContain('import { emitOverlayAlert } from "./overlay-events";');
    const gateAt = worldStageTipsSrc.indexOf("if (creditLanded && fromUserId !== toUserId) {");
    const overlayAt = worldStageTipsSrc.indexOf("emitOverlayAlert(toUserId, {", gateAt);
    expect(gateAt).toBeGreaterThan(-1);
    expect(overlayAt).toBeGreaterThan(gateAt);
  });

  it("a tip-goal edit nudges open goal overlays to refetch", () => {
    expect(liveWidgetsSrc).toContain('import { emitOverlayRefresh } from "../lib/overlay-events";');
    expect(liveWidgetsSrc).toContain("emitOverlayRefresh(stream.user_id);");
  });

  it("the desk/state router is mounted and the socket is registered", () => {
    expect(routesIndexSrc).toContain("router.use(streamOverlaysRouter);");
    expect(indexSrc).toContain("registerOverlayWs(wsGateway);");
  });
});
