/**
 * unified-live-chat.ts — the server side of the unified cross-platform
 * live chat (Round-2 #12).
 *
 * ONE model, ONE feed: every chat message the stream chat renders —
 * history, socket delivery, the merged panel — is a UnifiedChatMessage
 * carrying the source it arrived from. Sources:
 *
 *   - "site"    — Bow Down's own stream chat (routes/live-chat.ts).
 *                 LIVE: it is the only ingesting source today.
 *   - "twitch"  — config-gated ingestion adapter (below). OFF.
 *   - "youtube" — config-gated ingestion adapter (below). OFF.
 *
 * External ingestion is FAIL CLOSED, in two independent locks:
 *
 *   1. The config gate (evaluateSourceGate): an external source is
 *      even *configured* only when BOTH its enable flag
 *      (LIVE_CHAT_INGEST_TWITCH / LIVE_CHAT_INGEST_YOUTUBE = "1") AND
 *      its platform chat credential are present in the environment.
 *      Either missing → disabled, with the reason stated.
 *   2. The transport lock: no Twitch/YouTube chat transport exists in
 *      this codebase yet (no platform app/OAuth approval has landed),
 *      so `canIngest` is false for every external adapter in every
 *      configuration. A configured-but-transportless adapter reports
 *      exactly that — it never simulates, samples, or invents a
 *      message. When a real transport lands it replaces the adapter
 *      behind this same interface and flips canIngest itself.
 *
 * The merge (mergeUnifiedFeed) enforces the same rule the FE seam
 * layer pins: a message is admitted ONLY from an adapter whose
 * canIngest is true and ONLY when its source tag matches the adapter.
 *
 * Presence is TRUTHFUL by construction (unifiedPresence): the site
 * count comes from real measured presence (heartbeat sessions /
 * connected chat sockets, supplied by the caller); external counts
 * are `null` — unknown — never 0 (which would claim "nobody there")
 * and never a padded number. Totals sum KNOWN sources only and say
 * which sources they cover.
 */

/* ------------------------------------------------------------- model */

export type UnifiedChatSourceId = "site" | "twitch" | "youtube";

export const UNIFIED_CHAT_SOURCES: readonly UnifiedChatSourceId[] = ["site", "twitch", "youtube"];

export const EXTERNAL_SOURCES: readonly Exclude<UnifiedChatSourceId, "site">[] = ["twitch", "youtube"];

/** One message in the unified feed — the shape stream chat renders
 *  from, whatever source it arrived through. */
export interface UnifiedChatMessage {
  id: string;
  streamId: string;
  source: UnifiedChatSourceId;
  /** The platform's own message id for ingested messages (dedupe key
   *  with source); null for site messages, whose id IS the key. */
  externalId: string | null;
  /** Bow Down user id of the author; null for external authors, who
   *  are never invented as site users. */
  userId: string | null;
  authorName: string;
  authorAvatarUrl: string | null;
  body: string;
  kind: "chat" | "tip";
  tipAmountVb: number | null;
  createdAt: string;
}

/* -------------------------------------------------------- config gate */

export interface SourceGate {
  source: Exclude<UnifiedChatSourceId, "site">;
  /** The owner/config switch is on (flag set AND credential present). */
  configured: boolean;
  /** A real transport exists and messages really flow. Always false
   *  until a transport is implemented behind the adapter. */
  canIngest: boolean;
  /** Honest one-line reason for the current state. */
  reason: string;
}

const GATE_DEFS: Record<
  Exclude<UnifiedChatSourceId, "site">,
  { flag: string; credential: string; label: string }
> = {
  twitch: { flag: "LIVE_CHAT_INGEST_TWITCH", credential: "TWITCH_CHAT_OAUTH_TOKEN", label: "Twitch" },
  youtube: { flag: "LIVE_CHAT_INGEST_YOUTUBE", credential: "YOUTUBE_CHAT_OAUTH_TOKEN", label: "YouTube" },
};

function envOn(value: string | undefined): boolean {
  return value === "1" || value === "true";
}

/**
 * Evaluate one external source's ingestion gate against an env map
 * (process.env in production; a literal in tests). Fail closed at
 * every step: flag off → disabled; flag on but credential missing →
 * disabled; both present → configured, but ingestion STILL off until
 * a real transport exists — the reason says so plainly.
 */
export function evaluateSourceGate(
  source: Exclude<UnifiedChatSourceId, "site">,
  env: Record<string, string | undefined>,
): SourceGate {
  const def = GATE_DEFS[source];
  if (!envOn(env[def.flag])) {
    return {
      source,
      configured: false,
      canIngest: false,
      reason: `${def.label} chat ingestion is off — ${def.flag} is not enabled.`,
    };
  }
  if (!env[def.credential]) {
    return {
      source,
      configured: false,
      canIngest: false,
      reason: `${def.label} chat ingestion is enabled but ${def.credential} is not set — staying off rather than guessing.`,
    };
  }
  return {
    source,
    configured: true,
    canIngest: false,
    reason: `${def.label} chat is configured, but no ${def.label} chat transport is connected yet — no ${def.label} messages flow until it is.`,
  };
}

export function evaluateAllSourceGates(
  env: Record<string, string | undefined>,
): SourceGate[] {
  return EXTERNAL_SOURCES.map((s) => evaluateSourceGate(s, env));
}

/* ------------------------------------------------------------ adapters */

/**
 * One source feeding the unified feed. A future real Twitch/YouTube
 * transport implements this with `canIngest: true`; until then the
 * gated adapter below is what registers for external sources.
 */
export interface UnifiedChatAdapter {
  readonly source: UnifiedChatSourceId;
  readonly canIngest: boolean;
  collect(): UnifiedChatMessage[];
}

/** The site's own chat — the first (and today only) live adapter. It
 *  reads through a getter so the feed and the chat store can never
 *  disagree about the messages. */
export class SiteUnifiedChatAdapter implements UnifiedChatAdapter {
  readonly source = "site" as const;
  readonly canIngest = true;

  constructor(private readonly readMessages: () => readonly UnifiedChatMessage[]) {}

  collect(): UnifiedChatMessage[] {
    return [...this.readMessages()];
  }
}

/**
 * An external platform's ingestion adapter, behind the config gate.
 * INERT BY CONSTRUCTION in every configuration: it holds no message
 * store and `collect()` is hard-wired to empty — with no transport
 * connected there is no code path that could fabricate an external
 * message. The gate is still evaluated and exposed so surfaces report
 * the honest state (off / unconfigured / configured-awaiting-transport).
 */
export class GatedExternalChatAdapter implements UnifiedChatAdapter {
  readonly canIngest = false;
  readonly gate: SourceGate;

  constructor(
    readonly source: Exclude<UnifiedChatSourceId, "site">,
    env: Record<string, string | undefined> = process.env,
  ) {
    this.gate = evaluateSourceGate(source, env);
  }

  collect(): UnifiedChatMessage[] {
    return [];
  }
}

/** The adapter registry for one stream's unified feed: site first
 *  (live), then the gated external adapters in display order. */
export function createUnifiedChatRegistry(
  readSiteMessages: () => readonly UnifiedChatMessage[],
  env: Record<string, string | undefined> = process.env,
): UnifiedChatAdapter[] {
  return [
    new SiteUnifiedChatAdapter(readSiteMessages),
    new GatedExternalChatAdapter("twitch", env),
    new GatedExternalChatAdapter("youtube", env),
  ];
}

/* --------------------------------------------------------------- merge */

/**
 * Merge every adapter's messages into one time-ordered feed.
 *
 * The no-fake-messages guard lives here, not just in the adapters: a
 * message is admitted ONLY from an adapter whose `canIngest` is true,
 * and ONLY when the message's own source tag matches the adapter that
 * produced it. Dedupe is per source: (source, externalId ?? id).
 */
export function mergeUnifiedFeed(adapters: readonly UnifiedChatAdapter[]): UnifiedChatMessage[] {
  const out: UnifiedChatMessage[] = [];
  const seen = new Set<string>();
  for (const adapter of adapters) {
    if (!adapter.canIngest) continue;
    for (const m of adapter.collect()) {
      if (m.source !== adapter.source) continue;
      const key = `${m.source}:${m.externalId ?? m.id}`;
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

/* --------------------------------------------------------- source state */

export interface UnifiedSourceState {
  source: UnifiedChatSourceId;
  /** Messages from this source really reach the feed. */
  ingestionLive: boolean;
  /** For external sources: the config gate verdict. Null for site. */
  gate: SourceGate | null;
  note: string;
}

export function unifiedSourceStates(args: {
  streamStatus: "live" | "ended" | "idle";
  env?: Record<string, string | undefined>;
}): UnifiedSourceState[] {
  const env = args.env ?? process.env;
  const site: UnifiedSourceState =
    args.streamStatus === "live"
      ? {
          source: "site",
          ingestionLive: true,
          gate: null,
          note: "Bow Down chat is live — messages here are this stream's own chat.",
        }
      : {
          source: "site",
          ingestionLive: false,
          gate: null,
          note:
            args.streamStatus === "ended"
              ? "This stream has ended — showing its Bow Down chat replay."
              : "Bow Down chat opens when the stream starts.",
        };
  const external: UnifiedSourceState[] = evaluateAllSourceGates(env).map((gate) => ({
    source: gate.source,
    ingestionLive: false,
    gate,
    note: gate.reason,
  }));
  return [site, ...external];
}

/* ------------------------------------------------------------- presence */

export interface SourcePresence {
  source: UnifiedChatSourceId;
  /** Real measured presence, or null when this source's presence is
   *  not measured. Null is the honest value — never a fabricated 0
   *  presented as a count of an external platform's viewers. */
  viewers: number | null;
}

export interface UnifiedPresence {
  perSource: SourcePresence[];
  /** Sum of the KNOWN sources only. */
  totalKnown: number;
  /** Which sources the total actually covers. */
  knownSources: UnifiedChatSourceId[];
}

/**
 * Aggregate presence across sources without inventing a single head.
 * The site's count is supplied by the caller from real measurement
 * (heartbeat sessions on the watch page); external sources contribute
 * null until a real platform presence feed exists behind their gate.
 */
export function unifiedPresence(args: { siteViewers: number }): UnifiedPresence {
  const siteViewers = Math.max(0, Math.floor(args.siteViewers));
  const perSource: SourcePresence[] = [
    { source: "site", viewers: siteViewers },
    ...EXTERNAL_SOURCES.map((source) => ({ source, viewers: null as number | null })),
  ];
  return { perSource, totalKnown: siteViewers, knownSources: ["site"] };
}
