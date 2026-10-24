/**
 * Merged live chat (feature #12 shell) — the seam layer's pins:
 *
 *   - the registry is the site's own chat (live) + inert Twitch /
 *     YouTube seams, in display order;
 *   - the site's own messages flow through the merge tagged as site
 *     chat, in time order, deduped — the existing chat, unregressed;
 *   - NO FAKE MESSAGES: inert adapters can produce nothing, and the
 *     merge itself refuses messages from any adapter that cannot
 *     ingest or whose source tag doesn't match its adapter;
 *   - external connection states are honest derivations of the
 *     existing platform-connection state (connected accounts +
 *     multistream destinations) and can never read "live";
 *   - sending targets the site's own chat only.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  InertExternalChatAdapter,
  SiteChatAdapter,
  collectMergedMessages,
  collectSourceStates,
  createChatSourceRegistry,
  externalSourceStates,
  sendableSources,
  siteSourceState,
  sourceBadge,
  SEND_TARGET_NOTE,
  type ChatSourceAdapter,
  type MergedChatMessage,
} from "./merged-live-chat";
import type { ChatMessage } from "./live-chat-client";

const STREAM = "22222222-2222-4222-8222-222222222222";

function siteMsg(id: string, body: string, at: string): ChatMessage {
  return {
    id,
    streamId: STREAM,
    userId: "user-1",
    body,
    createdAt: at,
    author: { displayName: "Fan", avatarUrl: null, slug: null },
  };
}

/** A rogue adapter that CLAIMS a source and returns a fabricated
 *  message — the merge must refuse it when it cannot ingest. */
function rogueAdapter(source: "twitch" | "youtube", canIngest: boolean): ChatSourceAdapter {
  return {
    source,
    canIngest,
    canSend: false,
    collect: (): MergedChatMessage[] => [
      { ...siteMsg(`fake-${source}`, "simulated hello", "2026-01-01T00:01:00.000Z"), source },
    ],
  };
}

describe("adapter registry", () => {
  it("registers site (live) then the inert twitch + youtube seams", () => {
    const registry = createChatSourceRegistry(() => []);
    expect(registry.map((a) => a.source)).toEqual(["site", "twitch", "youtube"]);
    expect(registry[0]!.canIngest).toBe(true);
    expect(registry[0]!.canSend).toBe(true);
    for (const external of registry.slice(1)) {
      expect(external.canIngest).toBe(false);
      expect(external.canSend).toBe(false);
    }
  });

  it("sending targets the site's own chat only — never a cross-post", () => {
    const registry = createChatSourceRegistry(() => []);
    expect(sendableSources(registry)).toEqual(["site"]);
    expect(SEND_TARGET_NOTE).toContain("Bow Down chat only");
  });

  it("badges name each source plainly", () => {
    expect(sourceBadge("site").label).toBe("Bow Down");
    expect(sourceBadge("twitch").label).toBe("Twitch");
    expect(sourceBadge("youtube").label).toBe("YouTube");
  });
});

describe("the site's own chat through the merge", () => {
  it("flows through tagged as site chat, time-ordered and deduped", () => {
    const store = [
      siteMsg("m2", "second", "2026-01-01T00:02:00.000Z"),
      siteMsg("m1", "first", "2026-01-01T00:01:00.000Z"),
      siteMsg("m1", "first", "2026-01-01T00:01:00.000Z"),
    ];
    const merged = collectMergedMessages(createChatSourceRegistry(() => store));
    expect(merged.map((m) => m.id)).toEqual(["m1", "m2"]);
    expect(merged.every((m) => m.source === "site")).toBe(true);
    expect(merged[0]!.body).toBe("first");
  });

  it("the site adapter reads the live store — later messages appear", () => {
    const store: ChatMessage[] = [siteMsg("m1", "first", "2026-01-01T00:01:00.000Z")];
    const adapter = new SiteChatAdapter(() => store);
    expect(adapter.collect()).toHaveLength(1);
    store.push(siteMsg("m2", "second", "2026-01-01T00:02:00.000Z"));
    expect(adapter.collect().map((m) => m.id)).toEqual(["m1", "m2"]);
  });
});

describe("no fake messages — the seam cannot fabricate external chat", () => {
  it("inert adapters collect nothing, ever", () => {
    for (const source of ["twitch", "youtube"] as const) {
      const adapter = new InertExternalChatAdapter(source);
      expect(adapter.collect()).toEqual([]);
      expect(adapter.collect()).toEqual([]);
    }
  });

  it("the merge drops messages from an adapter that cannot ingest", () => {
    const registry = [
      new SiteChatAdapter(() => [siteMsg("m1", "real", "2026-01-01T00:01:00.000Z")]),
      rogueAdapter("twitch", false),
      rogueAdapter("youtube", false),
    ];
    const merged = collectMergedMessages(registry);
    expect(merged.map((m) => m.id)).toEqual(["m1"]);
    expect(merged.some((m) => m.body === "simulated hello")).toBe(false);
  });

  it("the merge drops messages whose source tag doesn't match their adapter", () => {
    const lyingSite: ChatSourceAdapter = {
      source: "site",
      canIngest: true,
      canSend: true,
      collect: (): MergedChatMessage[] => [
        { ...siteMsg("fake-1", "tagged twitch, from the site slot", "2026-01-01T00:01:00.000Z"), source: "twitch" },
      ],
    };
    expect(collectMergedMessages([lyingSite])).toEqual([]);
  });

  it("a registry merge with an empty site store is empty — no filler appears", () => {
    expect(collectMergedMessages(createChatSourceRegistry(() => []))).toEqual([]);
  });
});

describe("honest external connection states", () => {
  it("nothing connected → not_connected, ingestion never live", () => {
    const states = externalSourceStates({ accounts: [], destinations: [] });
    expect(states.map((s) => s.source)).toEqual(["twitch", "youtube"]);
    for (const s of states) {
      expect(s.kind).toBe("not_connected");
      expect(s.ingestionLive).toBe(false);
      expect(s.note).toContain("Bow Down only");
    }
  });

  it("a saved stream key is destination_only — video out, chat never claimed in", () => {
    const states = externalSourceStates({
      accounts: [],
      destinations: [{ platform: "twitch" }, { platform: "youtube" }],
    });
    for (const s of states) {
      expect(s.kind).toBe("destination_only");
      expect(s.ingestionLive).toBe(false);
      expect(s.note).toContain("doesn't come back in");
    }
  });

  it("a connected account is account_connected — still no message flow", () => {
    const states = externalSourceStates({
      accounts: [{ platform: "youtube", expired: false }],
      destinations: [{ platform: "youtube" }],
    });
    const yt = states.find((s) => s.source === "youtube")!;
    expect(yt.kind).toBe("account_connected");
    expect(yt.ingestionLive).toBe(false);
    expect(yt.note).toContain("no YouTube messages flow yet");
    const tw = states.find((s) => s.source === "twitch")!;
    expect(tw.kind).toBe("not_connected");
  });

  it("an expired account does not count as connected", () => {
    const states = externalSourceStates({
      accounts: [{ platform: "twitch", expired: true }],
      destinations: [],
    });
    expect(states.find((s) => s.source === "twitch")!.kind).toBe("not_connected");
  });

  it("a failed connection read claims nothing either way", () => {
    const states = externalSourceStates({ accounts: null, destinations: null, loadFailed: true });
    for (const s of states) {
      expect(s.kind).toBe("check_failed");
      expect(s.ingestionLive).toBe(false);
    }
  });

  it("unrelated platforms (instagram/tiktok/facebook) never light a seam", () => {
    const states = externalSourceStates({
      accounts: [
        { platform: "instagram", expired: false },
        { platform: "tiktok", expired: false },
        { platform: "facebook", expired: false },
      ],
      destinations: [{ platform: "facebook" }, { platform: "kick" }],
    });
    expect(states.every((s) => s.kind === "not_connected")).toBe(true);
  });
});

describe("source states for the panel strip", () => {
  it("site first: live while the stream is live, idle otherwise", () => {
    expect(siteSourceState("live")).toMatchObject({ source: "site", kind: "live", ingestionLive: true });
    expect(siteSourceState("idle").ingestionLive).toBe(false);
    expect(siteSourceState("ended").note).toContain("replay");
  });

  it("collectSourceStates orders site, twitch, youtube", () => {
    const states = collectSourceStates({ streamStatus: "live", accounts: [], destinations: [] });
    expect(states.map((s) => s.source)).toEqual(["site", "twitch", "youtube"]);
    expect(states.filter((s) => s.ingestionLive).map((s) => s.source)).toEqual(["site"]);
  });
});

describe("panel wiring pins (source-level)", () => {
  const panel = readFileSync(new URL("../components/live/LiveChatPanel.tsx", import.meta.url), "utf8");

  it("the panel renders the merged source strip and per-message source badges", () => {
    expect(panel).toContain('data-testid="chat-source-strip"');
    expect(panel).toContain('data-testid="chat-source-badge"');
    expect(panel).toContain("collectMergedMessages");
    expect(panel).toContain("collectSourceStates");
  });

  it("the panel states the send target honestly and never cross-posts", () => {
    expect(panel).toContain("SEND_TARGET_NOTE");
    expect(panel.toLowerCase()).not.toContain("cross-post to twitch and youtube");
  });
});
