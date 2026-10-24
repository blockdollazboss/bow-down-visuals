/**
 * group-detail-tier-gate.test.ts — source pins for tier-gated
 * channels on the group page (Stack-100 #3, #19):
 *  (a) the gate lives INSIDE the forum tab of group-detail — the
 *      channel create form and a per-channel "Room access" setting;
 *      no standalone page or route;
 *  (b) the gate choices come from the SERVER (gate_options on the
 *      channels payload), and setting/clearing rides the channel
 *      PATCH with min_fan_tier_id (id = set, null = clear);
 *  (c) a locked channel renders the KNOCK DOOR — room name, the
 *      server's message, the history-preservation note, and the
 *      existing fan-club join door (join_url from the knock) with
 *      copy that matches the viewer's state (join / upgrade /
 *      rejoin) — never a bare error;
 *  (d) the shared api helper carries the structured refusal payload
 *      (err.data) so a gated thread read can become the knock too.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync(new URL("./group-detail.tsx", import.meta.url), "utf8");
const ui = readFileSync(new URL("../lib/community-ui.tsx", import.meta.url), "utf8");

describe("tier gate — docked in the forum tab, no standalone page", () => {
  it("the create-channel form carries the gate choice, fed by server gate_options", () => {
    expect(page).toContain("gate_options");
    expect(page).toContain("setGateOptions(d.gate_options ?? [])");
    expect(page).toContain("Members only: {t.name} &amp; up");
    expect(page).toContain("...(channelGateTier ? { min_fan_tier_id: channelGateTier } : {})");
  });

  it("the Room access strip sets and clears the gate through the channel PATCH", () => {
    expect(page).toContain("Room access");
    expect(page).toContain("api.patch(`/api/groups/${slug}/forum/channels/${channelId}`, {");
    expect(page).toContain("min_fan_tier_id: tierId === \"\" ? null : tierId");
    expect(page).toContain("Everyone the group admits");
  });

  it("managers without fan tiers are pointed at the existing Memberships page, not a new surface", () => {
    expect(page).toContain('href="/memberships"');
    expect(page).toContain("to gate this room");
  });
});

describe("tier gate — the knock door", () => {
  it("a locked channel shows its knock instead of loading threads", () => {
    expect(page).toContain("c.gate && !c.gate.viewer_has_access && c.gate.knock");
    expect(page).toContain('data-testid="tier-gate-knock"');
    expect(page).toContain("{knock.message}");
    expect(page).toContain("{knock.history_note}");
  });

  it("the knock's action is the existing join door, worded by viewer state", () => {
    expect(page).toContain("href={knock.join_url}");
    expect(page).toContain('"Rejoin the fan club"');
    expect(page).toContain('"Upgrade your membership"');
    expect(page).toContain('"Join the fan club"');
  });

  it("channel rows badge the gate and say when it is locked for this viewer", () => {
    expect(page).toContain("`${c.gate.tier_name} & up`");
    expect(page).toContain("locked for you");
  });

  it("a gated refusal on a thread read becomes the knock, via err.data on the shared helper", () => {
    expect(page).toContain("knockFromError");
    expect(page).toContain("data?.tier_gate");
    expect(ui).toContain("err.data = data");
  });
});
