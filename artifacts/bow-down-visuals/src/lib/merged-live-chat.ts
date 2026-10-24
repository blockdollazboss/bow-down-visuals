/**
 * merged-live-chat.ts — the merged live-chat seam layer (Stack-100 #3,
 * feature #12 shell).
 *
 * ONE chat panel for a live stream, fed by source adapters:
 *
 *   - "site"    — Bow Down's own stream chat. LIVE today: it wraps the
 *                 existing LiveChatClient, so send / receive /
 *                 moderation behave exactly as they always have.
 *   - "twitch"  — INERT seam. No Twitch chat ingestion exists and no
 *                 Twitch OAuth/app approval has landed, so this
 *                 adapter can never produce a message.
 *   - "youtube" — INERT seam, same story for YouTube.
 *
 * The hard rule of this layer: NO FAKE MESSAGES. An inert adapter
 * holds no message store at all — there is nothing in it that could
 * fabricate an external message — and the merge step additionally
 * refuses messages from any adapter whose `canIngest` is false, so
 * even a future buggy adapter cannot leak simulated chat into the
 * panel. External sources appear ONLY as honest connection states
 * derived from the platform-connection state the site already keeps:
 *
 *   - connected accounts: GET /api/social/accounts (routes/social.ts)
 *   - multistream destinations: GET /api/reach/destinations
 *     (routes/reach.ts) — a saved RTMP key sends video OUT; it never
 *     brings chat back IN, and the state copy says exactly that.
 *
 * Sending goes to the site's own chat only. Nothing here cross-posts,
 * and nothing pretends to.
 */

import type { ChatMessage } from "./live-chat-client";

/* ------------------------------------------------------------ sources */

export type ChatSourceId = "site" | "twitch" | "youtube";

/** The external platforms with inert chat seams, in display order. */
export const EXTERNAL_CHAT_SOURCES: readonly ChatSourceId[] = ["twitch", "youtube"];

export interface SourceBadge {
  label: string;
  /** Short tag rendered on each message row. */
  short: string;
}

const BADGES: Record<ChatSourceId, SourceBadge> = {
  site: { label: "Bow Down", short: "Bow Down" },
  twitch: { label: "Twitch", short: "Twitch" },
  youtube: { label: "YouTube", short: "YouTube" },
};

export function sourceBadge(source: ChatSourceId): SourceBadge {
  return BADGES[source];
}

/** A message in the merged list — the site's own chat shape plus the
 *  source it arrived from. Only adapters that can ingest may produce
 *  these; today that is the site adapter alone. */
export interface MergedChatMessage extends ChatMessage {
  source: ChatSourceId;
}

/* ------------------------------------------------------- connection */

/**
 * Honest connection state for one source.
 *
 * - "live":              messages really flow (the site's own chat
 *                        while the stream is live).
 * - "site_idle":         the site's own chat, stream not live yet /
 *                        ended — the panel's composer rules apply.
 * - "account_connected": a platform account is connected, but chat
 *                        ingestion is still awaiting the platform's
 *                        OAuth/app approval — no messages flow.
 * - "destination_only":  a multistream stream key is saved, so video
 *                        goes OUT to the platform — chat never comes
 *                        back in. Not a chat connection.
 * - "not_connected":     no account and no destination for the
 *                        platform — and ingestion awaits approval
 *                        regardless.
 * - "check_failed":      the connection state couldn't be loaded, so
 *                        nothing is claimed either way.
 */
export type SourceConnectionKind =
  | "live"
  | "site_idle"
  | "account_connected"
  | "destination_only"
  | "not_connected"
  | "check_failed";

export interface SourceConnection {
  source: ChatSourceId;
  kind: SourceConnectionKind;
  /** True only when messages from this source really reach the panel. */
  ingestionLive: boolean;
  /** One honest line for the panel's source strip. */
  note: string;
}

/** The slice of GET /api/social/accounts this layer reads. Twitch and
 *  YouTube accounts cannot exist there today (the OAuth routes cover
 *  instagram / tiktok / facebook) — the read is structural, so a
 *  future Twitch/YouTube account is picked up without a rewrite. */
export interface PlatformAccountLike {
  platform: string;
  expired: boolean;
}

/** The slice of GET /api/reach/destinations this layer reads. */
export interface SavedDestinationLike {
  platform: string;
}

/**
 * The external sources' connection states, derived ONLY from the
 * platform-connection state passed in. Every external state has
 * `ingestionLive: false` — until real ingestion code lands behind
 * these adapters, there is no input that can flip an external source
 * live: a connected account or a saved key is reported as exactly
 * what it is, never as flowing chat.
 */
export function externalSourceStates(args: {
  accounts: readonly PlatformAccountLike[] | null;
  destinations: readonly SavedDestinationLike[] | null;
  /** True when the connection reads themselves failed. */
  loadFailed?: boolean;
}): SourceConnection[] {
  if (args.loadFailed) {
    return EXTERNAL_CHAT_SOURCES.map((source) => ({
      source,
      kind: "check_failed" as const,
      ingestionLive: false,
      note: "Couldn't check your platform connections — nothing is claimed either way.",
    }));
  }
  const accounts = args.accounts ?? [];
  const destinations = args.destinations ?? [];
  return EXTERNAL_CHAT_SOURCES.map((source) => {
    const label = BADGES[source].label;
    const account = accounts.find((a) => a.platform === source && !a.expired);
    if (account) {
      return {
        source,
        kind: "account_connected" as const,
        ingestionLive: false,
        note: `Your ${label} account is connected, but ${label} chat joins this panel when the platform approval lands — no ${label} messages flow yet.`,
      };
    }
    if (destinations.some((d) => d.platform === source)) {
      return {
        source,
        kind: "destination_only" as const,
        ingestionLive: false,
        note: `Your stream key sends video out to ${label} — ${label} chat doesn't come back in yet. Chat here is Bow Down only.`,
      };
    }
    return {
      source,
      kind: "not_connected" as const,
      ingestionLive: false,
      note: `${label} chat will join this panel when its platform connection lands — for now, chat here is Bow Down only.`,
    };
  });
}

/** The site's own source state: live while the stream is live. */
export function siteSourceState(streamStatus: "live" | "ended" | "idle"): SourceConnection {
  if (streamStatus === "live") {
    return {
      source: "site",
      kind: "live",
      ingestionLive: true,
      note: "Bow Down chat is live — messages here are this stream's own chat.",
    };
  }
  return {
    source: "site",
    kind: "site_idle",
    ingestionLive: false,
    note:
      streamStatus === "ended"
        ? "This stream has ended — showing its Bow Down chat replay."
        : "Bow Down chat opens when the stream starts.",
  };
}

/* --------------------------------------------------------- adapters */

/**
 * One chat source feeding the merged panel. A future real Twitch /
 * YouTube ingestion implements this same interface with a real
 * transport and `canIngest: true`; until then the inert adapters
 * below are what register.
 */
export interface ChatSourceAdapter {
  readonly source: ChatSourceId;
  /** Can this adapter produce messages right now? */
  readonly canIngest: boolean;
  /** Can the composer send through this adapter? Site only, forever
   *  until a platform grants write access — and even then sending
   *  stays an explicit per-source act, never a silent cross-post. */
  readonly canSend: boolean;
  /** The messages this adapter contributes, tagged with its source. */
  collect(): MergedChatMessage[];
}

/** The site's own stream chat — the first (and today only) live
 *  adapter. It reads the LiveChatClient's store through a getter so
 *  the panel and the adapter can never disagree about the messages. */
export class SiteChatAdapter implements ChatSourceAdapter {
  readonly source = "site" as const;
  readonly canIngest = true;
  readonly canSend = true;

  constructor(private readonly readMessages: () => readonly ChatMessage[]) {}

  collect(): MergedChatMessage[] {
    return this.readMessages().map((m) => ({ ...m, source: "site" as const }));
  }
}

/**
 * An external platform's chat seam. INERT BY CONSTRUCTION: it holds
 * no message store, exposes no ingest method, and `collect()` is
 * hard-wired to empty — there is no code path in this class that
 * could fabricate an external message. When a platform's OAuth/app
 * approval lands, a real adapter replaces this one behind the same
 * interface; nothing in the panel changes.
 */
export class InertExternalChatAdapter implements ChatSourceAdapter {
  readonly canIngest = false;
  readonly canSend = false;

  constructor(readonly source: Exclude<ChatSourceId, "site">) {}

  collect(): MergedChatMessage[] {
    return [];
  }
}

/** The adapter registry for a stream's merged panel: the site's own
 *  chat first (live), then the inert external seams in display
 *  order. */
export function createChatSourceRegistry(readSiteMessages: () => readonly ChatMessage[]): ChatSourceAdapter[] {
  return [
    new SiteChatAdapter(readSiteMessages),
    new InertExternalChatAdapter("twitch"),
    new InertExternalChatAdapter("youtube"),
  ];
}

/** The only sources the composer may send to. Today and until a real
 *  cross-post feature is built and approved: the site's own chat. */
export function sendableSources(adapters: readonly ChatSourceAdapter[]): ChatSourceId[] {
  return adapters.filter((a) => a.canSend).map((a) => a.source);
}

/**
 * Merge every adapter's messages into one time-ordered list.
 *
 * The no-fake-messages guard lives here, not just in the inert
 * adapters: a message is admitted ONLY from an adapter whose
 * `canIngest` is true, and ONLY when the message's own source tag
 * matches the adapter that produced it. An inert adapter that
 * somehow returned a message would have it dropped, loudly by
 * construction (the tests pin this).
 */
export function collectMergedMessages(adapters: readonly ChatSourceAdapter[]): MergedChatMessage[] {
  const out: MergedChatMessage[] = [];
  const seen = new Set<string>();
  for (const adapter of adapters) {
    if (!adapter.canIngest) continue;
    for (const m of adapter.collect()) {
      if (m.source !== adapter.source) continue;
      const key = `${m.source}:${m.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(m);
    }
  }
  out.sort((a, b) => {
    const dt = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    return dt !== 0 ? dt : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  return out;
}

/** Every source's connection state for the panel's strip: the site's
 *  own state first, then the external states in display order. */
export function collectSourceStates(args: {
  streamStatus: "live" | "ended" | "idle";
  accounts: readonly PlatformAccountLike[] | null;
  destinations: readonly SavedDestinationLike[] | null;
  loadFailed?: boolean;
}): SourceConnection[] {
  return [siteSourceState(args.streamStatus), ...externalSourceStates(args)];
}

/** The composer's honest send-target line. Sending posts to Bow
 *  Down's own chat only — it never cross-posts to Twitch or YouTube,
 *  and the panel says so instead of implying a merged send. */
export const SEND_TARGET_NOTE = "Posts to Bow Down chat only — nothing is cross-posted to Twitch or YouTube.";
