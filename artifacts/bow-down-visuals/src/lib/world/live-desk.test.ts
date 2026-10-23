/**
 * live-desk — Live Wave I (stack-100 #85–#87) seam + sources.
 *
 * Pins:
 * - #85 the studio rails are the 2D studio's verbatim: the status
 *   door, the stream-kit transport (POST /api/live-streams with the
 *   SITE_DESTINATION, stop() ends it), the ingest-key doors,
 *   reachApi's destination keys + loyalty (with LoyaltySettingsPanel's
 *   fixed menus and the /api/creator-profiles/me profile resolution);
 * - #86 the host doors are guest-api's verbatim (mint/list/revoke
 *   invites, promote/demote/remove, host backstage REST) plus the
 *   BackstageClient socket, and the roster keeps GuestPanel's
 *   backstage/on_stage-only filter;
 * - #87 the guest doors are guest-api's verbatim (read, join,
 *   session, 25s heartbeat, backstage, leave) with the guest page's
 *   storage key, the server's 1–40-char name rule and the token
 *   extractor that never fires the read rail on an empty box;
 * - law: the desks dock in the hall Screen panel, which the World
 *   gates to signed-in members (!isGuest) — palace guests gain no
 *   voice; no desk links out to /go-live to complete its flow, and
 *   nothing here charges (no credit/confirm machinery).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  LIVE_STATUS_PATH, LIVE_STREAM_PATH, LIVE_STREAM_END_PATH,
  INGEST_KEY_PATH, INGEST_KEY_REVEAL_PATH, INGEST_KEY_REGENERATE_PATH, INGEST_KEY_REVOKE_PATH,
  MY_PROFILE_PATH,
  LOYALTY_WATCH_MENU, LOYALTY_CHAT_MENU, LOYALTY_TIP_MENU, LOYALTY_CUSTOM_COST_MENU,
  INVITE_EXPIRY_OPTIONS, BACKSTAGE_SAY_MAX,
  normalizeLiveStatus, streamTitleReady, ingestKeyShownOnce,
  normalizeGuestRoster, inviteShareUrl, backstageDraftReady,
  extractInviteToken, guestStorageKey, guestNameReady, guestSessionActive,
  LIVE_WAVE1_PROMOTIONS, LIVE_NATIVE_FOLLOW_ONS,
} from "./live-desk";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const deskSrc = read("../../components/world/native/LiveDesk.tsx");
const worldSrc = read("../../pages/world.tsx");
const guestApiSrc = read("../go-live/guest-api.ts");
const transportSrc = read("../stream-kit/transport.ts");

describe("#85 studio rails — the 2D studio's verbatim doors", () => {
  it("pins every studio path verbatim", () => {
    expect(LIVE_STATUS_PATH).toBe("/api/live-streams/status");
    expect(LIVE_STREAM_PATH("s 1")).toBe("/api/live-streams/s%201");
    expect(LIVE_STREAM_END_PATH("s1")).toBe("/api/live-streams/s1/end");
    expect(INGEST_KEY_PATH).toBe("/api/live-streams/ingest-key");
    expect(INGEST_KEY_REVEAL_PATH).toBe("/api/live-streams/ingest-key/reveal");
    expect(INGEST_KEY_REGENERATE_PATH).toBe("/api/live-streams/ingest-key/regenerate");
    expect(INGEST_KEY_REVOKE_PATH).toBe("/api/live-streams/ingest-key/revoke");
    expect(MY_PROFILE_PATH).toBe("/api/creator-profiles/me");
  });

  it("normalizes the status payload the studio reads (configured, transport, live stream)", () => {
    expect(normalizeLiveStatus({
      configured: true, transport: "own",
      live_stream: { id: "s1", title: "Show", viewer_count: 7 },
    })).toEqual({ configured: true, transport: "own", liveStream: { id: "s1", title: "Show", viewerCount: 7 } });
    expect(normalizeLiveStatus({ configured: false, transport: "weird", live_stream: null }))
      .toEqual({ configured: false, transport: null, liveStream: null });
    expect(normalizeLiveStatus(null)).toEqual({ configured: false, transport: null, liveStream: null });
  });

  it("the title gate is createSchema's: 1–200 trimmed characters", () => {
    expect(streamTitleReady("  Show  ")).toBe(true);
    expect(streamTitleReady("   ")).toBe(false);
    expect(streamTitleReady("x".repeat(201))).toBe(false);
  });

  it("an ingest key is shown only from the response that minted it", () => {
    expect(ingestKeyShownOnce("sk_live_123")).toBe(true);
    expect(ingestKeyShownOnce(null)).toBe(false);
    expect(ingestKeyShownOnce("")).toBe(false);
  });

  it("loyalty menus are LoyaltySettingsPanel's fixed menus verbatim", () => {
    expect([...LOYALTY_WATCH_MENU]).toEqual([0, 5, 10, 20]);
    expect([...LOYALTY_CHAT_MENU]).toEqual([0, 1, 2, 5]);
    expect([...LOYALTY_TIP_MENU]).toEqual([0, 5, 10]);
    expect([...LOYALTY_CUSTOM_COST_MENU]).toEqual([500, 1000, 2500, 5000]);
  });

  it("the desk rides the transport + SITE_DESTINATION, reachApi destinations/loyalty, and the ingest doors", () => {
    expect(deskSrc).toContain("createStreamTransport(status?.transport ?? \"own\")");
    expect(deskSrc).toContain("destinations: [{ ...SITE_DESTINATION }]");
    expect(deskSrc).toContain("WhipTransport.api.getAccessToken = getAccessToken");
    expect(deskSrc).toContain("OwnServerTransport.api.getAccessToken = getAccessToken");
    expect(deskSrc).toContain("reachApi.listDestinations");
    expect(deskSrc).toContain("reachApi.saveDestination");
    expect(deskSrc).toContain("reachApi.deleteDestination");
    expect(deskSrc).toContain("reachApi.loyalty");
    expect(deskSrc).toContain("reachApi.saveLoyaltySettings");
    expect(deskSrc).toContain("reachApi.redemptionQueue");
    expect(deskSrc).toContain("reachApi.resolveRedemption");
    expect(deskSrc).toContain("pendingRedemptionsFromPayload");
    expect(deskSrc).toContain("INGEST_KEY_REVEAL_PATH");
    expect(deskSrc).toContain("INGEST_KEY_REGENERATE_PATH");
    expect(deskSrc).toContain("INGEST_KEY_REVOKE_PATH");
    expect(deskSrc).toContain('method: "PATCH"');
    /* The transports themselves own the create/end session calls. */
    expect(transportSrc).toContain("/api/live-streams");
    expect(transportSrc).toContain("/end`");
  });
});

describe("#86 guests & backstage — GuestPanel's host doors verbatim", () => {
  it("guest-api carries the exact host rails the desk imports", () => {
    expect(guestApiSrc).toContain("/guest-invites`");
    expect(guestApiSrc).toContain("/guests/${sessionId}/promote`");
    expect(guestApiSrc).toContain("/guests/${sessionId}/demote`");
    expect(guestApiSrc).toContain("/guests/${sessionId}/remove`");
    expect(guestApiSrc).toContain("/backstage/messages`");
    for (const fn of ["mintGuestInvite", "listGuestInvites", "revokeGuestInvite", "promoteGuest", "demoteGuest", "removeGuest", "hostBackstageHistory", "hostBackstagePost"]) {
      expect(deskSrc).toContain(fn);
    }
    expect(deskSrc).toContain("new BackstageClient({");
  });

  it("the roster keeps only backstage / on_stage sessions, like GuestPanel", () => {
    const roster = normalizeGuestRoster([
      { id: "g1", display_name: "Ana", state: "backstage" },
      { id: "g2", display_name: "Bo", state: "on_stage" },
      { id: "g3", display_name: "Cy", state: "left" },
      { id: "g4", display_name: "Di", state: "removed" },
      { noId: true },
      "junk",
    ]);
    expect(roster.map((g) => g.id)).toEqual(["g1", "g2"]);
    expect(roster[1]!.onStage).toBe(true);
    expect(roster[0]!.onStage).toBe(false);
    expect(normalizeGuestRoster(null)).toEqual([]);
  });

  it("invite defaults are GuestPanel's: 4-hour expiry selected from the menu, share URL from invite_path", () => {
    expect(INVITE_EXPIRY_OPTIONS.map((o) => o.minutes)).toEqual([60, 240, 1440, 10080]);
    expect(deskSrc).toContain('useState<string>("240")');
    expect(inviteShareUrl("https://example.com", "/live/guest/tok")).toBe("https://example.com/live/guest/tok");
  });

  it("the backstage composer mirrors the server's 1–500 rule", () => {
    expect(BACKSTAGE_SAY_MAX).toBe(500);
    expect(backstageDraftReady(" hi ")).toBe(true);
    expect(backstageDraftReady("   ")).toBe(false);
    expect(backstageDraftReady("x".repeat(501))).toBe(false);
  });
});

describe("#87 join as guest — the guest page's doors verbatim", () => {
  it("the token extractor takes links and bare tokens, and never fires on an empty box", () => {
    expect(extractInviteToken("https://bowdownvisuals.com/live/guest/abcDEF123_-x")).toBe("abcDEF123_-x");
    expect(extractInviteToken("  /live/guest/tok_12345  ")).toBe("tok_12345");
    expect(extractInviteToken("abcDEF123_-x")).toBe("abcDEF123_-x");
    expect(extractInviteToken("")).toBeNull();
    expect(extractInviteToken("hello world")).toBeNull();
    expect(extractInviteToken("short")).toBeNull();
  });

  it("the storage key, name rule and active states are the guest page's / server's", () => {
    expect(guestStorageKey("tok")).toBe("bdv-guest:tok");
    expect(guestNameReady(" Ana ")).toBe(true);
    expect(guestNameReady("")).toBe(false);
    expect(guestNameReady("x".repeat(41))).toBe(false);
    expect(guestSessionActive("backstage")).toBe(true);
    expect(guestSessionActive("on_stage")).toBe(true);
    expect(guestSessionActive("left")).toBe(false);
    expect(guestSessionActive(null)).toBe(false);
  });

  it("the desk rides guest-api's guest doors + the 25s heartbeat + BackstageClient with the guest token", () => {
    for (const fn of ["readInvite", "joinAsGuest", "guestSession", "guestHeartbeat", "guestLeave", "guestBackstageHistory", "guestBackstagePost"]) {
      expect(deskSrc).toContain(fn);
    }
    expect(guestApiSrc).toContain("/api/live-guest-invites/");
    expect(guestApiSrc).toContain("/api/live-guest/session");
    expect(guestApiSrc).toContain("/api/live-guest/session/heartbeat");
    expect(guestApiSrc).toContain("/api/live-guest/session/leave");
    expect(deskSrc).toContain("guestToken: sessToken");
    expect(deskSrc).toContain("25_000");
    expect(deskSrc).toContain("sessionStorage.setItem(guestStorageKey(inviteToken), data.session_token)");
  });
});

describe("law — members only, no link-out completion, nothing charged", () => {
  it("the desks dock inside the members-only Screen panel (palace guests gain no voice)", () => {
    expect(worldSrc).toContain('data-testid="world-live-desks"');
    expect(worldSrc).toContain("<LiveStudioDesk");
    expect(worldSrc).toContain("<LiveBackstageDesk");
    expect(worldSrc).toContain("<LiveGuestJoinDesk");
    /* The panel's own gate: screenPanelOpen && inHall && !isGuest. */
    expect(worldSrc).toContain("screenPanelOpen && inHall && !isGuest");
    expect(deskSrc).toContain("palace guests never");
  });

  it("no desk completes by linking out to the 2D studio, and the old link-out copy is gone from the panel", () => {
    expect(deskSrc).not.toContain('href="/go-live"');
    expect(deskSrc).not.toContain('"/go-live"');
    expect(worldSrc).not.toContain("open the Go Live studio");
    expect(worldSrc).toContain("in the Live studio right below, without leaving the hall");
  });

  it("nothing in the wave charges: no credits, no confirm-charge machinery (all three flows are free rails)", () => {
    expect(deskSrc).not.toContain("credits");
    expect(deskSrc).not.toContain("ConfirmCharge");
    expect(deskSrc).not.toContain("idempotency");
  });

  it("the board records the wave-I promotions (#88–#91 follow-ons retired by wave II)", () => {
    expect(LIVE_WAVE1_PROMOTIONS).toHaveLength(3);
    expect(LIVE_WAVE1_PROMOTIONS[0]).toContain("#85");
    expect(LIVE_WAVE1_PROMOTIONS[1]).toContain("#86");
    expect(LIVE_WAVE1_PROMOTIONS[2]).toContain("#87");
    /* Wave II built #88/#89/#90/#91 — the wave-I follow-on entries
       for them are retired (see live-desk-wave2.test.ts). */
    expect(LIVE_NATIVE_FOLLOW_ONS.join(" ")).not.toContain("stays with stack-100 #88");
    expect(LIVE_NATIVE_FOLLOW_ONS.join(" ")).not.toContain("stays with #89");
    expect(LIVE_NATIVE_FOLLOW_ONS.join(" ")).not.toContain("stays with #90");
  });
});
