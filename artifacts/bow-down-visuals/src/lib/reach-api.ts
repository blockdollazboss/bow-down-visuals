import { apiJson } from "@/lib/social-api";

/* ── Stack 9 "Reach" API client — camelCase DTOs from /api/reach. ── */

export interface SavedDestination {
  platform: string;
  ingestUrl: string;
  hasKey: boolean;
  updatedAt: string | null;
}

export interface FanOutVerdict {
  platform: string;
  status: "live" | "error" | "pending";
  reason: string | null;
}

export interface PremiereDto {
  id: string;
  title: string;
  kind: "premiere";
  phase: "scheduled" | "live" | "ended" | "cancelled";
  scheduledAt: string | null;
  durationSeconds: number;
  positionSeconds: number;
  videoUrl: string | null;
  clipId: string | null;
  chatStreamId: string | null;
  creator: { id: string; slug: string; displayName: string; avatarUrl: string | null } | null;
}

export interface RaidDto {
  id: string;
  sourceStreamId: string;
  targetStreamId: string;
  viewerCount: number;
  countdownSeconds: number;
  raider: { id: string; slug: string; displayName: string; avatarUrl: string | null } | null;
  target: { id: string; slug: string; displayName: string; avatarUrl: string | null } | null;
  createdAt: string | null;
}

export interface WatchProgress {
  secondsWatched: number;
  thresholds: Array<{ seconds: number; amountVb: number; earned: boolean; progressSeconds: number }>;
  weeklyBudget: { capVb: number; spentVb: number; remainingVb: number };
  justAwarded?: Array<{ thresholdSeconds: number; amountVb: number }>;
  budgetReached?: boolean;
}

export interface LoyaltyState {
  profileId: string;
  enabled: boolean;
  watchPointsPer10Min: number;
  chatPoints: number;
  tipPointsPer100Vb: number;
  customRewardLabel: string | null;
  customRewardCost: number | null;
  perks: Array<{ kind: string; label: string; cost: number }>;
  notice: string;
  myPoints: number;
  myRedemptions: Array<{ id: string; perkKind: string; perkLabel: string; pointsCost: number; status: string; createdAt: string | null }>;
}

export type GetToken = () => Promise<string | null>;

export const reachApi = {
  listDestinations: (t: GetToken) => apiJson<{ destinations: SavedDestination[] }>(t, "/api/reach/destinations"),
  saveDestination: (t: GetToken, platform: string, ingestUrl: string, streamKey: string) =>
    apiJson<{ destination: SavedDestination }>(t, `/api/reach/destinations/${encodeURIComponent(platform)}`, {
      method: "PUT",
      body: JSON.stringify({ ingestUrl, streamKey }),
    }),
  deleteDestination: (t: GetToken, platform: string) =>
    apiJson<{ ok: boolean }>(t, `/api/reach/destinations/${encodeURIComponent(platform)}`, { method: "DELETE" }),
  runFanOut: (t: GetToken, streamId: string) =>
    apiJson<{ verdicts: FanOutVerdict[] }>(t, `/api/reach/streams/${streamId}/fanout`, { method: "POST", body: "{}" }),

  createPremiere: (t: GetToken, body: { clipId: string; title: string; durationSeconds: number; scheduledAt: string }) =>
    apiJson<{ premiere: PremiereDto }>(t, "/api/reach/premieres", { method: "POST", body: JSON.stringify(body) }),
  getPremiere: (t: GetToken, id: string) => apiJson<{ premiere: PremiereDto }>(t, `/api/reach/premieres/${id}`),
  upcomingPremieres: (t: GetToken) => apiJson<{ premieres: PremiereDto[] }>(t, "/api/reach/premieres/upcoming"),
  cancelPremiere: (t: GetToken, id: string) => apiJson<{ ok: boolean }>(t, `/api/reach/premieres/${id}/cancel`, { method: "POST", body: "{}" }),

  raid: (t: GetToken, sourceStreamId: string, targetStreamId: string) =>
    apiJson<{ raid: RaidDto }>(t, `/api/reach/streams/${sourceStreamId}/raid`, { method: "POST", body: JSON.stringify({ targetStreamId }) }),
  raidOutgoing: (t: GetToken, streamId: string) => apiJson<{ raid: RaidDto | null }>(t, `/api/reach/streams/${streamId}/raid-outgoing`),
  raidIncoming: (t: GetToken, streamId: string) => apiJson<{ raid: RaidDto | null }>(t, `/api/reach/streams/${streamId}/raid-incoming`),

  watchHeartbeat: (t: GetToken, streamId: string, sessionId: string) =>
    apiJson<WatchProgress>(t, `/api/reach/streams/${streamId}/watch`, { method: "POST", body: JSON.stringify({ sessionId }) }),
  watchProgress: (t: GetToken, streamId: string) => apiJson<WatchProgress>(t, `/api/reach/streams/${streamId}/watch-progress`),

  loyalty: (t: GetToken, profileId: string) => apiJson<LoyaltyState>(t, `/api/reach/loyalty/${profileId}`),
  saveLoyaltySettings: (t: GetToken, profileId: string, body: Record<string, unknown>) =>
    apiJson<LoyaltyState>(t, `/api/reach/loyalty/${profileId}/settings`, { method: "PUT", body: JSON.stringify(body) }),
  redeem: (t: GetToken, profileId: string, perkKind: string) =>
    apiJson<{ redemption: unknown; myPoints: number }>(t, `/api/reach/loyalty/${profileId}/redeem`, { method: "POST", body: JSON.stringify({ perkKind }) }),
  redemptionQueue: (t: GetToken, profileId: string) =>
    apiJson<{ redemptions: Array<{ id: string; userId: string; perkLabel: string; pointsCost: number; status: string; createdAt: string | null }> }>(t, `/api/reach/loyalty/${profileId}/redemptions`),
  resolveRedemption: (t: GetToken, id: string, decision: "fulfilled" | "declined") =>
    apiJson<{ ok: boolean; status: string }>(t, `/api/reach/loyalty/redemptions/${id}/resolve`, { method: "POST", body: JSON.stringify({ decision }) }),

  closeFriends: (t: GetToken) =>
    apiJson<{ friends: Array<{ userId: string; profile: { id: string; slug: string; displayName: string; avatarUrl: string | null } | null; addedAt: string | null }> }>(t, "/api/reach/close-friends"),
  addCloseFriend: (t: GetToken, friendProfileId: string) =>
    apiJson<{ ok: boolean }>(t, "/api/reach/close-friends", { method: "POST", body: JSON.stringify({ friendProfileId }) }),
  removeCloseFriend: (t: GetToken, friendProfileId: string) =>
    apiJson<{ ok: boolean }>(t, `/api/reach/close-friends/${friendProfileId}`, { method: "DELETE" }),

  broadcastInbox: (t: GetToken) =>
    apiJson<{
      channels: Array<{ id: string; name: string; profileId: string; creator: { slug: string; displayName: string } | null }>;
      posts: Array<{ id: string; channelId: string; channelName: string; body: string; createdAt: string | null; creator: { slug: string; displayName: string } | null }>;
    }>(t, "/api/reach/broadcast/inbox"),
  broadcastChannels: (t: GetToken) =>
    apiJson<{ channels: Array<{ id: string; name: string; description: string; profileId: string; memberCount: number; isMember: boolean; isOwner: boolean; creator: { slug: string; displayName: string; avatarUrl: string | null } | null }> }>(t, "/api/reach/broadcast/channels"),
  createBroadcastChannel: (t: GetToken, name: string, description: string) =>
    apiJson<{ channel: unknown }>(t, "/api/reach/broadcast/channels", { method: "POST", body: JSON.stringify({ name, description }) }),
  joinBroadcast: (t: GetToken, id: string) => apiJson<{ ok: boolean; memberCount: number }>(t, `/api/reach/broadcast/channels/${id}/join`, { method: "POST", body: "{}" }),
  leaveBroadcast: (t: GetToken, id: string) => apiJson<{ ok: boolean; memberCount: number }>(t, `/api/reach/broadcast/channels/${id}/leave`, { method: "POST", body: "{}" }),
  broadcastPosts: (t: GetToken, id: string) =>
    apiJson<{ posts: Array<{ id: string; body: string; createdAt: string | null }> }>(t, `/api/reach/broadcast/channels/${id}/posts`),
  postBroadcast: (t: GetToken, id: string, body: string) =>
    apiJson<{ post: unknown }>(t, `/api/reach/broadcast/channels/${id}/posts`, { method: "POST", body: JSON.stringify({ body }) }),
};
