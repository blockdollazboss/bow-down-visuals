/**
 * Unified cross-platform live chat (Round-2 #12) — the pins:
 *  - the config gate fails closed at every step (flag off, credential
 *    missing) and even fully configured external ingestion stays OFF
 *    until a real transport exists — no fake messages, ever;
 *  - the merge admits only messages from ingesting adapters whose
 *    source tag matches, deduped per source, time-ordered;
 *  - presence never invents an external headcount: external viewers
 *    are null (unknown), totals cover known sources only.
 */
import { describe, it, expect } from "vitest";
import {
  GatedExternalChatAdapter,
  SiteUnifiedChatAdapter,
  createUnifiedChatRegistry,
  evaluateSourceGate,
  mergeUnifiedFeed,
  unifiedPresence,
  unifiedSourceStates,
  type UnifiedChatAdapter,
  type UnifiedChatMessage,
} from "../unified-live-chat";

const STREAM = "22222222-2222-4222-8222-222222222222";

function msg(id: string, source: UnifiedChatMessage["source"], at: string, externalId: string | null = null): UnifiedChatMessage {
  return {
    id,
    streamId: STREAM,
    source,
    externalId,
    userId: "user-1",
    authorName: "Fan",
    authorAvatarUrl: null,
    body: `hello ${id}`,
    kind: "chat",
    tipAmountVb: null,
    createdAt: at,
  };
}

describe("config gate — fail closed", () => {
  it("flag off → not configured, cannot ingest", () => {
    const gate = evaluateSourceGate("twitch", {});
    expect(gate.configured).toBe(false);
    expect(gate.canIngest).toBe(false);
    expect(gate.reason).toContain("LIVE_CHAT_INGEST_TWITCH");
  });

  it("flag on but credential missing → still off, reason names the credential", () => {
    const gate = evaluateSourceGate("youtube", { LIVE_CHAT_INGEST_YOUTUBE: "1" });
    expect(gate.configured).toBe(false);
    expect(gate.canIngest).toBe(false);
    expect(gate.reason).toContain("YOUTUBE_CHAT_OAUTH_TOKEN");
  });

  it("flag + credential → configured, but ingestion STILL off (no transport, no fake messages)", () => {
    const gate = evaluateSourceGate("twitch", {
      LIVE_CHAT_INGEST_TWITCH: "true",
      TWITCH_CHAT_OAUTH_TOKEN: "oauth:example",
    });
    expect(gate.configured).toBe(true);
    expect(gate.canIngest).toBe(false);
    expect(gate.reason).toContain("no Twitch chat transport");
  });

  it("the gated adapter can never produce a message in any configuration", () => {
    for (const env of [{}, { LIVE_CHAT_INGEST_TWITCH: "1" }, { LIVE_CHAT_INGEST_TWITCH: "1", TWITCH_CHAT_OAUTH_TOKEN: "x" }]) {
      const adapter = new GatedExternalChatAdapter("twitch", env);
      expect(adapter.canIngest).toBe(false);
      expect(adapter.collect()).toEqual([]);
    }
  });
});

describe("merge — one feed, guarded", () => {
  it("site messages flow through tagged, deduped, time-ordered", () => {
    const site = new SiteUnifiedChatAdapter(() => [
      msg("b", "site", "2026-01-01T00:02:00.000Z"),
      msg("a", "site", "2026-01-01T00:01:00.000Z"),
      msg("a", "site", "2026-01-01T00:01:00.000Z"),
    ]);
    const feed = mergeUnifiedFeed([site]);
    expect(feed.map((m) => m.id)).toEqual(["a", "b"]);
    expect(feed.every((m) => m.source === "site")).toBe(true);
  });

  it("a rogue adapter that cannot ingest contributes nothing, even if it returns fabricated messages", () => {
    const rogue: UnifiedChatAdapter = {
      source: "twitch",
      canIngest: false,
      collect: () => [msg("fake-1", "twitch", "2026-01-01T00:01:00.000Z", "ext-1")],
    };
    expect(mergeUnifiedFeed([rogue])).toEqual([]);
  });

  it("a message whose source tag doesn't match its adapter is refused", () => {
    const liar: UnifiedChatAdapter = {
      source: "site",
      canIngest: true,
      collect: () => [msg("x", "youtube", "2026-01-01T00:01:00.000Z")],
    };
    expect(mergeUnifiedFeed([liar])).toEqual([]);
  });

  it("the default registry is site + gated twitch + gated youtube, and its feed is the site's alone", () => {
    const registry = createUnifiedChatRegistry(() => [msg("s1", "site", "2026-01-01T00:00:00.000Z")], {});
    expect(registry.map((a) => a.source)).toEqual(["site", "twitch", "youtube"]);
    expect(mergeUnifiedFeed(registry).map((m) => m.id)).toEqual(["s1"]);
  });
});

describe("source states + presence — truthful", () => {
  it("external states never claim live ingestion, whatever the env", () => {
    const states = unifiedSourceStates({
      streamStatus: "live",
      env: { LIVE_CHAT_INGEST_TWITCH: "1", TWITCH_CHAT_OAUTH_TOKEN: "x" },
    });
    expect(states[0]).toMatchObject({ source: "site", ingestionLive: true });
    for (const s of states.slice(1)) expect(s.ingestionLive).toBe(false);
  });

  it("presence: external viewers are unknown (null), total covers site only", () => {
    const p = unifiedPresence({ siteViewers: 7 });
    expect(p.perSource).toEqual([
      { source: "site", viewers: 7 },
      { source: "twitch", viewers: null },
      { source: "youtube", viewers: null },
    ]);
    expect(p.totalKnown).toBe(7);
    expect(p.knownSources).toEqual(["site"]);
  });

  it("presence clamps nonsense site counts to a real floor of 0", () => {
    expect(unifiedPresence({ siteViewers: -3 }).totalKnown).toBe(0);
  });
});
